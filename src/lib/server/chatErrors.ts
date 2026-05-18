/**
 * Translate raw provider errors into concise user-facing messages.
 * Lives separately from chatProcessor so other call sites (the inline
 * impersonate path, future tools) can reuse it without pulling in the full
 * processor module.
 */

/**
 * Parse the wild zoo of LLM API error shapes into one short, readable line.
 */
function humanizeError(rawMessage: string): string {
	// Pull the status code out of "Provider API error (STATUS): body"
	const match = rawMessage.match(/^(\w[\w.]*)\s+API error \((\d+)\):\s*([\s\S]*)$/);
	if (!match) return rawMessage;

	const [, provider, statusStr, body] = match;
	const status = Number(statusStr);

	// Try to parse a JSON error body.
	let parsed: any = null;
	try {
		parsed = JSON.parse(body);
	} catch { /* plain text body */ }

	// Pull the most useful field out of structured responses.
	const apiMessage =
		parsed?.error?.message ||   // OpenAI / OpenRouter / Gemini
		parsed?.error?.type ||      // Anthropic type fallback
		parsed?.error ||            // Ollama: { "error": "..." }
		(typeof body === 'string' ? body.slice(0, 200) : '');

	// Common HTTP status → message map.
	const statusMessages: Record<number, string> = {
		400: 'Bad request — the model may not support these settings',
		401: 'Authentication failed — check your API key',
		403: 'Access denied — your API key may lack permissions for this model',
		404: 'Model not found — it may have been removed or the name is incorrect',
		408: 'Request timed out — the server took too long to respond',
		429: 'Rate limited — too many requests, try again in a moment',
		500: 'Server error on the provider\'s end',
		502: 'Bad gateway — the provider may be temporarily down',
		503: 'Service unavailable — the provider may be overloaded or down for maintenance',
		529: 'Overloaded — the provider is at capacity, try again later',
	};

	// Look for common error keywords in the body itself.
	const lower = (typeof apiMessage === 'string' ? apiMessage : '').toLowerCase();

	if (lower.includes('context length') || lower.includes('too many tokens') || lower.includes('maximum context') || lower.includes('token limit')) {
		return `${provider}: Message too long — the conversation exceeds this model's context limit. Try starting a new chat or reducing the context size.`;
	}
	if (lower.includes('content filter') || lower.includes('content management') || lower.includes('safety') || lower.includes('blocked')) {
		return `${provider}: The response was blocked by the provider's content filter.`;
	}
	if (lower.includes('model not found') || lower.includes('does not exist') || lower.includes('no such model')) {
		return `${provider}: Model not found — check the model name or try a different one.`;
	}
	if (lower.includes('insufficient_quota') || lower.includes('billing') || lower.includes('payment') || lower.includes('quota')) {
		return `${provider}: Account billing issue — check your API plan and payment method.`;
	}
	if (lower.includes('rate limit') || status === 429) {
		return `${provider}: Rate limited — too many requests. Wait a moment and try again.`;
	}
	if (lower.includes('econnrefused') || lower.includes('connect') || lower.includes('enotfound')) {
		return `${provider}: Connection refused — is the server running at the configured endpoint?`;
	}

	// Fallback: status code message + a snippet of the API message.
	const statusHint = statusMessages[status] || `Error ${status}`;
	const detail = typeof apiMessage === 'string' && apiMessage.length > 0
		? apiMessage.slice(0, 150)
		: '';

	return detail
		? `${provider}: ${statusHint} — ${detail}`
		: `${provider}: ${statusHint}`;
}

/**
 * Humanize anything error-shaped, including raw fetch failures.
 */
export function humanizeAnyError(err: unknown): string {
	if (!(err instanceof Error)) return 'Unknown error';

	const msg = err.message;

	// Native fetch failures (ECONNREFUSED, DNS resolution failure, etc).
	if (msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
		const cause = (err as any).cause;
		const detail = cause instanceof Error ? cause.message : '';
		if (detail.includes('ECONNREFUSED')) return 'Connection refused — is the provider server running?';
		if (detail.includes('ENOTFOUND')) return 'Server not found — check the endpoint URL';
		if (detail.includes('EAI_AGAIN')) return 'DNS lookup failed — check your network connection';
		return 'Connection failed — check the endpoint URL and that the server is running';
	}

	// Cancelled / aborted.
	if (msg.includes('AbortError') || msg.includes('aborted') || msg.includes('signal')) {
		return 'Request was cancelled';
	}

	return humanizeError(msg);
}
