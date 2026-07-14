import { Client, Room } from "@colyseus/sdk";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators and must never enter the
// browser bundle. We only borrow WorldState's shape for typing the room state.
import type { WorldState } from "@caysonverse/shared/schema";
import { WORLD_ROOM, CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type { MovePayload } from "@caysonverse/shared/messages";
import { SERVER_URL } from "./endpoint";
import { useAppStore } from "../stores/appStore";
import { leaveAction } from "./leaveAction";
import { markKicked } from "./kickSeam";

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

const client = new Client(SERVER_URL);

// Module-level room handle — NOT React state. The scene reads it via getRoom().
let room: Room<WorldState> | null = null;

/** The currently joined world room, or null when not connected. */
export function getRoom(): Room<WorldState> | null {
  return room;
}

/**
 * Join (or create) the world room. Resolves once our own player exists in the
 * synced state (so the caller can read the authoritative spawn). Rejects with an
 * Error whose message is user-facing Korean — the server's rejection string when
 * available, otherwise a generic connection-failure message.
 */
export async function joinWorld(params: JoinParams): Promise<Room<WorldState>> {
  let joined: Room<WorldState>;
  try {
    joined = await client.joinOrCreate<WorldState>(WORLD_ROOM, params);
  } catch (err) {
    throw new Error(toKoreanJoinError(err));
  }

  room = joined;
  await waitForSelf(joined);
  registerLeaveHandler(joined);
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
 * `joinOrCreate` can resolve a tick before the first state patch arrives. Wait
 * (briefly) for our player so the caller reads the real spawn, not a default.
 */
function waitForSelf(r: Room<WorldState>): Promise<void> {
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

/**
 * Return the user to the entry screen if the room ever drops (kick / server
 * down). The leave CODE decides the UX (see leaveAction): code 4001 is an
 * admin kick — show the kick notice and persist the no-reconnect seam so Task
 * 11's reconnection logic honors it; any other code is an ordinary disconnect.
 * Full reconnection UX is Task 11 — here we only avoid stranding the user.
 */
function registerLeaveHandler(joined: Room<WorldState>): void {
  joined.onLeave((code: number) => {
    if (room !== joined) return; // superseded by a newer join
    room = null;
    const action = leaveAction(code);
    // Kick seam for Task 11: mark the session so auto-reconnection is refused.
    if (action.blockReconnect) markKicked();
    useAppStore.getState().leaveToEntry(action.notice);
  });
}

// Hangul range — used to tell a server-authored Korean rejection apart from a
// low-level network error (whose message would be unhelpful English).
const HANGUL = /[가-힣]/;

function toKoreanJoinError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message && HANGUL.test(message)) return message;
  return "서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.";
}
