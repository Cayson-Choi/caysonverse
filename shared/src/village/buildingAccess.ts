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

