/**
 * Derived locomotion (pure). A remote avatar is "walking" or "running" purely as
 * a function of its interpolated speed — no animation state is ever synced.
 * Hysteresis (a gap between the ON and OFF thresholds) keeps the idle/walk/run
 * animation from flapping when interpolated speed wobbles at snapshot boundaries.
 */

import {
  RUN_ENTER_MS,
  RUN_OFF_SPEED,
  RUN_ON_SPEED,
  WALK_OFF_SPEED,
  WALK_ON_SPEED,
} from "./constants";
import type { Gait } from "./gait";

/**
 * Given the current walking state and the latest interpolated speed (m/s),
 * decide the next walking state:
 *   - above WALK_ON_SPEED  → walking
 *   - below WALK_OFF_SPEED → idle
 *   - in between           → unchanged (the hysteresis band)
 */
export function nextWalking(current: boolean, speed: number): boolean {
  if (speed > WALK_ON_SPEED) return true;
  if (speed < WALK_OFF_SPEED) return false;
  return current;
}

/**
 * Given the current gait and the latest interpolated speed (m/s), decide the next
 * gait. Two nested hysteresis bands:
 *   - above RUN_ON_SPEED   → run  (from idle or walk)
 *   - below RUN_OFF_SPEED  → a running avatar drops to walk, or on to idle when
 *                            it is below the walk band too
 *   - in between           → unchanged
 * and below RUN_ON_SPEED a non-running avatar follows `nextWalking` unchanged.
 */
export function nextGait(current: Gait, speed: number): Gait {
  if (current === "run") {
    if (speed >= RUN_OFF_SPEED) return "run";
  } else if (speed > RUN_ON_SPEED) {
    return "run";
  }
  return nextWalking(current !== "idle", speed) ? "walk" : "idle";
}

/**
 * Mutable run-entry clock for ONE remote avatar. A plain object (created once,
 * mutated in place) so the per-frame path allocates nothing.
 */
export interface RunGate {
  /** Clock time (ms) the speed first went above RUN_ON_SPEED and has stayed there; -1 while it is not. */
  aboveSince: number;
}

export function createRunGate(): RunGate {
  return { aboveSince: -1 };
}

/**
 * `nextGait` plus a TIME hysteresis on entering run: the speed must stay above
 * RUN_ON_SPEED continuously for RUN_ENTER_MS (wall-clock `nowMs`, so frame rate
 * does not matter) before a non-running avatar is promoted. Until then it shows
 * walk (or idle) exactly as `nextGait` would without the run rule; any frame that
 * is not above RUN_ON_SPEED restarts the clock. Leaving run, and everything
 * between idle and walk, is unchanged. Reset `gate.aboveSince = -1` whenever the
 * avatar leaves standing locomotion (seat) so a stale clock cannot promote.
 */
export function nextGaitTimed(current: Gait, speed: number, nowMs: number, gate: RunGate): Gait {
  const next = nextGait(current, speed);
  if (current === "run" || next !== "run") {
    gate.aboveSince = -1;
    return next;
  }
  // Above RUN_ON_SPEED but not running yet: start (or keep) the clock.
  if (gate.aboveSince < 0) gate.aboveSince = nowMs;
  if (nowMs - gate.aboveSince >= RUN_ENTER_MS) {
    gate.aboveSince = -1;
    return "run";
  }
  return nextWalking(current !== "idle", speed) ? "walk" : "idle";
}
