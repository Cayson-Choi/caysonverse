/**
 * UI focus guard for the movement input system (Task 4, owner-based in Task 15).
 *
 * The UI is "captured" while ANY owner holds the keyboard: the chat input, the 조교
 * dialogue's input, the admin panel, the Esc menu. The local player's per-frame
 * controller reads `isUiCaptured()` through `guardMoveKeys`, which zeroes movement
 * while the UI is captured — so typing (including WASD letters) never walks the avatar.
 *
 * Why OWNERS and not one boolean: with a single flag, whoever released last cleared
 * everyone's hold — the 조교 dialogue closing, or the chat input blurring, would free
 * the keyboard for WASD / Space / the hotkeys while the Esc menu was still open. Each
 * holder now acquires and releases under its own name; releasing a name that does not
 * hold the keyboard (a second release, a release without an acquire) changes nothing,
 * and the keyboard is free only when nobody holds it.
 *
 * Why a flag and a PURE guard rather than intercepting key events: we never
 * touch drei's window key listeners, so their pressed/released state stays
 * physically accurate. The guard has no memory of its own, so releasing a key
 * after blur can never leave it "stuck" and focusing never fabricates a press.
 */

import type { MoveKeys } from "./input";

/** Who holds the keyboard right now ("chat", "npc", "admin", "menu"). */
const owners = new Set<string>();

/** `owner` takes the keyboard (idempotent: acquiring twice is still one hold). */
export function acquireUiCapture(owner: string): void {
  owners.add(owner);
}

/** `owner` lets go. The keyboard stays captured while any other owner still holds it. */
export function releaseUiCapture(owner: string): void {
  owners.delete(owner);
}

/** A fresh world starts with nobody holding the keyboard (WorldScene mount). */
export function releaseAllUiCapture(): void {
  owners.clear();
}

/** Whether any UI element currently owns keyboard input. */
export function isUiCaptured(): boolean {
  return owners.size > 0;
}

/** The all-released key set returned while captured — shared and frozen so the per-frame guard never allocates. */
const NO_KEYS: Readonly<MoveKeys> = Object.freeze({
  forward: false,
  backward: false,
  left: false,
  right: false,
  run: false,
});

/**
 * Movement keys the controller should act on: all-false while UI-captured —
 * `run` included, so Shift held while typing never runs (or sprints the click-move).
 */
export function guardMoveKeys(keys: MoveKeys, uiCaptured: boolean): MoveKeys {
  if (!uiCaptured) return keys;
  return NO_KEYS;
}

/**
 * React-effect helper for a focus-capturing UI element (chat input, admin panel, 조교
 * dialogue). Returns a disposer that RELEASES `owner`'s hold on unmount.
 *
 * Why this is needed: the hold is normally released by the element's onBlur /
 * focusout, but browsers fire NO blur/focusout when a focused element is removed
 * from the DOM — which is exactly what happens when a reconnect bumps the
 * connection epoch (WorldScene remounts, unmounting a focused ChatInput) or a
 * kick/failed reconnect tears down the world. Without this disposer the hold
 * stays stranded forever: WASD is zeroed every frame, Enter-to-chat and
 * emoji shortcuts are swallowed — desktop movement silently dead until the user
 * manually clicks and blurs the (now gone) field. Wire it as
 * `useEffect(() => captureReleaseEffect("chat"), [])`.
 */
export function captureReleaseEffect(owner: string): () => void {
  return () => releaseUiCapture(owner);
}
