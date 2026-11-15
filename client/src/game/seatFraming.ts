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
import { SHOULDER } from "./cameraShoulder";

/** The tilt a seat indoors starts the third-person camera at (rad): nearly level, over the shoulder, so the room is in view. */
export const INDOOR_SEAT_PITCH = 0.12;
/** Steeper tilts tried when the level one has no room (rad). */
const SEAT_PITCHES = [INDOOR_SEAT_PITCH, 0.3, 0.5] as const;
/** The least camera-to-head distance (m) a seat's first framing gives: the nearest zoom (3.2 m) and a margin. */
export const INDOOR_SEAT_MIN_DIST = CAMERA.minDistance + 0.15;
/** A seat's first framing is looked for at this distance (m) first, before settling for the least room. */
export const INDOOR_SEAT_ROOMY = 4.5;
/**
 * The yaw offsets from "behind the seat" that are tried, in order (right before left at each step): from behind (up to 45°
 * round), then the front three-quarter views from the room, then straight from the front, then the side views. Round 6
 * review: side views of a sofa against the wall look along the wall, past the tea counter and the door frame — the body
 * reads as stuck to the counter — so they come last.
 */
const OFFSETS: readonly number[] = (() => {
  const deg = [0, 15, 30, 45, 135, 120, 150, 165, 180, 105, 90, 75, 60];
  const out: number[] = [];
  for (const d of deg) {
    out.push((d * Math.PI) / 180);
    if (d !== 0 && d !== 180) out.push((-d * Math.PI) / 180);
  }
  return out;
})();

/**
 * Whether something solid (the hall's own model: a counter, a cabinet, a coffee machine) stands between a camera spot and a point
 * of the seated body. The hall registers a raycast over its model while it is mounted (MemorialHall.tsx); without one, every
 * framing counts as clear. Round 6 review: sofa a0/a1's first framing looked along the wall past the tea counter, which hid
 * the body — the walls-only arm could not know the counter was there.
 */
export type SightBlocked = (fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number) => boolean;
let sightBlocked: SightBlocked | null = null;
/** Register (or clear) the blocker; returns the unregister for that one blocker. */
export function setSeatSightBlocker(fn: SightBlocked | null): () => void {
  sightBlocked = fn;
  frameCache.clear();
  return () => {
    if (sightBlocked === fn) {
      sightBlocked = null;
      frameCache.clear();
    }
  };
}

/**
 * Whether a camera spot itself is inside or right against something solid, or up among things hung from the ceiling (the
 * lounge's oak louvres and beams, the cove, the light fittings). Round 7 review: letter_s0's first framing put the camera at
 * 4.1 m inside the louvres — the sight rays to the body slipped through the gaps between the slats, so the spot itself is
 * tested. The hall registers it over its model while mounted (MemorialHall.tsx); without one, every spot is clear.
 */
export type SpotBlocked = (x: number, y: number, z: number) => boolean;
let spotBlocked: SpotBlocked | null = null;
/** Register (or clear) the spot test; returns the unregister for that one test. */
export function setSeatSpotBlocker(fn: SpotBlocked | null): () => void {
  spotBlocked = fn;
  frameCache.clear();
  return () => {
    if (spotBlocked === fn) {
      spotBlocked = null;
      frameCache.clear();
    }
  };
}

/** Whether the camera spot is clear (no spot test registered: yes). */
export function seatSpotClear(spot: { x: number; y: number; z: number }): boolean {
  return !spotBlocked || !spotBlocked(spot.x, spot.y, spot.z);
}

/**
 * The seats are fixed: a seat's first framing for one zoom and one screen shape is worked out once (round 7 review: the search
 * cast up to ~800 rays over the hall's model and stalled the tap on 앉기 by 30-70 ms on a fast PC). Cleared whenever the hall's
 * tests change (a new hall model).
 */
const frameCache = new Map<string, SeatFrame>();
const FRAME_CACHE_MAX = 256;
/** Heights (m) of the seated body checked for sight: the lap, the chest and the head. The body is in view when all are. */
export const SEAT_SIGHT_HEIGHTS = [0.5, 0.75, 1.05] as const;
/**
 * …and the chest's width with a margin (m, to either side, across the view): a framing that grazes a counter right beside the
 * body (sofa a0/a1 seen along the wall past the tea counter) reads as the body stuck to the counter, so it does not count.
 */
export const SEAT_SIGHT_SIDE = 0.45;

/** Whether a camera settled at `spot` sees the seated body at (x, z) (with no blocker registered: yes). */
export function seatBodyInSight(spot: { x: number; y: number; z: number }, x: number, z: number): boolean {
  const blocked = sightBlocked;
  if (!blocked) return true;
  if (SEAT_SIGHT_HEIGHTS.some((y) => blocked(spot.x, spot.y, spot.z, x, y, z))) return false;
  const dx = x - spot.x;
  const dz = z - spot.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const sx = (-dz / len) * SEAT_SIGHT_SIDE;
  const sz = (dx / len) * SEAT_SIGHT_SIDE;
  return !blocked(spot.x, spot.y, spot.z, x + sx, 0.75, z + sz) && !blocked(spot.x, spot.y, spot.z, x - sx, 0.75, z - sz);
}

export interface SeatFrame {
  yaw: number;
  pitch: number;
  /** Where the camera then settles, from the head (m). */
  dist: number;
}

/** Where the camera settles (distance from the head) for a player at (x, z) with the orbit (yaw, pitch, distance) on `aspect`. */
export function settledHeadDistance(x: number, z: number, yaw: number, pitch: number, distance: number, aspect: number): number {
  return settledSpot(x, z, yaw, pitch, distance, aspect).dist;
}

/** Where the camera settles for that orbit (and its distance from the head). */
function settledSpot(x: number, z: number, yaw: number, pitch: number, distance: number, aspect: number): { x: number; y: number; z: number; dist: number } {
  const orbit = { yaw, pitch, distance };
  const rig = createFollowRig(orbit);
  const spot = createFollowSpot();
  // the arm takes a shorter length at once; two frames settle the ceiling and the walls
  stepFollowRig(rig, orbit, x, z, aspect, 1 / 60, true, spot);
  stepFollowRig(rig, orbit, x, z, aspect, 1 / 60, true, spot);
  return { x: spot.x, y: spot.y, z: spot.z, dist: Math.hypot(spot.x - x, spot.y - HEAD_HEIGHT, spot.z - z) };
}

/**
 * The first framing of a seat at (x, z) facing `seatYaw`, for the player's zoom `distance` on a screen of `aspect`: the yaw and
 * tilt nearest "behind, looking the way the seat faces, level" at which the camera stays `INDOOR_SEAT_MIN_DIST` from the head.
 * Where no direction has that room (never in the hall), the one with the most.
 */
export function indoorSeatFrame(x: number, z: number, seatYaw: number, distance: number, aspect: number): SeatFrame {
  const key = `${x.toFixed(2)},${z.toFixed(2)},${seatYaw.toFixed(3)},${distance.toFixed(2)},${aspect.toFixed(3)}`;
  const hit = frameCache.get(key);
  if (hit) return { ...hit };
  const f = searchSeatFrame(x, z, seatYaw, distance, aspect);
  if (frameCache.size >= FRAME_CACHE_MAX) frameCache.clear();
  frameCache.set(key, f);
  return { ...f };
}

function searchSeatFrame(x: number, z: number, seatYaw: number, distance: number, aspect: number): SeatFrame {
  const behind = recenterYaw(seatYaw);
  let bestClear: SeatFrame | null = null;
  let bestSeen: SeatFrame | null = null;
  let best: SeatFrame | null = null;
  // first a roomy framing (the player's own zoom, up to INDOOR_SEAT_ROOMY) from behind, the front three-quarters or the side: a sofa against the wall is
  // then seen from across the room, not from a camera squeezed along the wall; then any direction with the least room
  const roomy = Math.min(INDOOR_SEAT_ROOMY, distance * 0.9);
  for (const [need, maxOff] of [
    [Math.max(INDOOR_SEAT_MIN_DIST, roomy), Math.PI + 1e-9],
    [INDOOR_SEAT_MIN_DIST, Math.PI + 1e-9],
  ] as const) {
    for (const off of OFFSETS) {
      if (Math.abs(off) > maxOff) continue;
      for (const pitch of SEAT_PITCHES) {
        const yaw = normalizeAngle(behind + off);
        const spot = settledSpot(x, z, yaw, pitch, distance, aspect);
        const dist = spot.dist;
        // with room enough, the body must also be in sight (a counter or a cabinet between them is no framing), and the camera
        // far enough out across the floor that the wall's over-the-shoulder view (cameraShoulder.ts) stays off
        const across = Math.hypot(spot.x - x, spot.z - z);
        // the camera spot itself: never inside the louvres, a cabinet or a wall's trim (round 7 review)
        const clear = seatSpotClear(spot);
        if (clear && dist >= need - 1e-9 && across >= SHOULDER.engageBelow && seatBodyInSight(spot, x, z)) return { yaw, pitch, dist };
        if (clear && (!bestClear || dist > bestClear.dist)) bestClear = { yaw, pitch, dist };
        // no framing with every rule met: one that still sees the body from a clear spot comes first
        if (clear && dist >= INDOOR_SEAT_MIN_DIST - 1e-9 && (!bestSeen || dist < bestSeen.dist) && seatBodyInSight(spot, x, z)) bestSeen = { yaw, pitch, dist };
        if (!best || dist > best.dist) best = { yaw, pitch, dist };
      }
    }
  }
  return bestSeen ?? bestClear ?? best!;
}
