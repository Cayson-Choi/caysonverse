import { createHash, timingSafeEqual } from "node:crypto";
import {
  HOUSE_KEYPAD_IDS,
  HOUSE_KEYPAD_REACH_M,
  EMPTY_KEYPAD_RATE,
  nearestKeypadEntry,
  recordKeypadAttempt,
  validateKeypadAttempt,
  type KeypadDecision,
  type KeypadEntry,
  type KeypadRateState,
} from "@caysonverse/shared/village/buildingAccess";

/** House keypad policy. The expected code is represented only by this server-side digest. */
export const HOUSE_KEYPAD_POLICY = Object.freeze({
  keypadBuildingIds: new Set(HOUSE_KEYPAD_IDS),
  reachM: HOUSE_KEYPAD_REACH_M,
  minCodeLength: 4,
  maxCodeLength: 4,
  failureWindowMs: 30_000,
  maxFailures: 5,
  lockoutMs: 30_000,
});

// SHA-256("1004"). This digest must never be moved into shared/client code.
const HOUSE_CODE_DIGEST = "75992a5ac67ff644d3063976c2effd10bdd93fcc109798e3d5c1acf2e530d01a";

export interface KeypadCheck {
  buildingId: string;
  playerId: string;
  area: string;
  x: number;
  z: number;
  code: string;
  nowMs: number;
  rate: KeypadRateState;
}

export interface KeypadCheckResult {
  state: KeypadRateState;
  decision: KeypadDecision;
  entry: KeypadEntry;
}

function codeMatches(code: string): boolean {
  const digest = Buffer.from(createHash("sha256").update(code, "utf8").digest("hex"), "utf8");
  const expected = Buffer.from(HOUSE_CODE_DIGEST, "utf8");
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

/** Validate the authoritative position, verify the server-only digest, then apply the rate/lockout state. */
export function checkHouseKeypad(input: KeypadCheck): KeypadCheckResult {
  const nearest = nearestKeypadEntry(input.x, input.z);
  const entry = nearest?.entry ?? null;
  const emptyEntry: KeypadEntry = { buildingId: input.buildingId, pad: { x: input.x, z: input.z }, placeholderArea: "hall" };
  if (!entry || entry.buildingId !== input.buildingId) {
    return { state: input.rate, decision: { ok: false, reason: "too_far" }, entry: emptyEntry };
  }
  const validated = validateKeypadAttempt(
    { buildingId: input.buildingId, playerId: input.playerId, area: input.area, distanceM: nearest!.distanceM, code: input.code, nowMs: input.nowMs },
    HOUSE_KEYPAD_POLICY,
  );
  if (!validated.ok) return { state: input.rate, decision: validated, entry };
  const result = recordKeypadAttempt(input.rate, input.nowMs, codeMatches(input.code), HOUSE_KEYPAD_POLICY, input.buildingId);
  return { state: result.state, decision: result.decision, entry };
}

export const initialKeypadRate = (): KeypadRateState => EMPTY_KEYPAD_RATE;
