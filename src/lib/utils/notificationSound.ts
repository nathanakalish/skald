import { browser } from '$app/environment';
import { settingsStore } from '$lib/stores/settings.svelte.js';

// Tiny WebAudio beep used for "a response just landed" feedback. iMessage/
// Messenger both play a short tone on incoming; we mirror that with a single
// 880Hz sine that fades over 300ms so it never feels obnoxious. AudioContext
// is created fresh per beep because Safari + iOS suspend a long-lived context
// when the tab loses focus; reconstructing avoids the silent-after-resume
// failure mode at the cost of one cheap allocation.
//
// Gated on:
//   - settings.notificationSound (user preference)
//   - localStorage "skald-device-silent" (per-device mute toggle)
// Both gates are checked here so callers don't have to remember.
export function playMessageBeep(): void {
	if (!browser) return;
	if (!settingsStore.settings.notificationSound) return;
	try {
		if (localStorage.getItem('skald-device-silent') === 'true') return;
	} catch { /* localStorage unavailable — fall through and play */ }

	try {
		const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
		if (!Ctx) return;
		const ctx = new Ctx();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.frequency.value = 880;
		osc.type = 'sine';
		gain.gain.setValueAtTime(0.3, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
		osc.start(ctx.currentTime);
		osc.stop(ctx.currentTime + 0.3);
	} catch { /* autoplay blocked or context creation failed — silently noop */ }
}
