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
 *     is EXPECTED (no DB). A 521 ("no rooms found") is NOT treated as terminal
 *     capacity here — the room may still be re-creating in the server's boot window
 *     (mass reconnect after a restart lands exactly there), so it is RETRIED through
 *     the same backoff like any other failure.
 *   Exhausted → entry screen with a notice chosen from the LAST error: the capacity
 *     notice only if that final error was capacity-shaped (the world really is full),
 *     otherwise the generic failure notice.
 *
 * Every successful (re)connection produces a NEW room; `onReconnected` swaps the
 * room handle, re-arms resilience, and bumps the connection epoch so the scene
 * REMOUNTS and rebinds (remote store rebuilt clean — no duplicate avatars).
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
  CAPACITY_NOTICE,
  FAILED_NOTICE,
} from "./reconnectPolicy";
import { loadIdentity } from "./identityCache";
import { wasKicked, markKicked } from "./kickSeam";
import { useAppStore } from "../stores/appStore";

/** sessionStorage key for the room reconnection token (scoped to this tab). */
const TOKEN_KEY = "cv.reconnectToken";
/** How often to retry the token reconnect while the server is unreachable. */
const TOKEN_RETRY_MS = 1000;

/** Guards against overlapping reconnect loops (one recovery at a time). */
let reconnecting = false;

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
  // Ignore a superseded room's late close, or a close during active recovery.
  if (getRoom() !== leftRoom) return;
  if (reconnecting) return;

  const decision = decideLeave(code, wasKicked());
  if (decision.action === "entry") {
    if (decision.kick) {
      markKicked(); // honor Task 9's no-reconnect seam
      clearToken();
    }
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
    if (outcome === "connected") return;
    // Budget spent: capacity notice only if the world is genuinely full, else
    // the generic failure notice.
    store.leaveToEntry(outcome === "capacity" ? CAPACITY_NOTICE : FAILED_NOTICE);
  } catch {
    // Defensive: never strand the user on an unexpected error.
    store.leaveToEntry(FAILED_NOTICE);
  } finally {
    store.setReconnecting(false);
    reconnecting = false;
  }
}

/** Phase 1: re-establish the same session with the persisted token. */
async function phaseTokenReconnect(): Promise<boolean> {
  const token = loadToken();
  if (!token) return false; // nothing to resume → straight to a fresh join

  const deadline = Date.now() + RECONNECT_WINDOW_S * 1000;
  while (Date.now() < deadline) {
    try {
      const room = (await client.reconnect<WorldState>(token)) as Room<WorldState>;
      await waitForSelf(room);
      onReconnected(room);
      return true;
    } catch (err) {
      // Server reachable but token rejected (it restarted) → give up on the
      // token now and let Phase 2 fresh-join. Otherwise (unreachable) keep
      // trying until the window closes.
      if (serverResponded(err)) return false;
      await sleep(TOKEN_RETRY_MS);
    }
  }
  return false;
}

/** How Phase 2 ended: recovered, exhausted-because-full, or exhausted-otherwise. */
type FreshJoinOutcome = "connected" | "capacity" | "failed";

/**
 * Phase 2: silent fresh join with cached identity + exponential backoff. EVERY
 * failure (including a 521 "no rooms found") is retried through the backoff — a
 * 521 may just mean the singleton world is still re-creating in the server's boot
 * window, not that it is full. Only once the budget is spent do we decide the
 * notice from the LAST error: `capacity` if it was capacity-shaped (really full),
 * else `failed`.
 */
async function phaseFreshJoin(): Promise<FreshJoinOutcome> {
  const identity = loadIdentity();
  const params = {
    nickname: identity.nickname,
    character: identity.character,
    tint: identity.tint,
  };

  try {
    const room = await retryWhile({
      attempt: () => joinRoom(params),
      shouldRetry: () => true, // retry every failure through the backoff
      delaysMs: reconnectBackoffMs(),
      sleep,
    });
    await waitForSelf(room);
    onReconnected(room);
    return "connected";
  } catch (err) {
    return isCapacityError(err) ? "capacity" : "failed";
  }
}

/** Adopt a (re)connected room and resume the world. */
function onReconnected(room: Room<WorldState>): void {
  setRoom(room);
  attachResilience(room); // re-persist token, re-arm onLeave, disable SDK loop
  // Bump the epoch → WorldScene remounts on the new room (remote store rebuilt
  // clean); adopt the (possibly new) sessionId; hide the overlay + resume input.
  useAppStore.getState().reconnected(room.sessionId);
}
