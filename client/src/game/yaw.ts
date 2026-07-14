/**
 * Yaw helpers (pure). Character facing turns smoothly toward the movement
 * direction; these keep the turn on the shortest arc and correctly wrapped.
 */

/** Normalize a radian angle into [-PI, PI]. */
export function normalizeAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

/**
 * Step `current` toward `target` by at most `maxDelta` radians, always along the
 * shortest arc (so a turn near the +/-PI seam wraps the short way, never the
 * long way around). The result is normalized to [-PI, PI].
 */
export function stepYaw(current: number, target: number, maxDelta: number): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(diff) * maxDelta);
}

/**
 * Interpolate from angle `a` to angle `b` by fraction `f` (0..1) along the
 * shortest arc, wrapped/normalized to [-PI, PI]. Used for snapshot yaw blending
 * so a facing change near the +/-PI seam takes the short way, never a full spin.
 */
export function lerpAngle(a: number, b: number, f: number): number {
  const diff = normalizeAngle(b - a);
  return normalizeAngle(a + diff * f);
}
