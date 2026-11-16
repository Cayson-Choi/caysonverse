// The float (찌) of one angler as a function of the schema's fields and the room clock — pure, no three.js. Every screen
// computes the same picture from (spot, fishSeq, fishSig, fishAt, fishPhase) (design 9.4: no coordinates are sent).
//
// The scatter of the landing point and the times of the 예신 tugs come from the same seed, `fishSeq` + the spot. D2's server
// does not need them (it only picks the phase lengths); if D2 exports a shared seed function F can swap it in `scatter`.

import { LAKE_FISHING_SPOTS, LAKE_WATER_Y, type LakeFishingSpot } from "@caysonverse/shared/village/lakeLayout";
import { FISH_PHASE, FISH_SIG, type FishView } from "./lakeProtocol";

/** The float's top above the water when it stands (design 4.4: 1.6 x the real 5-10 cm, about 25 cm). */
export const FLOAT_TOP_M = 0.25;
/** How far the scatter reaches (m, design 2.3). */
export const SCATTER_M = 0.6;

/** A small integer hash to 0..1 (mulberry-style). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return ((h >>> 0) % 1000003) / 1000003;
}

export interface Pt {
  x: number;
  z: number;
}

/** Where this cast's float lands: the spot's mark scattered +-SCATTER_M by the cast's seed. */
export function scatter(spot: LakeFishingSpot, seq: number, out: Pt = { x: 0, z: 0 }): Pt {
  const idx = LAKE_FISHING_SPOTS.indexOf(spot);
  const a = hash01(idx + 1, seq, 11) * Math.PI * 2;
  const r = Math.sqrt(hash01(idx + 1, seq, 23)) * SCATTER_M;
  out.x = spot.float.x + Math.cos(a) * r;
  out.z = spot.float.z + Math.sin(a) * r;
  return out;
}

export function spotByIndex(i: number): LakeFishingSpot | null {
  return LAKE_FISHING_SPOTS[i] ?? null;
}

/** What one frame draws of one float. */
export interface FloatPose {
  /** Anything to draw (a float in the air or the water). */
  visible: boolean;
  x: number;
  z: number;
  /** The float's TOP above the water surface (m); below 0 = under the water (a diving float is hidden by the water). */
  top: number;
  /** World y of the float's centre-ish (water + top - half the visible part). */
  y: number;
  /** 0..1 how far it is down (for the line's slack and the glow). */
  dive: number;
  /** Flying from the rod tip to the water (the cast). */
  flying: boolean;
  /** 0..1 along the flight. */
  flight: number;
  /** The float lies on its side (just landed) -> 0, stands -> 1. */
  stand: number;
  /** The line is taut toward a fish (hooked, fighting). */
  taut: boolean;
}

export const CAST_S = 0.8;
export const SETTLE_S = 2.0;
/** The rise (찌올림): 2 segments up over 2.0 s, the top held 0.6 s (design 8). */
export const RISE_S = 2.0;
/** A tug (깔짝): every TUG_EVERY s one dips for TUG_S. */
export const TUG_EVERY = 0.62;
export const TUG_S = 0.28;
export const TUG_DEPTH = 0.06;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The 예신 tug at time `t` seconds into the nibble phase: a dip of the float's top (m, positive = down). The number of tugs is
 * not known to the client (the server decides how long the phase lasts), so they keep coming in the seed's rhythm.
 */
export function tugDip(t: number, seq: number): number {
  if (t < 0.15) return 0;
  const k = Math.floor((t - 0.15) / TUG_EVERY);
  const into = t - 0.15 - k * TUG_EVERY;
  if (into > TUG_S) return 0;
  const depth = TUG_DEPTH * (0.7 + 0.6 * hash01(seq, k, 5));
  return depth * Math.sin((into / TUG_S) * Math.PI);
}

/** Index of the tug in progress (-1 none): the water draws a small ring at its start. */
export function tugIndex(t: number): number {
  if (t < 0.15) return -1;
  const k = Math.floor((t - 0.15) / TUG_EVERY);
  return t - 0.15 - k * TUG_EVERY <= TUG_S ? k : -1;
}

/** The bite's motion `t` seconds after it began: the float's top (m above water) and the slide (m along the cast's direction). */
export function biteMotion(sig: number, t: number): { top: number; slide: number } {
  if (sig === FISH_SIG.rise) {
    // two segments up (each 0.11 m), then held
    return { top: FLOAT_TOP_M + 0.22 * smooth(t / RISE_S), slide: 0 };
  }
  if (sig === FISH_SIG.drag) {
    // slides 0.45 m sideways while sinking, over 0.8 s
    const k = smooth(t / 0.8);
    return { top: FLOAT_TOP_M * (1 - k) - 0.3 * k, slide: 0.45 * k };
  }
  // sink: straight down in 0.35 s
  const k = smooth(t / 0.35);
  return { top: FLOAT_TOP_M * (1 - k) - 0.3 * k, slide: 0 };
}

const NONE: FloatPose = { visible: false, x: 0, z: 0, top: 0, y: 0, dive: 0, flying: false, flight: 0, stand: 0, taut: false };

/**
 * The float for `view`, `elapsedMs` after its phase began (lakeNet.ts elapsedSince), written into `out`. `target` is the landing point (scatter of the cast),
 * `side` the unit vector the drag bite slides along (across the line of the cast).
 */
export function floatPose(view: FishView, target: Pt, side: Pt, elapsedMs: number, out: FloatPose): FloatPose {
  out.visible = false;
  out.flying = false;
  out.flight = 0;
  out.taut = false;
  out.dive = 0;
  out.stand = 1;
  out.top = FLOAT_TOP_M;
  out.x = target.x;
  out.z = target.z;
  const t = Math.max(0, elapsedMs / 1000);
  const p = view.phase;
  if (view.spot < 0 || view.rod === 0) return Object.assign(out, NONE);
  switch (p) {
    case FISH_PHASE.casting: {
      out.visible = true;
      out.flying = true;
      out.flight = Math.min(1, t / CAST_S);
      out.stand = 0;
      out.top = 0;
      break;
    }
    case FISH_PHASE.settling: {
      out.visible = true;
      out.stand = smooth(t / SETTLE_S);
      out.top = FLOAT_TOP_M * out.stand;
      break;
    }
    case FISH_PHASE.waiting:
    case FISH_PHASE.missed:
    case FISH_PHASE.ready: {
      // `ready` after a throw is not drawn (no cast yet); `missed` shows the float coming back up
      if (p === FISH_PHASE.ready) return Object.assign(out, NONE);
      out.visible = true;
      out.top = FLOAT_TOP_M + 0.006 * Math.sin(t * 1.7 + view.seq);
      break;
    }
    case FISH_PHASE.nibble: {
      out.visible = true;
      const dip = tugDip(t, view.seq);
      out.top = FLOAT_TOP_M - dip;
      out.dive = Math.min(1, dip / 0.1);
      break;
    }
    case FISH_PHASE.bite: {
      out.visible = true;
      const m = biteMotion(view.sig, t);
      out.top = m.top;
      out.x += side.x * m.slide;
      out.z += side.z * m.slide;
      out.dive = out.top < 0 ? 1 : 0;
      break;
    }
    case FISH_PHASE.hooked:
    case FISH_PHASE.fighting: {
      // the float is under the water; the line runs toward a fish thrashing near it
      out.visible = true;
      out.taut = true;
      const m = biteMotion(view.sig === FISH_SIG.rise ? FISH_SIG.sink : view.sig, 5);
      out.top = -0.3;
      out.x += side.x * m.slide + Math.sin(t * 3.1) * 0.35 * (p === FISH_PHASE.fighting ? 1 : 0.3);
      out.z += side.z * m.slide + Math.cos(t * 2.3) * 0.35 * (p === FISH_PHASE.fighting ? 1 : 0.3);
      out.dive = 1;
      break;
    }
    default:
      return Object.assign(out, NONE);
  }
  out.y = LAKE_WATER_Y + out.top - 0.14;
  return out;
}

/** Is the angler's float in the water at all (the water draws its rings for it). */
export function floatInWater(phase: number): boolean {
  return phase >= FISH_PHASE.settling && phase <= FISH_PHASE.fighting || phase === FISH_PHASE.missed;
}
