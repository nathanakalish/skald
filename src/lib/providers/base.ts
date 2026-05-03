export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ProviderConfig {
	endpoint: string;
	apiKey: string;
	model: string;
}

export interface SamplerSettings {
	temperature: number;
	topP: number;
	topK: number;
	maxTokens: number;
	repetitionPenalty: number;
	frequencyPenalty: number;
	presencePenalty: number;
	reasoningEffort: 'off' | 'low' | 'medium' | 'high';
}

export interface StreamChunk {
	type: 'reasoning' | 'content';
	text: string;
}

export abstract class LLMProvider {
	protected config: ProviderConfig;

	constructor(config: ProviderConfig) {
		this.config = config;
	}

	abstract get type(): string;

	abstract stream(
		messages: ChatMessage[],
		samplerSettings: SamplerSettings,
		signal?: AbortSignal
	): AsyncGenerator<StreamChunk, void, unknown>;

	abstract listModels(): Promise<string[]>;

	abstract testConnection(): Promise<boolean>;

	/**
	 * SSRF guard for the configured endpoint. Resolves the endpoint hostname
	 * via DNS and rejects private / loopback / link-local addresses unless
	 * the operator opted in (ALLOW_LOCAL_PROVIDERS=true) — see
	 * `assertPublicHost`. Called from every outbound provider request so a
	 * malicious or compromised provider record can't be used to scan the
	 * internal network.
	 */
	protected async guardEndpoint(): Promise<void> {
		const { assertPublicHost } = await import('../server/ssrf.js');
		const { logger } = await import('../server/logger.js');
		const { hostname } = new URL(this.config.endpoint);
		logger.debug('provider request', {
			provider: this.type,
			model: this.config.model,
			endpoint: this.config.endpoint,
		});
		try {
			await assertPublicHost(hostname);
		} catch (err) {
			// Re-throw a friendlier error so the UI surfaces actionable text.
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Refusing to call provider — endpoint ${hostname} is private/internal. ` +
				`Set ALLOW_LOCAL_PROVIDERS=true in your env to allow local providers. (${msg})`
			);
		}
	}

	/**
	 * Read the response body for diagnostics, log it server-side, and throw a
	 * generic error so the upstream body never reaches the client (which would
	 * leak whatever the provider chose to return — sometimes including request
	 * headers).
	 */
	protected async throwGeneric(response: Response, providerName: string): Promise<never> {
		let body = '';
		try { body = (await response.text()).slice(0, 2048); } catch { /* ignore */ }
		const { logger } = await import('../server/logger.js');
		logger.warn('upstream provider error', {
			provider: providerName,
			endpoint: this.config.endpoint,
			model: this.config.model,
			status: response.status,
			body
		});
		throw new Error(`${providerName} request failed (${response.status})`);
	}
}
