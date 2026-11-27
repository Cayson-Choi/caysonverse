// The catch, from the strike to the release (lake v2, owner 2026-11-16: "끌어당겨서 올라오는 모습까지 리얼하게"). Pure: what the
// fish does `t` seconds into a phase, from the schema's fields alone (phase, its start, the spot, the cast's seed, the species and
// the length), so every screen draws the same story with no extra message:
//
//  hooked / fighting   under the water near where the float went down, a dark shape running left and right, coming in as the
//                      fight goes on (fighting), swirls and now and then a thrash at the surface
//  lifting (small)     0 .. REEL_S reeled in under the surface toward the rod tip; at REEL_S it breaks the surface (splash and spray)
//                      and hangs from the line by its mouth, swinging and flapping, dripping; then the left hand takes it
//  (lake v2: no net — a big fish brought in by the fight is lifted out on the line too, from where the fight left it)
//  landed              taken in the arms (품에 안기), held against the chest and shown off, still flapping (Fish_Stand_Show)
//  releasing           lowered with the release clip, then let go into the water with a splash
//
// The rig (fishingRig.ts) turns a stage into a pose with the avatar's hands, the rod tip and a little pendulum for the swing.

import { LAKE_FACE_DIR, LAKE_FISHING_SPOTS, LAKE_WATER_Y } from "@caysonverse/shared/village/lakeLayout";
import { floatPosition } from "@caysonverse/shared/village/fishing";
import { FISH_PHASE, needsNet, type FishView } from "./lakeProtocol";
import { hash01 } from "./lakeFloat";

/** Lifting: reeled in under the surface this long, then out of the water. */
export const REEL_S = 0.9;
/** Lifting: the rod comes up and draws the fish out of the water this long (a steady lift, not a leap: owner 2026-11-22). */
export const BREAK_S = 0.35;
/** Lifting: hanging from the line until the hand reaches for it. */
export const HANG_END_S = 2.55;
/** Lifting: the hand has it after this blend. */
export const TO_HAND_S = 0.4;
/** Netting: at the surface thrashing, then the net. */
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
      // reeled in (the angler holds): dragged along the line at the surface, its back out; let go: it runs and dives a little
      out.stage = thrashAt(view.seq, t, reelHeld(view)) ? "surface" : "under";
      out.wriggle = reelHeld(view) ? 1.15 : 0.9;
      out.beat = reelHeld(view) ? 6 : 4;
      break;
    case FISH_PHASE.lifting:
      // calm (owner 2026-11-22: "너무 정신없이"): a steady swim under the line, then out of the water hanging still with a burst of
      // flapping now and then (a real hooked fish flaps in short bursts with pauses, not without a break)
      if (t < REEL_S) {
        out.stage = "under";
        out.wriggle = 0.7;
        out.beat = 3;
      } else if (t < REEL_S + BREAK_S) {
        out.stage = "surface";
        out.wriggle = 0.9;
        out.beat = 4;
      } else {
        const p = flapPulse(t, view.seq);
        out.stage = t < HANG_END_S ? "line" : t < HANG_END_S + TO_HAND_S ? "toHand" : "hand";
        if (out.stage === "toHand") out.k = smooth((t - HANG_END_S) / TO_HAND_S);
        // (real footage: bursts of ~2-4 flicks a second, then a pause of a second or more)
        out.wriggle = 0.25 + 0.75 * p;
        out.beat = 2.2 + 1.6 * p;
      }
      break;
    case FISH_PHASE.landed:
      out.stage = "show";
      // still alive: calm flexing with a hard flap now and then
      out.wriggle = 0.35 + 0.65 * flapPulse(t, view.seq);
      out.beat = 2.5 + 2 * flapPulse(t, view.seq);
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

/** A burst of flapping (out of the water): 0 most of the time, a 0.45 s pulse every ~1.6-2.4 s (seeded per catch). */
export function flapPulse(t: number, seq: number): number {
  const period = 1.6 + 0.8 * hash01(seq, 3, 9);
  const ph = (t + hash01(seq, 4, 2) * period) % period;
  return ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI) : 0;
}

/** During the fight a big fish rolls at the surface now and then (more often while it is reeled in): thrashes at seeded times. */
export function thrashAt(seq: number, t: number, held = false): boolean {
  if (t < 0.6) return true; // the hook set: it comes up once at once
  const period = (held ? 1.7 : 2.6) + 1.2 * hash01(seq, 7, 1);
  const ph = (t + hash01(seq, 8, 3) * period) % period;
  return ph < (held ? 0.45 : 0.6);
}

/** The fight on the wire (Player.fishReel): is the angler holding (reeling in)? */
export function reelHeld(view: FishView): boolean {
  return (view.reel & 128) !== 0;
}
/** The fight on the wire: how far the fish is brought in, 0..1. */
export function reelProgress(view: FishView): number {
  return Math.min(100, view.reel & 127) / 100;
}

/** Is the fish being dragged in at the surface (its back out, a wake behind it): the small fish's reel-in, a big fish held. */
export function skimming(view: FishView, t: number): boolean {
  return (view.phase === FISH_PHASE.lifting && t < REEL_S) || (view.phase === FISH_PHASE.fighting && reelHeld(view));
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
 * (a big fish after its fight), running left and right across the line as it fights.
 */
export function underPos(view: FishView, t: number, out: Pt3 & { yaw: number }, reelK?: number): boolean {
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
    case FISH_PHASE.fighting: {
      // the fight's own progress (Player.fishReel, smoothed by the rig: `reelK`): from where it bit to 2.6 m off the rod tip
      const held = reelHeld(view);
      k = 0.06 + 0.74 * (reelK ?? reelProgress(view));
      // a bigger fish runs wider; held, it is pulled straighter along the line
      const big = Math.min(1.6, 0.7 + view.cm / 60);
      swing = (held ? 0.45 : 1.5) * big;
      depth = held ? 0.06 : 0.34;
      break;
    }
    case FISH_PHASE.lifting: {
      // a big fish was already brought in by the fight (to 80 % of the way): the reel-in goes on from there
      const k0 = needsNet(view.kind, view.cm) ? 0.8 : 0;
      k = k0 + (1 - k0) * smooth(Math.min(1, t / REEL_S));
      // led in on a short line: a gentle sway, narrowing as it comes in
      swing = (0.3 * (1 - k) + 0.05) * Math.min(1.4, 0.7 + view.cm / 60);
      depth = 0.05;
      break;
    }
    default:
      return false;
  }
  const bx = start.x + (tipX - start.x) * k;
  const bz = start.z + (tipZ - start.z) * k;
  // across the line: the run left and right
  const ax = -f.z;
  const az = f.x;
  // (lifting: the slow sway alone, no quick zig-zag)
  const quick = view.phase === FISH_PHASE.lifting ? 0 : 0.25;
  const run = Math.sin(t * 1.35 + view.seq) * swing + Math.sin(t * 3.1 + view.seq * 0.7) * swing * quick;
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
  return phase === FISH_PHASE.hooked || phase === FISH_PHASE.fighting || phase === FISH_PHASE.lifting;
}
