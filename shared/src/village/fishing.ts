/**
 * Server-authoritative fishing rules for the village pond.
 *
 * The browser may show a cast animation, but only this clock-injected state machine decides
 * whether a bobber is submerged and whether a pull caught anything. A FishingState is
 * session-local and should be discarded on disconnect.
 */

export const FISHING = {
  rentalReachM: 2.5,
  pondReachM: 3.5,
  castCooldownMs: 900,
  minBiteDelayMs: 4_000,
  maxBiteDelayMs: 12_000,
  biteWindowMs: 1_600,
  /** A repeated invalid action cannot spin the state machine faster than this. */
  actionCooldownMs: 250,
} as const;

export type FishingPhase = "no_rod" | "ready" | "waiting" | "submerged";
export type FishKind = "minnow" | "crucian_carp" | "bass" | "koi" | "giant_catfish";

export interface FishSpecies {
  kind: FishKind;
  label: string;
  /** Relative weight; rare large fish intentionally have low weight. */
  weight: number;
  minCm: number;
  maxCm: number;
}

export const FISH_SPECIES: readonly FishSpecies[] = [
  { kind: "minnow", label: "피라미", weight: 48, minCm: 8, maxCm: 16 },
  { kind: "crucian_carp", label: "붕어", weight: 30, minCm: 18, maxCm: 34 },
  { kind: "bass", label: "배스", weight: 15, minCm: 28, maxCm: 52 },
  { kind: "koi", label: "비단잉어", weight: 6, minCm: 24, maxCm: 46 },
  { kind: "giant_catfish", label: "대형 메기", weight: 1, minCm: 65, maxCm: 110 },
] as const;

export interface FishCatch {
  kind: FishKind;
  label: string;
  lengthCm: number;
  caughtAt: number;
}

export interface FishingState {
  phase: FishingPhase;
  rodRented: boolean;
  castId: number;
  castAt: number;
  biteAt: number | null;
  biteUntil: number | null;
  lastActionAt: number;
  lastResult: "none" | "cast" | "bite" | "missed" | "caught";
  catch: FishCatch | null;
}

export type FishingReject =
  | "not_near_rental"
  | "already_has_rod"
  | "too_soon"
  | "not_near_pond"
  | "rod_required"
  | "already_cast"
  | "no_bite"
  | "bite_expired"
  | "invalid_time";

export interface FishingActionResult {
  ok: boolean;
  state: FishingState;
  reject?: FishingReject;
  event?: "rod_rented" | "cast" | "bite" | "missed" | "caught";
}

export interface FishingPoints {
  x: number;
  z: number;
}

export function createFishingState(): FishingState {
  return {
    phase: "no_rod",
    rodRented: false,
    castId: 0,
    castAt: 0,
    biteAt: null,
    biteUntil: null,
    lastActionAt: Number.NEGATIVE_INFINITY,
    lastResult: "none",
    catch: null,
  };
}

function finiteNow(now: number): boolean {
  return Number.isFinite(now) && now >= 0;
}

function randomUnit(random: () => number): number {
  const n = Number(random());
  return Number.isFinite(n) ? Math.min(0.999999999, Math.max(0, n)) : 0;
}

export function distanceSquared(a: FishingPoints, b: FishingPoints): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function withinFishingReach(from: FishingPoints, target: FishingPoints, reach: number): boolean {
  return Number.isFinite(reach) && reach >= 0 && distanceSquared(from, target) <= reach * reach + 1e-9;
}

function copyState(state: FishingState): FishingState {
  return { ...state, catch: state.catch ? { ...state.catch } : null };
}

function reject(state: FishingState, reason: FishingReject): FishingActionResult {
  return { ok: false, state: copyState(state), reject: reason };
}

function elapsedActionAllowed(state: FishingState, now: number): boolean {
  return now - state.lastActionAt >= FISHING.actionCooldownMs;
}

export function rentRod(state: FishingState, now: number, nearRental: boolean): FishingActionResult {
  if (!finiteNow(now)) return reject(state, "invalid_time");
  if (!nearRental) return reject(state, "not_near_rental");
  if (state.rodRented) return reject(state, "already_has_rod");
  if (!elapsedActionAllowed(state, now)) return reject(state, "too_soon");
  const next = copyState(state);
  next.rodRented = true;
  next.phase = "ready";
  next.lastActionAt = now;
  next.lastResult = "none";
  return { ok: true, state: next, event: "rod_rented" };
}

export function castLine(
  state: FishingState,
  now: number,
  nearPond: boolean,
  random: () => number = Math.random,
): FishingActionResult {
  if (!finiteNow(now)) return reject(state, "invalid_time");
  if (!state.rodRented || state.phase === "no_rod") return reject(state, "rod_required");
  if (!nearPond) return reject(state, "not_near_pond");
  if (state.phase === "waiting" || state.phase === "submerged") return reject(state, "already_cast");
  if (!elapsedActionAllowed(state, now) || (state.castId > 0 && now - state.castAt < FISHING.castCooldownMs)) return reject(state, "too_soon");

  const delay = FISHING.minBiteDelayMs + randomUnit(random) * (FISHING.maxBiteDelayMs - FISHING.minBiteDelayMs);
  const next = copyState(state);
  next.phase = "waiting";
  next.castId += 1;
  next.castAt = now;
  next.biteAt = now + Math.round(delay);
  next.biteUntil = null;
  next.lastActionAt = now;
  next.lastResult = "cast";
  next.catch = null;
  return { ok: true, state: next, event: "cast" };
}

export function tickFishing(state: FishingState, now: number): FishingActionResult {
  if (!finiteNow(now)) return reject(state, "invalid_time");
  const next = copyState(state);
  if (next.phase === "waiting" && next.biteAt !== null && now >= next.biteAt) {
    const biteUntil = next.biteAt + FISHING.biteWindowMs;
    if (now >= biteUntil) {
      next.phase = "ready";
      next.biteAt = null;
      next.biteUntil = null;
      next.lastResult = "missed";
      return { ok: true, state: next, event: "missed" };
    }
    next.phase = "submerged";
    next.biteUntil = biteUntil;
    next.lastResult = "bite";
    return { ok: true, state: next, event: "bite" };
  }
  if (next.phase === "submerged" && next.biteUntil !== null && now >= next.biteUntil) {
    next.phase = "ready";
    next.biteAt = null;
    next.biteUntil = null;
    next.lastResult = "missed";
    return { ok: true, state: next, event: "missed" };
  }
  return { ok: true, state: next };
}

function pickSpecies(random: () => number): FishSpecies {
  const total = FISH_SPECIES.reduce((sum, item) => sum + item.weight, 0);
  let n = randomUnit(random) * total;
  for (const item of FISH_SPECIES) {
    n -= item.weight;
    if (n < 0) return item;
  }
  return FISH_SPECIES[FISH_SPECIES.length - 1]!;
}

export function reelLine(
  state: FishingState,
  now: number,
  random: () => number = Math.random,
): FishingActionResult {
  if (!finiteNow(now)) return reject(state, "invalid_time");
  const stepped = tickFishing(state, now);
  if (!stepped.ok) return stepped;
  const current = stepped.state;
  if (current.phase === "waiting") return reject(current, "no_bite");
  if (current.phase !== "submerged") {
    return current.lastResult === "missed" ? reject(current, "bite_expired") : reject(current, "no_bite");
  }

  const species = pickSpecies(random);
  const lengthCm = Math.round(species.minCm + randomUnit(random) * (species.maxCm - species.minCm));
  const next = copyState(current);
  next.phase = "ready";
  next.biteAt = null;
  next.biteUntil = null;
  next.lastActionAt = now;
  next.lastResult = "caught";
  next.catch = { kind: species.kind, label: species.label, lengthCm, caughtAt: now };
  return { ok: true, state: next, event: "caught" };
}

export function resetFishing(): FishingState {
  return createFishingState();
}

