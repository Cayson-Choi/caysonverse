/**
 * Anti-peek camera cap for the maze zone (design 18).
 *
 * Inside the maze the third-person camera is height/distance-capped so no
 * pitch/aspect combination can lift it over the 4 m walls for a bird's-eye view.
 * Pure + allocation-free so the per-frame camera path (CameraRig) can call it
 * every frame; the engagement lerps over ~0.3 s so entering/leaving the zone
 * eases the cap in/out instead of snapping.
 *
 * Two independent clamps (both required):
 *   - effective follow DISTANCE ≤ MAZE_CAM_MAX_DISTANCE (6 m), and
 *   - final camera Y ≤ MAZE_CAM_MAX_Y (WALL_HEIGHT − 0.5 = 3.5 m).
 * Distance keeps the camera close; the Y clamp guarantees it stays below the
 * wall top even at max pitch. Both are lerped by the same 0..1 engagement so the
 * transition is smooth in both directions.
 */

import { ZONES, WALL_HEIGHT } from "@caysonverse/shared/worldMap";

/** Max effective follow distance (m) while the cap is fully engaged. */
export const MAZE_CAM_MAX_DISTANCE = 6;

/** Max final camera height (m) while capped — below the 4 m wall top so no peek. */
export const MAZE_CAM_MAX_Y = WALL_HEIGHT - 0.5; // 3.5

/** Seconds to fully engage / release the cap (smooth, no snap jolt). */
export const MAZE_CAP_ENGAGE_SEC = 0.3;

/** True if (x,z) is inside the maze zone. No allocation (reads the module AABB). */
export function isInMaze(x: number, z: number): boolean {
  const m = ZONES.maze;
  return x >= m.minX && x <= m.maxX && z >= m.minZ && z <= m.maxZ;
}

/**
 * Advance the cap engagement (0 = off, 1 = fully capped) toward its target
 * (`inside ? 1 : 0`) at a constant rate over MAZE_CAP_ENGAGE_SEC. Clamped to
 * [0,1]; a large `delta` (tab refocus) can't overshoot.
 */
export function stepMazeCapEngage(engage: number, inside: boolean, delta: number): number {
  const target = inside ? 1 : 0;
  const step = MAZE_CAP_ENGAGE_SEC > 0 ? delta / MAZE_CAP_ENGAGE_SEC : 1;
  if (engage < target) return Math.min(target, engage + step);
  if (engage > target) return Math.max(target, engage - step);
  return engage;
}

/** Linear interpolation from `a` to `b` by `t` (t already clamped to [0,1]). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Effective follow distance with the cap applied by `engage`. At engage 0 the
 * user's distance passes through untouched; at engage 1 it is clamped to
 * MAZE_CAM_MAX_DISTANCE (a distance already under the cap is unaffected at any
 * engagement). Works AFTER the portrait aspect multiplier, so a phone's pulled-
 * back distance is still capped inside the maze.
 */
export function cappedFollowDistance(distance: number, engage: number): number {
  return lerp(distance, Math.min(distance, MAZE_CAM_MAX_DISTANCE), engage);
}

/** Final camera Y with the height cap applied by `engage` (≤ MAZE_CAM_MAX_Y at 1). */
export function cappedCameraY(y: number, engage: number): number {
  return lerp(y, Math.min(y, MAZE_CAM_MAX_Y), engage);
}
