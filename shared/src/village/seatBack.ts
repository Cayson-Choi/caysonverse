/**
 * Where a sitter's BACK meets the seat's backrest, for the avatar-side clipping fix (owner 2026-11-20: "낚시터에서 의자에 앉으면 의자
 * 뒤로 옷이 좀 삐져나오던데"). The seat positions are designed for the BARE body: its torso's back is SIT_POSE.torsoBehindRoot (0.71 m)
 * behind the root and a backrest's face is placed ~0.72 m behind it — but a tee is 0.73, a hoodie (hood) 0.87, a robe 0.77 m behind the
 * root, so thick clothes, leaned-back torsos and long hair poke out behind the backrest. The seats and the furniture stay as they are;
 * instead the avatar's own back is flattened against the face while it sits (client/src/game/backSquash.ts reads `seatBackFace`).
 */

import type { Seat } from "../worldMap";
import { BACKED_ROOT_AHEAD } from "../sitPose";

/** A seat as the village list has it: `Seat` plus the optional fields the village's own seats carry. */
export type BackedSeatLike = Seat & { kind?: string; lake?: string };

/**
 * How far behind the fishing chair's centre its back panel's face is (m): build_chair.py's back panel face at its lower edge (the
 * uprights lean back from there, so higher up the real chair has MORE room: flattening at this face is the safe side).
 */
export const FISHING_CHAIR_BACK_FACE = 0.208;
/** The distance from a fishing chair's back panel's outer back to its centre (lakeLayout.ts `approachEdge` = ahead of centre + this). */
export const FISHING_CHAIR_OUTER_BACK = 0.26;

/**
 * How far behind the root the face of `seat`'s backrest is (m), or 0 for a seat with none (a backless bench, a stool, a cushion, a
 * seat not on the list). A backed seat that does not state its backrest is flattened at the design distance BACKED_ROOT_AHEAD (0.72):
 * a smaller number only flattens the back a little more, never leaves a gap.
 */
export function seatBackFace(seat: BackedSeatLike | undefined): number {
  if (!seat) return 0;
  if (seat.lake === "fishing_chair" && seat.approachEdge !== undefined) {
    return Math.round((seat.approachEdge - FISHING_CHAIR_OUTER_BACK + FISHING_CHAIR_BACK_FACE) * 1000) / 1000;
  }
  if (seat.kind === "backed") return seat.backrest !== undefined && seat.backrest > 0 ? seat.backrest : BACKED_ROOT_AHEAD;
  if (seat.kind === "floor" && seat.backrest !== undefined && seat.backrest > 0) return seat.backrest;
  return 0;
}

/** The avatar-frame heights (m above the root's floor) between which the back is flattened: full between `riseHi` and `fallLo`. */
export interface BackBand {
  riseLo: number;
  riseHi: number;
  fallLo: number;
  fallHi: number;
}

/**
 * Chair pose (Sit_Chair_*): from just under the seat surface (0.39; below it a skirt panel is inside the seat anyway) up through the shoulders (the neck is at ~1.3); the head and its hair are
 * above the band — a backrest shorter than that never touches them, a taller one is not flattened into the head.
 */
export const CHAIR_BACK_BAND: BackBand = { riseLo: 0.15, riseHi: 0.3, fallLo: 1.3, fallHi: 1.45 };
/**
 * A low backrest (a fishing chair, a bench, a café chair: no lean-back, the back panel ends below the shoulder blades): flattened up to
 * 1.0 m, fading out by 1.2 m, so the hair that hangs to the shoulders (curly, ponytail) keeps its volume — it never reaches the panel.
 */
export const LOW_BACK_BAND: BackBand = { riseLo: 0.15, riseHi: 0.3, fallLo: 1.0, fallHi: 1.2 };
/** Floor pose (Sit_Floor_*): hips at 0.08 m, shoulders at ~0.9 m. */
export const FLOOR_BACK_BAND: BackBand = { riseLo: 0.0, riseHi: 0.1, fallLo: 0.85, fallHi: 1.0 };

export function backBandOf(seat: BackedSeatLike | undefined): BackBand {
  if (seat?.pose === "floor") return FLOOR_BACK_BAND;
  // a sofa, an armchair, a pew, a school chair: a tall, leaned-into back (lean > 0); the rest have a low panel
  return (seat?.lean ?? 0) > 0 ? CHAIR_BACK_BAND : LOW_BACK_BAND;
}

/** Hermite smoothstep (GLSL's). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The z (avatar frame, +z the way it faces) a skinned vertex ends up at: its back is pushed forward by whatever sticks out behind
 * `face`, fully inside the band and fading out above and below it. The GLSL in backSquash.ts is this function.
 */
export function flattenedZ(z: number, y: number, face: number, band: BackBand, mix = 1): number {
  if (!(face > 0)) return z;
  const behind = -z - face;
  if (behind <= 0) return z;
  const w = smoothstep(band.riseLo, band.riseHi, y) * (1 - smoothstep(band.fallLo, band.fallHi, y));
  return z + behind * w * mix;
}
