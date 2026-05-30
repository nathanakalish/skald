/**
 * Position a floating context menu near a touch/pointer event so it always
 * stays fully on screen and prefers opening *above* the finger (so the menu
 * isn't covered by the user's thumb on mobile).
 *
 * On mobile with the soft keyboard up, `position: fixed` elements track the
 * visual viewport but `Touch.clientY` is in the layout viewport — without
 * translating between them the menu drifts up by the keyboard's offset and
 * gets clamped to the wrong height. We use `visualViewport` when available
 * to keep both coordinate spaces in sync.
 */
export interface MenuPosition {
	x: number;
	/** When `flipUp` is true this is the menu's *bottom* edge (CSS `bottom`); otherwise the *top* edge (CSS `top`). */
	y: number;
	/** True when there was room to open above the touch point. */
	flipUp: boolean;
	/** Viewport height used during layout — handy for callers that need to recompute on rotate/resize. */
	viewportH: number;
}

export interface PositionMenuViewport {
	innerWidth: number;
	innerHeight: number;
	visualViewport?: {
		width?: number;
		height?: number;
		offsetLeft?: number;
		offsetTop?: number;
	} | null;
}

const PAD = 8;

export function positionForMenu(
	clientX: number,
	clientY: number,
	menuW: number,
	menuH: number,
	viewport: PositionMenuViewport = typeof window !== 'undefined'
		? { innerWidth: window.innerWidth, innerHeight: window.innerHeight, visualViewport: window.visualViewport }
		: { innerWidth: 0, innerHeight: 0, visualViewport: null }
): MenuPosition {
	const vv = viewport.visualViewport;
	const offX = vv?.offsetLeft ?? 0;
	const offY = vv?.offsetTop ?? 0;
	const winW = vv?.width ?? viewport.innerWidth;
	const winH = vv?.height ?? viewport.innerHeight;
	const localX = clientX - offX;
	const localY = clientY - offY;

	const enoughRoomAbove = localY - menuH - PAD >= PAD;
	const flipUp = enoughRoomAbove;

	const x = Math.max(PAD, Math.min(winW - menuW - PAD, localX - menuW / 2));
	const y = flipUp
		? Math.max(menuH + PAD, Math.min(winH - PAD, localY - PAD))
		: Math.max(PAD, Math.min(winH - menuH - PAD, localY + PAD));

	return { x, y, flipUp, viewportH: winH };
}
