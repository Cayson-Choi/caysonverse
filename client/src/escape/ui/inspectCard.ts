/**
 * The close-up card's pure maths and words (AI 학교 탈출, Task 18): how far a drag tips the card, which
 * side faces us, the circular "UV light" mask that follows the pointer, and where the picture lives.
 * No React, no DOM — the overlay applies these straight to the card's style while the pointer moves
 * (frame data never goes through React state).
 */

/** The card never tips further than this, either way, on either axis. */
export const TILT_MAX_DEG = 35;

/** A drag of half the card's width tips it to the limit. */
const TILT_DEG_PER_WIDTH = 2 * TILT_MAX_DEG;

/** A finite number, else 0 — and never a negative zero (the maths below can produce one). */
function clean(n: number): number {
  return Number.isFinite(n) ? n + 0 : 0;
}

function clampTilt(deg: number): number {
  const d = clean(deg);
  return d > TILT_MAX_DEG ? TILT_MAX_DEG : d < -TILT_MAX_DEG ? -TILT_MAX_DEG : d + 0;
}

/**
 * The tilt a drag of (dx, dy) CSS pixels gives a card `widthPx` wide: `ry` (turning about the vertical
 * axis) follows the horizontal drag, `rx` (about the horizontal axis) the vertical one — dragging the
 * card's top edge up tips it back. Both are cut to ±TILT_MAX_DEG. A broken width means flat.
 */
export function tiltFromDrag(dx: number, dy: number, widthPx: number): { rx: number; ry: number } {
  if (!(widthPx > 0) || !Number.isFinite(widthPx)) return { rx: 0, ry: 0 };
  const k = TILT_DEG_PER_WIDTH / widthPx;
  return { rx: clampTilt(-dy * k), ry: clampTilt(dx * k) };
}

/** The CSS `transform` for a tilt (one decimal is plenty for the eye and keeps the string short). */
export function tiltTransform(t: { rx: number; ry: number }): string {
  return `rotateX(${round1(t.rx)}deg) rotateY(${round1(t.ry)}deg)`;
}

function round1(n: number): number {
  return Math.round(clean(n) * 10) / 10 + 0;
}

/** 0 while the front faces us, 180 when the card is turned over. */
export function flipped(state: { flipped: boolean }): number {
  return state.flipped ? 180 : 0;
}

/**
 * The CSS mask (`mask-image`) that lets the hidden text show only inside a circle of `radiusPx` around
 * (px, py): solid in the middle, fading to nothing at the rim. Positions are in the card's own pixels.
 */
export function uvMaskStyle(px: number, py: number, radiusPx: number): string {
  const r = Math.max(1, round1(radiusPx));
  const x = round1(px);
  const y = round1(py);
  return `radial-gradient(circle ${r}px at ${x}px ${y}px, #000 0%, #000 45%, transparent 100%)`;
}

/** Where the inspect pictures are served from (our own renders; Task 24 puts the files in). */
export const INSPECT_IMAGE_DIR = "/models/school/inspect/";

/** The eight worry notes share ONE picture; `note_<n>` is the number written on it. */
const NOTE_ID = /^note_([0-9]+)$/;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** The number of a worry note (`note_3` → 3), or null for anything else (the note BOX is not one). */
export function noteNumber(objectId: string): number | null {
  const m = NOTE_ID.exec(objectId);
  return m ? Number(m[1]) : null;
}

/**
 * The picture for an object's front: the shared note picture for a numbered note, else the object's own
 * `<id>-front.webp`. Null for an id that is not a plain name (it could point out of the folder).
 */
export function inspectImageUrl(objectId: string): string | null {
  if (noteNumber(objectId) !== null) return `${INSPECT_IMAGE_DIR}note-front.webp`;
  if (!SAFE_ID.test(objectId)) return null;
  return `${INSPECT_IMAGE_DIR}${objectId}-front.webp`;
}
