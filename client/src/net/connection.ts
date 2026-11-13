import { Client, Room } from "@colyseus/sdk";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators and must never enter the
// browser bundle. We only borrow the state's shape for typing the room.
import type { WorldState } from "@caysonverse/shared/schema";
import { VILLAGE_ROOM, CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type { MovePayload } from "@caysonverse/shared/messages";
import { recordSentMove } from "../game/sentMoves";
import type { Appearance } from "@caysonverse/shared/appearance";
import { VillageMsg } from "@caysonverse/shared/village/messages";
import type { FishingEmptyPayload } from "@caysonverse/shared/village/messages";
import { SERVER_URL } from "./endpoint";
import { joinErrorNotice } from "./reconnectPolicy";
import { attachResilience } from "./resilience";

/** Options of a village (케이슨 마을) join: validated server-side against the join contract (no admin code). */
export interface VillageJoinParams {
  nickname: string;
  /** The 15 appearance fields (server rejects anything else with APPEARANCE_ERROR). */
  appearance: Appearance;
}

/** The one SDK client. Shared with the resilience driver (reconnect/re-join). */
export const client = new Client(SERVER_URL);

// Module-level room handle — NOT React state. Scenes read it via getRoom().
let room: Room<WorldState> | null = null;

/** The village room, or null when not connected/reconnecting. */
export function getRoom(): Room<WorldState> | null {
  return room;
}

/** Swap the room handle (used by the resilience driver on reconnect). */
export function setRoom(next: Room<WorldState> | null): void {
  room = next;
}

/** The room the player is in — the village room; chat / emoji / typing sync bind to this name. */
export function getActiveRoom(): Room<WorldState> | null {
  return room;
}

/** The options the village's `onJoin` reads: exactly nickname and appearance (never an admin code). */
function villageJoinOptions(p: VillageJoinParams): VillageJoinParams {
  return { nickname: p.nickname, appearance: p.appearance };
}

/**
 * Raw join of a village room: `joinOrCreate` — the village is NOT a singleton. Rooms are created on
 * demand (30 per room, VILLAGE_MAX_CLIENTS) and a full room is locked, so the next visitor lands in
 * a new one; there is no "world is full" refusal to retry. Throws the SDK's native error (the
 * caller maps it). Used by joinVillage and by the resilience driver's Phase-2 rejoin.
 */
export function joinVillageRoom(params: VillageJoinParams): Promise<Room<WorldState>> {
  return client.joinOrCreate<WorldState>(VILLAGE_ROOM, villageJoinOptions(params));
}

/**
 * Join 케이슨 마을 from the entry screen (the default 입장하기). Adopt the
 * room, arm the resilience BEFORE the join-wait (a drop during it is then recovered, not stranded),
 * resolve once our own player exists in the synced state. Rejects with an Error whose message is
 * user-facing Korean (the server's rejection string — e.g. the nickname rule — else the generic
 * connection-failure notice). No 521 retry: `joinOrCreate` makes a room instead of reporting none.
 */
export async function joinVillage(params: VillageJoinParams): Promise<Room<WorldState>> {
  let joined: Room<WorldState>;
  try {
    joined = await joinVillageRoom(params);
  } catch (err) {
    throw new Error(joinErrorNotice(err));
  }

  setRoom(joined);
  attachResilience(joined);
  await waitForSelf(joined);
  return joined;
}

/**
 * Use the door at hand in 케이슨 마을: the memorial hall's front door, or the way out from inside. The message
 * carries no data; the server checks the distance to the door and a 1-per-second cap and silently drops anything
 * else. No-op unless this tab is in the village.
 */
export function sendUseDoor(): void {
  if (!room) return;
  room?.send(VillageMsg.UseDoor, {});
}

/** Submit a house keypad code; the server validates the authoritative position and never receives a reusable credential. */
export function sendKeypad(buildingId: string, code: string): void {
  if (!room) return;
  room?.send(VillageMsg.Keypad, { buildingId, code });
}

/**
 * 케이슨 마을 (Task 9): light a candle in a memorial cubby. The server checks that we are in the hall within 1.5 m of
 * it and a 1-per-5-seconds cap, then tells everyone in the hall (`CandleLit`); anything else is dropped silently.
 * No-op unless this tab is in the village.
 */
export function sendLightCandle(cubby: string): void {
  if (!room) return;
  room?.send(VillageMsg.LightCandle, { cubby });
}

/** Rent the session's rod. The server validates the player's authoritative position at the kiosk. */
export function sendFishingRentRod(): void {
  if (!room) return;
  const payload: FishingEmptyPayload = {};
  room?.send(VillageMsg.FishingRentRod, payload);
}

/** Cast at the pond. The server chooses the bite time and owns the bobber phase. */
export function sendFishingCast(): void {
  if (!room) return;
  const payload: FishingEmptyPayload = {};
  room?.send(VillageMsg.FishingCast, payload);
}

/** Pull the line. A catch is possible only while the server reports a submerged bobber. */
export function sendFishingReel(): void {
  if (!room) return;
  const payload: FishingEmptyPayload = {};
  room?.send(VillageMsg.FishingReel, payload);
}

// ─────────────────────────── Player messages: the ACTIVE room ───────────────────────────

/**
 * Send a throttled position update to the active room. No-op if not connected. Each sent pose is remembered by
 * its stamp, so the self-correction can compare the server's echo with where I was then (game/sentMoves.ts).
 */
export function sendMove(payload: MovePayload): void {
  const active = getActiveRoom();
  if (!active) return;
  recordSentMove(payload);
  active.send(MessageType.Move, payload);
}

/**
 * Send a chat line to the active room (village chat).
 * Pre-trimmed to CHAT_MAX_LENGTH (the server re-validates and is authoritative). No-op if not
 * connected or the trimmed text is empty.
 */
export function sendChat(text: string): void {
  const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
  if (trimmed.length === 0) return;
  getActiveRoom()?.send(MessageType.Chat, { text: trimmed });
}

/**
 * Send an emoji reaction (index into EMOJIS) to the active room. No-op if not connected; the
 * server re-validates the index and is authoritative on the rate cap.
 */
export function sendEmoji(index: number): void {
  getActiveRoom()?.send(MessageType.Emoji, { index });
}

/**
 * Tell the active room this client jumped (a broadcast EVENT, not state — y is
 * server-fixed). No-op if not connected. The server drops it when the sender is
 * seated or over the JUMP_RATE cap, so callers gate with `localJump` first.
 */
export function sendJump(): void {
  getActiveRoom()?.send(MessageType.Jump, {});
}

/**
 * Tell the active room this client started (`on: true`) or stopped (`on: false`) typing a
 * chat line (a broadcast EVENT, not state). No-op if not connected. The server drops
 * an ON over the TYPING_RATE cap and an OFF that has no ON before it, so callers go
 * through `createTypingSender`, which already follows both rules.
 */
export function sendTyping(on: boolean): void {
  getActiveRoom()?.send(MessageType.Typing, { on });
}

// ───────────────────────── Seating ─────────────────────────

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
 * What `waitForSelf` needs of a room — the village room fits it
 * (Room's own generic is invariant, so a structural shape instead of Room<…>).
 */
interface SelfWaitable {
  sessionId: string;
  readonly state: { players?: { get?(sid: string): unknown } } | undefined;
  onStateChange: ((cb: () => void) => unknown) & { remove(cb: () => void): void };
}

/**
 * True once the server has placed our player in the synced state. Null-safe:
 * `joinOrCreate` can resolve before the reflection-decoded `state.players`
 * MapSchema exists, so we must not assume the shape is ready yet.
 */
function hasSelf(r: SelfWaitable): boolean {
  return r.state?.players?.get?.(r.sessionId) !== undefined;
}

/**
 * `joinOrCreate`/`reconnect` can resolve a tick before the first state patch
 * arrives. Wait (briefly) for our player so the caller reads the real spawn, not
 * a default. Exported so the resilience drivers reuse the exact same gate.
 */
export function waitForSelf(r: SelfWaitable): Promise<void> {
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
 * Tab close / navigation (`pagehide`, which fires on mobile too): a best-effort CONSENTED leave, so the
 * server removes the player at once instead of holding a 20 s ghost window.
 */
export function handlePageHide(): void {
  void room?.leave(true);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", handlePageHide);
}
