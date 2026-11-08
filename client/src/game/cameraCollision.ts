/**
 * Spring arm: keep the third-person camera on the player's side of a wall.
 *
 * The follow camera sits `distance` behind the head. When a wall lies between the
 * head and that spot, the camera would be inside (or behind) it and the avatar
 * would vanish behind a flat face. So each frame a segment is cast from the head to
 * the wanted camera position against the wall boxes; if it hits, the arm is pulled
 * in to just in front of the wall. It snaps IN at once (never show the far side of a
 * wall) and eases back OUT at `SPRING.returnRate` m/s once the way is clear.
 *
 * Walls count (room walls + maze walls, floor to WALL_HEIGHT), and so does a prop that states
 * a `height` of its own (a locker bank, a bookcase: tall enough that the camera, low or close,
 * would end up inside it). Furniture lower than that is looked over. Everything here is pure and allocation-free — the raycast
 * runs every frame, against ~120 boxes, so it first rejects boxes whose XZ footprint
 * the segment cannot reach.
 */

import type { AABB, CameraBox } from "@caysonverse/shared/collision";
import { LEGACY_GEOMETRY, WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { getActiveMap } from "./activeMap";

/**
 * Every box the camera can be blocked by in the legacy world: the room walls and the maze walls
 * (0..WALL_HEIGHT tall). It IS `LEGACY_GEOMETRY.cameraBoxes` — the one list the school maps'
 * geometries also carry — so there is no second copy of this geometry to drift.
 */
export const CAMERA_BOXES: readonly AABB[] = LEGACY_GEOMETRY.cameraBoxes;

/** The camera boxes of the map the player stands in now (activeMap.ts): what every cast uses. */
export function cameraBoxes(): readonly CameraBox[] {
  return getActiveMap().geometry.cameraBoxes;
}

/**
 * Spring arm tuning: the arm never gets shorter than `minDist` (m), stops `pad` (m)
 * in front of the wall it hit, and grows back out at `returnRate` (m/s).
 */
export const SPRING = { minDist: 0.6, pad: 0.2, returnRate: 6 } as const;

/**
 * The pad of the map the player stands in now: its own (`ActiveMap.cameraPad`, 케이슨 마을's 0.3, wider than its 0.2 near
 * plane) or `SPRING.pad`.
 */
export function cameraPad(): number {
  return getActiveMap().cameraPad ?? SPRING.pad;
}

/**
 * Value of the eased arm limit while nothing is in the way. Larger than any arm the
 * camera can ask for (maxDistance 18 m × the portrait pull-back 1.6), so a free limit
 * never shortens the arm and never has to "grow back" when the player zooms out.
 */
export const ARM_FREE = 64;

/**
 * Where, along the segment A → B, it first enters one of `boxes` (each spanning
 * y = `minY`..its own `height` — `minY` is 0 unless the box is a ceiling slab — or `height` when it
 * states none): a fraction t in [0, 1), or 1 when nothing blocks it.
 *
 * Per box this is the usual slab test on x, y and z. A box that already contains A
 * is skipped — a head hugging a wall must not fold the camera to zero — and so is
 * one the segment only touches at B.
 *
 * `margin` (m) inflates every box in X and Z (not in height) for the cast: the hit is
 * then where the segment comes within `margin` of the wall, measured ACROSS the wall,
 * however shallow the angle. A start inside the inflated box but outside the raw one
 * (closer than `margin` to a wall) is tested against the raw box instead, so it never
 * folds to zero either. A ceiling slab's underside is padded the same way (it is lowered
 * by `margin`), so the arm stops `margin` below the roof; its top is not inflated.
 */
export function segmentHitFraction(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: readonly CameraBox[] = cameraBoxes(),
  height: number = WALL_HEIGHT,
  margin: number = 0,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  // XZ bounds of the segment, for the broad phase.
  const loX = ax < bx ? ax : bx;
  const hiX = ax < bx ? bx : ax;
  const loZ = az < bz ? az : bz;
  const hiZ = az < bz ? bz : az;

  let best = 1;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const top = b.height ?? height;
    // A ceiling slab hangs from `minY`; the margin pads it DOWNWARD too, so the arm stops `margin` under the underside.
    const rawBottom = b.minY ?? 0;
    let bottom = rawBottom > 0 ? rawBottom - margin : 0;
    let minX = b.minX - margin;
    let maxX = b.maxX + margin;
    let minZ = b.minZ - margin;
    let maxZ = b.maxZ + margin;
    if (maxX < loX || minX > hiX || maxZ < loZ || minZ > hiZ) continue;
    if (ay >= bottom && ay <= top && ax >= minX && ax <= maxX && az >= minZ && az <= maxZ) {
      // The start is inside the (inflated) box: judge it against the raw one instead…
      minX = b.minX;
      maxX = b.maxX;
      minZ = b.minZ;
      maxZ = b.maxZ;
      bottom = rawBottom;
      // …and skip the box altogether if the start is inside that too.
      if (ay >= bottom && ax >= minX && ax <= maxX && az >= minZ && az <= maxZ) continue;
    }

    let enter = 0;
    let exit = 1;
    if (dx === 0) {
      if (ax < minX || ax > maxX) continue;
    } else {
      let t1 = (minX - ax) / dx;
      let t2 = (maxX - ax) / dx;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > enter) enter = t1;
      if (t2 < exit) exit = t2;
      if (enter > exit) continue;
    }
    if (dy === 0) {
      if (ay < bottom || ay > top) continue;
    } else {
      let t1 = (bottom - ay) / dy;
      let t2 = (top - ay) / dy;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > enter) enter = t1;
      if (t2 < exit) exit = t2;
      if (enter > exit) continue;
    }
    if (dz === 0) {
      if (az < minZ || az > maxZ) continue;
    } else {
      let t1 = (minZ - az) / dz;
      let t2 = (maxZ - az) / dz;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > enter) enter = t1;
      if (t2 < exit) exit = t2;
      if (enter > exit) continue;
    }
    if (enter < best) best = enter;
  }
  return best;
}

/**
 * How long the arm may be: `desired` (m) when the segment from the head to the
 * camera spot is clear, otherwise the distance at which it comes within `pad` (the map's,
 * `cameraPad()`; `SPRING.pad` by default) of a wall — never under `SPRING.minDist`.
 * `desired` is the length of that segment.
 *
 * The pad is applied by inflating the walls for the cast (see `segmentHitFraction`),
 * so it is `SPRING.pad` ACROSS the wall at any angle. Subtracting it along the ray
 * (`t × desired − pad`) is the same for a head-on cast, but at a shallow angle it
 * leaves the camera only `pad × sin(angle)` from the wall — inside the near plane.
 */
export function springArmDistance(
  headX: number,
  headY: number,
  headZ: number,
  camX: number,
  camY: number,
  camZ: number,
  desired: number,
  boxes: readonly CameraBox[] = cameraBoxes(),
  pad: number = cameraPad(),
): number {
  const t = segmentHitFraction(headX, headY, headZ, camX, camY, camZ, boxes, WALL_HEIGHT, pad);
  if (t >= 1) return desired;
  return Math.max(SPRING.minDist, t * desired);
}

/**
 * One frame of the arm length: a shorter target is taken at once (the wall is in
 * the way NOW), a longer one is approached at `SPRING.returnRate` m/s and never
 * overshot.
 */
export function stepSpringDistance(current: number, target: number, dt: number): number {
  if (target <= current) return target;
  const grown = current + SPRING.returnRate * dt;
  return grown < target ? grown : target;
}

/**
 * One frame of the eased arm LIMIT that CameraRig keeps between frames; the arm it
 * draws is `min(desired, limit)`. `reach` is what `springArmDistance` returned for
 * the wanted length `desired`: shorter than `desired` means a wall is in the way, so
 * the limit snaps to it; equal means clear, so the limit eases out toward `ARM_FREE`.
 *
 * Easing the LIMIT (rather than the arm itself) keeps the spring out of the way of
 * the zoom: while the way is clear the limit sits far above `desired`, so a wheel
 * notch or pinch still glides at the zoom's own pace instead of being held to
 * `returnRate`, and a zoom-in is not snapped.
 */
export function stepArmLimit(limit: number, reach: number, desired: number, dt: number): number {
  return stepSpringDistance(limit, reach < desired ? reach : ARM_FREE, dt);
}

/**
 * Seated camera shaping for a SHORTENED arm (a seat close to a wall, e.g. the front
 * row behind the divider). Scaling the whole offset toward the head would drop the
 * camera to head height and fill the view with the avatar's head; seated, the height
 * offset is kept instead and the look target is raised so the screen stays in view.
 * `lookLift` (m) is the raise for a fully pulled-in arm (k → 0); `blendRate` (1/s) is
 * how fast the seated factor eases in and out when sitting down / standing up.
 */
export const SEAT_ARM = { lookLift: 1.6, blendRate: 8 } as const;

/**
 * Factor on the camera's height offset when the arm is shortened to the fraction `k`
 * (0..1) of the wanted length. `seat` is the eased 0..1 seated factor: standing
 * (0) the height shrinks with the arm like the rest of the offset (`k`); seated (1)
 * it is kept whole (1).
 */
export function armHeightScale(k: number, seat: number): number {
  return k + (1 - k) * seat;
}

/** How far (m) the look target rises for a shortened arm `k`, scaled by the seated factor. */
export function armLookLift(k: number, seat: number): number {
  return (1 - k) * seat * SEAT_ARM.lookLift;
}
