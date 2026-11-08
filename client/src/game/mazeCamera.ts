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
 *
 * The clamp itself lives in indoorCamera.ts, where a building's camera limit uses it too (Task 5): the maze is
 * the same rule with the numbers below (`MAZE_CAMERA_LIMIT`), so its results are unchanged; the helpers here
 * hand the maze's limit to it.
 */

import { ZONES, WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { limitedDistance, limitedY, type CameraLimit } from "./indoorCamera";
import type { GeometryId } from "@caysonverse/shared/school/geometry";

/** Max effective follow distance (m) while the cap is fully engaged. */
export const MAZE_CAM_MAX_DISTANCE = 6;

/** Max final camera height (m) while capped — below the 4 m wall top so no peek. */
export const MAZE_CAM_MAX_Y = WALL_HEIGHT - 0.5; // 3.5

/** The maze's cap as a camera limit. The overview is allowed in the maze (design 20: easy escape wins). */
export const MAZE_CAMERA_LIMIT: CameraLimit = Object.freeze({
  maxY: MAZE_CAM_MAX_Y,
  maxDistance: MAZE_CAM_MAX_DISTANCE,
  overview: true,
});

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

/**
 * Effective follow distance with the cap applied by `engage`. At engage 0 the
 * user's distance passes through untouched; at engage 1 it is clamped to
 * MAZE_CAM_MAX_DISTANCE (a distance already under the cap is unaffected at any
 * engagement). Works AFTER the portrait aspect multiplier, so a phone's pulled-
 * back distance is still capped inside the maze.
 */
export function cappedFollowDistance(distance: number, engage: number): number {
  return limitedDistance(distance, MAZE_CAMERA_LIMIT, engage);
}

/** Final camera Y with the height cap applied by `engage` (≤ MAZE_CAM_MAX_Y at 1). */
export function cappedCameraY(y: number, engage: number): number {
  return limitedY(y, MAZE_CAMERA_LIMIT, engage);
}

/**
 * The camera limit in force for a player at (x, z) on `map`: the map's own (a building's ceiling limit), else the
 * maze's cap while the player stands in the maze — a zone of the LEGACY world only. The village (and every other
 * map) has its own coordinates, and the maze's rectangle (x -66..-30, z -18..18) overlaps the open village's, so
 * the zone test alone must not decide: a stroll past the west houses must not cap the village camera at 6 m.
 */
export function cameraLimitAt(
  map: { cameraLimit?: CameraLimit; geometry: { id: GeometryId } },
  x: number,
  z: number,
): CameraLimit | undefined {
  if (map.cameraLimit) return map.cameraLimit;
  return map.geometry.id === "legacy" && isInMaze(x, z) ? MAZE_CAMERA_LIMIT : undefined;
}

/**
 * Whether the camera arm takes its indoor shape (keeps its height, the look rises over the head: Task 9): only under
 * a building's own ceiling limit (the map's `cameraLimit`), never for the legacy maze's cap, whose arm behaves as it
 * always did (final review m1: the legacy world gets no other change).
 */
export function indoorArmAt(map: { cameraLimit?: CameraLimit }, limitNow: CameraLimit | undefined): boolean {
  return limitNow !== undefined && map.cameraLimit !== undefined;
}
