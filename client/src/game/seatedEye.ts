import { liftForSeatY } from "@caysonverse/shared/sitPose";

/**
 * Where the first-person eye goes while seated (review 2026-11-15: at the café's chairs the eye stayed on the avatar's
 * ROOT — the seat point, 0.46 m ahead of the chair, over the table's edge — at the standing eye height, so the table vanished
 * under the camera and the parasol's pole stood 0.2 m in front of it). Measured from character.glb (Sit_Chair_Idle against
 * Idle, client sitPose.test.ts): the seated head's centre is SEATED_HEAD_BEHIND_ROOT behind the root (the standing head's
 * is right over it) and SEATED_HEAD_RISE higher than the standing one, before the seat's lift (sitPose.ts liftForSeatY).
 */
export const SEATED_HEAD_BEHIND_ROOT = 0.45;
export const SEATED_HEAD_RISE = 0.08;
/** How fast the eye eases between the standing and the seated spot (1/s): about the sit-down clip's length. */
const EASE_RATE = 5;

export interface SeatedEyeOffset {
  dx: number;
  dy: number;
  dz: number;
}

/** The eye's offset from the standing FP eye over the root for a seat facing `yaw` with its surface `seatY` m up, weighted by `w` (0..1). */
export function seatedEyeOffset(yaw: number, seatY: number | undefined, w: number): SeatedEyeOffset {
  const k = Math.max(0, Math.min(1, w));
  return {
    dx: -Math.sin(yaw) * SEATED_HEAD_BEHIND_ROOT * k,
    dy: (SEATED_HEAD_RISE + liftForSeatY(seatY)) * k,
    dz: -Math.cos(yaw) * SEATED_HEAD_BEHIND_ROOT * k,
  };
}

/** One frame's step of the seated weight toward 1 (seated) or 0 (standing). */
export function stepSeatedWeight(w: number, seated: boolean, delta: number): number {
  const target = seated ? 1 : 0;
  return target + (w - target) * Math.exp(-EASE_RATE * Math.max(0, delta));
}
