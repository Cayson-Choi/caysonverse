/**
 * UI focus guard for the movement input system (Task 4).
 *
 * A single module-level flag records whether a DOM UI element (the chat input)
 * currently owns keyboard focus. The local player's per-frame controller reads
 * it through `guardMoveKeys`, which zeroes movement while the UI is captured —
 * so typing (including WASD letters) never walks the avatar.
 *
 * Why a flag and a PURE guard rather than intercepting key events: we never
 * touch drei's window key listeners, so their pressed/released state stays
 * physically accurate. The guard has no memory of its own, so releasing a key
 * after blur can never leave it "stuck" and focusing never fabricates a press.
 */

import type { MoveKeys } from "./input";

let captured = false;

/** Mark the movement input as captured (true) or released (false) by the UI. */
export function setUiCaptured(value: boolean): void {
  captured = value;
}

/** Whether a UI element currently owns keyboard input. */
export function isUiCaptured(): boolean {
  return captured;
}

/** Movement keys the controller should act on: all-false while UI-captured. */
export function guardMoveKeys(keys: MoveKeys, uiCaptured: boolean): MoveKeys {
  if (!uiCaptured) return keys;
  return { forward: false, backward: false, left: false, right: false };
}
