/**
 * 케이슨 낚시터 (A10, D2): the server-authoritative fishing rules, as pure clock-injected functions.
 * Design: docs/designs/lake-fishing/design.md chapters 7-9 (the flow, the fish table, the server's stages).
 *
 * The browser only sends intent (rent, return, sit, cast, strike, hold, stand); this state machine, fed the server's clock and
 * the server's dice, decides every outcome. Nothing here reads a clock or a global RNG on its own: `now` and `random` come in,
 * so every stage, every boundary time and every probability is unit-testable.
 *
 * Two kinds of randomness (anti-cheat, design 9.2):
 *  - SECRET: how long the fish takes, which fish, how big, how many nibbles. Drawn from the server's `random` at the cast;
 *    the client never sees it before the stage that shows it (the bite signal in `bite`, the fish from `hooked` on).
 *  - PUBLIC and seeded: where the float lands (`floatPosition`) and when the nibbles splash (`nibbleTimesMs`) are pure
 *    functions of (spot, `fishSeq`), so every client draws the same float and the same splashes without a coordinate
 *    being sent (design 9.4). They carry no information about the fish.
 *
 * Stages (design 9.2): none -> carry (rod on the shoulder) -> ready (seated at a spot with a rod) -> casting -> settling ->
 * waiting -> nibble -> bite -> hooked -> (lifting | fighting -> lifting) -> landed -> releasing -> ready (lake v2: no net — a big
 * fish brought in is lifted out on the line and taken in the arms like a small one; `netting` stays in the list, never entered,
 * so the phase ids on the wire do not move); `missed` (a missed
 * bite or a lost fish) -> ready. Strike during nibble is ignored with no penalty ("too_early"); too late is `missed`.
 */

import { FIGHT, fightSchedule, stepFight, type FightEvent } from "./fishFight";

const FIGHT_START_PROGRESS = FIGHT.startProgress;
import { LAKE_FISHING_SPOTS, LAKE_RENTAL_PAD, LAKE_SHORE, distToPolygonEdge } from "./lakeLayout";

/** Timings (ms), distances (m) and rate caps. One place to tune; the design's numbers (chapters 7-9). */
export const FISHING = {
  /** Renting: within the rental pad (radius 2.5) plus a little slack, as the design's 12.3 ("2.6 m outside -> refused"). */
  rentReachM: 2.6,
  /** Returning: within this distance of the pad (the office is beside it). */
  returnReachM: 4,
  /** West of this x the player has left the lake zone: the rod is returned by itself (design 12.3). */
  lakeZoneMinX: 90,
  castMs: 800,
  settleMs: 2000,
  /** The waiting time after the float stands: uniform in [min, max]; at night this much shorter (x 1 - nightFaster). */
  waitMinMs: 4000,
  waitMaxMs: 18000,
  nightFaster: 0.15,
  /** The nibble stage is `nibbleTailMs` after the last splash (0.6 s when there is none); never over 2.5 s. */
  nibbleNoneMs: 600,
  nibbleTailMs: 500,
  hookedMs: 400,
  /** Lake v2 (owner 2026-11-16): the small fish is reeled in under the surface, breaks out and hangs from the line before the hand takes it (client fishCatch.ts). */
  liftMs: 3000,
  landedMs: 2500,
  /** Lake v2: the release clip, then the fish falls back into the water with a splash. */
  releaseMs: 1300,
  missedMs: 1000,
  /** Cast to cast, and sit / stand to sit / stand (design 9.5). */
  castGapMs: 1500,
  sitGapMs: 500,
  /** Any state-changing action can not come faster than this (a repeated invalid action can not spin the machine). */
  actionGapMs: 100,
  /** A strike is honoured this long after the window's end, at most (design 9.2: min(250 ms, RTT / 2)). */
  strikeGraceMs: 250,
  /** One Hold message counts for at most this long (a lost "up" is taken as released after it; the client repeats it every 0.5 s). */
  holdGapMs: 2500,
  /** The big fish's fight is a pull / release rhythm (fishFight.ts); a fight nobody touches for this long, and the whole fight, are capped. */
  fightIdleMs: 8000,
  fightMaxMs: 45000,
  /** Fishing messages per client: 8 per second and 40 per 10 seconds (design 9.5). */
  rateShort: { count: 8, windowMs: 1000 },
  rateLong: { count: 40, windowMs: 10000 },
  /** Float scatter around a spot's centre (m) and the spacing the floats keep (m, LAKE_PARAMS). */
  floatScatterM: 0.6,
  floatSpacingM: 3,
  floatShoreMarginM: 1,
} as const;

// ------------------------------------------------------------------------------------------------ names and ids

/** Every stage, in wire order: `Player.fishPhase` is the index. */
export const FISHING_PHASES = [
  "none",
  "carry",
  "ready",
  "casting",
  "settling",
  "waiting",
  "nibble",
  "bite",
  "hooked",
  "fighting",
  "lifting",
  "netting",
  "landed",
  "releasing",
  "missed",
] as const;
export type FishingPhase = (typeof FISHING_PHASES)[number];

export function fishingPhaseId(phase: FishingPhase): number {
  return FISHING_PHASES.indexOf(phase);
}
export function fishingPhaseFromId(id: number): FishingPhase | null {
  return FISHING_PHASES[id] ?? null;
}

/** The three bite signals (`Player.fishSig`, set only in `bite`): 0 none. */
export const FISH_SIGNALS = ["none", "rise", "sink", "drag"] as const;
export type FishSignal = (typeof FISH_SIGNALS)[number];
export function fishSignalId(s: FishSignal): number {
  return FISH_SIGNALS.indexOf(s);
}

/** `Player.rod`: 0 none, 1 the 2칸 민장대. */
export const ROD_NONE = 0;
export const ROD_MINJANGDAE = 1;

/** The fish species, in `Player.fishKind` order (id = index + 1; 0 = none). The 10 + 장어 of design chapter 8. */
export const FISH_KINDS = [
  "crucian_carp", // 붕어
  "bluegill", // 블루길
  "minnow", // 피라미
  "prussian_carp", // 떡붕어
  "bass", // 배스
  "carp", // 잉어
  "korean_bullhead", // 동자개(빠가사리)
  "catfish", // 메기
  "mirror_carp", // 향어
  "snakehead", // 가물치
  "eel", // 장어
] as const;
export type FishKind = (typeof FISH_KINDS)[number];
export function fishKindId(kind: FishKind): number {
  return FISH_KINDS.indexOf(kind) + 1;
}
export function fishKindFromId(id: number): FishKind | null {
  return id >= 1 ? (FISH_KINDS[id - 1] ?? null) : null;
}

/** A band of sizes (integer cm, inclusive) taken with probability `p` (the bands of a species sum to 1). */
export interface SizeBand {
  fromCm: number;
  toCm: number;
  p: number;
}

export type FishDisposal = "release" | "bin";

export interface FishSpecies {
  kind: FishKind;
  label: string;
  /** Share among the fish at midday and at night (the server normalises each, design 8). */
  dayWeight: number;
  nightWeight: number;
  bands: readonly SizeBand[];
  /** How the float shows the bite. */
  signal: Exclude<FishSignal, "none">;
  /** The size from which the fish needs the hold stage and the net (design 8, "끌어내기"); 0 = always, Infinity = never. */
  netFromCm: number;
  /** 배스·블루길 are invasive: they go into the bin, never back into the water. */
  disposal: FishDisposal;
  /** From this size the whole lake is told ("대물"); null = never. */
  trophyCm: number | null;
}

/**
 * THE fish table (design 8): the one place the odds are changed. The big-species bands were thinned (owner's coordinator, 2026-11-16) so >= 45 cm is ~4.6 % by day / ~7.4 % at night and >= 70 cm ~0.7 % by day, as the design says. Sizes are integer cm: the design's 월척 (30.3 cm) is 31 here.
 * Eel is a night fish (0 % by day, 1.5 % at night).
 */
export const FISH_TABLE: readonly FishSpecies[] = Object.freeze(
  [
    { kind: "crucian_carp", label: "붕어", dayWeight: 30, nightWeight: 26, bands: [{ fromCm: 12, toCm: 24, p: 0.75 }, { fromCm: 24, toCm: 30, p: 0.2 }, { fromCm: 31, toCm: 39, p: 0.045 }, { fromCm: 40, toCm: 42, p: 0.005 }], signal: "rise", netFromCm: 31, disposal: "release", trophyCm: 31 },
    { kind: "bluegill", label: "블루길", dayWeight: 22, nightWeight: 12, bands: [{ fromCm: 8, toCm: 16, p: 0.85 }, { fromCm: 16, toCm: 22, p: 0.15 }], signal: "sink", netFromCm: Infinity, disposal: "bin", trophyCm: null },
    { kind: "minnow", label: "피라미", dayWeight: 12, nightWeight: 6, bands: [{ fromCm: 7, toCm: 13, p: 0.9 }, { fromCm: 13, toCm: 16, p: 0.1 }], signal: "sink", netFromCm: Infinity, disposal: "release", trophyCm: null },
    { kind: "prussian_carp", label: "떡붕어", dayWeight: 8, nightWeight: 8, bands: [{ fromCm: 20, toCm: 30, p: 0.85 }, { fromCm: 30, toCm: 38, p: 0.15 }], signal: "rise", netFromCm: 30, disposal: "release", trophyCm: 35 },
    { kind: "bass", label: "배스", dayWeight: 8, nightWeight: 4, bands: [{ fromCm: 20, toCm: 35, p: 0.8 }, { fromCm: 35, toCm: 45, p: 0.19 }, { fromCm: 45, toCm: 55, p: 0.01 }], signal: "drag", netFromCm: 40, disposal: "bin", trophyCm: 45 },
    { kind: "carp", label: "잉어", dayWeight: 6, nightWeight: 7, bands: [{ fromCm: 35, toCm: 50, p: 0.88 }, { fromCm: 50, toCm: 70, p: 0.04 }, { fromCm: 70, toCm: 85, p: 0.08 }], signal: "drag", netFromCm: 0, disposal: "release", trophyCm: 70 },
    { kind: "korean_bullhead", label: "동자개", dayWeight: 4, nightWeight: 10, bands: [{ fromCm: 12, toCm: 22, p: 0.8 }, { fromCm: 22, toCm: 30, p: 0.2 }], signal: "sink", netFromCm: Infinity, disposal: "release", trophyCm: null },
    { kind: "catfish", label: "메기", dayWeight: 3, nightWeight: 10, bands: [{ fromCm: 25, toCm: 45, p: 0.98 }, { fromCm: 45, toCm: 60, p: 0.02 }], signal: "drag", netFromCm: 40, disposal: "release", trophyCm: 55 },
    { kind: "mirror_carp", label: "향어", dayWeight: 6, nightWeight: 6, bands: [{ fromCm: 30, toCm: 45, p: 0.98 }, { fromCm: 45, toCm: 60, p: 0.02 }], signal: "drag", netFromCm: 0, disposal: "release", trophyCm: 50 },
    { kind: "snakehead", label: "가물치", dayWeight: 1, nightWeight: 1, bands: [{ fromCm: 45, toCm: 60, p: 0.6 }, { fromCm: 60, toCm: 80, p: 0.4 }], signal: "drag", netFromCm: 0, disposal: "release", trophyCm: 70 },
    { kind: "eel", label: "장어", dayWeight: 0, nightWeight: 1.5, bands: [{ fromCm: 40, toCm: 80, p: 1 }], signal: "drag", netFromCm: 0, disposal: "release", trophyCm: 60 },
  ].map((s) => Object.freeze({ ...s, bands: Object.freeze(s.bands) })) as FishSpecies[],
);

export function fishSpecies(kind: FishKind): FishSpecies {
  return FISH_TABLE[FISH_KINDS.indexOf(kind)]!;
}

/** "Big fish" = the ones that need the hold stage and the net. */
export function needsNet(kind: FishKind, cm: number): boolean {
  return cm >= fishSpecies(kind).netFromCm;
}

/** How loudly a catch is announced: nothing, to the people at the lake, to the whole village (design 7.3). */
export type TrophyTier = "none" | "lake" | "village";

export function trophyTier(kind: FishKind, cm: number): TrophyTier {
  if ((kind === "snakehead" || kind === "eel") || (kind === "crucian_carp" && cm >= 40)) return "village";
  const t = fishSpecies(kind).trophyCm;
  return t !== null && cm >= t ? "lake" : "none";
}

// ------------------------------------------------------------------------------------------------ dice

/** The share of each species (sums to 1) for a night weight 0 (midday) .. 1 (full night): the day and night shares blended. */
export function speciesShares(night: number): number[] {
  const n = Number.isFinite(night) ? Math.min(1, Math.max(0, night)) : 0;
  const w = FISH_TABLE.map((s) => s.dayWeight * (1 - n) + s.nightWeight * n);
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}

/** A uniform number in [0, 1) from any RNG output (garbage in -> 0, never throws). */
function unit(random: () => number): number {
  const n = Number(random());
  return Number.isFinite(n) ? Math.min(0.999999999, Math.max(0, n)) : 0;
}

export interface FishRoll {
  kind: FishKind;
  cm: number;
}

/** Draw a fish: the species by the day/night share, then the size band, then an integer size inside it. */
export function rollFish(random: () => number, night = 0, force?: FishKind): FishRoll {
  let species: FishSpecies = FISH_TABLE[0]!;
  if (force) {
    species = fishSpecies(force);
  } else {
    const shares = speciesShares(night);
    let r = unit(random);
    species = FISH_TABLE[FISH_TABLE.length - 1]!;
    for (let i = 0; i < FISH_TABLE.length; i++) {
      r -= shares[i]!;
      if (r < 0) {
        species = FISH_TABLE[i]!;
        break;
      }
    }
  }
  let r = unit(random);
  let band = species.bands[species.bands.length - 1]!;
  for (const b of species.bands) {
    r -= b.p;
    if (r < 0) {
      band = b;
      break;
    }
  }
  const cm = band.fromCm + Math.floor(unit(random) * (band.toCm - band.fromCm + 1));
  return { kind: species.kind, cm: Math.min(band.toCm, cm) };
}

/** mulberry32: a small seeded RNG (uint32 seed -> [0, 1)). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The public seed of one cast: a hash of the spot and the cast number (`Player.fishSeq`). */
export function fishSeed(spot: number, seq: number): number {
  let h = Math.imul((spot + 1) | 0, 0x9e3779b1) ^ Math.imul((seq + 1) | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

let scatterCache: number[] | null = null;

/** Each spot's scatter radius: 0.6 m, or less where the next float or the shore is too near to keep 3 m / 1 m clear. */
function scatterRadii(): number[] {
  if (scatterCache) return scatterCache;
  const floats = LAKE_FISHING_SPOTS.map((s) => s.float);
  scatterCache = floats.map((f, i) => {
    let nearest = Infinity;
    floats.forEach((g, j) => {
      if (j !== i) nearest = Math.min(nearest, Math.hypot(f.x - g.x, f.z - g.z));
    });
    const spacing = (nearest - FISHING.floatSpacingM) / 2;
    const shore = distToPolygonEdge(f.x, f.z, LAKE_SHORE) - FISHING.floatShoreMarginM;
    return Math.max(0, Math.min(FISHING.floatScatterM, spacing, shore));
  });
  return scatterCache;
}

/** Where the float of cast `seq` at spot index `spot` lands: the spot's float point scattered inside its radius by the public seed. */
export function floatPosition(spot: number, seq: number): { x: number; z: number } {
  const s = LAKE_FISHING_SPOTS[spot];
  if (!s) return { x: 0, z: 0 };
  const rnd = seededRandom(fishSeed(spot, seq));
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(rnd()) * scatterRadii()[spot]!;
  return { x: Math.round((s.float.x + Math.cos(a) * r) * 1000) / 1000, z: Math.round((s.float.z + Math.sin(a) * r) * 1000) / 1000 };
}

/**
 * When the three possible nibble splashes of cast `seq` happen, ms after the nibble stage begins (public, seeded). A fish
 * uses the first 0..3 of them (a rise 1-2, a sink 1-3, a drag 0-1); the stage ends `nibbleTailMs` after the last one used, and
 * the client draws a splash only while the stage lasts, so the schedule leaks nothing about the fish.
 */
export function nibbleTimesMs(spot: number, seq: number): [number, number, number] {
  const rnd = seededRandom(fishSeed(spot, seq) ^ 0x51ed270b);
  const t1 = 650 + Math.floor(rnd() * 250);
  const t2 = t1 + 350 + Math.floor(rnd() * 200);
  const t3 = t2 + 350 + Math.floor(rnd() * 200);
  return [t1, t2, t3];
}

/** How many nibbles a signal shows (rise 1-2, sink 1-3, drag 0-1). */
function nibbleCount(signal: Exclude<FishSignal, "none">, random: () => number): number {
  const r = unit(random);
  if (signal === "rise") return 1 + Math.floor(r * 2);
  if (signal === "sink") return 1 + Math.floor(r * 3);
  return Math.floor(r * 2);
}

/** The bite window (ms after the bite stage begins): [opens, closes] by signal (design 8). */
export function biteWindowMs(signal: Exclude<FishSignal, "none">): [number, number] {
  if (signal === "rise") return [400, 2600]; // rises 2.0 s, top 0.6 s; open 0.4 s after the rise starts, ~2.2 s
  if (signal === "sink") return [0, 1200];
  return [0, 2000];
}

// ------------------------------------------------------------------------------------------------ state

export interface FishCatch {
  kind: FishKind;
  label: string;
  cm: number;
  /** Big fish: hold, then the net. */
  needsNet: boolean;
  disposal: FishDisposal;
  tier: TrophyTier;
}

/** The secret plan drawn at a cast: all the boundaries of waiting -> nibble -> bite, the fish. Never sent to the browser. */
export interface FishingPlan {
  nibbleAt: number;
  biteAt: number;
  windowOpensAt: number;
  windowClosesAt: number;
  signal: Exclude<FishSignal, "none">;
  fish: FishCatch;
}

/** The ways a fight is lost. */
export type FightLoss = "none" | "snap" | "escape" | "idle";

export type FishingResultKind = "none" | "cast" | "missed" | "lost" | "caught";

export interface FishingState {
  phase: FishingPhase;
  /** When the current stage began (the server's clock, ms). */
  phaseAt: number;
  rod: boolean;
  /** Index into LAKE_FISHING_SPOTS of the chair sat on, -1 none. */
  spot: number;
  /** Cast number (1..65535, wraps to 1); 0 before the first cast. Public (`Player.fishSeq`). */
  seq: number;
  plan: FishingPlan | null;
  /** The fish: known from `hooked` on. */
  catch: FishCatch | null;
  /** Fight (fishFight.ts): how close the fish is (0..1, landed at 1), the line's tension (0..1, snaps at 1), the button state, when it was
   *  last integrated, and the grace of the last Hold message. */
  fightProgress: number;
  fightTension: number;
  holdDown: boolean;
  holdDownUntil: number;
  holdIntegratedAt: number;
  lastActiveAt: number;
  fightStartAt: number;
  lastCastAt: number;
  lastSitAt: number;
  lastActionAt: number;
  lastResult: FishingResultKind;
  /** Why the fish was lost: its line snapped, it escaped (never pulled), or nobody did anything. */
  lostWhy: FightLoss;
  /** The grace after a bite window: min(250 ms, RTT / 2); the room may lower it per client. */
  graceMs: number;
}

export type FishingReject =
  | "not_near_rental"
  | "already_has_rod"
  | "no_rod"
  | "not_near_return"
  | "stand_first"
  | "too_soon"
  | "not_seated"
  | "bad_spot"
  | "spot_taken"
  | "too_far"
  | "already_cast"
  | "too_early"
  | "no_bite"
  | "bite_expired"
  | "not_fighting"
  | "wrong_phase"
  | "invalid_time";

/** What a transition did, for the owner's UI and the room's bookkeeping. */
export type FishingAction = "rod_rented" | "rod_returned" | "sat" | "stood" | "cast" | "struck" | "hold" | "auto_returned";

export interface FishingActionResult {
  ok: boolean;
  state: FishingState;
  reject?: FishingReject;
  action?: FishingAction;
  /** Stages entered by this call, in order (a late tick can pass several). */
  entered: FishingPhase[];
}

export function createFishingState(): FishingState {
  return {
    phase: "none",
    phaseAt: 0,
    rod: false,
    spot: -1,
    seq: 0,
    plan: null,
    catch: null,
    fightProgress: 0,
    fightTension: 0,
    holdDown: false,
    holdDownUntil: 0,
    holdIntegratedAt: 0,
    lastActiveAt: 0,
    fightStartAt: 0,
    lastCastAt: Number.NEGATIVE_INFINITY,
    lastSitAt: Number.NEGATIVE_INFINITY,
    lastActionAt: Number.NEGATIVE_INFINITY,
    lastResult: "none",
    lostWhy: "none",
    graceMs: FISHING.strikeGraceMs,
  };
}

const finite = (now: number) => Number.isFinite(now) && now >= 0;
const fail = (state: FishingState, reject: FishingReject): FishingActionResult => ({ ok: false, state, reject, entered: [] });

function enter(s: FishingState, phase: FishingPhase, at: number, entered: FishingPhase[]): void {
  s.phase = phase;
  s.phaseAt = at;
  entered.push(phase);
}

/** The state after the standing-up / returning resets: no plan, no fish, no fight. */
function clearCast(s: FishingState): void {
  s.plan = null;
  s.catch = null;
  s.fightProgress = 0;
  s.fightTension = 0;
  s.holdDown = false;
  s.holdDownUntil = 0;
}

/** Whether the stage is one of the fishing ones (a rod in hand, seated). */
export function isFishingPhase(phase: FishingPhase): boolean {
  return fishingPhaseId(phase) >= fishingPhaseId("ready");
}

/** Whether a stage has the line in the water (a stand-up here pulls it out). */
export function lineIsOut(phase: FishingPhase): boolean {
  return fishingPhaseId(phase) >= fishingPhaseId("casting");
}

// ------------------------------------------------------------------------------------------------ rent, return

/** Rent the one rod: standing within `FISHING.rentReachM` of the pad. Free and unlimited, one per player. */
export function rentRod(state: FishingState, now: number, ctx: { nearRental: boolean; seated: boolean }): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  if (ctx.seated) return fail(state, "stand_first");
  if (!ctx.nearRental) return fail(state, "not_near_rental");
  if (state.rod) return fail(state, "already_has_rod");
  if (now - state.lastActionAt < FISHING.actionGapMs) return fail(state, "too_soon");
  const next: FishingState = { ...state, rod: true, phase: "carry", phaseAt: now, spot: -1, lastActionAt: now, lastResult: "none" };
  clearCast(next);
  return { ok: true, state: next, action: "rod_rented", entered: ["carry"] };
}

/** Give the rod back at the office (standing, within `returnReachM`) or, with `auto`, because the player left the lake. */
export function returnRod(state: FishingState, now: number, ctx: { nearReturn: boolean; seated: boolean; auto?: boolean }): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  if (!state.rod) return fail(state, "no_rod");
  if (!ctx.auto) {
    if (ctx.seated) return fail(state, "stand_first");
    if (!ctx.nearReturn) return fail(state, "not_near_return");
  }
  const next: FishingState = { ...state, rod: false, phase: "none", phaseAt: now, spot: -1, lastActionAt: now };
  clearCast(next);
  return { ok: true, state: next, action: ctx.auto ? "auto_returned" : "rod_returned", entered: ["none"] };
}

// ------------------------------------------------------------------------------------------------ sit, stand

/**
 * The player is seated on a fishing chair (`spot` = its index in LAKE_FISHING_SPOTS; -1 for any other seat). With a rod a
 * fishing chair makes it `ready`; without one the player just sits (the HUD offers to go and borrow a rod).
 */
export function sitDown(state: FishingState, now: number, spot: number): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  const next: FishingState = { ...state, spot, lastSitAt: now, lastActionAt: now };
  clearCast(next);
  const entered: FishingPhase[] = [];
  if (state.rod && spot >= 0) enter(next, "ready", now, entered);
  else if (state.rod) enter(next, "carry", now, entered);
  return { ok: true, state: next, action: "sat", entered };
}

/** The player stood up (from anything): the line comes out, a rod in hand goes back on the shoulder. */
export function standUp(state: FishingState, now: number): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  const next: FishingState = { ...state, spot: -1, lastSitAt: now, lastActionAt: now };
  clearCast(next);
  const entered: FishingPhase[] = [];
  const target: FishingPhase = state.rod ? "carry" : "none";
  if (state.phase !== target) enter(next, target, now, entered);
  return { ok: true, state: next, action: "stood", entered };
}

// ------------------------------------------------------------------------------------------------ cast

/**
 * Cast (from `ready`): a minimum of `castGapMs` since the last one. Draws the secret plan (the wait, the fish, the nibbles)
 * from `random`; `night` is 0..1 (the sun clock) and `force` a dev-only species.
 */
export function castLine(
  state: FishingState,
  now: number,
  opts: { seated: boolean; random: () => number; night?: number; force?: FishKind },
): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  if (!state.rod) return fail(state, "no_rod");
  if (!opts.seated || state.spot < 0) return fail(state, "not_seated");
  if (state.phase !== "ready") return fail(state, lineIsOut(state.phase) ? "already_cast" : "wrong_phase");
  if (now - state.lastCastAt < FISHING.castGapMs || now - state.lastActionAt < FISHING.actionGapMs) return fail(state, "too_soon");

  const night = Number.isFinite(opts.night) ? Math.min(1, Math.max(0, opts.night!)) : 0;
  const roll = rollFish(opts.random, night, opts.force);
  const species = fishSpecies(roll.kind);
  const waitMs = (FISHING.waitMinMs + unit(opts.random) * (FISHING.waitMaxMs - FISHING.waitMinMs)) * (1 - FISHING.nightFaster * night);
  const count = nibbleCount(species.signal, opts.random);
  const seq = state.seq >= 65535 ? 1 : state.seq + 1;
  const times = nibbleTimesMs(state.spot, seq);
  const nibbleMs = count === 0 ? FISHING.nibbleNoneMs : times[count - 1]! + FISHING.nibbleTailMs;
  const [opens, closes] = biteWindowMs(species.signal);
  const nibbleAt = now + FISHING.castMs + FISHING.settleMs + Math.round(waitMs);
  const biteAt = nibbleAt + nibbleMs;
  const net = needsNet(roll.kind, roll.cm);
  const next: FishingState = {
    ...state,
    seq,
    lastCastAt: now,
    lastActionAt: now,
    lastResult: "cast",
    lostWhy: "none",
    plan: {
      nibbleAt,
      biteAt,
      windowOpensAt: biteAt + opens,
      windowClosesAt: biteAt + closes,
      signal: species.signal,
      fish: { kind: roll.kind, label: species.label, cm: roll.cm, needsNet: net, disposal: species.disposal, tier: trophyTier(roll.kind, roll.cm) },
    },
    catch: null,
    fightProgress: 0,
    fightTension: 0,
    holdDown: false,
    holdDownUntil: 0,
  };
  const entered: FishingPhase[] = [];
  enter(next, "casting", now, entered);
  return { ok: true, state: next, action: "cast", entered };
}

// ------------------------------------------------------------------------------------------------ strike, hold

/**
 * Strike (the pull): only a bite honours it. During the nibble (and the first 0.4 s of a rise) it is ignored without penalty
 * ("too_early"); after the window it is too late (`missed`), except for the grace of `state.graceMs` (min(250 ms, RTT / 2)).
 */
export function strikeLine(state: FishingState, now: number): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  const ticked = tickFishing(state, now);
  const s = ticked.state;
  const withEntered = (r: FishingActionResult): FishingActionResult => ({ ...r, entered: [...ticked.entered, ...r.entered] });
  if (!s.rod || s.spot < 0) return withEntered(fail(s, "no_rod"));
  switch (s.phase) {
    case "casting":
    case "settling":
    case "waiting":
      return withEntered(fail(s, "no_bite"));
    case "nibble":
      return withEntered(fail(s, "too_early"));
    case "bite": {
      const plan = s.plan!;
      if (now < plan.windowOpensAt) return withEntered(fail(s, "too_early"));
      const next: FishingState = { ...s, lastActionAt: now, catch: { ...plan.fish }, fightProgress: 0, fightTension: 0 };
      const entered: FishingPhase[] = [];
      enter(next, "hooked", now, entered);
      return { ok: true, state: next, action: "struck", entered: [...ticked.entered, ...entered] };
    }
    case "missed":
      return withEntered(fail(s, "bite_expired"));
    default:
      return withEntered(fail(s, "wrong_phase"));
  }
}

/** The seed of this cast's fight schedule (public: the client shows the same command): the spot and the cast number. */
export function fightSeedOf(s: Pick<FishingState, "spot" | "seq">): number {
  return fishSeed(s.spot, s.seq);
}

/**
 * Bring the fight (fishFight.ts) up to `now` with the button state the server holds: returns the first event inside (the fish landed, the
 * line snapped, the fish escaped) and when it happened, or null. The button counts as held only until `holdDownUntil` (a lost "up" lapses).
 */
function integrateFight(s: FishingState, now: number): { event: FightEvent | null; at: number } {
  const from = s.holdIntegratedAt;
  if (!s.catch || now <= from) return { event: null, at: now };
  const sched = fightSchedule(s.catch.cm, fightSeedOf(s));
  const t0 = from - s.fightStartAt;
  const t1 = now - s.fightStartAt;
  const press = s.holdDown ? { from: -1e9, to: s.holdDownUntil - s.fightStartAt } : null;
  const r = stepFight(sched, { progress: s.fightProgress, tension: s.fightTension }, t0, t1, press);
  s.fightProgress = r.run.progress;
  s.fightTension = r.run.tension;
  const upTo = r.event ? s.fightStartAt + r.atMs : now;
  if (s.holdDown) s.lastActiveAt = Math.max(s.lastActiveAt, Math.min(upTo, s.holdDownUntil));
  s.holdIntegratedAt = upTo;
  return { event: r.event, at: upTo };
}

/** The fight ends: landed (lifting), or lost (the line snapped / the fish escaped / nobody pulled). */
function endFight(f: FishingState, event: FightEvent | "idle", at: number, entered: FishingPhase[]): void {
  if (event === "landed") {
    enter(f, "lifting", at, entered);
    return;
  }
  f.lastResult = "lost";
  f.lostWhy = event === "snap" ? "snap" : event === "escape" ? "escape" : "idle";
  clearCast(f);
  enter(f, "missed", at, entered);
}

/** One Hold message of the fight: `down` true presses (counted for up to `holdGapMs`, then it must be repeated), false releases. */
export function holdLine(state: FishingState, now: number, down: boolean): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  const ticked = tickFishing(state, now);
  const s = ticked.state;
  if (s.phase !== "fighting") return { ...fail(s, "not_fighting"), entered: ticked.entered };
  const next: FishingState = { ...s };
  const ev = integrateFight(next, now);
  const entered = [...ticked.entered];
  if (ev.event) {
    endFight(next, ev.event, ev.at, entered);
    next.lastActionAt = now;
    return { ok: true, state: next, action: "hold", entered };
  }
  next.holdDown = down === true;
  next.holdDownUntil = down === true ? now + FISHING.holdGapMs : 0;
  if (down === true) next.lastActiveAt = Math.max(next.lastActiveAt, now);
  next.lastActionAt = now;
  return { ok: true, state: next, action: "hold", entered };
}

// ------------------------------------------------------------------------------------------------ the clock

/** When the current stage ends on its own (null = it waits for the player). */
export function phaseEndsAt(s: FishingState): number | null {
  const p = s.plan;
  switch (s.phase) {
    case "casting":
      return s.phaseAt + FISHING.castMs;
    case "settling":
      return s.phaseAt + FISHING.settleMs;
    case "waiting":
      return p ? p.nibbleAt : null;
    case "nibble":
      return p ? p.biteAt : null;
    case "bite":
      return p ? p.windowClosesAt + s.graceMs : null;
    case "hooked":
      return s.phaseAt + FISHING.hookedMs;
    case "lifting":
      return s.phaseAt + FISHING.liftMs;
    case "netting": // never entered since lake v2 (no net); a stale state ends like a lift
      return s.phaseAt + FISHING.liftMs;
    case "landed":
      return s.phaseAt + FISHING.landedMs;
    case "releasing":
      return s.phaseAt + FISHING.releaseMs;
    case "missed":
      return s.phaseAt + FISHING.missedMs;
    case "fighting":
      return s.fightStartAt + FISHING.fightMaxMs;
    default:
      return null;
  }
}

/**
 * Advance the stages that end by themselves up to `now` (a late tick passes several, each at its scheduled time, so a slow
 * server tick shifts nothing). A fight is also checked for finishing (progress reached) and for losing the fish.
 */
export function tickFishing(state: FishingState, now: number): FishingActionResult {
  if (!finite(now)) return fail(state, "invalid_time");
  let s = state;
  const entered: FishingPhase[] = [];
  for (let guard = 0; guard < 16; guard++) {
    const end = phaseEndsAt(s);
    if (s.phase === "fighting") {
      const f = { ...s };
      const ev = integrateFight(f, now);
      if (ev.event) {
        endFight(f, ev.event, ev.at, entered);
        s = f;
        continue;
      }
      const idleSince = Math.max(f.fightStartAt, f.lastActiveAt);
      if (now - idleSince >= FISHING.fightIdleMs || now >= (end ?? Infinity)) {
        endFight(f, "idle", Math.min(now, idleSince + FISHING.fightIdleMs), entered);
        s = f;
        continue;
      }
      return { ok: true, state: f, entered };
    }
    if (end === null || now < end) break;
    const n: FishingState = { ...s };
    switch (s.phase) {
      case "casting":
        enter(n, "settling", end, entered);
        break;
      case "settling":
        enter(n, "waiting", end, entered);
        break;
      case "waiting":
        enter(n, "nibble", end, entered);
        break;
      case "nibble":
        enter(n, "bite", end, entered);
        break;
      case "bite":
        n.lastResult = "missed";
        clearCast(n);
        enter(n, "missed", end, entered);
        break;
      case "hooked":
        if (s.catch?.needsNet) {
          n.fightStartAt = end;
          n.holdIntegratedAt = end;
          n.lastActiveAt = end;
          n.fightProgress = FIGHT_START_PROGRESS;
          n.fightTension = 0;
          n.holdDown = false;
          n.holdDownUntil = 0;
          enter(n, "fighting", end, entered);
        } else {
          enter(n, "lifting", end, entered);
        }
        break;
      case "lifting":
      case "netting":
        n.lastResult = "caught";
        enter(n, "landed", end, entered);
        break;
      case "landed":
        enter(n, "releasing", end, entered);
        break;
      case "releasing":
        n.plan = null;
        n.catch = null;
        enter(n, "ready", end, entered);
        break;
      case "missed":
        n.plan = null;
        enter(n, n.rod && n.spot >= 0 ? "ready" : n.rod ? "carry" : "none", end, entered);
        break;
      default:
        return { ok: true, state: s, entered };
    }
    s = n;
  }
  return { ok: true, state: s, entered };
}

// ------------------------------------------------------------------------------------------------ the wire

/** The fight on the wire (`Player.fishReel`, uint16): bits 0..6 the distance brought in (0..100), bit 7 the button held, bits 8..14 the line tension (0..100). */
export function packReel(progress: number, tension: number, held: boolean): number {
  const p = Math.max(0, Math.min(100, Math.round(100 * progress)));
  const t = Math.max(0, Math.min(100, Math.round(100 * tension)));
  return p | (held ? 128 : 0) | (t << 8);
}

/** What `Player` carries for the other clients (design 9.4). */
export interface FishingSync {
  rod: number;
  fishSpot: number;
  fishPhase: number;
  fishSeq: number;
  fishSig: number;
  fishKind: number;
  fishCm: number;
  fishAt: number;
  /** The fight (packReel: progress, held, tension); 0 outside it. */
  fishReel: number;
}

/** The synced fields of a state: the signal only while it bites, the fish only from `hooked` until it is released. */
export function fishingSync(s: FishingState): FishingSync {
  const fishShown = s.catch !== null && fishingPhaseId(s.phase) >= fishingPhaseId("hooked") && s.phase !== "missed";
  return {
    rod: s.rod ? ROD_MINJANGDAE : ROD_NONE,
    fishSpot: s.spot,
    fishPhase: fishingPhaseId(s.phase),
    fishSeq: s.seq,
    fishSig: s.phase === "bite" && s.plan ? fishSignalId(s.plan.signal) : 0,
    fishKind: fishShown ? fishKindId(s.catch!.kind) : 0,
    fishCm: fishShown ? Math.min(255, s.catch!.cm) : 0,
    fishAt: Math.floor(s.phaseAt) % 4294967296,
    fishReel: s.phase === "fighting" ? packReel(s.fightProgress, s.fightTension, s.holdDown) : 0,
  };
}

/** Whether a point is within `reach` of another (x/z plane), inclusive. */
export function withinFishingReach(from: { x: number; z: number }, target: { x: number; z: number }, reach: number): boolean {
  return Number.isFinite(reach) && reach >= 0 && (from.x - target.x) ** 2 + (from.z - target.z) ** 2 <= reach * reach + 1e-9;
}

export function nearRentalPad(x: number, z: number): boolean {
  return withinFishingReach({ x, z }, LAKE_RENTAL_PAD, FISHING.rentReachM);
}
export function nearReturnPad(x: number, z: number): boolean {
  return withinFishingReach({ x, z }, LAKE_RENTAL_PAD, FISHING.returnReachM);
}
