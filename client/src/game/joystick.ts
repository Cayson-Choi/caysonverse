/**
 * Virtual-joystick → movement-intent mapping (pure). The nipplejs `move` event
 * hands us a normalized direction vector and a 0..1 force. We turn that into the
 * SAME local `Intent` the keyboard's `readIntent` produces, so both feed one
 * camera-relative movement path (see `worldDirection`). Force is a dead-zone gate
 * ONLY — it never scales speed (movement is a constant MOVE_SPEED, direction
 * only), matching the keyboard exactly.
 */

import type { Intent } from "./input";

/** nipplejs `data.vector`: `x` is screen-right (+), `y` is up (+). */
export interface JoystickVector {
  x: number;
  y: number;
}

/**
 * Below this force (fraction of the joystick radius, 0 at centre → 1 at edge) the
 * stick reads as centred and produces no movement. Prevents drift from a resting
 * thumb.
 */
export const JOYSTICK_DEAD_ZONE = 0.15;

/**
 * Map a joystick reading to a local movement intent. Inside the dead-zone the
 * intent is zero; otherwise the vector's `y` becomes forward (into the screen)
 * and `x` becomes screen-right — the axes `readIntent` uses. `worldDirection`
 * later normalizes, so a partial push still moves at full speed.
 */
export function joystickIntent(
  vector: JoystickVector,
  force: number,
  deadZone: number = JOYSTICK_DEAD_ZONE,
): Intent {
  if (force < deadZone) return { forward: 0, right: 0 };
  return { forward: vector.y, right: vector.x };
}
