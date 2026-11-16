import { VILLAGE_LAYOUT, type Point2, type SceneryHouse, type VillageLayout } from "./villageLayout";

/**
 * Server boundary types and pure rate/lockout rules for building keypads.
 *
 * The client sends only a building id and the code currently typed. It never
 * receives the expected code or a reusable credential. A server handler should
 * validate proximity/area, call a server-only verifier, then feed the boolean
 * result into `recordKeypadAttempt` and issue a short-lived session unlock.
 */

export interface KeypadAttempt {
  buildingId: string;
  playerId: string;
  area: string;
  distanceM: number;
  code: string;
  nowMs: number;
}

export interface KeypadPolicy {
  /** Buildings in this set accept keypad attempts; public auto doors do not. */
  readonly keypadBuildingIds: ReadonlySet<string>;
  readonly reachM: number;
  readonly minCodeLength: number;
  readonly maxCodeLength: number;
  readonly failureWindowMs: number;
  readonly maxFailures: number;
  readonly lockoutMs: number;
}

export interface KeypadRateState {
  readonly failedAtMs: readonly number[];
  readonly lockedUntilMs: number;
}

export const EMPTY_KEYPAD_RATE: Readonly<KeypadRateState> = Object.freeze({ failedAtMs: [], lockedUntilMs: 0 });

export type KeypadRejectReason = "invalid_request" | "not_keypad_building" | "too_far" | "locked_out" | "rate_limited" | "invalid_code";
export type KeypadDecision =
  | { ok: true; buildingId: string }
  | { ok: false; reason: KeypadRejectReason; retryAfterMs?: number };

export interface ServerKeypadVerifier {
  /** Implemented on the server with a server-only hash/verifier; never in browser code. */
  verify(buildingId: string, code: string): Promise<boolean> | boolean;
}

function validAttempt(a: KeypadAttempt, p: KeypadPolicy): boolean {
  return p.keypadBuildingIds.has(a.buildingId) && a.playerId.length > 0 && a.area.length > 0 && Number.isFinite(a.distanceM) && a.distanceM >= 0 && Number.isFinite(a.nowMs) && a.nowMs >= 0;
}

/** Validate the untrusted request before touching a verifier or rate state. */
export function validateKeypadAttempt(a: KeypadAttempt, p: KeypadPolicy): KeypadDecision {
  if (!validAttempt(a, p)) return { ok: false, reason: "invalid_request" };
  if (a.distanceM > p.reachM) return { ok: false, reason: "too_far" };
  if (a.code.length < p.minCodeLength || a.code.length > p.maxCodeLength || !/^\d+$/.test(a.code)) return { ok: false, reason: "invalid_code" };
  return { ok: true, buildingId: a.buildingId };
}

/** Apply lockout/rate rules after the server verifier returns without exposing the expected code. */
export function recordKeypadAttempt(
  state: KeypadRateState,
  nowMs: number,
  accepted: boolean,
  p: KeypadPolicy,
  buildingId = "",
): { state: KeypadRateState; decision: KeypadDecision } {
  if (!Number.isFinite(nowMs) || nowMs < 0) return { state, decision: { ok: false, reason: "invalid_request" } };
  if (state.lockedUntilMs > nowMs) return { state, decision: { ok: false, reason: "locked_out", retryAfterMs: state.lockedUntilMs - nowMs } };
  if (accepted) return { state: EMPTY_KEYPAD_RATE, decision: { ok: true, buildingId } };
  const recent = state.failedAtMs.filter((t) => nowMs - t < p.failureWindowMs);
  const failedAtMs = [...recent, nowMs];
  if (failedAtMs.length >= p.maxFailures) {
    const lockedUntilMs = nowMs + p.lockoutMs;
    return { state: { failedAtMs: [], lockedUntilMs }, decision: { ok: false, reason: "locked_out", retryAfterMs: p.lockoutMs } };
  }
  return { state: { failedAtMs, lockedUntilMs: 0 }, decision: { ok: false, reason: "rate_limited" } };
}

/** Houses are private keypad buildings; public buildings use the proximity-door state machine instead. */
export const HOUSE_KEYPAD_IDS = Object.freeze(VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house").map((h) => h.id));
export const HOUSE_KEYPAD_REACH_M = 2;

export interface KeypadEntry {
  buildingId: string;
  pad: Point2;
  /** Where the way out of the house puts a player: on the porch in front of the door, facing away from it (house N's exit). */
  exit: { x: number; z: number; yaw: number };
}

/** How far past the keypad pad (m, away from the wall) the way out of a house lands: 1.2 m from the wall, 0.55 m past the pad. */
export const HOUSE_EXIT_PAST_PAD_M = 0.55;

function keypadPad(house: SceneryHouse): Point2 {
  const halfX = house.size.x / 2;
  const halfZ = house.size.z / 2;
  const offset = 0.65;
  switch (house.doorSide) {
    case "n": return { x: house.centre.x, z: house.centre.z - halfZ - offset };
    case "s": return { x: house.centre.x, z: house.centre.z + halfZ + offset };
    case "e": return { x: house.centre.x + halfX + offset, z: house.centre.z };
    case "w": return { x: house.centre.x - halfX - offset, z: house.centre.z };
  }
}

/** The unit vector pointing out of the house through its door, and the yaw of a person walking that way (the game's atan2(dirX, dirZ)). */
function outward(side: SceneryHouse["doorSide"]): { dx: number; dz: number; yaw: number } {
  switch (side) {
    case "n": return { dx: 0, dz: -1, yaw: Math.PI };
    case "s": return { dx: 0, dz: 1, yaw: 0 };
    case "e": return { dx: 1, dz: 0, yaw: Math.PI / 2 };
    case "w": return { dx: -1, dz: 0, yaw: -Math.PI / 2 };
  }
}

export function keypadEntries(layout: VillageLayout = VILLAGE_LAYOUT): readonly KeypadEntry[] {
  return layout.sceneryHouses
    .filter((h) => h.kind === "house")
    .map((h) => {
      const pad = keypadPad(h);
      const o = outward(h.doorSide);
      const round = (v: number) => Math.round(v * 1000) / 1000;
      return {
        buildingId: h.id,
        pad,
        exit: { x: round(pad.x + o.dx * HOUSE_EXIT_PAST_PAD_M), z: round(pad.z + o.dz * HOUSE_EXIT_PAST_PAD_M), yaw: o.yaw },
      };
    });
}

/** The keypad entry of a house by its building id (`house_3`), or null. */
export function keypadEntryOf(buildingId: string, layout: VillageLayout = VILLAGE_LAYOUT): KeypadEntry | null {
  return keypadEntries(layout).find((e) => e.buildingId === buildingId) ?? null;
}

export function nearestKeypadEntry(x: number, z: number, layout: VillageLayout = VILLAGE_LAYOUT): { entry: KeypadEntry; distanceM: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let best: { entry: KeypadEntry; distanceM: number } | null = null;
  for (const entry of keypadEntries(layout)) {
    const distanceM = Math.hypot(x - entry.pad.x, z - entry.pad.z);
    if (distanceM <= HOUSE_KEYPAD_REACH_M && (best === null || distanceM < best.distanceM)) best = { entry, distanceM };
  }
  return best;
}

