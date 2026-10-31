/**
 * Gait (pure): idle / walk / run, and the speed + animation clip each one uses.
 *
 * The LOCAL player picks its gait from its own input (`gaitFor`); a REMOTE avatar
 * derives it from interpolated speed (`nextGait` in locomotion.ts) because the
 * client never syncs walk/run state. Both feed the same `gaitClip`, so the two
 * sides always agree on which loop belongs to which gait.
 */

import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { CLIP } from "./constants";

export type Gait = "idle" | "walk" | "run";

/** Ground speed (m/s) for the given run intent: MOVE_SPEED walking, RUN_SPEED running. */
export function moveSpeed(run: boolean): number {
  return run ? RUN_SPEED : MOVE_SPEED;
}

/** The local gait: not moving is always idle; moving runs only while run is held. */
export function gaitFor(moving: boolean, run: boolean): Gait {
  if (!moving) return "idle";
  return run ? "run" : "walk";
}

/** The looping animation clip that plays for a gait. */
export function gaitClip(g: Gait): string {
  if (g === "run") return CLIP.run;
  if (g === "walk") return CLIP.walk;
  return CLIP.idle;
}

/**
 * DEV-only E2E probe: the gait each remote avatar is currently showing, keyed by
 * session id. RemotePlayer writes to it only under `import.meta.env.DEV` (and
 * removes its entry on unmount); `window.__cv.getRemoteGaits()` reads it. Always
 * empty in production, where the DEV guard is dead-code-eliminated.
 */
export const remoteGaitProbe = new Map<string, Gait>();
