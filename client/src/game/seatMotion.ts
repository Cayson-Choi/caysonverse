/**
 * Sitting down on and getting up from a seat the sitter rests ON (케이슨 마을's benches: a seat with `seatY`) — pure,
 * shared by the local avatar (LocalPlayer) and remote ones (RemotePlayer), so both move the same way.
 *
 *  - The lift: the sit pose's butt is at SIT_POSE.contactY; a bench's surface is a few cm higher, so the seated avatar
 *    is raised by `liftForSeatY(seatY)`. It eases in while Sit_Chair_Down lifts the body off its feet and onto the seat
 *    (25 → 65 % of the clip; the butt arrives at about 65 %) and out while Sit_Chair_StandUp puts the feet back down
 *    (0 → 40 %), so the feet never float above the ground nor sink into it while standing.
 *  - The glides: the avatar walks onto the seat's spot while the sit-down clip starts (instead of jumping there), and
 *    the stand-up clip carries it from the seat to the dismount spot the server chose in front of the bench (instead
 *    of it rising from thin air there). Both stay in front of the bench: the prompt is only offered from the front and
 *    the dismount spot is ahead of the seat.
 *
 * The legacy world's chairs have no `seatY`: no lift, no glide — they keep their snap, exactly as before.
 * Everything here is a function of the time spent in the current clip; nothing reads a clock.
 */

import { lerpAngle } from "./yaw";

/** The share of Sit_Chair_Down over which the avatar walks onto the seat's spot (the clip's standing start). */
export const SIT_GLIDE = { from: 0, to: 0.35 } as const;
/** The share of Sit_Chair_StandUp over which the body is carried from the seat to the dismount spot. */
export const STAND_GLIDE = { from: 0.05, to: 0.7 } as const;
/** Lift windows (shares of the clip): eased in over SIT_LIFT, eased out over STAND_LIFT. */
export const SIT_LIFT = { from: 0.25, to: 0.65 } as const;
export const STAND_LIFT = { from: 0, to: 0.4 } as const;

function clamp01(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** Smoothstep of `t` (clamped to 0..1). */
export function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** How far (0..1, eased) through `window` of a clip `duration` s long the clip is after `elapsed` s. */
export function windowProgress(elapsed: number, duration: number, window: { from: number; to: number }): number {
  if (!(duration > 0)) return 1;
  return smooth((elapsed / duration - window.from) / (window.to - window.from));
}

/** The lift (m) while sitting down: none while still standing, all of `lift` once the butt reaches the seat. */
export function sitDownLift(lift: number, elapsed: number, duration: number): number {
  return lift * windowProgress(elapsed, duration, SIT_LIFT);
}

/** The lift (m) while getting up: all of `lift` while the butt is on the seat, none once the feet are down. */
export function standUpLift(lift: number, elapsed: number, duration: number): number {
  return lift * (1 - windowProgress(elapsed, duration, STAND_LIFT));
}

/** A move of the avatar's root from one spot (and facing) to another over a window of a clip. */
export interface Glide {
  fromX: number;
  fromZ: number;
  fromYaw: number;
  toX: number;
  toZ: number;
  toYaw: number;
  window: { from: number; to: number };
}

/** Where the glide puts the root after `elapsed` s of a clip `duration` s long (writes into `out`). */
export function glideAt(g: Glide, elapsed: number, duration: number, out: { x: number; z: number; yaw: number }): void {
  const k = windowProgress(elapsed, duration, g.window);
  out.x = g.fromX + (g.toX - g.fromX) * k;
  out.z = g.fromZ + (g.toZ - g.fromZ) * k;
  out.yaw = lerpAngle(g.fromYaw, g.toYaw, k);
}

/** Whether the glide is over after `elapsed` s of a clip `duration` s long. */
export function glideDone(g: Glide, elapsed: number, duration: number): boolean {
  return !(duration > 0) || elapsed / duration >= g.window.to;
}
