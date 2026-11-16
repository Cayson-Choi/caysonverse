// The catch, from the strike to the release (lake v2, owner 2026-11-16: "끌어당겨서 올라오는 모습까지 리얼하게"). Pure: what the
// fish does `t` seconds into a phase, from the schema's fields alone (phase, its start, the spot, the cast's seed, the species and
// the length), so every screen draws the same story with no extra message:
//
//  hooked / fighting   under the water near where the float went down, a dark shape running left and right, coming in as the
//                      fight goes on (fighting), swirls and now and then a thrash at the surface
//  lifting (small)     0 .. REEL_S reeled in under the surface toward the rod tip; at REEL_S it breaks the surface (splash and spray)
//                      and hangs from the line by its mouth, swinging and flapping, dripping; then the left hand takes it
//  netting (big)       at the surface in front of the angler thrashing, then the net scoops it (Fish_Net) and it lies in the bag
//  landed              held up between the hands, still flexing (Fish_Stand_Show)
//  releasing           lowered with the release clip, then let go into the water with a splash
//
// The rig (fishingRig.ts) turns a stage into a pose with the avatar's hands, the rod tip and a little pendulum for the swing.

import { LAKE_FACE_DIR, LAKE_FISHING_SPOTS, LAKE_WATER_Y } from "@caysonverse/shared/village/lakeLayout";
import { floatPosition } from "@caysonverse/shared/village/fishing";
import { FISH_PHASE, type FishView } from "./lakeProtocol";
import { hash01 } from "./lakeFloat";

/** Lifting: reeled in under the surface this long, then out of the water. */
export const REEL_S = 1.3;
/** Lifting: hanging from the line until the hand reaches for it. */
export const HANG_END_S = 2.25;
/** Lifting: the hand has it after this blend. */
export const TO_HAND_S = 0.45;
/** Netting: at the surface thrashing, then the net. */
export const NET_SCOOP_S = 0.85;
export const NET_IN_S = 1.45;
/** Releasing: the hands let go here (Fish_Release is 19/24 s), the fish falls into the water. */
export const LET_GO_S = 0.78;
export const DROP_S = 0.42;

export type CatchStage =
  | "none"
  /** under the water: a dark shape (world position from `underPos`) */
  | "under"
  /** breaking out / thrashing at the surface */
  | "surface"
  /** hanging from the line under the rod tip */
  | "line"
  /** from the line into the left hand (blend `k`) */
  | "toHand"
  /** in the left hand */
  | "hand"
  /** in the net's bag */
  | "net"
  /** held up between the hands */
  | "show"
  /** let go: falling into the water (k 0..1) */
  | "drop";

export interface CatchState {
  stage: CatchStage;
  /** 0..1 within a blend stage (toHand, drop, the scoop). */
  k: number;
  /** How hard it wriggles (0..1.2): the tail beat's amplitude. */
  wriggle: number;
  /** Tail beats per second. */
  beat: number;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function catchState(view: FishView, t: number, out: CatchState = { stage: "none", k: 0, wriggle: 0, beat: 0 }): CatchState {
  out.k = 0;
  out.wriggle = 0;
  out.beat = 3;
  switch (view.phase) {
    case FISH_PHASE.hooked:
      out.stage = "under";
      out.wriggle = 1;
      out.beat = 5;
      break;
    case FISH_PHASE.fighting:
      out.stage = thrashAt(view.seq, t) ? "surface" : "under";
      out.wriggle = 1;
      out.beat = 4.5;
      break;
    case FISH_PHASE.lifting:
      if (t < REEL_S) {
        out.stage = "under";
        out.wriggle = 0.9;
        out.beat = 4;
      } else if (t < REEL_S + 0.16) {
        out.stage = "surface";
        out.wriggle = 1.2;
        out.beat = 6;
      } else if (t < HANG_END_S) {
        out.stage = "line";
        out.wriggle = 1.1;
        out.beat = 5.5;
      } else if (t < HANG_END_S + TO_HAND_S) {
        out.stage = "toHand";
        out.k = smooth((t - HANG_END_S) / TO_HAND_S);
        out.wriggle = 0.9;
        out.beat = 5;
      } else {
        out.stage = "hand";
        out.wriggle = 0.6;
        out.beat = 4;
      }
      break;
    case FISH_PHASE.netting:
      if (t < NET_SCOOP_S) {
        out.stage = "surface";
        out.wriggle = 1.2;
        out.beat = 5.5;
      } else {
        out.stage = "net";
        out.k = smooth((t - NET_SCOOP_S) / (NET_IN_S - NET_SCOOP_S));
        out.wriggle = 0.8;
        out.beat = 4.5;
      }
      break;
    case FISH_PHASE.landed:
      out.stage = "show";
      // still alive: calm flexing with a hard flap now and then
      out.wriggle = 0.35 + 0.65 * flapPulse(t, view.seq);
      out.beat = 3 + 3 * flapPulse(t, view.seq);
      break;
    case FISH_PHASE.releasing:
      if (t < LET_GO_S) {
        out.stage = "show";
        out.wriggle = 0.5;
        out.beat = 3.5;
      } else if (t < LET_GO_S + DROP_S) {
        out.stage = "drop";
        out.k = (t - LET_GO_S) / DROP_S;
        out.wriggle = 1;
        out.beat = 6;
      } else out.stage = "none";
      break;
    default:
      out.stage = "none";
  }
  return out;
}

/** A hard flap in the show pose: 0 most of the time, a 0.5 s pulse every ~1.1 s (seeded per catch). */
export function flapPulse(t: number, seq: number): number {
  const period = 1.0 + 0.4 * hash01(seq, 3, 9);
  const ph = (t + hash01(seq, 4, 2) * period) % period;
  return ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI) : 0;
}

/** During the fight a big fish rolls at the surface now and then: 0.6 s thrashes at seeded times. */
export function thrashAt(seq: number, t: number): boolean {
  if (t < 0.6) return true; // the hook set: it comes up once at once
  const period = 2.4 + 1.2 * hash01(seq, 7, 1);
  const ph = (t + hash01(seq, 8, 3) * period) % period;
  return ph < 0.6;
}

export interface Pt3 {
  x: number;
  y: number;
  z: number;
}

/** The spot's facing (unit x / z toward the water). */
export function faceOf(spot: number): { x: number; z: number } | null {
  const s = LAKE_FISHING_SPOTS[spot];
  return s ? LAKE_FACE_DIR[s.face] : null;
}

/**
 * Where the fish is under (or at) the water, and which way it heads (yaw, atan2(dx, dz) of its nose), for the under / surface
 * stages. Starts where the float went down (the cast's seeded landing point) and comes in toward the rod tip (lifting) or the net
 * (netting), running left and right across the line as it fights.
 */
export function underPos(view: FishView, t: number, out: Pt3 & { yaw: number }): boolean {
  const spot = LAKE_FISHING_SPOTS[view.spot];
  if (!spot) return false;
  const f = LAKE_FACE_DIR[spot.face];
  const start = floatPosition(view.spot, view.seq);
  // the far point (where it bit) and the near points: under the rod tip (3.2 m out) or in front of the net (1.9 m)
  const tipX = spot.anchor.x + f.x * 3.2;
  const tipZ = spot.anchor.z + f.z * 3.2;
  let k = 0;
  let depth = 0.32;
  let swing = 0.9;
  switch (view.phase) {
    case FISH_PHASE.hooked:
      k = 0.04 * t;
      break;
    case FISH_PHASE.fighting:
      // comes in slowly as the angler holds (the hold is not on the wire: the time is), never closer than 2.6 m
      k = 0.72 * (1 - Math.exp(-t / 9));
      swing = 1.3;
      depth = 0.38;
      break;
    case FISH_PHASE.lifting:
      k = smooth(Math.min(1, t / REEL_S));
      swing = 0.7 * (1 - k) + 0.12;
      depth = 0.3 * (1 - k) + 0.06;
      break;
    case FISH_PHASE.netting: {
      // in front of the angler, at the surface, where the net reaches
      const nx = spot.anchor.x + f.x * 1.9;
      const nz = spot.anchor.z + f.z * 1.9;
      const wob = Math.sin(t * 7.1) * 0.18;
      out.x = nx - f.z * wob;
      out.z = nz + f.x * wob;
      out.y = LAKE_WATER_Y - 0.04;
      out.yaw = Math.atan2(-f.z, f.x) + Math.sin(t * 5.3) * 0.7;
      return true;
    }
    default:
      return false;
  }
  const bx = start.x + (tipX - start.x) * k;
  const bz = start.z + (tipZ - start.z) * k;
  // across the line: the run left and right
  const ax = -f.z;
  const az = f.x;
  const run = Math.sin(t * 1.35 + view.seq) * swing + Math.sin(t * 3.1 + view.seq * 0.7) * swing * 0.25;
  out.x = bx + ax * run;
  out.z = bz + az * run;
  out.y = LAKE_WATER_Y - depth - Math.sin(t * 2.2) * 0.05;
  // heading: along the run (its derivative) with the pull of the line (toward the angler) mixed in
  const dRun = Math.cos(t * 1.35 + view.seq) * 1.35 * swing;
  const vx = ax * dRun - f.x * 0.6;
  const vz = az * dRun - f.z * 0.6;
  out.yaw = Math.atan2(vx, vz);
  return true;
}

/** Where a released fish goes into the water: a metre and a half out in front of the chair. */
export function releasePoint(spot: number, out: Pt3): boolean {
  const s = LAKE_FISHING_SPOTS[spot];
  if (!s) return false;
  const f = LAKE_FACE_DIR[s.face];
  out.x = s.anchor.x + f.x * 1.5;
  out.y = LAKE_WATER_Y;
  out.z = s.anchor.z + f.z * 1.5;
  return true;
}

/** The rod phases where the line ends at the fish's mouth (not at the float). */
export function lineOnFish(phase: number): boolean {
  return phase === FISH_PHASE.hooked || phase === FISH_PHASE.fighting || phase === FISH_PHASE.lifting || phase === FISH_PHASE.netting;
}
