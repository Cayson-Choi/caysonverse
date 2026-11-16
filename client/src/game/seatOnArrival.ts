/**
 * A clicked seat on arrival (round 8 review: a first-time visitor taps the sofa; round 9 review: this state machine, which lived
 * inline in CameraRig's frame loop, had no test). A click on a seat (furnitureClick.ts, seatTap.ts) walks to its approach and
 * leaves an "intent" here; each frame `stepSeatOnArrival` decides, from the walk's target and the avatar's pose, whether to keep
 * waiting, turn to face that seat, or forget it.
 *
 * Owner 2026-11-17 ("의자를 찍으면 자동 앉기는 빼줘"): a tap on a seat no longer sits. The walk ends at the seat's approach with the
 * avatar standing and turned toward the seat; the "앉기" button (E on a PC) offers that very seat there (seatPreference.ts), and
 * the visitor sits with it. Pure: CameraRig feeds it and turns the body.
 */
import { DOUBLE_TAP_MS } from "./tapGesture";

/** How near (m) the walk must end to a clicked seat's approach for the avatar to turn toward the seat on arrival. */
export const SIT_ON_ARRIVAL_DIST = 0.7;
/** A clicked seat's walk that has not started within this (ms) is forgotten (the tap was taken back, or a key took over). */
export const SIT_ON_ARRIVAL_ARM_MS = 1500;

/** A seat clicked: its index, its approach (the walk's target), whether that walk has started (`armed`), and when (ms). */
export interface SeatIntent {
  index: number;
  x: number;
  z: number;
  armed: boolean;
  at: number;
}

export interface SeatArrivalInput {
  /** The walk's target now (clickMove.ts peekClickTarget), or null when no walk is going on. */
  target: { x: number; z: number } | null;
  /** The player sits already. */
  seated: boolean;
  /** Where the avatar stands. */
  pose: { x: number; z: number };
  /** performance.now(). */
  now: number;
}

/** What one frame makes of the intent: kept (maybe now armed), or dropped — and the seat to turn toward, if it is time. */
export interface SeatArrivalStep {
  next: SeatIntent | null;
  /** The seat the avatar has arrived at: turn to face it (never a sit: the visitor presses 앉기). */
  face: number | null;
}

/**
 * One frame of the intent. The walk whose target is the intent's approach arms it; once that walk is over (no target) the avatar
 * turns toward the seat when it ended within SIT_ON_ARRIVAL_DIST of the approach. Another walk (a new click, a re-plan elsewhere)
 * or sitting meanwhile drops it; so does a walk that never started within SIT_ON_ARRIVAL_ARM_MS. A walk so short that it began
 * and ended between two frames (the approach a step away) counts once a tap's double-tap wait is over.
 */
export function stepSeatOnArrival(soa: SeatIntent | null, input: SeatArrivalInput): SeatArrivalStep {
  if (!soa) return { next: null, face: null };
  const { target, pose, now } = input;
  const ours = target !== null && Math.abs(target.x - soa.x) < 1e-3 && Math.abs(target.z - soa.z) < 1e-3;
  if (ours) return { next: soa.armed ? soa : { ...soa, armed: true }, face: null };
  if (target !== null || input.seated) return { next: null, face: null }; // another walk, or already seated
  const near = Math.hypot(pose.x - soa.x, pose.z - soa.z) <= SIT_ON_ARRIVAL_DIST;
  if (soa.armed || (now - soa.at > DOUBLE_TAP_MS + 100 && near)) return { next: null, face: near ? soa.index : null };
  if (now - soa.at > SIT_ON_ARRIVAL_ARM_MS) return { next: null, face: null };
  return { next: soa, face: null };
}

/** How fast (rad/s) the standing avatar turns to face the seat it walked to. */
export const FACE_SEAT_TURN = 7;

/** The yaw (player convention `atan2(dx, dz)`) that faces (sx, sz) from (x, z); null when standing on it. */
export function yawToward(x: number, z: number, sx: number, sz: number): number | null {
  const dx = sx - x;
  const dz = sz - z;
  return Math.hypot(dx, dz) < 1e-3 ? null : Math.atan2(dx, dz);
}
