/**
 * Chat processor: streams from the active LLM provider, persists the result,
 * and emits SSE events. Used by the background message queue and the inline
 * impersonate endpoint.
 *
 * Most of the heavy lifting lives in sibling modules:
 *   - chatContext.ts   — prompt building / token budgeting
 *   - chatStreamParser — `<thinking>` tag extraction
 *   - chatErrors.ts    — humanized provider error messages
 */
import { db, rawDb } from '$lib/db/index.js';
import { messages, chats, characters, providers, userSettings } from '$lib/db/schema.js';
import { eq, asc, and, sql } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import { cacheInlineImages } from '$lib/services/imageCache.js';
import { eventBus } from '$lib/server/eventBus.js';
import { applyRegexScripts } from '$lib/services/regex.js';
import { sendPushNotification } from '$lib/server/webPush.js';
import { presence } from '$lib/server/presence.js';
import { isWithinQuietHours } from '$lib/quietHours.js';
import { logger } from '$lib/server/logger.js';
import { bumpChatTail } from '$lib/db/chatTail.js';
import { broadcast } from '$lib/server/realtime.js';
import { activeGenerations } from '$lib/server/activeGenerations.js';
import { buildChatContext, type ProcessOptions } from './chatContext.js';
import { ThinkingTagParser } from './chatStreamParser.js';
import { resolveCompactionSettings, runCompaction, shouldAutoCompact } from './compactionService.js';

/** Truncation length for the chat-tail "preview" snippet shown in the sidebar. */
const PREVIEW_MAX_CHARS = 200;
import { humanizeAnyError } from './chatErrors.js';
import { parseImpersonationSwipes, type ImpersonationSwipe } from '$lib/chat/impersonationSwipes.js';

export type { ProcessOptions };
export type { ImpersonationSwipe };

export interface ProcessCallbacks {
	onTokenStats?: (stats: any) => void;
	onReasoning?: (text: string) => void;
	onToken?: (text: string) => void;
	onError?: (error: string) => void;
	onDone?: () => void;
}

/**
 * Process a chat request: stream from the LLM, save to DB, fan out SSE events.
 * Runs in the background (no HTTP response to write back to).
 */
export async function processChat(opts: ProcessOptions, signal?: AbortSignal): Promise<void> {
	const { chatId, regenerate, greeting, impersonate, guidance } = opts;
	void greeting;

	let ctx;
	try {
		ctx = buildChatContext(chatId, opts);
	} catch (err) {
		// Best-effort: try to look up the chat so we know whose error to emit.
		const fallbackChat = db.select().from(chats).where(eq(chats.id, chatId)).get();
		logger.warn('chatProcessor: buildChatContext failed', { chatId, err: err instanceof Error ? err.message : String(err) });
		eventBus.emit({ type: 'error', chatId, userId: fallbackChat?.userId ?? 0, data: { error: humanizeAnyError(err) } });
		return;
	}

	// Auto-compaction check: skipped for impersonate (read-only one-shot), and only
	// triggers when the user has compaction on and the prompt is already crowding
	// the context window. Synchronous — we block generation until the summary lands
	// so the live request actually uses it.
	if (!impersonate) {
		try {
			const settings = resolveCompactionSettings(ctx.chat, ctx.chatUserId);
			if (settings.enabled && shouldAutoCompact(ctx.tokenStats.promptTokens, ctx.tokenStats.availableForPrompt, settings.threshold)) {
				const result = await runCompaction(chatId);
				if (result.ran) {
					ctx = buildChatContext(chatId, opts);
				}
			}
		} catch (err) {
			logger.warn('chatProcessor: auto-compaction failed (continuing without)', { chatId, err: String(err) });
		}
	}

	const { chat, activeProvider, activeModel, samplerSettings, llmMessages, tokenStats, streamingEnabled, chatUserId } = ctx;

	const llm = createProvider(activeProvider.type as ProviderType, {
		endpoint: activeProvider.endpoint,
		apiKey: activeProvider.apiKey || '',
		model: activeModel,
	});

	let fullResponse = '';
	let fullReasoning = '';
	let contentStarted = false;

	// Figure out which message id is being regenerated (last assistant on the
	// active path). Lets every connected device — not just the originating one —
	// know which bubble to overlay with the regen indicator.
	let originalMessageId: number | null = null;
	if (regenerate) {
		const latestChat = db.select().from(chats).where(eq(chats.id, chatId)).get();
		const leafId = latestChat?.activeLeafId ?? null;
		if (leafId) {
			const pathRows = db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt)).all();
			const byId = new Map(pathRows.map(m => [m.id, m]));
			let cur: typeof pathRows[number] | undefined = byId.get(leafId);
			while (cur) {
				if (cur.role === 'assistant') { originalMessageId = cur.id; break; }
				cur = cur.parentId ? byId.get(cur.parentId) : undefined;
			}
		}
	}

	activeGenerations.start({ chatId, userId: chatUserId, isRegenerate: !!regenerate, isImpersonation: !!impersonate, originalMessageId });
	eventBus.emit({
		type: 'streaming', chatId, userId: chatUserId,
		data: { active: true, isRegenerate: !!regenerate, isImpersonation: !!impersonate, originalMessageId }
	});

	// In-memory snapshot of the impersonation swipes blob. We seed it from
	// the chat row once at start, then mutate locally and persist on each
	// transition (start → [abort/error →] done). Saves two SELECT+JSON.parse
	// passes per impersonation vs. re-reading the row at each step.
	let impSwipes: ImpersonationSwipe[] = [];
	let impIndex = -1;

	// Mark the chat as having an in-flight impersonation draft so reloads
	// from any device know to expect/restore one. We append a fresh
	// placeholder swipe so the streaming tokens have somewhere to land
	// when the client refetches mid-stream; index points at it.
	if (impersonate) {
		const startRow = db.select().from(chats).where(eq(chats.id, chatId)).get();
		impSwipes = parseImpersonationSwipes(startRow?.impersonationSwipes);
		impSwipes.push({ draft: '', reasoning: '', guidance: guidance?.trim() || undefined, generatedAt: null });
		impIndex = impSwipes.length - 1;
		db.update(chats)
			.set({
				impersonationStatus: 'streaming',
				impersonationSwipes: JSON.stringify(impSwipes),
				impersonationSwipeIndex: impIndex,
			})
			.where(eq(chats.id, chatId))
			.run();
		broadcast(chatUserId, {
			type: 'chat:impersonation',
			chatId,
			status: 'streaming',
			swipes: impSwipes,
			swipeIndex: impIndex
		});
	}

	const streamStartedAt = Date.now();
	let chunkCount = 0;
	logger.debug('chatProcessor: stream start', {
		chatId, userId: chatUserId,
		provider: activeProvider.type, model: activeModel,
		promptTokens: tokenStats.promptTokens, contextSize: tokenStats.contextSize,
		regenerate: !!regenerate, impersonate: !!impersonate,
	});

	// Periodic checkpoint of the in-flight impersonation draft so a hard
	// close → reopen still shows the partial response (otherwise the chat
	// row only carries the empty placeholder until the completion path
	// commits the final draft). Hoisted outside the try block so the
	// catch and finalisation paths can call cancelImpDraftFlush().
	let lastImpFlush = 0;
	let impFlushTimer: ReturnType<typeof setTimeout> | null = null;
	const flushImpDraft = () => {
		impFlushTimer = null;
		if (!impersonate || impIndex < 0) return;
		lastImpFlush = Date.now();
		impSwipes[impIndex] = {
			...impSwipes[impIndex],
			draft: fullResponse,
			reasoning: fullReasoning,
		};
		try {
			db.update(chats)
				.set({ impersonationSwipes: JSON.stringify(impSwipes) })
				.where(eq(chats.id, chatId))
				.run();
		} catch { /* best-effort checkpoint */ }
	};
	const scheduleImpDraftFlush = () => {
		if (impFlushTimer) return;
		const since = Date.now() - lastImpFlush;
		const delay = since >= 2000 ? 0 : 2000 - since;
		impFlushTimer = setTimeout(flushImpDraft, delay);
	};
	const cancelImpDraftFlush = () => {
		if (impFlushTimer) { clearTimeout(impFlushTimer); impFlushTimer = null; }
	};

	try {
		// Token stats first so the UI can render the prompt-size meter.
		const tokenStatsPayload = {
			contextSize: tokenStats.contextSize,
			maxResponseTokens: tokenStats.maxResponseTokens,
			promptTokens: tokenStats.promptTokens,
			availableForPrompt: tokenStats.availableForPrompt,
			breakdown: tokenStats.breakdown,
		};
		activeGenerations.setTokenStats(chatId, tokenStatsPayload);
		eventBus.emit({ type: 'tokenStats', chatId, userId: chatUserId, data: tokenStatsPayload });

		const parser = new ThinkingTagParser({
			onReasoning: (text) => {
				if (!text) return;
				fullReasoning += text;
				if (streamingEnabled) {
					activeGenerations.appendReasoning(chatId, text);
					eventBus.emit({ type: 'reasoning', chatId, userId: chatUserId, data: { reasoning: text, isImpersonation: !!impersonate } });
				}
				if (impersonate) scheduleImpDraftFlush();
			},
			onContent: (text) => {
				if (!text) return;
				let out = text;
				if (!contentStarted) {
					out = out.trimStart();
					if (!out) return;
					contentStarted = true;
				}
				fullResponse += out;
				if (streamingEnabled) {
					activeGenerations.appendToken(chatId, out);
					eventBus.emit({ type: 'token', chatId, userId: chatUserId, data: { token: out, isImpersonation: !!impersonate } });
				}
				if (impersonate) scheduleImpDraftFlush();
			},
		});

		for await (const chunk of llm.stream(llmMessages, samplerSettings, signal)) {
			chunkCount++;
			if (chunk.type === 'reasoning') {
				parser.handleReasoningChunk(chunk.text);
			} else {
				parser.handleContentChunk(chunk.text);
			}
		}
		parser.flush();

		// If streaming was off, dump everything in one go.
		if (!streamingEnabled) {
			if (fullReasoning) {
				activeGenerations.appendReasoning(chatId, fullReasoning);
				eventBus.emit({ type: 'reasoning', chatId, userId: chatUserId, data: { reasoning: fullReasoning, isImpersonation: !!impersonate } });
			}
			activeGenerations.appendToken(chatId, fullResponse);
			eventBus.emit({ type: 'token', chatId, userId: chatUserId, data: { token: fullResponse, isImpersonation: !!impersonate } });
		}
	} catch (err) {
		cancelImpDraftFlush();
		activeGenerations.clear(chatId);
		const aborted = signal?.aborted === true;
		if (aborted) {
			logger.info('chatProcessor: stream aborted', {
				chatId, userId: chatUserId, durationMs: Date.now() - streamStartedAt,
				chunkCount, partialChars: fullResponse.length,
			});
		} else {
			logger.error('chatProcessor: stream failed', {
				chatId, userId: chatUserId, provider: activeProvider.type, model: activeModel,
				durationMs: Date.now() - streamStartedAt, chunkCount, err,
			});
		}
		// For impersonation: keep whatever partial draft we have. Save it
		// to the active swipe entry so the user can see/edit/finish it
		// manually instead of losing the work.
		if (impersonate) {
			const generatedAt = new Date().toISOString();
			// On user-initiated abort: keep the partial response if there
			// was one, but DON'T inject the "⚠ No response returned"
			// placeholder for empty drafts — the user just cancelled, so
			// surfacing that scary text would be misleading and (more
			// importantly) leaves the textarea/draft stuck with content
			// the user didn't ask for.
			const partial = fullResponse || (!aborted && fullReasoning ? '⚠ No response returned' : '');
			const status = aborted ? 'done' : 'error';
			const finalStatus = (partial || fullReasoning) ? status : null;
			if (impIndex >= 0) {
				impSwipes[impIndex] = {
					...impSwipes[impIndex],
					draft: partial,
					reasoning: fullReasoning,
					generatedAt: finalStatus ? generatedAt : null,
				};
			}
			db.update(chats)
				.set({
					impersonationSwipes: JSON.stringify(impSwipes),
					impersonationSwipeIndex: impIndex >= 0 ? impIndex : 0,
					impersonationStatus: finalStatus,
				})
				.where(eq(chats.id, chatId))
				.run();
			broadcast(chatUserId, {
				type: 'chat:impersonation', chatId,
				status: finalStatus,
				swipes: impSwipes,
				swipeIndex: impIndex >= 0 ? impIndex : 0
			});
		}
		if (!aborted) {
			eventBus.emit({ type: 'error', chatId, userId: chatUserId, data: { error: humanizeAnyError(err), isImpersonation: !!impersonate } });
		}
		eventBus.emit({ type: 'streaming', chatId, userId: chatUserId, data: { active: false, isImpersonation: !!impersonate } });
		return;
	}

	logger.debug('chatProcessor: stream finished', {
		chatId, userId: chatUserId,
		durationMs: Date.now() - streamStartedAt,
		chunkCount,
		contentChars: fullResponse.length,
		reasoningChars: fullReasoning.length,
	});

	// Reasoning-only fallback: surface a placeholder so users see *something*
	// rather than an empty bubble / empty draft. Applies to both regular
	// replies and impersonation.
	if (!fullResponse && fullReasoning) {
		fullResponse = '⚠ No response returned';
	}

	// Persist to DB (skipped for impersonation — nothing to save).
	if ((fullResponse || fullReasoning) && !impersonate) {
		// Run AI-response regex scripts on the way in.
		fullResponse = applyRegexScripts(fullResponse, chatUserId, 'ai_response', chat.characterId);
		const cachedResponse = fullResponse ? await cacheInlineImages(fullResponse) : '';
		const latestChat = db.select().from(chats).where(eq(chats.id, chatId)).get();
		const parentMsgId = latestChat?.activeLeafId ?? null;

		if (regenerate) {
			// Re-read messages fresh — the snapshot from earlier may be stale by now.
			const freshMsgs = db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt)).all();
			const freshById = new Map(freshMsgs.map(m => [m.id, m]));

			const pathMsgs: typeof freshMsgs = [];
			if (parentMsgId) {
				let cur = freshById.get(parentMsgId);
				while (cur) {
					pathMsgs.push(cur);
					cur = cur.parentId ? freshById.get(cur.parentId) : undefined;
				}
				pathMsgs.reverse();
			}
			const lastAssistant = pathMsgs.filter(m => m.role === 'assistant').pop();

			if (lastAssistant) {
				const swipes: string[] = JSON.parse(lastAssistant.swipes || '[]');
				swipes.push(cachedResponse);
				const reasoningSwipes: string[] = JSON.parse(lastAssistant.reasoning || '[]');
				reasoningSwipes.push(fullReasoning || '');
				const newIndex = swipes.length - 1;
				db.update(messages)
					.set({
						content: cachedResponse,
						swipes: JSON.stringify(swipes),
						swipeIndex: newIndex,
						reasoning: JSON.stringify(reasoningSwipes),
					})
					.where(eq(messages.id, lastAssistant.id))
					.run();
				bumpChatTail(chatId, cachedResponse, 'assistant');
				broadcast(chatUserId, {
					type: 'message:patched',
					chatId,
					id: lastAssistant.id,
					patch: {
						content: cachedResponse,
						swipes,
						swipeIndex: newIndex,
						reasoning: reasoningSwipes
					}
				});
			}
		} else {
			// Wrap insert + activeLeafId update in a tx so a crash between the two
			// can't leave the chat pointing at a deleted message id (M1).
			const newGuidance = opts.guidance && opts.guidance.trim() ? opts.guidance : null;
			const assistantMsgId = rawDb.transaction(() => {
				const result = db.insert(messages)
					.values({
						chatId,
						role: 'assistant',
						content: cachedResponse,
						swipes: JSON.stringify([cachedResponse]),
						swipeIndex: 0,
						reasoning: JSON.stringify([fullReasoning || '']),
						// Persist the per-message reply guidance (if any) on the
						// assistant we just produced so future regenerations of
						// THIS message pick it up automatically. Chat-wide guidance
						// is intentionally not stored here — it's read live from
						// the chat row.
						guidance: newGuidance,
						parentId: parentMsgId,
					})
					.run();

				const id = Number(result.lastInsertRowid);
				db.update(chats).set({ activeLeafId: id, updatedAt: sql`datetime('now')` }).where(eq(chats.id, chatId)).run();
				// Pending guidance on the parent user message (left there by a
				// prior assistant deletion) has now been consumed by the new
				// reply — clear it so it doesn't get reapplied if the user
				// keeps the new reply and later sends another turn.
				if (newGuidance && parentMsgId != null) {
					db.update(messages)
						.set({ guidance: null })
						.where(and(eq(messages.id, parentMsgId), eq(messages.role, 'user')))
						.run();
				}
				return id;
			})();
			bumpChatTail(chatId, cachedResponse, 'assistant');
			const row = db.select().from(messages).where(eq(messages.id, assistantMsgId)).get();
			if (row) broadcast(chatUserId, { type: 'message:created', chatId, message: row as any });
			if (newGuidance && parentMsgId != null) {
				broadcast(chatUserId, {
					type: 'message:patched', chatId, id: parentMsgId,
					patch: { guidance: null }
				});
			}
		}
	}

	// Persist the impersonation draft to the chat row so any device opening
	// the chat after the stream finishes lands on the same text.
	if (impersonate) {
		cancelImpDraftFlush();
		const generatedAt = new Date().toISOString();
		const status = (fullResponse || fullReasoning) ? 'done' : null;
		if (impIndex >= 0) {
			impSwipes[impIndex] = {
				...impSwipes[impIndex],
				draft: fullResponse,
				reasoning: fullReasoning,
				generatedAt: status ? generatedAt : null,
			};
		}
		db.update(chats)
			.set({
				impersonationSwipes: JSON.stringify(impSwipes),
				impersonationSwipeIndex: impIndex >= 0 ? impIndex : 0,
				impersonationStatus: status,
			})
			.where(eq(chats.id, chatId))
			.run();
		broadcast(chatUserId, {
			type: 'chat:impersonation', chatId,
			status,
			swipes: impSwipes,
			swipeIndex: impIndex >= 0 ? impIndex : 0
		});
	}

	// Emit completion and bump unread.
	const viewedElsewhere = presence.hasFocusedSessionOnChat(chatUserId, chatId);
	const currentChat = db.select().from(chats).where(eq(chats.id, chatId)).get();
	eventBus.emit({
		type: 'complete', chatId, userId: chatUserId, data: {
			content: impersonate ? fullResponse : undefined,
			preview: fullResponse.length > PREVIEW_MAX_CHARS ? fullResponse.slice(0, PREVIEW_MAX_CHARS) + '…' : fullResponse,
			hasReasoning: !!fullReasoning,
			viewedElsewhere,
			muted: currentChat?.muted === true,
			isImpersonation: !!impersonate,
		}
	});

	// Increment unread count for this chat
	if (!impersonate) {
		const newUnread = (currentChat?.unread ?? 0) + 1;
		db.update(chats)
			.set({ unread: newUnread })
			.where(eq(chats.id, chatId))
			.run();
		eventBus.emit({ type: 'unread', chatId, userId: chatUserId, data: { count: newUnread } });

		// Web push (fire-and-forget). Only fires when nobody has the app open at all
		// (every device backgrounded or closed). If any device has the app in the
		// foreground — even on a different chat — the in-app toast on that device is
		// the notification; we don't need to also buzz the phone.
		//   viewedElsewhere      → someone is watching this exact chat → nothing
		//   appOpenSomewhere     → app is focused somewhere (different chat) → toast only, no push
		//   neither              → everything closed/backgrounded → push
		// Also suppressed for muted chats and during quiet hours.
		const chatMuted = currentChat?.muted === true;
		const appOpenSomewhere = presence.hasAnyFocusedSession(chatUserId);

		// Quiet hours: skip push entirely while in window (computed in user's tz).
		const qhEnabledRow = db.select().from(userSettings)
			.where(and(eq(userSettings.userId, chatUserId), eq(userSettings.key, 'quietHoursEnabled')))
			.get();
		let withinQuiet = false;
		if (qhEnabledRow?.value === 'true') {
			const qhStart = db.select().from(userSettings)
				.where(and(eq(userSettings.userId, chatUserId), eq(userSettings.key, 'quietHoursStart')))
				.get()?.value ?? '22:00';
			const qhEnd = db.select().from(userSettings)
				.where(and(eq(userSettings.userId, chatUserId), eq(userSettings.key, 'quietHoursEnd')))
				.get()?.value ?? '07:00';
			const tz = db.select().from(userSettings)
				.where(and(eq(userSettings.userId, chatUserId), eq(userSettings.key, 'userTimezone')))
				.get()?.value || undefined;
			let userNow = new Date();
			if (tz) {
				try {
					const parts = new Intl.DateTimeFormat('en-US', {
						timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
					}).formatToParts(userNow);
					const hh = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
					const mm = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
					userNow = new Date(2000, 0, 1, hh, mm);
				} catch { /* fall back to server time */ }
			}
			withinQuiet = isWithinQuietHours(qhStart, qhEnd, userNow);
		}

		const shouldSendPush = !chatMuted && !viewedElsewhere && !appOpenSomewhere && !withinQuiet;

		if (shouldSendPush) {
			const character = db.select().from(characters).where(eq(characters.id, chat.characterId)).get();
			const charName = character?.name ?? 'Character';
			const preview = fullResponse.length > PREVIEW_MAX_CHARS ? fullResponse.slice(0, PREVIEW_MAX_CHARS) + '…' : fullResponse;

			// Check user's notification style preference
			const styleSetting = db.select().from(userSettings)
				.where(and(eq(userSettings.userId, chatUserId), eq(userSettings.key, 'notificationStyle')))
				.get();
			const notifStyle = styleSetting?.value ?? 'generic';

			// Check if user wants character avatar in notifications
			const avatarSetting = db.select().from(userSettings)
				.where(and(eq(userSettings.userId, chatUserId), eq(userSettings.key, 'notificationAvatar')))
				.get();
			const useAvatar = avatarSetting?.value !== 'false';

			sendPushNotification(chatUserId, {
				title: charName,
				body: notifStyle === 'preview' ? preview : 'New message',
				icon: useAvatar && character?.avatarPath ? `/avatars/${character.avatarPath}` : '/icon-192.png',
				data: { chatId }
			}).catch((err) => {
				logger.warn('Push notification dispatch failed', { error: err instanceof Error ? err.message : String(err) });
			});
		}
	}

	activeGenerations.clear(chatId);
	eventBus.emit({ type: 'streaming', chatId, userId: chatUserId, data: { active: false, isImpersonation: !!impersonate } });
}

/**
 * Process chat inline with callbacks (for impersonate which needs direct response).
 * This version uses callbacks instead of the event bus.
 */
export async function processChatInline(
	opts: ProcessOptions,
	callbacks: ProcessCallbacks,
	signal?: AbortSignal
): Promise<string> {
	const { chatId } = opts;

	let ctx;
	try {
		ctx = buildChatContext(chatId, opts);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Unknown error';
		callbacks.onError?.(msg);
		return '';
	}

	const { activeProvider, activeModel, samplerSettings, llmMessages, tokenStats, streamingEnabled } = ctx;

	const llm = createProvider(activeProvider.type as ProviderType, {
		endpoint: activeProvider.endpoint,
		apiKey: activeProvider.apiKey || '',
		model: activeModel,
	});

	let fullResponse = '';
	let fullReasoning = '';
	let contentStarted = false;

	try {
		callbacks.onTokenStats?.(tokenStats);

		for await (const chunk of llm.stream(llmMessages, samplerSettings, signal)) {
			if (chunk.type === 'reasoning') {
				fullReasoning += chunk.text;
				if (streamingEnabled) callbacks.onReasoning?.(chunk.text);
			} else {
				let text = chunk.text;
				if (!contentStarted) {
					text = text.trimStart();
					if (!text) continue;
					contentStarted = true;
				}
				fullResponse += text;
				if (streamingEnabled) callbacks.onToken?.(text);
			}
		}

		if (!streamingEnabled) {
			if (fullReasoning) callbacks.onReasoning?.(fullReasoning);
			callbacks.onToken?.(fullResponse);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		callbacks.onError?.(message);
	}

	callbacks.onDone?.();
	return fullResponse;
}
