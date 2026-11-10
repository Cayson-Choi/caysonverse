/**
 * First-person mouse cursor hiding (pure decision, no DOM).
 *
 * The owner saw a blue droplet with a "+" sitting in the middle of the first-person view while
 * turning with Z / C (2026-11-10). The game never draws that: it is the mouse cursor (the
 * user's Windows / Chrome pointer theme), left resting over the 3D view. A first-person game
 * hides it while it is not in use, so here, in FIRST PERSON on a desktop:
 *   - the cursor over the 3D view hides once the mouse has rested FP_CURSOR_IDLE_MS,
 *   - and at once when a walk or turn key (WASD / arrows / Z / C) is pressed,
 *   - and shows again the moment the mouse moves or a button is pressed. A key still held
 *     after that move does not hide it again — only a NEW press, or the mouse resting again.
 * Third person, the overview map, a touch device and any open chat field / menu / panel
 * (uiCapture) never hide it. Only the canvas carries the hidden cursor (useFpCursor), so the
 * HUD, the panels, the chat and the menus always show theirs.
 *
 * The clock is the caller's (performance.now() in the hook, plain numbers in the tests).
 */

import type { MoveControl } from "./constants";
import type { ViewMode } from "./viewMode";

/** How long (ms) the mouse must rest in first person before its cursor hides. */
export const FP_CURSOR_IDLE_MS = 1200;

/** What the decision remembers between frames — one per camera rig, mutated in place. */
export interface FpCursorTracker {
  /** When the mouse last moved or pressed a button (-Infinity: not since the rig mounted). */
  lastMouse: number;
  /** When a walk / turn key was last newly pressed (-Infinity: never). */
  lastKeyPress: number;
  /** The walk / turn keys held at the last `noteHeldKeys` (heldKeyMask bits). */
  heldMask: number;
  /** The mouse's last client position (NaN: none yet) — a pointermove that did not move is no activity. */
  mouseX: number;
  mouseY: number;
}

export function createFpCursorTracker(): FpCursorTracker {
  return { lastMouse: -Infinity, lastKeyPress: -Infinity, heldMask: 0, mouseX: Number.NaN, mouseY: Number.NaN };
}

/** The controls that hide the cursor when pressed: walking and turning. Shift (run) alone moves nothing. */
const HIDING_CONTROLS: readonly MoveControl[] = ["forward", "backward", "left", "right", "camLeft", "camRight"];

/** The held walk / turn keys as bits (one per control), from drei's KeyboardControls state. */
export function heldKeyMask(keys: Readonly<Record<MoveControl, boolean>>): number {
  let mask = 0;
  for (let i = 0; i < HIDING_CONTROLS.length; i++) if (keys[HIDING_CONTROLS[i]]) mask |= 1 << i;
  return mask;
}

/**
 * The mouse moved to (x, y). Returns whether that counted as activity: a pointermove at the
 * very spot of the last one (Chrome sends such moves after a layout change under a resting
 * mouse) does not, so it cannot flash the hidden cursor back.
 */
export function noteMouseMove(t: FpCursorTracker, x: number, y: number, now: number): boolean {
  if (x === t.mouseX && y === t.mouseY) return false;
  t.mouseX = x;
  t.mouseY = y;
  t.lastMouse = now;
  return true;
}

/** A mouse button went down (or the wheel turned): the player is using the mouse. */
export function noteMousePress(t: FpCursorTracker, now: number): void {
  t.lastMouse = now;
}

/** This frame's held walk / turn keys (0 while a text field holds the keyboard). A key that was not held before is a press. */
export function noteHeldKeys(t: FpCursorTracker, mask: number, now: number): void {
  if ((mask & ~t.heldMask) !== 0) t.lastKeyPress = now;
  t.heldMask = mask;
}

export interface FpCursorContext {
  mode: ViewMode;
  /** The session is a touch device (device.ts): there is no cursor to manage. */
  touch: boolean;
  /** A chat field, the menu or a panel holds the keyboard (uiCapture). */
  captured: boolean;
}

/** Whether the cursor over the 3D view should be hidden right now. */
export function fpCursorHidden(t: FpCursorTracker, ctx: FpCursorContext, now: number): boolean {
  if (ctx.mode !== "fp" || ctx.touch || ctx.captured) return false;
  // A walk / turn key pressed since the mouse last moved hides it at once, for as long as one is held.
  if (t.heldMask !== 0 && t.lastKeyPress >= t.lastMouse) return true;
  return now - t.lastMouse >= FP_CURSOR_IDLE_MS;
}
