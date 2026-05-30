/**
 * Holds the raw user-editable text buffers (compose textarea and inline
 * message-edit buffer) plus the timestamps the sync module needs to decide
 * which side wins when local and server drafts disagree.
 *
 * Persistence and debouncing live in `chat/sync/draftSync.svelte.ts` — this
 * store only knows about *current values* and *last-synced markers*, no I/O.
 */
export class DraftStore {
	input = $state('');
	lastSyncedInput = $state('');
	lastSyncedInputAt = $state(0);
	lastLocalInputAt = $state(0);

	editingId = $state<number | null>(null);
	editContent = $state('');
	lastSyncedEditId = $state<number | null>(null);
	lastSyncedEditContent = $state('');
	lastSyncedEditAt = $state(0);
	lastLocalEditAt = $state(0);

	setInput(value: string): void {
		this.input = value;
		this.lastLocalInputAt = Date.now();
	}

	beginEdit(messageId: number, content: string): void {
		this.editingId = messageId;
		this.editContent = content;
		this.lastLocalEditAt = Date.now();
	}

	updateEditContent(content: string): void {
		this.editContent = content;
		this.lastLocalEditAt = Date.now();
	}

	cancelEdit(): void {
		this.editingId = null;
		this.editContent = '';
		this.lastLocalEditAt = Date.now();
	}

	markInputSynced(value: string, at: number): void {
		this.lastSyncedInput = value;
		this.lastSyncedInputAt = at;
	}

	markEditSynced(messageId: number | null, content: string, at: number): void {
		this.lastSyncedEditId = messageId;
		this.lastSyncedEditContent = content;
		this.lastSyncedEditAt = at;
	}
}
