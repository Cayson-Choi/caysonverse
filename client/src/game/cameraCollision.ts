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
 * Only walls count (room walls + maze walls, floor to WALL_HEIGHT): furniture is low
 * enough to look over. Everything here is pure and allocation-free — the raycast
 * runs every frame, against ~120 boxes, so it first rejects boxes whose XZ footprint
 * the segment cannot reach.
 */

import type { AABB } from "@caysonverse/shared/collision";
import { MAZE_WALLS } from "@caysonverse/shared/maze";
import { WALLS, WALL_HEIGHT } from "@caysonverse/shared/worldMap";

/** Every box the camera can be blocked by: the room walls and the maze walls (0..WALL_HEIGHT tall). */
export const CAMERA_BOXES: readonly AABB[] = [...WALLS, ...MAZE_WALLS];

/**
 * Spring arm tuning: the arm never gets shorter than `minDist` (m), stops `pad` (m)
 * in front of the wall it hit, and grows back out at `returnRate` (m/s).
 */
export const SPRING = { minDist: 0.6, pad: 0.2, returnRate: 6 } as const;

/**
 * Value of the eased arm limit while nothing is in the way. Larger than any arm the
 * camera can ask for (maxDistance 18 m × the portrait pull-back 1.6), so a free limit
 * never shortens the arm and never has to "grow back" when the player zooms out.
 */
export const ARM_FREE = 64;

/**
 * Where, along the segment A → B, it first enters one of `boxes` (each spanning
 * y = 0..`height`): a fraction t in [0, 1), or 1 when nothing blocks it.
 *
 * Per box this is the usual slab test on x, y and z. A box that already contains A
 * is skipped — a head hugging a wall must not fold the camera to zero — and so is
 * one the segment only touches at B.
 */
export function segmentHitFraction(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: readonly AABB[] = CAMERA_BOXES,
  height: number = WALL_HEIGHT,
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
    if (b.maxX < loX || b.minX > hiX || b.maxZ < loZ || b.minZ > hiZ) continue;
    if (
      ax >= b.minX &&
      ax <= b.maxX &&
      az >= b.minZ &&
      az <= b.maxZ &&
      ay >= 0 &&
      ay <= height
    ) {
      continue; // the start is inside this box
    }

    let enter = 0;
    let exit = 1;
    if (dx === 0) {
      if (ax < b.minX || ax > b.maxX) continue;
    } else {
      let t1 = (b.minX - ax) / dx;
      let t2 = (b.maxX - ax) / dx;
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
      if (ay < 0 || ay > height) continue;
    } else {
      let t1 = (0 - ay) / dy;
      let t2 = (height - ay) / dy;
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
      if (az < b.minZ || az > b.maxZ) continue;
    } else {
      let t1 = (b.minZ - az) / dz;
      let t2 = (b.maxZ - az) / dz;
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
 * camera spot is clear, otherwise the distance to the wall it hits minus `SPRING.pad`
 * — but never under `SPRING.minDist`. `desired` is the length of that segment.
 */
export function springArmDistance(
  headX: number,
  headY: number,
  headZ: number,
  camX: number,
  camY: number,
  camZ: number,
  desired: number,
  boxes: readonly AABB[] = CAMERA_BOXES,
): number {
  const t = segmentHitFraction(headX, headY, headZ, camX, camY, camZ, boxes);
  if (t >= 1) return desired;
  return Math.max(SPRING.minDist, t * desired - SPRING.pad);
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
