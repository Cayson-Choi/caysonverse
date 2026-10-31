/**
 * Derived locomotion (pure). A remote avatar is "walking" or "running" purely as
 * a function of its interpolated speed — no animation state is ever synced.
 * Hysteresis (a gap between the ON and OFF thresholds) keeps the idle/walk/run
 * animation from flapping when interpolated speed wobbles at snapshot boundaries.
 */

import { RUN_OFF_SPEED, RUN_ON_SPEED, WALK_OFF_SPEED, WALK_ON_SPEED } from "./constants";
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
