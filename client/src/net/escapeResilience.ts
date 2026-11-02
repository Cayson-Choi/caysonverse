/**
 * The team classroom's (EscapeRoom's) connection-loss driver — the classroom twin of
 * resilience.ts, for the connection that is open ON TOP of the class connection.
 *
 * Like the main driver it switches the SDK's own reconnect loop off
 * (`room.reconnection.enabled = false`), so every close arrives once at our onLeave with its
 * original code, and `decideEscapeLeave` (pure) classifies it:
 *   - kicked (4101): the teacher's kick — the class connection is closed with it too and its
 *     driver goes to the entry screen; here we only drop the classroom;
 *   - ended (4102, the class ended): back to the hall (the class closes shortly after);
 *   - closed (a clean server-side close): back to the hall with ESCAPE_LOST_NOTICE;
 *   - recover (a drop, an error, a server restart 4001):
 *       Phase 1 — the SAME session with the room's reconnection token, retried for
 *         RECONNECT_WINDOW_S (the server holds the seat that long); a server that answers but
 *         refuses the token skips to Phase 2;
 *       Phase 2 — ask the class for a new ticket (`ClassMsg.EscapeRejoin`, answered only while
 *         the class still has us inside) and wait ESCAPE_TICKET_WAIT_MS for it; the ticket is
 *         handled by classSync like any other (joinEscape → enterEscape), which ends this
 *         recovery. A second ask waits ESCAPE_REJOIN_GAP_MS (the server answers one per 2 s);
 *       otherwise → leave it and `exitEscape("교실 연결이 끊겨 복도로 돌아왔어요.")`.
 * During a recovery the dead room stays the current classroom handle, so the player's sends go
 * nowhere (never into the hall chat), and the "재연결 중..." overlay shows (escapeReconnecting).
 * A deliberate leave or a newer classroom session cancels a running recovery
 * (`cancelEscapeRecovery`, called by leaveEscape / joinEscape).
 */

import type { Room } from "@colyseus/sdk";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { EscapeState } from "@caysonverse/shared/schema";
import { RECONNECT_WINDOW_S } from "@caysonverse/shared/constants";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import {
  adoptEscapeRoom,
  client,
  escapeJoinPending,
  getEscapeRoom,
  getRoom,
  leaveEscape,
  sendClass,
  waitForSelf,
} from "./connection";
import { decideEscapeLeave, serverResponded, ESCAPE_LOST_NOTICE } from "./reconnectPolicy";
import { markKicked, wasKicked } from "./kickSeam";
import { useAppStore } from "../stores/appStore";

/** How long Phase 2 waits for a new ticket after asking. */
export const ESCAPE_TICKET_WAIT_MS = 5000;
/** Gap between two EscapeRejoin asks — over the server's 2 s one-ticket-per-session gap. */
export const ESCAPE_REJOIN_GAP_MS = 2500;
/** How often to retry the token while the server is unreachable. */
const TOKEN_RETRY_MS = 1000;
/** Phase 2's polling step (a classroom join in flight, the class connection back). */
const POLL_MS = 100;
/** A classroom join that started before the deadline may take this much longer to finish. */
const JOIN_SETTLE_MAX_MS = 10_000;
/** Thrown into the confirm wait when the just-adopted room closes again (no numeric code → retry). */
const CLOSED_DURING_RECOVERY = "cv:escape-closed-during-recovery";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The reconnection token of the current classroom session (module memory only). */
let escapeToken: string | null = null;
/** Id of the running recovery (null = none); a cancel clears it and the loop stops. */
let activeRecovery: number | null = null;
let recoveryCount = 0;
/** Aborts the confirm wait of a room adopted mid-recovery that closed again. */
let abortConfirm: (() => void) | null = null;

/** Arm a freshly (re)joined classroom room: own the reconnect loop, route its close through us. */
export function attachEscapeResilience(room: Room<EscapeState>): void {
  escapeToken = room.reconnectionToken;
  room.reconnection.enabled = false;
  room.onLeave((code: number) => handleEscapeLeave(room, code));
}

/** True while the classroom connection is being recovered. */
export function isEscapeRecovering(): boolean {
  return activeRecovery !== null;
}

/** Stop a running recovery (the player left on purpose, or a newer session took over). */
export function cancelEscapeRecovery(): void {
  if (activeRecovery === null) return;
  activeRecovery = null;
  const abort = abortConfirm;
  abortConfirm = null;
  abort?.();
  useAppStore.getState().setEscapeReconnecting(false);
}

function handleEscapeLeave(left: Room<EscapeState>, code: number): void {
  // A superseded session, or one we left ourselves (leaveEscape forgets it first): not ours to handle.
  if (getEscapeRoom() !== left) return;

  if (activeRecovery !== null) {
    // The room this recovery just adopted closed again before it was confirmed: let the loop retry.
    abortConfirm?.();
    return;
  }

  switch (decideEscapeLeave(code, wasKicked())) {
    case "kicked":
      markKicked(); // never auto-rejoin; the class connection's kick moves the screen to the entry
      void leaveEscape();
      return;
    case "ended":
      void leaveEscape();
      useAppStore.getState().exitEscape();
      return;
    case "closed":
      void leaveEscape();
      useAppStore.getState().exitEscape(ESCAPE_LOST_NOTICE);
      return;
    case "recover":
      void recoverEscape();
      return;
  }
}

async function recoverEscape(): Promise<void> {
  if (activeRecovery !== null) return;
  const id = ++recoveryCount;
  activeRecovery = id;
  const live = (): boolean => activeRecovery === id;
  useAppStore.getState().setEscapeReconnecting(true);

  try {
    let restored = false;
    try {
      restored = await phaseToken(live);
      if (!restored && live()) await phaseTicket(live);
    } catch {
      /* fall through: give up below if still ours */
    }
    if (!live()) return; // cancelled: a ticket's join took over, or the player left on purpose
    activeRecovery = null;
    if (restored) {
      useAppStore.getState().enterEscape(); // remount the classroom on the restored session
      return;
    }
    // Nothing worked: back to the corridor (the class connection is still there).
    void leaveEscape();
    useAppStore.getState().exitEscape(ESCAPE_LOST_NOTICE);
  } finally {
    if (activeRecovery === id) activeRecovery = null;
    // Clear the overlay half unless a newer recovery has started meanwhile.
    if (activeRecovery === null) useAppStore.getState().setEscapeReconnecting(false);
  }
}

/** Adopt a reconnected room and wait for our player; abortable if the room closes meanwhile. */
async function adoptAndConfirm(room: Room<EscapeState>): Promise<void> {
  adoptEscapeRoom(room); // arm + sync BEFORE waiting (Content arrives right after the join)
  let settled = false;
  await new Promise<void>((resolve, reject) => {
    abortConfirm = () => {
      if (settled) return;
      settled = true;
      abortConfirm = null;
      reject(new Error(CLOSED_DURING_RECOVERY));
    };
    void waitForSelf(room).then(() => {
      if (settled) return;
      settled = true;
      abortConfirm = null;
      resolve();
    });
  });
}

/** Phase 1: the same session by its reconnection token, within the server's window. */
async function phaseToken(live: () => boolean): Promise<boolean> {
  const deadline = Date.now() + RECONNECT_WINDOW_S * 1000;
  while (live() && Date.now() < deadline) {
    const token = escapeToken; // re-read: an adopted-then-dropped room left a fresher one
    if (!token) return false;
    try {
      const room = (await client.reconnect<EscapeState>(token)) as Room<EscapeState>;
      if (!live()) {
        void room.leave(true).catch(() => undefined);
        return false;
      }
      await adoptAndConfirm(room);
      return true;
    } catch (err) {
      if (!live()) return false;
      // The server answered but refused the token (restarted, or the window closed): Phase 2.
      if (serverResponded(err)) return false;
      await sleep(TOKEN_RETRY_MS);
    }
  }
  return false;
}

/**
 * Phase 2: ask the class for a new ticket and wait. Returns when this recovery is cancelled (a
 * ticket's join took over) or the wait is over. A join already in flight at the deadline is
 * waited for (bounded), so the screen does not flick to the hall and back.
 */
async function phaseTicket(live: () => boolean): Promise<void> {
  const deadline = Date.now() + ESCAPE_TICKET_WAIT_MS;
  let askedAt = Number.NEGATIVE_INFINITY;
  while (live()) {
    const now = Date.now();
    if (escapeJoinPending()) {
      if (now >= deadline + JOIN_SETTLE_MAX_MS) return;
    } else {
      if (now >= deadline) return;
      // Only through a live class connection (null while the class itself is reconnecting).
      if (getRoom() !== null && now - askedAt >= ESCAPE_REJOIN_GAP_MS) {
        sendClass(ClassMsg.EscapeRejoin, {});
        askedAt = now;
      }
    }
    await sleep(POLL_MS);
  }
}
