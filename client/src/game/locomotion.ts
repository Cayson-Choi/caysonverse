/**
 * Derived locomotion (pure). A remote avatar is "walking" purely as a function
 * of its interpolated speed — no animation state is ever synced. Hysteresis (a
 * gap between the ON and OFF thresholds) keeps the walk/idle animation from
 * flapping when interpolated speed wobbles at snapshot boundaries.
 */

import { WALK_OFF_SPEED, WALK_ON_SPEED } from "./constants";

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
