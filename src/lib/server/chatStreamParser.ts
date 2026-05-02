/**
 * Pulls `<thinking>` / `<think>` blocks out of the content stream so the UI
 * can shove them into the reasoning pane instead of rendering them as prose.
 * Some models (cough, Anthropic-style) don't have a separate reasoning channel
 * and just dump it inline with these tags. Yes, both spellings. No, we don't
 * get to pick.
 *
 * Usage:
 *
 *     const parser = new ThinkingTagParser({
 *       onContent: t => emitContent(t),
 *       onReasoning: t => emitReasoning(t),
 *     });
 *     for await (const chunk of llm.stream(...)) {
 *       if (chunk.type === 'reasoning') parser.handleReasoningChunk(chunk.text);
 *       else parser.handleContentChunk(chunk.text);
 *     }
 *     parser.flush();
 */

interface Callbacks {
	onContent: (text: string) => void;
	onReasoning: (text: string) => void;
}

export class ThinkingTagParser {
	private inThinkingTag = false;
	private tagBuffer = '';

	constructor(private readonly cb: Callbacks) {}

	/** Native reasoning channel — already separated by the provider, just forward it. */
	handleReasoningChunk(text: string) {
		this.cb.onReasoning(text);
	}

	/** Content text that *might* have inline thinking tags hiding in it. */
	handleContentChunk(text: string) {
		let i = 0;
		while (i < text.length) {
			const ch = text[i];

			if (this.tagBuffer.length > 0) {
				// We may already have the short form (`<think>`) buffered. If the
				// next char rules out the long form (`<thinking>`), commit the short
				// form now and re-process the current char from scratch.
				const lowerBefore = this.tagBuffer.toLowerCase();
				const candidate = lowerBefore + ch.toLowerCase();

				if (!this.inThinkingTag && lowerBefore === '<think>' && !'<thinking>'.startsWith(candidate)) {
					this.inThinkingTag = true;
					this.tagBuffer = '';
					continue;
				}
				if (this.inThinkingTag && lowerBefore === '</think>' && !'</thinking>'.startsWith(candidate)) {
					this.inThinkingTag = false;
					this.tagBuffer = '';
					continue;
				}

				this.tagBuffer += ch;
				i++;
				const lower = this.tagBuffer.toLowerCase();

				if (!this.inThinkingTag) {
					if (lower === '<thinking>') {
						this.inThinkingTag = true;
						this.tagBuffer = '';
					} else if (lower === '<think>') {
						// Hold up — this might still grow into <thinking>.
					} else if (!'<thinking>'.startsWith(lower) && !'<think>'.startsWith(lower)) {
						this.cb.onContent(this.tagBuffer);
						this.tagBuffer = '';
					}
				} else {
					if (lower === '</thinking>') {
						this.inThinkingTag = false;
						this.tagBuffer = '';
					} else if (lower === '</think>') {
						// Same deal — could still be </thinking>.
					} else if (!'</thinking>'.startsWith(lower) && !'</think>'.startsWith(lower)) {
						this.cb.onReasoning(this.tagBuffer);
						this.tagBuffer = '';
					}
				}
			} else if (ch === '<') {
				this.tagBuffer = '<';
				i++;
			} else {
				if (this.inThinkingTag) {
					this.cb.onReasoning(ch);
				} else {
					this.cb.onContent(ch);
				}
				i++;
			}
		}
	}

	/** Drain whatever's still in the buffer at end-of-stream. */
	flush() {
		if (!this.tagBuffer) return;
		const lower = this.tagBuffer.toLowerCase();
		if (this.inThinkingTag) {
			if (lower === '</think>' || lower === '</thinking>') {
				this.inThinkingTag = false;
			} else {
				this.cb.onReasoning(this.tagBuffer);
			}
		} else {
			// A bare opening tag with no content following it: drop it on the floor.
			if (lower !== '<think>' && lower !== '<thinking>') {
				this.cb.onContent(this.tagBuffer);
			}
		}
		this.tagBuffer = '';
	}
}
