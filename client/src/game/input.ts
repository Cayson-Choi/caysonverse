/**
 * Camera-relative movement input math (pure, no three.js, no per-frame state).
 *
 * The camera orbits the player at azimuth `cameraYaw` (see CameraRig). "Forward"
 * always means *into the screen, away from the camera*; "right" means the
 * player's screen-right. These helpers turn key booleans into a world-space
 * ground direction so movement stays intuitive regardless of camera angle.
 */

/** Which movement keys are currently held. */
export interface MoveKeys {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

/** Local movement intent on two axes, each in {-1, 0, 1}. */
export interface Intent {
  forward: number;
  right: number;
}

/** A direction on the ground plane (XZ). */
export interface GroundVec {
  x: number;
  z: number;
}

/** Collapse held keys into a local intent, cancelling opposing pairs. */
export function readIntent(keys: MoveKeys): Intent {
  return {
    forward: (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0),
    right: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
  };
}

/**
 * Rotate a local intent into a normalized world-space ground direction, given
 * the camera azimuth. Returns `{x: 0, z: 0}` for zero intent (never NaN).
 *
 * Derivation: with the camera at azimuth φ around the player, the horizontal
 * "away from camera" unit vector is F = (-sinφ, -cosφ) and screen-right is
 * R = (cosφ, -sinφ) (matching three.js lookAt handedness). The world direction
 * is `forward·F + right·R`, then normalized.
 */
export function worldDirection(intent: Intent, cameraYaw: number): GroundVec {
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  const x = intent.forward * -sin + intent.right * cos;
  const z = intent.forward * -cos + intent.right * -sin;
  const len = Math.hypot(x, z);
  if (len < 1e-9) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}
