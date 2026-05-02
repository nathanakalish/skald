/**
 * Build Combobox items from a flat list of model IDs returned by a provider.
 *
 * For OpenRouter, model IDs starting with "~" are aliases that point to the
 * latest variant of a model family. We strip the leading "~" from the label
 * and tag the entry with hint: 'alias' so the dropdown surfaces it. Aliases
 * are also sorted alphabetically by the character after the "~" so they're
 * easy to scan, and grouped at the top of the list.
 */
import type { ComboboxItem } from '$lib/components/Combobox.svelte';

export function modelsToItems(models: string[], providerType?: string | null): ComboboxItem[] {
	const isOpenRouter = providerType === 'openrouter';
	if (!isOpenRouter) return models.map((id) => ({ value: id }));

	const aliases: ComboboxItem[] = [];
	const rest: ComboboxItem[] = [];
	for (const id of models) {
		if (id.startsWith('~')) {
			aliases.push({ value: id, label: id.slice(1), hint: 'alias' });
		} else {
			rest.push({ value: id });
		}
	}
	aliases.sort((a, b) => (a.label ?? '').toLowerCase().localeCompare((b.label ?? '').toLowerCase()));
	return [...aliases, ...rest];
}
