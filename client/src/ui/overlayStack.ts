/**
 * The open overlays of a classroom, as a stack (AI 학교 탈출, Task 18) — the close-up of an object, a
 * lock plate, the team panel, the last door (Task 19/20 push theirs here too).
 *
 * Two things hang on it:
 *  - Esc closes the TOP one (`handleEscape` → `topOverlay()?.close()`), one overlay per press, before
 *    anything else Esc would close (hotkeys.ts `resolveEscape`).
 *  - While any overlay is open the keyboard is captured under the owner "overlay" (uiCapture.ts), so
 *    WASD does not walk the avatar behind it, E does not reach the scene and the digits 1~6 go to a
 *    lock instead of sending an emoji. The hold is released when the last one closes.
 *
 * An overlay component pushes in an effect when it opens and pops in that effect's cleanup, so
 * unmounting (a reconnect, the scene leaving) pops it too. `close` is the overlay's own way of
 * closing — it must end in `popOverlay`, through that cleanup. Plain module state, like uiCapture.ts.
 */

import { acquireUiCapture, releaseUiCapture } from "../game/uiCapture";

/** The capture owner of every open overlay (they share one hold). */
export const OVERLAY_CAPTURE_OWNER = "overlay";

export interface OverlayEntry {
  id: string;
  close: () => void;
}

const stack: OverlayEntry[] = [];

/**
 * Open an overlay on top. An id that is already open is replaced and comes to the top again (one entry
 * per id, so a re-render that pushes twice cannot leave a ghost). The keyboard hold is taken on every
 * push — idempotent, and it heals a scene that wiped every hold when it mounted (PlayShell).
 */
export function pushOverlay(id: string, close: () => void): void {
  const at = stack.findIndex((o) => o.id === id);
  if (at !== -1) stack.splice(at, 1);
  stack.push({ id, close });
  acquireUiCapture(OVERLAY_CAPTURE_OWNER);
}

/** Take an overlay off, wherever it is in the stack; the keyboard is let go when the last one leaves. Unknown ids do nothing. */
export function popOverlay(id: string): void {
  const at = stack.findIndex((o) => o.id === id);
  if (at === -1) return;
  stack.splice(at, 1);
  if (stack.length === 0) releaseUiCapture(OVERLAY_CAPTURE_OWNER);
}

/** The overlay opened last, or null. (Returns the stored entry: nothing is allocated.) */
export function topOverlay(): OverlayEntry | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Forget every overlay and let go of the keyboard (a scene starting or ending). */
export function resetOverlays(): void {
  stack.length = 0;
  releaseUiCapture(OVERLAY_CAPTURE_OWNER);
}
