/**
 * The plug between a scene and the context button (AI 학교 탈출, Task 16).
 *
 * The legacy world offers chairs and 조교 (interact.ts reads them itself). The school scenes
 * offer their own things — the hall's team rug and the corridor's door pads, a classroom's
 * objects — so a scene plugs in:
 *   - a SOURCE: what is within reach of this pose, asked at the button's ~5 Hz proximity pass
 *     (never per frame), and
 *   - a HANDLER: what pressing a target does (open the team panel, send "enter", …).
 * Module state, like activeMap.ts: the scene sets both when it mounts and clears them (null)
 * when it unmounts, so a later scene never inherits an earlier one's targets.
 */

import type { InteractTarget } from "./interact";
import type { Pose } from "./types";

/** "press" starts the action; "release" ends a held one (`hold` targets — the hold switch). */
export type TargetPhase = "press" | "release";

type TargetSource = (pose: Pose) => readonly InteractTarget[];
type TargetHandler = (target: InteractTarget, phase: TargetPhase) => void;

/** The answer when nothing is plugged in: one shared frozen list, so the empty case allocates nothing. */
const NONE: readonly InteractTarget[] = Object.freeze([]);

let source: TargetSource | null = null;
let handler: TargetHandler | null = null;

/** Plug in (or, with null, unplug) the scene's target list. Called by the scene on mount / unmount. */
export function setTargetSource(fn: TargetSource | null): void {
  source = fn;
}

/** What the active scene offers at `pose` (an empty list when no scene plugged a source in). */
export function getTargets(pose: Pose): readonly InteractTarget[] {
  return source ? source(pose) : NONE;
}

/** Plug in (or unplug) what pressing a target does. */
export function setTargetHandler(fn: TargetHandler | null): void {
  handler = fn;
}

/** Run the handler for `target` (the context button and the E / F key come through here). */
export function fireTarget(target: InteractTarget, phase: TargetPhase): void {
  handler?.(target, phase);
}
