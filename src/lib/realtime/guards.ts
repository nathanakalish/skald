// Hand-rolled runtime type guards for realtime SSE payloads. Server-side
// broadcasts are typed (see realtime/events.ts) but we don't trust the wire:
// a malformed event from a buggy or future endpoint would silently corrupt
// stores otherwise.
//
// Guards only check the shape the dispatcher actually needs; everything
// beyond that is TypeScript's problem via the `RealtimeEvent` union.

export function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function hasNumberId(x: unknown): x is { id: number } {
	return isRecord(x) && typeof x.id === 'number';
}

/** `{ chat: { id: number, ... } }` */
export function hasChat(x: unknown): x is { chat: Record<string, unknown> & { id: number } } {
	return isRecord(x) && hasNumberId((x as any).chat);
}

/** `{ character: { id: number, ... } }` */
export function hasCharacter(x: unknown): x is { character: Record<string, unknown> & { id: number } } {
	return isRecord(x) && hasNumberId((x as any).character);
}

/** `{ provider: { id: number, ... } }` */
export function hasProvider(x: unknown): x is { provider: Record<string, unknown> & { id: number } } {
	return isRecord(x) && hasNumberId((x as any).provider);
}

/** `{ lorebook: { id: number, ... } }` */
export function hasLorebook(x: unknown): x is { lorebook: Record<string, unknown> & { id: number } } {
	return isRecord(x) && hasNumberId((x as any).lorebook);
}

/** `{ persona: { id: number, ... } }` */
export function hasPersona(x: unknown): x is { persona: Record<string, unknown> & { id: number } } {
	return isRecord(x) && hasNumberId((x as any).persona);
}

/** `{ theme: { id: number, ... } }` */
export function hasTheme(x: unknown): x is { theme: Record<string, unknown> & { id: number } } {
	return isRecord(x) && hasNumberId((x as any).theme);
}

/** `{ id: number, patch: object }` */
export function hasIdPatch(x: unknown): x is { id: number; patch: Record<string, unknown> } {
	return isRecord(x) && typeof (x as any).id === 'number' && isRecord((x as any).patch);
}

/** `{ id: number }` only */
export function hasJustId(x: unknown): x is { id: number } {
	return isRecord(x) && typeof (x as any).id === 'number';
}

/** `{ providers: [{id: number}, ...] }` */
export function hasProviderArray(x: unknown): x is { providers: Array<Record<string, unknown> & { id: number }> } {
	return isRecord(x) && Array.isArray((x as any).providers) && (x as any).providers.every(hasNumberId);
}

/** `{ personas: [{id: number}, ...] }` */
export function hasPersonaArray(x: unknown): x is { personas: Array<Record<string, unknown> & { id: number }> } {
	return isRecord(x) && Array.isArray((x as any).personas) && (x as any).personas.every(hasNumberId);
}
