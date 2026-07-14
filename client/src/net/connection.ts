import { Client, Room } from "@colyseus/sdk";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators and must never enter the
// browser bundle. We only borrow WorldState's shape for typing the room state.
import type { WorldState } from "@caysonverse/shared/schema";
import { WORLD_ROOM, CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type { MovePayload } from "@caysonverse/shared/messages";
import { SERVER_URL } from "./endpoint";
import { useAppStore } from "../stores/appStore";

/** Options sent to the server's `onJoin` (validated there against the contract). */
export interface JoinParams {
  nickname: string;
  character: number;
  tint: number;
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
 * Return the user to the entry screen if the room ever drops unexpectedly
 * (kick / server down). Full reconnection UX is Task 11 — here we only avoid
 * stranding the user on a dead canvas.
 */
function registerLeaveHandler(joined: Room<WorldState>): void {
  joined.onLeave(() => {
    if (room !== joined) return; // superseded by a newer join
    room = null;
    useAppStore.getState().leaveToEntry("서버와의 연결이 끊어졌습니다. 다시 입장해주세요.");
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
