/**
 * Pure policy for turning a room LEAVE close code (and the persisted kick flag)
 * into the client-side action, plus mapping a JOIN failure to a Korean notice.
 * Clock-free and side-effect-free so the whole decision table is unit-testable;
 * the resilience driver performs the actual side effects (toast, screen change,
 * reconnect loop, kick seam).
 *
 * Close-code semantics observed in the installed Colyseus 0.17 SDK
 * (see @colyseus/shared-types CloseCode + colyseus.js Room):
 * - 4101 (KICK_CLOSE_CODE): admin kick → entry + kick notice, NO auto-reconnect.
 * - 4000 (CONSENTED) / 1000 (NORMAL_CLOSURE): deliberate/clean close → entry.
 * - 4102 (CLASS_CLOSED_CODE): the class (반) ended → entry + "수업이 끝났어요", NO
 *   auto-reconnect (AI 학교 탈출).
 * - 1001/1005/1006/4010 (GOING_AWAY/NO_STATUS/ABNORMAL/MAY_TRY_RECONNECT) and any
 *   other code (e.g. 4001 SERVER_SHUTDOWN — a server restart/deploy, 4002 WITH_ERROR,
 *   4003 FAILED_TO_RECONNECT): unexpected → run the reconnect flow.
 *
 * The class half (Task 13): how a class join failure reads, what a class connection's
 * Phase-2 rejoin does (`classRejoinPlan`) and when it retries, and how a team classroom's
 * close is handled (`decideEscapeLeave`).
 */

import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import { CLASS_CLOSED_CODE, type TextLevel } from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";

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
/** A class join found no class: a wrong code, a class that ended (locked), or a full one. */
export const CLASS_NOT_FOUND_NOTICE = "반 코드를 확인해 주세요. 수업이 끝났거나 반이 가득 찼을 수도 있어요.";
/** The class closed (CLASS_CLOSED_CODE): the entry screen says goodbye. */
export const CLASS_ENDED_NOTICE = "수업이 끝났어요. 함께해 줘서 고마워요!";
/** The team classroom's connection could not be restored: back in the corridor. */
export const ESCAPE_LOST_NOTICE = "교실 연결이 끊겨 복도로 돌아왔어요.";

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
  // The class ended: its connections are closed for good (the room is locked and disposing),
  // so reconnecting could only fail — say goodbye instead.
  if (code === CLASS_CLOSED_CODE) {
    return { action: "entry", notice: CLASS_ENDED_NOTICE };
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

/** Best-effort message extraction — handles Error, string, and {message} objects
 *  (matchmake rejections arrive as plain objects, not always Error instances). */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object") {
    const m = (err as ErrorLike).message;
    if (typeof m === "string") return m;
  }
  return "";
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
  const message = messageOf(err);
  // A Korean message is a server-authored rejection (nickname rule, kick, …).
  if (message && HANGUL.test(message)) return message;
  return GENERIC_JOIN_NOTICE;
}

/**
 * A DETERMINISTIC join rejection: the server actively refused with a Korean
 * (server-authored) reason — a denySet kick ("입장이 제한되었습니다"), a
 * nickname-rule violation, an out-of-range cached identity, a wrong admin code.
 * Unlike a capacity 521 (which may clear once the server's boot window closes)
 * or a transient network failure, retrying this can NEVER succeed.
 */
export function isDeterministicRejection(err: unknown): boolean {
  if (isCapacityError(err)) return false; // capacity/boot-window stays retryable
  const message = messageOf(err);
  return message.length > 0 && HANGUL.test(message);
}

/**
 * Phase-2 fresh-join retry predicate: retry EVERY failure through the backoff
 * EXCEPT a deterministic server rejection. Retrying a deterministic verdict for
 * ~31s behind the overlay only to then show a misleading generic notice is the
 * D2 bug; a denied/kicked user must see the real reason immediately instead.
 */
export function shouldRetryFreshJoin(err: unknown): boolean {
  return !isDeterministicRejection(err);
}

/**
 * A reconnection error where the server actually responded (a matchmake/server error carries a
 * numeric `code`) — it is reachable but refused the token (it restarted, or the window closed).
 * A bare network failure has no numeric code: keep retrying the token inside the window.
 */
export function serverResponded(err: unknown): boolean {
  return err !== null && typeof (err as { code?: unknown }).code === "number";
}

/**
 * A server-authored Korean message, or `fallback` (a proxy's HTML page, an English framework
 * error, a missing field). Used for the teacher HTTP route and the escape-room join.
 */
export function serverNoticeOr(message: unknown, fallback: string): string {
  return typeof message === "string" && HANGUL.test(message) ? message : fallback;
}

// ─────────────────────────────── Class (반) joins and rejoins ───────────────────────────────

/**
 * Map a CLASS join failure to the notice the entry screen shows. The matchmaker's "no room"
 * (521, or 522 locked) means: no class has this code, the class ended (it locks), or it is full —
 * one notice for all three. The room's own Korean refusal (nickname taken, kicked, expired
 * teacher pass) is shown as is; anything else is the generic connection notice.
 */
export function classJoinErrorNotice(err: unknown): string {
  if (isCapacityError(err)) return CLASS_NOT_FOUND_NOTICE;
  return joinErrorNotice(err);
}

/** The class a dropped class connection rejoins in Phase 2 (after a server restart). */
export type ClassRejoinPlan =
  | { kind: "teacher"; key: string; classCode: string; textLevel: TextLevel }
  | { kind: "student"; classCode: string };

/**
 * Review Focus 5: a teacher's tab re-opens ITS class under the same code (a new one-time pass
 * from the remembered key); a student's tab rejoins by the cached code (and waits for the
 * teacher to re-open it). No usable code → nothing to rejoin (null). The teacher's class code
 * wins over the cache, which another tab may have overwritten.
 */
export function classRejoinPlan(
  cached: { classCode?: string },
  teacher: { key: string; classCode: string; textLevel: TextLevel } | null,
): ClassRejoinPlan | null {
  if (teacher !== null && teacher.key !== "") {
    const code = normalizeClassCode(teacher.classCode) ?? normalizeClassCode(cached.classCode);
    if (code !== null) return { kind: "teacher", key: teacher.key, classCode: code, textLevel: teacher.textLevel };
    return null;
  }
  const code = normalizeClassCode(cached.classCode);
  return code === null ? null : { kind: "student", classCode: code };
}

/**
 * A failed teacher HTTP request carries its HTTP status as `status` (0 = no answer) — never as
 * `code`, so a proxy's HTTP 521/522 can never read as the matchmaker's "no room".
 */
function httpStatusOf(err: unknown): number | null {
  if (err === null || typeof err !== "object") return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * Phase-2 class rejoin retry predicate. Teacher route: retry only when the server could not
 * answer properly (no answer, 5xx — it may still be starting); a wrong key, another teacher's
 * code, a malformed request or the failure limit (4xx) never get better. Class join: as the world
 * (retry 521 — the class is not re-opened YET — and network trouble; never a Korean refusal).
 */
export function shouldRetryClassRejoin(err: unknown): boolean {
  const status = httpStatusOf(err);
  if (status !== null) return status === 0 || status >= 500;
  return shouldRetryFreshJoin(err);
}

/** The entry notice when a Phase-2 class rejoin gives up. */
export function classRejoinNotice(err: unknown): string {
  if (httpStatusOf(err) !== null) return serverNoticeOr(messageOf(err), FAILED_NOTICE);
  if (isCapacityError(err) || isDeterministicRejection(err)) return classJoinErrorNotice(err);
  return FAILED_NOTICE;
}

// ─────────────────────────────── Team classroom (escape room) ───────────────────────────────

/**
 * What a close of the CURRENT team-classroom connection means:
 * - `kicked`: the teacher's kick (the class connection is closed with it too and goes to the entry);
 * - `ended`: the class ended (CLASS_CLOSED_CODE) → back to the hall, which closes soon after;
 * - `closed`: a clean server-side close (consented / normal) → back to the hall, no retry;
 * - `recover`: any drop, error or server restart (4001) → reconnect, then ask for a new ticket.
 */
export type EscapeLeaveDecision = "kicked" | "ended" | "closed" | "recover";

export function decideEscapeLeave(code: number, kicked: boolean): EscapeLeaveDecision {
  if (code === KICK_CLOSE_CODE || kicked) return "kicked";
  if (code === CLASS_CLOSED_CODE) return "ended";
  if (code === CONSENTED || code === NORMAL_CLOSURE) return "closed";
  return "recover";
}
