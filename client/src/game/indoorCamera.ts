/**
 * The indoor camera (케이슨 마을 phase 1, Task 5): inside a building the third-person camera must read as being IN
 * the room, never above its roof. The owner: "지붕을 뚫고 화면이 보이는게 아니고 그 공간안에 있는 것으로 보이는
 * 카메라 구조". Every building has a roof, and from inside you see the ceiling.
 *
 * A place can carry a `CameraLimit` (`ActiveMap.cameraLimit`): the camera spot is pulled in until it is at most
 * `maxDistance` (m) from the player's head AND at most `maxY` (m) up, so no pitch, zoom or screen shape can lift it
 * through the ceiling. Where there is no limit (the open village, the legacy world, the hub) nothing is clamped.
 * The maze's anti-peek cap (mazeCamera.ts) is the same clamp with its own numbers; both go through
 * `indoorCameraClamp`, so there is ONE rule for "the camera stays under a lid".
 *
 * Two independent clamps, both required (as in the maze):
 *   - distance: the offset from the head is scaled down to `maxDistance` (the camera keeps its direction), and
 *   - height: the final Y is capped at `maxY` (the pitch cannot lift it past the ceiling at any distance).
 * A 0..1 `engage` blends the clamp in (the maze eases it over 0.3 s as the player walks in); a building's limit is
 * engaged at once, because the door's curtain already hides the cut.
 *
 * Pure and allocation-free (the caller passes `out`): CameraRig calls it every frame.
 */

/** How far a place lets the third-person camera go. */
export interface CameraLimit {
  /** Highest the camera may be (m): under the ceiling. */
  maxY: number;
  /** Farthest the camera may be from the player's head (m). */
  maxDistance: number;
  /** Whether the top-down overview (the map) is allowed there. */
  overview: boolean;
}

/** A point; structurally a three `Vector3` too. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Inside the memorial hall (ceiling 3.4 m): the camera stays at or under 3.1 m and within 3.6 m of the player's
 * head, and there is no overview. 3.1 m is the ceiling slab's underside (3.3) less the spring arm's 0.2 m pad.
 */
export const HALL_CAMERA_LIMIT: CameraLimit = Object.freeze({ maxY: 3.1, maxDistance: 3.6, overview: false });

/** Linear interpolation from `a` to `b` by `t` (t already clamped to [0,1]). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * `distance` with the limit applied by `engage` (0 = untouched, 1 = at most `maxDistance`). A distance already under
 * the limit is unaffected at any engagement.
 */
export function limitedDistance(distance: number, limit: CameraLimit, engage: number = 1): number {
  return lerp(distance, Math.min(distance, limit.maxDistance), engage);
}

/** Camera height `y` with the limit applied by `engage` (0 = untouched, 1 = at most `maxY`). */
export function limitedY(y: number, limit: CameraLimit, engage: number = 1): number {
  return lerp(y, Math.min(y, limit.maxY), engage);
}

/**
 * The camera spot for the wanted `desired` one: its offset from the player's head `target` is shortened to the
 * limit's distance (same direction), then its height is capped. `engage` (0..1) blends the limit in; at 1 the
 * spot is guaranteed to be within `limit.maxDistance` of `target` and at or under `limit.maxY`. The result goes
 * into `out` (a fresh object when none is given) and is returned; `desired` and `target` are not touched.
 */
export function indoorCameraClamp(
  desired: Vec3,
  target: Vec3,
  limit: CameraLimit,
  engage: number = 1,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  const ox = desired.x - target.x;
  const oy = desired.y - target.y;
  const oz = desired.z - target.z;
  const dist = Math.sqrt(ox * ox + oy * oy + oz * oz);
  // A camera on the head has no direction to shorten along.
  const k = dist > 1e-9 ? limitedDistance(dist, limit, engage) / dist : 1;
  out.x = target.x + ox * k;
  out.z = target.z + oz * k;
  out.y = limitedY(target.y + oy * k, limit, engage);
  return out;
}

/** True when the top-down overview may be opened where `limit` applies (no limit = allowed). */
export function overviewAllowed(limit: CameraLimit | undefined): boolean {
  return limit === undefined || limit.overview;
}

/**
 * True when going from a place with limit `a` to one with limit `b` crosses a limit (into or out of a building):
 * the camera is then re-seated at once instead of being eased. Two places with the same limit — or none — are
 * not a crossing (a hub gate opening must not snap the view).
 */
export function limitsDiffer(a: CameraLimit | undefined, b: CameraLimit | undefined): boolean {
  return a !== b;
}
