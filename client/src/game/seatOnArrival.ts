/**
 * Sit on a clicked seat on arrival (round 8 review: a first-time visitor taps the sofa to sit; round 9 review: this state
 * machine, which lived inline in CameraRig's frame loop, had no test). A click on a seat (furnitureClick.ts) walks to its
 * approach and leaves an "intent" here; each frame `stepSeatOnArrival` decides, from the walk's target and the avatar's pose,
 * whether to keep waiting, sit (send the sit for that very seat) or forget it. Pure: CameraRig feeds it and sends the sit.
 */
import { DOUBLE_TAP_MS } from "./tapGesture";

/** How near (m) the walk must end to a clicked seat's approach for the avatar to sit on arrival. */
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
  /** A menu or a panel has the input. */
  uiCaptured: boolean;
  /** Whether seat `index` is free and sat on from where the avatar stands (approachesSeat + SEAT_REACH; the server's rule). */
  canSit: (index: number) => boolean;
}

/** What one frame makes of the intent: kept (maybe now armed), or dropped — and the seat to sit on, if it is time. */
export interface SeatArrivalStep {
  next: SeatIntent | null;
  sit: number | null;
}

/**
 * One frame of the intent. The walk whose target is the intent's approach arms it; once that walk is over (no target) the avatar
 * sits when it ended within SIT_ON_ARRIVAL_DIST of the approach and the seat can be sat on from there. Another walk (a new click,
 * a re-plan elsewhere) or sitting meanwhile drops it; so does a walk that never started within SIT_ON_ARRIVAL_ARM_MS. A walk so
 * short that it began and ended between two frames (the approach a step away) counts once a tap's double-tap wait is over.
 */
export function stepSeatOnArrival(soa: SeatIntent | null, input: SeatArrivalInput): SeatArrivalStep {
  if (!soa) return { next: null, sit: null };
  const { target, pose, now } = input;
  const ours = target !== null && Math.abs(target.x - soa.x) < 1e-3 && Math.abs(target.z - soa.z) < 1e-3;
  if (ours) return { next: soa.armed ? soa : { ...soa, armed: true }, sit: null };
  if (target !== null || input.seated) return { next: null, sit: null }; // another walk, or already seated
  const near = Math.hypot(pose.x - soa.x, pose.z - soa.z) <= SIT_ON_ARRIVAL_DIST;
  if (soa.armed || (now - soa.at > DOUBLE_TAP_MS + 100 && near)) {
    const sit = near && !input.uiCaptured && input.canSit(soa.index) ? soa.index : null;
    return { next: null, sit };
  }
  if (now - soa.at > SIT_ON_ARRIVAL_ARM_MS) return { next: null, sit: null };
  return { next: soa, sit: null };
}
