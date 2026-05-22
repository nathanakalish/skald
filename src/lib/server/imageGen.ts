// Per-capability image-generation dispatchers.
//
// We deliberately keep this small (three implementations) rather than one per
// vendor: most OpenAI-compatible vendors that ship an image API match the
// `/v1/images/generations` shape closely enough that a single dispatcher
// covers all of them. Gemini and ComfyUI are different beasts and need their
// own paths.
//
// Each dispatcher returns the raw image bytes plus a file extension; the
// caller is responsible for writing to disk and persisting metadata.

import { assertPublicHost } from '$lib/server/ssrf.js';
import { logger } from '$lib/server/logger.js';
import type { ImageGenCapability } from '../providers/profiles.js';

export interface ImageGenInput {
	endpoint: string;
	apiKey: string;
	model: string;
	prompt: string;
	// ComfyUI-specific
	comfyWorkflow?: string;
	comfyPromptNodeId?: string;
}

export interface ImageGenResult {
	buffer: Buffer;
	ext: string; // includes leading dot, e.g. ".png"
}

export class ImageGenError extends Error {
	constructor(message: string, public status?: number) {
		super(message);
		this.name = 'ImageGenError';
	}
}

async function guard(endpoint: string) {
	const { hostname } = new URL(endpoint);
	await assertPublicHost(hostname);
}

// Most providers return PNG; sniff and label appropriately so the served file
// has a correct extension (the cache endpoint maps ext → content-type).
function sniffExt(buf: Buffer): string {
	if (buf.length < 12) return '.png';
	if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
	if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
	if (
		buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
		&& buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
	) return '.webp';
	return '.png';
}

// OpenAI-compatible: POST {endpoint}/images/generations  with { model, prompt }
// Returns either b64_json or url. We pull bytes from whichever we got.
async function openaiImageGen(input: ImageGenInput): Promise<ImageGenResult> {
	await guard(input.endpoint);
	const base = input.endpoint.replace(/\/$/, '');
	const url = `${base}/images/generations`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
		},
		body: JSON.stringify({
			model: input.model,
			prompt: input.prompt,
			n: 1,
			response_format: 'b64_json'
		})
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		logger.warn('image gen: openai-compat error', { status: res.status, body: text.slice(0, 500) });
		throw new ImageGenError(`Image provider returned HTTP ${res.status}`, res.status);
	}
	const data = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
	const entry = data?.data?.[0];
	if (!entry) throw new ImageGenError('Image provider returned no image');

	let buffer: Buffer;
	if (entry.b64_json) {
		buffer = Buffer.from(entry.b64_json, 'base64');
	} else if (entry.url) {
		// Some providers ignore response_format and return a URL anyway.
		const dl = await fetch(entry.url);
		if (!dl.ok) throw new ImageGenError(`Failed to download generated image (HTTP ${dl.status})`);
		buffer = Buffer.from(await dl.arrayBuffer());
	} else {
		throw new ImageGenError('Image provider returned no image data');
	}
	return { buffer, ext: sniffExt(buffer) };
}

// Gemini native image gen has two shapes depending on model family:
//   - imagen-* uses :predict with { instances: [{ prompt }] }
//   - gemini-*-image (e.g. gemini-2.5-flash-image) uses :generateContent
// The profile endpoint is the OpenAI-compat base; we strip the trailing
// "/openai" if present to get the native base.
async function geminiImageGen(input: ImageGenInput): Promise<ImageGenResult> {
	await guard(input.endpoint);
	const compatBase = input.endpoint.replace(/\/$/, '');
	const nativeBase = compatBase.replace(/\/openai$/, '');
	const isImagen = /imagen/i.test(input.model);
	const apiKey = input.apiKey;

	if (isImagen) {
		const url = `${nativeBase}/models/${encodeURIComponent(input.model)}:predict?key=${encodeURIComponent(apiKey)}`;
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				instances: [{ prompt: input.prompt }],
				parameters: { sampleCount: 1 }
			})
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			logger.warn('image gen: imagen error', { status: res.status, body: text.slice(0, 500) });
			throw new ImageGenError(`Imagen returned HTTP ${res.status}`, res.status);
		}
		const data = await res.json() as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
		const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
		if (!b64) throw new ImageGenError('Imagen returned no image');
		const buffer = Buffer.from(b64, 'base64');
		return { buffer, ext: sniffExt(buffer) };
	}

	// gemini-*-image style: generateContent with responseModalities: ['IMAGE'].
	const url = `${nativeBase}/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
			generationConfig: { responseModalities: ['IMAGE'] }
		})
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		logger.warn('image gen: gemini error', { status: res.status, body: text.slice(0, 500) });
		throw new ImageGenError(`Gemini returned HTTP ${res.status}`, res.status);
	}
	const data = await res.json() as {
		candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>
	};
	const parts = data?.candidates?.[0]?.content?.parts ?? [];
	const inline = parts.map((p) => p.inlineData).find((d) => d?.data);
	if (!inline?.data) throw new ImageGenError('Gemini returned no image');
	const buffer = Buffer.from(inline.data, 'base64');
	return { buffer, ext: sniffExt(buffer) };
}

// ComfyUI workflow execution:
//   1. POST {endpoint}/prompt with { prompt: workflow } — returns { prompt_id }
//   2. Poll GET {endpoint}/history/{prompt_id} until outputs appear
//   3. Download the first image from /view?filename=...&subfolder=...&type=...
//
// The user supplies the workflow JSON and the id of the node whose inputs.text
// should be replaced with the actual prompt before sending.
async function comfyuiImageGen(input: ImageGenInput): Promise<ImageGenResult> {
	await guard(input.endpoint);
	const base = input.endpoint.replace(/\/$/, '');
	if (!input.comfyWorkflow) throw new ImageGenError('ComfyUI workflow JSON is not configured');
	if (!input.comfyPromptNodeId) throw new ImageGenError('ComfyUI prompt-node id is not configured');

	let workflow: Record<string, { inputs?: Record<string, unknown>; class_type?: string }>;
	try {
		workflow = JSON.parse(input.comfyWorkflow);
	} catch (err) {
		throw new ImageGenError(`ComfyUI workflow JSON is invalid: ${(err as Error).message}`);
	}

	const node = workflow[input.comfyPromptNodeId];
	if (!node) {
		throw new ImageGenError(`ComfyUI prompt-node id "${input.comfyPromptNodeId}" not found in workflow`);
	}
	node.inputs = { ...(node.inputs ?? {}), text: input.prompt };

	const submit = await fetch(`${base}/prompt`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ prompt: workflow })
	});
	if (!submit.ok) {
		const text = await submit.text().catch(() => '');
		throw new ImageGenError(`ComfyUI /prompt returned HTTP ${submit.status}: ${text.slice(0, 200)}`);
	}
	const submitData = await submit.json() as { prompt_id?: string };
	const promptId = submitData.prompt_id;
	if (!promptId) throw new ImageGenError('ComfyUI did not return a prompt_id');

	// Poll. ComfyUI runs are typically 5–60s; longer is rare. Cap at 5min so
	// a stuck queue doesn't pin a request handler forever.
	const deadline = Date.now() + 5 * 60 * 1000;
	const pollInterval = 1500;
	let outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> | null = null;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, pollInterval));
		const hist = await fetch(`${base}/history/${encodeURIComponent(promptId)}`);
		if (!hist.ok) continue;
		const histData = await hist.json() as Record<string, { outputs?: typeof outputs; status?: { completed?: boolean } }>;
		const entry = histData[promptId];
		if (entry?.status?.completed && entry.outputs) {
			outputs = entry.outputs;
			break;
		}
	}
	if (!outputs) throw new ImageGenError('ComfyUI generation timed out');

	let firstImage: { filename: string; subfolder: string; type: string } | undefined;
	for (const v of Object.values(outputs as Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>)) {
		if (v.images && v.images.length > 0) { firstImage = v.images[0]; break; }
	}
	if (!firstImage) throw new ImageGenError('ComfyUI returned no image outputs');

	const viewUrl = `${base}/view?filename=${encodeURIComponent(firstImage.filename)}&subfolder=${encodeURIComponent(firstImage.subfolder)}&type=${encodeURIComponent(firstImage.type)}`;
	const dl = await fetch(viewUrl);
	if (!dl.ok) throw new ImageGenError(`Failed to download ComfyUI output (HTTP ${dl.status})`);
	const buffer = Buffer.from(await dl.arrayBuffer());
	return { buffer, ext: sniffExt(buffer) };
}

export async function generateImage(capability: ImageGenCapability, input: ImageGenInput): Promise<ImageGenResult> {
	switch (capability) {
		case 'openai': return openaiImageGen(input);
		case 'gemini': return geminiImageGen(input);
		case 'comfyui': return comfyuiImageGen(input);
		case 'none':
		default:
			throw new ImageGenError('This provider does not support image generation');
	}
}
