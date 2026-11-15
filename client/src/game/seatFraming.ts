/**
 * The third-person framing a seat indoors starts with (케이슨 마을 추모관). Review 2026-11-15 round 5: the player must SEE their own
 * avatar sitting on every seat. Behind a sofa or an armchair against the hall's wall there is no room for the camera, so it used to
 * end up at the head (and the body was hidden). Now the seat's glide goal is the yaw nearest "behind the seat, looking the way it
 * faces" — then turning round the seat, side views before front views — at which the camera, after the walls have shortened its
 * arm, is still at least `INDOOR_SEAT_MIN_DIST` from the head (the nearest zoom, `CAMERA.minDistance`, plus a margin). Pure
 * apart from reading the active map's walls (the same spring arm CameraRig draws with: `stepFollowRig`).
 */

import { CAMERA, HEAD_HEIGHT } from "./constants";
import { recenterYaw } from "./cameraControls";
import { normalizeAngle } from "./yaw";
import { createFollowRig, createFollowSpot, stepFollowRig } from "./followRig";

/** The tilt a seat indoors starts the third-person camera at (rad): nearly level, over the shoulder, so the room is in view. */
export const INDOOR_SEAT_PITCH = 0.12;
/** Steeper tilts tried when the level one has no room (rad). */
const SEAT_PITCHES = [INDOOR_SEAT_PITCH, 0.3, 0.5] as const;
/** The least camera-to-head distance (m) a seat's first framing gives: the nearest zoom (3.2 m) and a margin. */
export const INDOOR_SEAT_MIN_DIST = CAMERA.minDistance + 0.15;
/** A seat's first framing is looked for at this distance (m) first, before settling for the least room. */
export const INDOOR_SEAT_ROOMY = 4.5;
/** The yaw offsets from "behind the seat" that are tried, in order: behind, then 15° steps round, right before left. */
const OFFSETS: readonly number[] = (() => {
  const out = [0];
  for (let k = 1; k <= 12; k++) out.push((k * Math.PI) / 12, (-k * Math.PI) / 12);
  return out;
})();

export interface SeatFrame {
  yaw: number;
  pitch: number;
  /** Where the camera then settles, from the head (m). */
  dist: number;
}

/** Where the camera settles (distance from the head) for a player at (x, z) with the orbit (yaw, pitch, distance) on `aspect`. */
export function settledHeadDistance(x: number, z: number, yaw: number, pitch: number, distance: number, aspect: number): number {
  const orbit = { yaw, pitch, distance };
  const rig = createFollowRig(orbit);
  const spot = createFollowSpot();
  // the arm takes a shorter length at once; two frames settle the ceiling and the walls
  stepFollowRig(rig, orbit, x, z, aspect, 1 / 60, true, spot);
  stepFollowRig(rig, orbit, x, z, aspect, 1 / 60, true, spot);
  return Math.hypot(spot.x - x, spot.y - HEAD_HEIGHT, spot.z - z);
}

/**
 * The first framing of a seat at (x, z) facing `seatYaw`, for the player's zoom `distance` on a screen of `aspect`: the yaw and
 * tilt nearest "behind, looking the way the seat faces, level" at which the camera stays `INDOOR_SEAT_MIN_DIST` from the head.
 * Where no direction has that room (never in the hall), the one with the most.
 */
export function indoorSeatFrame(x: number, z: number, seatYaw: number, distance: number, aspect: number): SeatFrame {
  const behind = recenterYaw(seatYaw);
  let best: SeatFrame | null = null;
  // first a roomy framing (the player's own zoom, up to INDOOR_SEAT_ROOMY) from behind or the side: a sofa against the wall is
  // then seen from across the room, not from a camera squeezed along the wall; then any direction with the least room
  const roomy = Math.min(INDOOR_SEAT_ROOMY, distance * 0.9);
  for (const [need, maxOff] of [
    [Math.max(INDOOR_SEAT_MIN_DIST, roomy), (3 * Math.PI) / 4 + 1e-9],
    [INDOOR_SEAT_MIN_DIST, Math.PI + 1e-9],
  ] as const) {
    for (const off of OFFSETS) {
      if (Math.abs(off) > maxOff) continue;
      for (const pitch of SEAT_PITCHES) {
        const yaw = normalizeAngle(behind + off);
        const dist = settledHeadDistance(x, z, yaw, pitch, distance, aspect);
        if (dist >= need - 1e-9) return { yaw, pitch, dist };
        if (!best || dist > best.dist) best = { yaw, pitch, dist };
      }
    }
  }
  return best!;
}
