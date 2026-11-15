/**
 * Over-the-shoulder camera against a wall, indoors (review 2026-11-15 round 6).
 *
 * Inside the memorial hall the player keeps walking up to a cubby bank, the "기억의 자리" niche or the letter table and
 * then turning round to face the room. The spring arm (cameraCollision.ts) then pulls the camera in to just in front of
 * the wall behind, and the indoor arm shape keeps its height — so it ended up right over the head (2.9 m, 1.8 m from it)
 * looking down, and the back of the head filled 50 % of a PC screen and 70-80 % of a phone. Good third-person games
 * slide the camera to an over-the-shoulder offset at that point, look level, and let the body fade a little.
 *
 * Here: while the spring-armed spot is nearer than `SHOULDER.engageBelow` to the head (across the floor), the camera blends (eased, never a
 * hard pop) toward a spot beside the head — a shoulder to the side, a little above it, as far back as the wall allows —
 * looking level ahead into the room. The side is the one with more room (right first) and is kept while engaged, so it
 * never flips back and forth. A wall at that side shortens the offset like the arm. Like every arm change it shapes one
 * frame and never writes the player's orbit: the wall clear again, the camera is exactly back where the player put it.
 * LocalPlayer fades the body to partial transparency while the camera is this close (SELF_COVER_FADE_*), never a ghost.
 */

import type { CameraBox } from "@caysonverse/shared/collision";
import { WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { HEAD_HEIGHT } from "./constants";
import { CAMERA_LOOK_LIFT } from "./cameraControls";
import { segmentHitFraction } from "./cameraCollision";

export const SHOULDER = {
  /**
   * The shoulder view starts once the wall has pulled the camera nearer than this to the head, measured across the floor (m):
   * however high the tilt holds it, a camera nearly over the head looks down on it. Arrival is 3.1 m out; a seat's first
   * framing 2.9 m+ (3.35 m at a tilt of at most 0.5).
   */
  engageBelow: 2.4,
  /** …and is whole at or under this (m). */
  fullBelow: 1.7,
  /** Side offset (m). */
  side: 0.55,
  /** Height of the shoulder camera over the head (m): over the big chibi head, so the lens is never inside it… */
  lift: 0.95,
  /** …and this much more on a tall portrait screen (aspect 0.46 gets about +0.16 m): its narrow view meets the head sooner. */
  portraitLift: 0.3,
  /** The level look: a point this far ahead (m)… */
  ahead: 6,
  /** …at this height (m): a slight look down onto the hall floor and benches. */
  lookY: 1.35,
  /** Easing time constant (s) of the blend in and out. */
  tau: 0.14,
  /** Never closer to the head than this (m): the lift grows to keep it (the body is hidden under 0.6 m). */
  minHeadDist: 0.95,
} as const;

/** The shoulder blend wanted for a spring-armed spot `dist` m from the head across the floor: 0 (off) .. 1 (whole), smooth in between. */
export function shoulderTarget(dist: number): number {
  const u = (SHOULDER.engageBelow - dist) / (SHOULDER.engageBelow - SHOULDER.fullBelow);
  const c = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/** One frame of the eased shoulder blend (`dt` s). */
export function stepShoulder(current: number, target: number, dt: number): number {
  const next = target + (current - target) * Math.exp(-Math.min(Math.max(dt, 0), 0.1) / SHOULDER.tau);
  return Math.abs(next - target) < 1e-3 ? target : next;
}

/** The shoulder spot and look, relative to the body at (x, z): written into a caller-owned object (no allocation). */
export interface ShoulderPose {
  x: number;
  y: number;
  z: number;
  /** Look target's horizontal offset from the body (m). */
  lookX: number;
  lookZ: number;
  /** Look target height over HEAD_HEIGHT + CAMERA_LOOK_LIFT (m): what FollowSpot.lookLift carries. */
  lookLift: number;
  /** The side chosen: +1 = the view's right, −1 = its left. */
  side: number;
}

export function createShoulderPose(): ShoulderPose {
  return { x: 0, y: 0, z: 0, lookX: 0, lookZ: 0, lookLift: 0, side: 1 };
}

/**
 * The over-the-shoulder spot for a body at (x, z), an orbit yaw `yaw`, the spring-armed spot (`armX`, `armZ`) whose
 * horizontal distance behind the head is how far back the wall allows. `keepSide` is the side already in use (0 = pick
 * now: the one with more room, the right on a tie). `boxes` / `pad`: the walls and the pad the arm casts against.
 */
export function shoulderPose(
  x: number,
  z: number,
  yaw: number,
  armX: number,
  armZ: number,
  aspect: number,
  keepSide: number,
  boxes: readonly CameraBox[],
  pad: number,
  out: ShoulderPose,
): ShoulderPose {
  const bx = Math.sin(yaw);
  const bz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const back = Math.max(0, (armX - x) * bx + (armZ - z) * bz);
  const sideW = SHOULDER.side;
  const baseLift = SHOULDER.lift + SHOULDER.portraitLift * (1 - Math.min(1, Math.max(0, aspect)));
  const y = HEAD_HEIGHT + baseLift;
  const cast = (sign: number): number =>
    segmentHitFraction(x, HEAD_HEIGHT, z, x + bx * back + rx * sign * sideW, y, z + bz * back + rz * sign * sideW, boxes, WALL_HEIGHT, pad);
  let side = keepSide;
  let t: number;
  if (side === 0) {
    const right = cast(1);
    const left = cast(-1);
    side = left > right + 1e-3 ? -1 : 1;
    t = side === 1 ? right : left;
  } else {
    t = cast(side);
  }
  const offX = (bx * back + rx * side * sideW) * t;
  const offZ = (bz * back + rz * side * sideW) * t;
  const horiz = Math.hypot(offX, offZ);
  const lift = Math.max(baseLift, Math.sqrt(Math.max(0, SHOULDER.minHeadDist ** 2 - horiz * horiz)));
  out.x = x + offX;
  out.y = HEAD_HEIGHT + lift;
  out.z = z + offZ;
  // Level look straight ahead from the shoulder (parallel to the orbit's view), so the head sits off to one side.
  out.lookX = offX - bx * SHOULDER.ahead;
  out.lookZ = offZ - bz * SHOULDER.ahead;
  out.lookLift = SHOULDER.lookY - HEAD_HEIGHT - CAMERA_LOOK_LIFT;
  out.side = side;
  return out;
}
