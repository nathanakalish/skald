/**
 * Lightweight tooltip action. Replaces native `title=` attributes (which
 * look like OS popups and ignore our theme). Single shared tooltip element
 * so we don't litter the DOM with one per consumer.
 *
 * Usage:
 *   <button use:tooltip={'Reset to default'}>...</button>
 *   <button use:tooltip={{ text: 'Delete', placement: 'top' }}>...</button>
 *
 * Hides on touch devices (mobile users get long-press menus / explicit
 * labels instead — a hover tooltip on a touchscreen is just a stutter).
 */

import { tick } from 'svelte';

export interface TooltipOptions {
	text: string;
	placement?: 'top' | 'bottom' | 'left' | 'right';
	/** Delay in ms before showing on hover. Defaults to 400. */
	delay?: number;
}

type TooltipArg = string | TooltipOptions | null | undefined | false;

let tipEl: HTMLDivElement | null = null;
let activeTarget: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hasTouch = false;

function ensureTip(): HTMLDivElement {
	if (tipEl) return tipEl;
	const el = document.createElement('div');
	el.setAttribute('role', 'tooltip');
	el.style.cssText = [
		'position:fixed',
		'z-index:1000',
		'pointer-events:none',
		'opacity:0',
		'transform:translateY(2px)',
		'transition:opacity 120ms ease, transform 120ms ease',
		'background:var(--popover, hsl(0 0% 12%))',
		'color:var(--popover-foreground, #fff)',
		'padding:4px 8px',
		'border-radius:6px',
		'font-size:12px',
		'line-height:1.3',
		'box-shadow:0 4px 12px rgb(0 0 0 / 0.2)',
		'border:1px solid var(--border, rgb(255 255 255 / 0.1))',
		'max-width:240px',
		'white-space:pre-line',
		'top:0',
		'left:0',
	].join(';');
	document.body.appendChild(el);
	tipEl = el;
	return el;
}

function position(target: HTMLElement, placement: 'top' | 'bottom' | 'left' | 'right') {
	const el = ensureTip();
	const rect = target.getBoundingClientRect();
	const tipRect = el.getBoundingClientRect();
	const gap = 6;
	let top = 0;
	let left = 0;
	switch (placement) {
		case 'top':
			top = rect.top - tipRect.height - gap;
			left = rect.left + rect.width / 2 - tipRect.width / 2;
			break;
		case 'bottom':
			top = rect.bottom + gap;
			left = rect.left + rect.width / 2 - tipRect.width / 2;
			break;
		case 'left':
			top = rect.top + rect.height / 2 - tipRect.height / 2;
			left = rect.left - tipRect.width - gap;
			break;
		case 'right':
			top = rect.top + rect.height / 2 - tipRect.height / 2;
			left = rect.right + gap;
			break;
	}
	// Clamp to viewport with a small margin
	const margin = 4;
	left = Math.max(margin, Math.min(window.innerWidth - tipRect.width - margin, left));
	top = Math.max(margin, Math.min(window.innerHeight - tipRect.height - margin, top));
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;
}

async function show(target: HTMLElement, text: string, placement: 'top' | 'bottom' | 'left' | 'right') {
	const el = ensureTip();
	el.textContent = text;
	activeTarget = target;
	// Two ticks: textContent change → layout → measure → position → fade in.
	await tick();
	position(target, placement);
	el.style.opacity = '1';
	el.style.transform = 'translateY(0)';
}

function hide() {
	if (showTimer) {
		clearTimeout(showTimer);
		showTimer = null;
	}
	if (!tipEl) return;
	tipEl.style.opacity = '0';
	tipEl.style.transform = 'translateY(2px)';
	activeTarget = null;
}

function normalize(arg: TooltipArg): TooltipOptions | null {
	if (!arg) return null;
	if (typeof arg === 'string') return { text: arg, placement: 'top', delay: 400 };
	if (!arg.text) return null;
	return { text: arg.text, placement: arg.placement ?? 'top', delay: arg.delay ?? 400 };
}

export function tooltip(node: HTMLElement, arg: TooltipArg) {
	let opts = normalize(arg);

	function onEnter() {
		if (!opts || hasTouch) return;
		const { text, placement = 'top', delay = 400 } = opts;
		if (showTimer) clearTimeout(showTimer);
		showTimer = setTimeout(() => show(node, text, placement), delay);
	}
	function onLeave() {
		if (activeTarget === node || showTimer) hide();
	}
	function onTouch() {
		hasTouch = true;
		hide();
	}
	function onScroll() {
		if (activeTarget === node) hide();
	}

	node.addEventListener('mouseenter', onEnter);
	node.addEventListener('mouseleave', onLeave);
	node.addEventListener('focusin', onEnter);
	node.addEventListener('focusout', onLeave);
	node.addEventListener('touchstart', onTouch, { passive: true });
	window.addEventListener('scroll', onScroll, { passive: true, capture: true });

	return {
		update(next: TooltipArg) {
			opts = normalize(next);
			if (activeTarget === node) {
				if (!opts) hide();
				else {
					ensureTip().textContent = opts.text;
					position(node, opts.placement ?? 'top');
				}
			}
		},
		destroy() {
			node.removeEventListener('mouseenter', onEnter);
			node.removeEventListener('mouseleave', onLeave);
			node.removeEventListener('focusin', onEnter);
			node.removeEventListener('focusout', onLeave);
			node.removeEventListener('touchstart', onTouch);
			window.removeEventListener('scroll', onScroll, true);
			if (activeTarget === node) hide();
		},
	};
}
