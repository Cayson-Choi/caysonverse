/**
 * The reconnection driver — the ONE module that owns connection-loss recovery.
 *
 * Strategy (verified against the installed Colyseus 0.17 SDK):
 * - We DISABLE the SDK's built-in auto-reconnect loop (`room.reconnection.enabled
 *   = false`) so every close — transient drop, kick, or consented leave — funnels
 *   through a single `room.onLeave(code)` we can reason about and test. `onLeave`
 *   then receives the ORIGINAL close code.
 * - `decideLeave(code, wasKicked)` (pure) classifies it: kick/consented → entry
 *   screen; anything unexpected → the reconnect flow below.
 *
 * Reconnect flow:
 *   Phase 1 — transient drop: re-establish the SAME session with the persisted
 *     `reconnectionToken` (server held the seat via allowReconnection), within the
 *     RECONNECT_WINDOW_S budget → same avatar, same position. If the server
 *     answers but rejects the token (it restarted), we skip straight to Phase 2.
 *   Phase 2 — server restarted / window expired: silent fresh join (join-existing
 *     -only against the boot-created singleton world) with the cached identity and
 *     the pure exponential backoff (1s,2s,4s… cap 8s, ~30s). A new avatar at spawn
 *     is EXPECTED (no DB). A 521 ("no rooms found") and transient/network failures
 *     are RETRIED — the room may still be re-creating in the server's boot window
 *     (mass reconnect after a restart lands exactly there). A DETERMINISTIC server
 *     rejection (a Korean reason: denySet kick, nickname rule, bad cached identity)
 *     is NOT retried — it can never succeed, so we surface the real reason at once.
 *     An admin session re-sends its (module-memory) code so a restart preserves the
 *     instructor's powers; a rejected code falls back to a normal-user join.
 *   Exhausted / rejected → entry screen with the real Korean reason (capacity when
 *     genuinely full, the server's rejection verbatim, else the generic failure).
 *
 * Every successful (re)connection produces a NEW room; each phase ADOPTS + ARMS
 * the room (setRoom + attachResilience) BEFORE awaiting its first state, so a
 * second drop during that wait is caught by our onLeave (never a zombie world),
 * then bumps the connection epoch so the scene REMOUNTS and rebinds (remote store
 * rebuilt clean — no duplicate avatars).
 */

import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { RECONNECT_WINDOW_S } from "@caysonverse/shared/constants";
import {
  client,
  getRoom,
  setRoom,
  joinRoom,
  waitForSelf,
} from "./connection";
import { reconnectBackoffMs } from "./backoff";
import { retryWhile } from "./joinRetry";
import {
  decideLeave,
  isCapacityError,
  isDeterministicRejection,
  shouldRetryFreshJoin,
  joinErrorNotice,
  FAILED_NOTICE,
} from "./reconnectPolicy";
import { loadIdentity } from "./identityCache";
import { getAdminCode, forgetAdminCode } from "./adminSession";
import { wasKicked, markKicked } from "./kickSeam";
import { useAppStore } from "../stores/appStore";

/** sessionStorage key for the room reconnection token (scoped to this tab). */
const TOKEN_KEY = "cv.reconnectToken";
/** How often to retry the token reconnect while the server is unreachable. */
const TOKEN_RETRY_MS = 1000;

/** Guards against overlapping reconnect loops (one recovery at a time). */
let reconnecting = false;

/**
 * Sentinel error thrown when the room we are adopting closes DURING its confirm
 * wait (a second drop mid-recovery). It carries no numeric code and no Hangul
 * message, so Phase 1 keeps retrying (not a token rejection) and Phase 2's
 * `shouldRetryFreshJoin` retries it (not a deterministic rejection).
 */
const CLOSED_DURING_RECOVERY = "cv:closed-during-recovery";

/**
 * Set while a reconnect attempt is waiting for its just-adopted room's first
 * state. If that room closes first, our (already-armed) onLeave calls this to
 * abort the wait so the recovery loop makes another attempt — instead of
 * adopting a room the SDK is about to destroy (the F4 zombie-world guard).
 */
let abortConfirm: (() => void) | null = null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Token persistence (best-effort; storage may be unavailable). ──
function saveToken(token: string | undefined): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* non-fatal */
  }
}
function loadToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* non-fatal */
  }
}

/**
 * A reconnection error where the server actually responded (a matchmake/server
 * error carries a numeric `code`) — meaning it is reachable but rejected our
 * token (it restarted). A bare network failure has no numeric code, so we keep
 * retrying inside the window. Either way Phase 2 provides the safety net.
 */
function serverResponded(err: unknown): boolean {
  return err !== null && typeof (err as { code?: unknown }).code === "number";
}

/**
 * Arm resilience on a freshly (re)connected room: persist its token, take over
 * the reconnect loop from the SDK, and route its next close through us. Called on
 * the initial join AND after every reconnect.
 */
export function attachResilience(room: Room<WorldState>): void {
  saveToken(room.reconnectionToken);
  // Own the loop: disable the SDK's built-in auto-reconnect so every close is a
  // single, classifiable onLeave with the original code.
  room.reconnection.enabled = false;
  room.onLeave((code: number) => handleLeave(room, code));
}

/** True while recovering — read each frame (no subscribe) to suspend input. */
export function isInputSuspended(): boolean {
  return useAppStore.getState().reconnecting;
}

function handleLeave(leftRoom: Room<WorldState>, code: number): void {
  // Ignore a superseded room's late close (getRoom already moved on).
  if (getRoom() !== leftRoom) return;

  if (reconnecting) {
    // A close DURING active recovery: the room we just adopted flapped again
    // before we could confirm it. Do NOT drop it (that stranded the user in a
    // zombie world — F4) and do NOT start a second overlapping reconnect: abort
    // the in-flight confirm wait so the current loop simply tries again.
    abortConfirm?.();
    return;
  }

  const decision = decideLeave(code, wasKicked());
  if (decision.action === "entry") {
    if (decision.kick) {
      markKicked(); // honor Task 9's no-reconnect seam
      clearToken();
    }
    forgetAdminCode(); // leaving the world drops the session admin secret
    setRoom(null);
    useAppStore.getState().leaveToEntry(decision.notice);
    return;
  }

  void startReconnect();
}

async function startReconnect(): Promise<void> {
  if (reconnecting) return;
  reconnecting = true;
  setRoom(null); // stop sends to the dead room while we recover
  const store = useAppStore.getState();
  store.setReconnecting(true); // "재연결 중..." overlay + input suspension

  try {
    // Phase 1 — same avatar within the window.
    if (await phaseTokenReconnect()) return;
    // Phase 2 — fresh avatar (server restarted / window expired).
    const outcome = await phaseFreshJoin();
    if (outcome.status === "connected") return;
    // Terminal → entry with the chosen notice (capacity if genuinely full, the
    // real Korean reason for a deterministic rejection, else generic failure).
    forgetAdminCode();
    store.leaveToEntry(outcome.notice);
  } catch {
    // Defensive: never strand the user on an unexpected error.
    forgetAdminCode();
    store.leaveToEntry(FAILED_NOTICE);
  } finally {
    store.setReconnecting(false);
    reconnecting = false;
  }
}

/**
 * Adopt a freshly (re)connected room and wait for our player to appear — arming
 * OUR onLeave and disabling the SDK's auto-reconnect BEFORE the wait (mirrors
 * joinWorld). If the room closes DURING the wait (a second drop on a flaky
 * network — the exact case that used to strand into a zombie world), the armed
 * onLeave aborts this wait via `abortConfirm` so the recovery loop retries
 * instead of adopting a room the SDK is already tearing down (F4).
 */
async function adoptAndConfirm(room: Room<WorldState>): Promise<void> {
  setRoom(room);
  attachResilience(room); // arm onLeave + disable SDK loop BEFORE waiting
  let settled = false;
  const finish = () => {
    settled = true;
    abortConfirm = null;
  };
  await new Promise<void>((resolve, reject) => {
    abortConfirm = () => {
      if (settled) return;
      finish();
      reject(new Error(CLOSED_DURING_RECOVERY));
    };
    void waitForSelf(room).then(() => {
      if (settled) return;
      finish();
      resolve();
    });
  });
}

/** Phase 1: re-establish the same session with the persisted token. */
async function phaseTokenReconnect(): Promise<boolean> {
  if (!loadToken()) return false; // nothing to resume → straight to a fresh join

  const deadline = Date.now() + RECONNECT_WINDOW_S * 1000;
  while (Date.now() < deadline) {
    // Re-read each attempt: adoptAndConfirm persists the freshest reconnection
    // token, so a second drop mid-recovery resumes with the current one.
    const token = loadToken();
    if (!token) return false;
    try {
      const room = (await client.reconnect<WorldState>(token)) as Room<WorldState>;
      await adoptAndConfirm(room); // adopt + arm onLeave BEFORE the confirm wait
      onReconnected(room); // Phase 1 keeps server userData → admin preserved
      return true;
    } catch (err) {
      // Server reachable but token rejected (it restarted) → give up on the
      // token now and let Phase 2 fresh-join. A close-during-recovery abort or an
      // unreachable server has no numeric code → keep trying until the window
      // closes.
      if (serverResponded(err)) return false;
      await sleep(TOKEN_RETRY_MS);
    }
  }
  return false;
}

/** How Phase 2 ended: recovered, or exhausted/rejected with a terminal notice. */
type FreshJoinOutcome = { status: "connected" } | { status: "terminal"; notice: string };

/**
 * Phase 2: silent fresh join with cached identity + exponential backoff.
 *
 * Retry policy (D2): a 521 "no rooms found" and transient/network failures are
 * retried through the backoff (the singleton world may still be re-creating in
 * the server's boot window). A DETERMINISTIC server rejection (a Korean reason:
 * denySet kick, nickname rule, bad cached identity) can never succeed, so it is
 * NOT retried — we surface the real reason immediately instead of hammering it
 * for ~31s behind the overlay and then showing a misleading generic notice.
 *
 * Admin (F5): if this session authenticated as admin, its code is held in module
 * memory and re-sent so a server restart preserves the instructor's powers. A
 * REJECTED code (server restarted with a different/unset ADMIN_CODE) falls back
 * to a normal-user join — it must not fail recovery.
 */
async function phaseFreshJoin(): Promise<FreshJoinOutcome> {
  const identity = loadIdentity();
  const baseParams = {
    nickname: identity.nickname,
    character: identity.character,
    tint: identity.tint,
  };

  // Whether the room we finally adopt is an authenticated admin join. A join that
  // SUPPLIED a code and SUCCEEDED proves the code was correct (a wrong code is
  // rejected server-side), mirroring the entry-screen inference.
  let grantedAdmin = false;
  let adminFellBack = false; // set once a resent code was rejected → stop retrying it

  try {
    const room = await retryWhile<Room<WorldState>>({
      attempt: async () => {
        const code = getAdminCode();
        if (code !== null && !adminFellBack) {
          try {
            const r = await joinRoom({ ...baseParams, adminCode: code });
            grantedAdmin = true;
            await adoptAndConfirm(r);
            return r;
          } catch (err) {
            // A transient/capacity failure: retry the whole attempt (still as
            // admin next time). A DETERMINISTIC rejection of the admin join: the
            // code (or the identity) was refused — drop the code and fall through
            // to a normal-user join so recovery is preserved (F5). If the reason
            // was actually the identity, the non-admin join fails the same way
            // and that real reason becomes terminal below.
            if (!isDeterministicRejection(err)) throw err;
            adminFellBack = true;
            forgetAdminCode();
            grantedAdmin = false;
          }
        }
        const r = await joinRoom(baseParams);
        grantedAdmin = false;
        await adoptAndConfirm(r);
        return r;
      },
      shouldRetry: shouldRetryFreshJoin,
      delaysMs: reconnectBackoffMs(),
      sleep,
    });
    onReconnected(room, grantedAdmin);
    return { status: "connected" };
  } catch (err) {
    // Terminal. A deterministic/capacity error → the real Korean reason (denied,
    // kicked, full); a network exhaustion → the generic failure notice.
    const notice =
      isCapacityError(err) || isDeterministicRejection(err)
        ? joinErrorNotice(err)
        : FAILED_NOTICE;
    return { status: "terminal", notice };
  }
}

/** Resume the world on a (re)connected room already adopted by adoptAndConfirm. */
function onReconnected(room: Room<WorldState>, isAdmin?: boolean): void {
  // setRoom + attachResilience were done by adoptAndConfirm (before the wait).
  // Bump the epoch → WorldScene remounts on the new room (remote store rebuilt
  // clean); adopt the (possibly new) sessionId; reconcile admin (undefined =
  // preserve for a token reconnect); hide the overlay + resume input.
  useAppStore.getState().reconnected(room.sessionId, isAdmin);
}
