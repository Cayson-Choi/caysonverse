/**
 * Pure policy for turning a room LEAVE close code (and the persisted kick flag)
 * into the client-side action, plus mapping a JOIN failure to a Korean notice.
 * Clock-free and side-effect-free so the whole decision table is unit-testable;
 * the resilience driver performs the actual side effects (toast, screen change,
 * reconnect loop, kick seam).
 *
 * Close-code semantics observed in the installed Colyseus 0.17 SDK
 * (see @colyseus/shared-types CloseCode + colyseus.js Room):
 * - 4001 (KICK_CLOSE_CODE): admin kick → entry + kick notice, NO auto-reconnect.
 * - 4000 (CONSENTED) / 1000 (NORMAL_CLOSURE): deliberate/clean close → entry.
 * - 1001/1005/1006/4010 (GOING_AWAY/NO_STATUS/ABNORMAL/MAY_TRY_RECONNECT) and any
 *   other code (e.g. 4002 WITH_ERROR, 4003 FAILED_TO_RECONNECT): unexpected →
 *   run the reconnect flow.
 */

import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";

/** WebSocket "consented leave" close code the SDK sends on a graceful leave. */
const CONSENTED = 4000;
/** WebSocket normal-closure code. */
const NORMAL_CLOSURE = 1000;
/**
 * Matchmake error code the server returns when `client.join` finds NO available
 * (unlocked) room for the requested name. In the singleton-world topology the
 * world room is pre-created at boot and never auto-disposes, so the ONLY reason a
 * join finds no available room is that the sole world room is locked (at capacity).
 * (ErrorCode.MATCHMAKE_INVALID_CRITERIA in the installed Colyseus 0.17.)
 */
const MATCHMAKE_INVALID_CRITERIA = 521;
/** Matchmake error code the server returns for a join-by-id to a locked room. */
const MATCHMAKE_INVALID_ROOM_ID = 522;

// ── User-facing Korean strings (identifiers stay English). ──
export const KICKED_NOTICE = "관리자에 의해 퇴장되었습니다";
export const DISCONNECT_NOTICE = "서버와의 연결이 끊어졌습니다. 다시 입장해주세요.";
export const CAPACITY_NOTICE = "정원이 가득 찼습니다 (최대 110명)";
export const FAILED_NOTICE = "연결에 실패했습니다. 잠시 후 다시 시도해주세요.";
const GENERIC_JOIN_NOTICE = "서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.";

/** Result of classifying a leave. `entry` shows the notice; `reconnect` recovers. */
export type LeaveDecision =
  | { action: "reconnect" }
  | { action: "entry"; notice: string; kick?: boolean };

/**
 * Classify a room leave. `kicked` is the persisted session flag (see kickSeam):
 * a kicked session must NEVER auto-reconnect even if a later drop code says it
 * could — so the flag forces the entry+kick outcome.
 */
export function decideLeave(code: number, kicked: boolean): LeaveDecision {
  if (code === KICK_CLOSE_CODE || kicked) {
    return { action: "entry", notice: KICKED_NOTICE, kick: true };
  }
  if (code === CONSENTED || code === NORMAL_CLOSURE) {
    return { action: "entry", notice: DISCONNECT_NOTICE };
  }
  return { action: "reconnect" };
}

// Hangul range — tells a server-authored Korean rejection (which we surface
// verbatim) apart from a low-level network error (whose message is unhelpful).
const HANGUL = /[가-힣]/;

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

/** True when a join failure means the world room is full/locked (capacity reached). */
export function isCapacityError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as ErrorLike;
  const message = typeof e.message === "string" ? e.message : "";
  // PRODUCTION path — `client.join(WORLD_ROOM)` (join-existing-only): a full world
  // room is locked, so matchmaking finds no available room and rejects with
  // MATCHMAKE_INVALID_CRITERIA (521) + "no rooms found …". Because the singleton
  // world is pre-created at boot and never auto-disposes, 521 can only mean it is
  // full (verified via the server integration test with a tiny maxClients override).
  if (e.code === MATCHMAKE_INVALID_CRITERIA) return true;
  // Legacy join-by-id path: a specific room at capacity is "locked" and rejected
  // with MATCHMAKE_INVALID_ROOM_ID (522) + a "…is locked" message.
  return e.code === MATCHMAKE_INVALID_ROOM_ID && /lock(ed)?/i.test(message);
}

/** Map any JOIN failure to the Korean notice shown on the entry screen. */
export function joinErrorNotice(err: unknown): string {
  if (isCapacityError(err)) return CAPACITY_NOTICE;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  // A Korean message is a server-authored rejection (nickname rule, kick, …).
  if (message && HANGUL.test(message)) return message;
  return GENERIC_JOIN_NOTICE;
}
