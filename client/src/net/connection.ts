import { Client, Room } from "@colyseus/sdk";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators and must never enter the
// browser bundle. We only borrow WorldState's shape for typing the room state.
import type { WorldState } from "@caysonverse/shared/schema";
import { WORLD_ROOM, CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type { MovePayload } from "@caysonverse/shared/messages";
import { SERVER_URL } from "./endpoint";
import { joinErrorNotice, isCapacityError } from "./reconnectPolicy";
import { retryWhile } from "./joinRetry";
import { attachResilience } from "./resilience";

/**
 * Bounded retry for the INITIAL join only (named in one place). A 521 "no rooms
 * found" at entry can mean the server is still in its boot window — the transport
 * accepts matchmake requests a sub-ms before `matchMaker.createRoom(WORLD_ROOM)`
 * resolves (see server/src/index.ts), and a mass reconnect after a restart is
 * exactly when a click lands there. So retry a 521 a couple of times, ~700ms
 * apart, before concluding the world is full. Its length is the retry count (2).
 * NON-capacity errors (nickname rejection, network failure) are NOT retried.
 */
const INITIAL_JOIN_RETRY_DELAYS_MS = [700, 700];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Options sent to the server's `onJoin` (validated there against the contract). */
export interface JoinParams {
  nickname: string;
  character: number;
  tint: number;
  /**
   * Optional admin code (instructor). Sent verbatim to the server, which is the
   * ONLY place it is compared — it is never checked or stored in the client. An
   * empty/absent value joins as a normal user.
   */
  adminCode?: string;
}

/** The one SDK client. Shared with the resilience driver (reconnect/re-join). */
export const client = new Client(SERVER_URL);

// Module-level room handle — NOT React state. The scene reads it via getRoom().
let room: Room<WorldState> | null = null;

/** The currently joined world room, or null when not connected/reconnecting. */
export function getRoom(): Room<WorldState> | null {
  return room;
}

/** Swap the active room handle (used by the resilience driver on reconnect). */
export function setRoom(next: Room<WorldState> | null): void {
  room = next;
}

/**
 * Raw join of the ONE shared world room — join-existing-only (NEVER joinOrCreate).
 * The room is pre-created at server boot and never auto-disposes, so this always
 * targets the single canonical world. If it is full/locked, matchmaking rejects
 * (it will NOT spawn a second room), and the caller maps that to the capacity
 * notice. Throws the SDK's native error (the caller maps it).
 */
export function joinRoom(params: JoinParams): Promise<Room<WorldState>> {
  return client.join<WorldState>(WORLD_ROOM, params);
}

/**
 * Join the world room from the entry screen. Resolves once our own player exists
 * in the synced state (so the caller can read the authoritative spawn). Rejects
 * with an Error whose message is user-facing Korean — the server's rejection
 * string when available, the capacity notice for a full room, else a generic
 * connection-failure message.
 *
 * Resilience is attached BEFORE the join-wait: a drop during `waitForSelf` (up
 * to 2s) is then handled by the reconnection driver rather than stranding the
 * user on a dead canvas (closes the Task 4 [task4-m5] gap).
 *
 * A 521 is retried a bounded number of times (INITIAL_JOIN_RETRY_DELAYS_MS) to
 * ride out the server boot window; only if it persists do we surface the capacity
 * notice. Other errors (nickname rejection etc.) surface immediately.
 */
export async function joinWorld(params: JoinParams): Promise<Room<WorldState>> {
  let joined: Room<WorldState>;
  try {
    joined = await retryWhile({
      attempt: () => joinRoom(params),
      shouldRetry: isCapacityError,
      delaysMs: INITIAL_JOIN_RETRY_DELAYS_MS,
      sleep,
    });
  } catch (err) {
    throw new Error(joinErrorNotice(err));
  }

  setRoom(joined);
  attachResilience(joined);
  await waitForSelf(joined);
  return joined;
}

/** Send a throttled position update. No-op if not connected. */
export function sendMove(payload: MovePayload): void {
  room?.send(MessageType.Move, payload);
}

/**
 * Send a chat line. Pre-trimmed to CHAT_MAX_LENGTH (the server re-validates and
 * is authoritative). No-op if not connected or the trimmed text is empty.
 */
export function sendChat(text: string): void {
  const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
  if (trimmed.length === 0) return;
  room?.send(MessageType.Chat, { text: trimmed });
}

/**
 * Send an emoji reaction (index into EMOJIS). No-op if not connected; the
 * server re-validates the index and is authoritative on the rate cap.
 */
export function sendEmoji(index: number): void {
  room?.send(MessageType.Emoji, { index });
}

/**
 * Request to sit on `seatIndex`. No-op if not connected; the server is
 * authoritative — it validates range/reach/occupancy and confirms by syncing the
 * player's `seatIndex` (the client never self-declares seated).
 */
export function sendSit(seatIndex: number): void {
  room?.send(MessageType.Sit, { seatIndex });
}

/** Request to stand up. No-op if not connected; the server drops it unless seated. */
export function sendStand(): void {
  room?.send(MessageType.Stand, {});
}

/**
 * Admin: set (or clear) the announcement banner. An empty/whitespace `text`
 * clears it — that is intentional and handled server-side. No-op if not
 * connected; the server drops the message unless this connection is admin.
 */
export function sendAnnounce(text: string): void {
  room?.send(MessageType.Announce, { text });
}

/**
 * Admin: kick the player owning `sid`. No-op if not connected; the server drops
 * the message unless this connection is admin, and refuses self-kicks.
 */
export function sendKick(sid: string): void {
  room?.send(MessageType.Kick, { sid });
}

/**
 * True once the server has placed our player in the synced state. Null-safe:
 * `joinOrCreate` can resolve before the reflection-decoded `state.players`
 * MapSchema exists, so we must not assume the shape is ready yet.
 */
function hasSelf(r: Room<WorldState>): boolean {
  return r.state?.players?.get?.(r.sessionId) !== undefined;
}

/**
 * `joinOrCreate`/`reconnect` can resolve a tick before the first state patch
 * arrives. Wait (briefly) for our player so the caller reads the real spawn, not
 * a default. Exported so the resilience driver reuses the exact same gate.
 */
export function waitForSelf(r: Room<WorldState>): Promise<void> {
  if (hasSelf(r)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (!hasSelf(r)) return;
      r.onStateChange.remove(done);
      clearTimeout(timer);
      resolve();
    };
    // Fallback so a missed patch never strands the join promise.
    const timer = setTimeout(() => {
      r.onStateChange.remove(done);
      resolve();
    }, 2000);
    r.onStateChange(done);
  });
}

// Best-effort CONSENTED leave on a deliberate tab close / navigation, so the
// server removes the player immediately instead of holding a 20s ghost window.
// `pagehide` (not `beforeunload`) fires on mobile too; the send is best-effort.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    // Consented leave → server `onLeave` removes at once (no reconnection window).
    void room?.leave(true);
  });
}
