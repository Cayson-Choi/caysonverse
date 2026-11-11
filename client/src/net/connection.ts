import { Client, Room } from "@colyseus/sdk";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators and must never enter the
// browser bundle. We only borrow the states' shapes for typing the rooms.
import type { ClassState, EscapeState, WorldState } from "@caysonverse/shared/schema";
import { WORLD_ROOM, VILLAGE_ROOM, CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type { MovePayload } from "@caysonverse/shared/messages";
import { recordSentMove } from "../game/sentMoves";
import type { Appearance } from "@caysonverse/shared/appearance";
import { CLASS_ROOM, type TextLevel } from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
import type { ClassPayloads, EscapePayloads } from "@caysonverse/shared/escape/messages";
import { VillageMsg } from "@caysonverse/shared/village/messages";
import type { FishingEmptyPayload } from "@caysonverse/shared/village/messages";
import { SERVER_URL } from "./endpoint";
import {
  joinErrorNotice,
  isCapacityError,
  classJoinErrorNotice,
  serverNoticeOr,
  CLASS_NOT_FOUND_NOTICE,
  FAILED_NOTICE,
} from "./reconnectPolicy";
import { retryWhile } from "./joinRetry";
import { attachResilience } from "./resilience";
import { attachEscapeResilience, cancelEscapeRecovery } from "./escapeResilience";
import { bindEscapeSync, unbindEscapeSync } from "./escapeSync";

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
  /** The 15 appearance fields (server rejects anything else with APPEARANCE_ERROR). */
  appearance: Appearance;
  /**
   * Optional admin code (instructor). Sent verbatim to the server, which is the
   * ONLY place it is compared — it is never checked or stored in the client. An
   * empty/absent value joins as a normal user.
   */
  adminCode?: string;
}

/**
 * Options of a village (케이슨 마을) join: the world's `nickname` + `appearance`, no admin code (the
 * village has no admin; VillageRoom validates the same contract and ignores nothing else).
 */
export type VillageJoinParams = Pick<JoinParams, "nickname" | "appearance">;

/**
 * Options of a class (반) join (ruling E5): the stage-3 join contract — nickname + NESTED
 * appearance, exactly as `JoinParams` — plus the class code and, for a teacher, the one-time
 * pass from `requestTeacherPass` (used once, never stored).
 */
export interface ClassJoinParams extends Omit<JoinParams, "adminCode"> {
  classCode: string;
  teacherPass?: string;
}

/** The kinds of main connection: 케이슨 마을, the legacy world, or a class (AI 학교 탈출). */
export type RoomMode = "village" | "world" | "class";

/** The one SDK client. Shared with the resilience driver (reconnect/re-join). */
export const client = new Client(SERVER_URL);

// Module-level room handles — NOT React state. Scenes read them via getRoom() / getEscapeRoom().
// `room` is the MAIN connection: the village, the legacy world or a class. A class room is held through the
// world type (ClassState extends WorldState; Room's generic is invariant, hence the casts where
// one is stored). `escapeRoom` is the team classroom, open ON TOP of the class connection.
let room: Room<WorldState> | null = null;
/** Which kind of main connection this tab has (set by joinVillage / joinWorld / joinClass). */
let roomMode: RoomMode = "world";
let escapeRoom: Room<EscapeState> | null = null;
/** Classroom joins in flight (escapeResilience waits for one instead of giving up mid-join). */
let escapeJoins = 0;

/** The main room (world or class), or null when not connected/reconnecting. */
export function getRoom(): Room<WorldState> | null {
  return room;
}

/** Which kind of main connection this tab has (the world unless the village or a class was joined). */
export function getRoomMode(): RoomMode {
  return roomMode;
}

/** Swap the main room handle (used by the resilience driver on reconnect). */
export function setRoom(next: Room<WorldState> | null): void {
  room = next;
}

/** The team classroom room, or null (in the hall, in the world). */
export function getEscapeRoom(): Room<EscapeState> | null {
  return escapeRoom;
}

/** Swap the classroom handle (a plain setter; `adoptEscapeRoom` also arms and syncs it). */
export function setEscapeRoom(next: Room<EscapeState> | null): void {
  escapeRoom = next;
}

/**
 * The room the player is IN — the classroom while one is open, else the main room. Player
 * messages (move, chat, emoji, jump, typing) go here, and the chat / emoji UI binds here
 * (ruling E13: hall chat in the hub, team chat in a classroom).
 *
 * Typed as the world room on purpose: its users (chat / typing / emoji sync) touch only the
 * player messages and `state.players`, which every player room (world, class, classroom) has —
 * a classroom's state has no `announcement`, so never read that through this handle.
 */
export function getActiveRoom(): Room<WorldState> | null {
  return (escapeRoom as unknown as Room<WorldState> | null) ?? room;
}

/** True while a classroom join is in flight. */
export function escapeJoinPending(): boolean {
  return escapeJoins > 0;
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
  roomMode = "world";
  attachResilience(joined);
  await waitForSelf(joined);
  return joined;
}

// ───────────────────────────────── 케이슨 마을 (the village) ─────────────────────────────────

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
 * Join 케이슨 마을 from the entry screen (the default 입장하기). Same shape as `joinWorld`: adopt the
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
  roomMode = "village";
  attachResilience(joined, "village");
  await waitForSelf(joined);
  return joined;
}

// ─────────────────────────────── Classes (AI 학교 탈출, Task 13) ───────────────────────────────

/**
 * A teacher-route failure: the server's Korean text (or FAILED_NOTICE) and the HTTP status
 * (0 = no answer). The status is deliberately NOT `code`: a proxy's HTTP 521/522 must never read
 * as the matchmaker's "no room" (reconnectPolicy.isCapacityError).
 */
export class TeacherPassError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TeacherPassError";
    this.status = status;
  }
}

/** A teacher-pass request that has not been answered after this long fails like no answer at all. */
export const TEACHER_PASS_TIMEOUT_MS = 10_000;

/** An abort signal that fires after `ms` (AbortSignal.timeout where the browser has it). */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * `POST /api/class/teacher`: verify the teacher key and open a new class (no `classCode`) or get a
 * pass for the LIVE class with that code (a teacher coming back after a reload, a co-teacher; the
 * server refuses a code with no live class). `reopen: true` is the restart recovery's own ask: it
 * re-opens the code when the server restarted. Resolves `{ classCode, pass }`; the pass goes into
 * ONE class join. Rejects with a TeacherPassError whose message is the server's Korean reason, else
 * FAILED_NOTICE (also when nothing answers within TEACHER_PASS_TIMEOUT_MS: status 0). The key
 * travels only in this body — it is never logged, stored, or put in a join option.
 */
export async function requestTeacherPass(body: {
  teacherKey: string;
  classCode?: string;
  textLevel?: TextLevel;
  reopen?: boolean;
}): Promise<{ classCode: string; pass: string }> {
  const payload: { teacherKey: string; classCode?: string; textLevel?: TextLevel; reopen?: true } = {
    teacherKey: body.teacherKey,
  };
  const code = body.classCode?.trim() ?? "";
  if (code !== "") payload.classCode = normalizeClassCode(code) ?? code; // a bad code: the server says why
  if (body.textLevel !== undefined) payload.textLevel = body.textLevel;
  if (body.reopen === true && code !== "") payload.reopen = true;

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/class/teacher`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: timeoutSignal(TEACHER_PASS_TIMEOUT_MS),
    });
  } catch {
    throw new TeacherPassError(FAILED_NOTICE, 0); // no answer, or none in time
  }
  const json = (await res.json().catch(() => null)) as { classCode?: unknown; pass?: unknown; error?: unknown } | null;
  if (res.ok) {
    const classCode = normalizeClassCode(json?.classCode);
    const pass = json?.pass;
    if (classCode !== null && typeof pass === "string" && pass !== "") return { classCode, pass };
    throw new TeacherPassError(FAILED_NOTICE, 500); // a 200 without the fields: a server fault
  }
  throw new TeacherPassError(serverNoticeOr(json?.error, FAILED_NOTICE), res.status);
}

/** A class's join options: canonical code, nickname, nested appearance, the pass only when given. */
function classJoinOptions(p: ClassJoinParams): ClassJoinParams {
  const classCode = normalizeClassCode(p.classCode);
  // The server's filter is exact: a code that can never match is refused here (no request).
  if (classCode === null) throw new Error(CLASS_NOT_FOUND_NOTICE);
  const options: ClassJoinParams = { classCode, nickname: p.nickname, appearance: p.appearance };
  if (p.teacherPass) options.teacherPass = p.teacherPass;
  return options;
}

/**
 * Raw class join (join-existing-only: a class exists only once the teacher route opened it).
 * Throws the SDK's native error (callers map it). Used by joinClass and by the resilience
 * driver's Phase-2 rejoin.
 */
export async function joinClassRoom(p: ClassJoinParams): Promise<Room<ClassState>> {
  return client.join<ClassState>(CLASS_ROOM, classJoinOptions(p));
}

/**
 * Join a class from the entry screen: `client.join(CLASS_ROOM, …)` → adopt (setRoom) → arm the
 * class resilience, which also starts the class sync (before any await: a takeover's ticket can
 * follow the join at once) → wait for our own player. Rejects with a user-facing Korean Error
 * (classJoinErrorNotice): no class with that code → CLASS_NOT_FOUND_NOTICE, the room's own
 * refusal as is. No 521 retry here: a wrong code should answer at once.
 */
export async function joinClass(p: ClassJoinParams): Promise<Room<ClassState>> {
  let joined: Room<ClassState>;
  try {
    joined = await joinClassRoom(p);
  } catch (err) {
    throw new Error(classJoinErrorNotice(err));
  }
  const asWorld = joined as unknown as Room<WorldState>;
  setRoom(asWorld);
  roomMode = "class";
  attachResilience(asWorld, "class");
  await waitForSelf(joined);
  return joined;
}

/** How long a consented leave is waited for: a room whose connection already closed never answers. */
const LEAVE_WAIT_MS = 3000;

/**
 * A consented leave that never throws and never hangs: it resolves when the server has closed
 * the connection, or after LEAVE_WAIT_MS (the SDK's promise never settles for a dead connection).
 */
function quietLeave(r: { leave(consented?: boolean): Promise<unknown> } | null): Promise<void> {
  if (!r) return Promise.resolve();
  let left: Promise<unknown>;
  try {
    left = r.leave(true);
  } catch {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, LEAVE_WAIT_MS);
    left.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/**
 * Make `next` THE classroom connection: adopt, arm its resilience (SDK auto-reconnect off, our
 * onLeave), start its sync — all before any await (the server sends Content right after a join).
 * A previous classroom session is left (consented); its late close is ignored (no longer current).
 */
export function adoptEscapeRoom(next: Room<EscapeState>): void {
  const previous = escapeRoom;
  escapeRoom = next;
  attachEscapeResilience(next);
  bindEscapeSync(next);
  if (previous !== null && previous !== next) void quietLeave(previous);
}

/**
 * Join the team classroom with a one-time ticket — ONLY by id (the escape room is private:
 * `joinById(roomId, { ticket })`, never matchmade by name). Rejects with a Korean Error: the
 * room's refusal as is ("입장권이 만료됐어요…"), anything else FAILED_NOTICE.
 */
export async function joinEscape(roomId: string, ticket: string): Promise<Room<EscapeState>> {
  escapeJoins++;
  try {
    let joined: Room<EscapeState>;
    try {
      joined = await client.joinById<EscapeState>(roomId, { ticket });
    } catch (err) {
      throw new Error(serverNoticeOr((err as { message?: unknown } | null)?.message, FAILED_NOTICE));
    }
    cancelEscapeRecovery(); // a new session supersedes any recovery of the old one
    adoptEscapeRoom(joined);
    await waitForSelf(joined);
    return joined;
  } finally {
    escapeJoins--;
  }
}

/**
 * Leave the team classroom (consented: the server reports it at once and puts the player back at
 * the door) and forget it. The caller moves the screen (`exitEscape`); the class connection stays.
 */
export async function leaveEscape(): Promise<void> {
  cancelEscapeRecovery();
  const r = escapeRoom;
  escapeRoom = null;
  unbindEscapeSync();
  await quietLeave(r);
}

/** Send a class message (team, phase, door, rejoin, results). No-op unless this tab is in a class. */
export function sendClass<K extends keyof ClassPayloads>(type: K, payload: ClassPayloads[K]): void {
  if (roomMode !== "class") return;
  room?.send(type, payload);
}

/**
 * Use the door at hand in 케이슨 마을: the memorial hall's front door, or the way out from inside. The message
 * carries no data; the server checks the distance to the door and a 1-per-second cap and silently drops anything
 * else. No-op unless this tab is in the village.
 */
export function sendUseDoor(): void {
  if (roomMode !== "village") return;
  room?.send(VillageMsg.UseDoor, {});
}

/** Submit a house keypad code; the server validates the authoritative position and never receives a reusable credential. */
export function sendKeypad(buildingId: string, code: string): void {
  if (roomMode !== "village") return;
  room?.send(VillageMsg.Keypad, { buildingId, code });
}

/**
 * 케이슨 마을 (Task 9): light a candle in a memorial cubby. The server checks that we are in the hall within 1.5 m of
 * it and a 1-per-5-seconds cap, then tells everyone in the hall (`CandleLit`); anything else is dropped silently.
 * No-op unless this tab is in the village.
 */
export function sendLightCandle(cubby: string): void {
  if (roomMode !== "village") return;
  room?.send(VillageMsg.LightCandle, { cubby });
}

/** Rent the session's rod. The server validates the player's authoritative position at the kiosk. */
export function sendFishingRentRod(): void {
  if (roomMode !== "village") return;
  const payload: FishingEmptyPayload = {};
  room?.send(VillageMsg.FishingRentRod, payload);
}

/** Cast at the pond. The server chooses the bite time and owns the bobber phase. */
export function sendFishingCast(): void {
  if (roomMode !== "village") return;
  const payload: FishingEmptyPayload = {};
  room?.send(VillageMsg.FishingCast, payload);
}

/** Pull the line. A catch is possible only while the server reports a submerged bobber. */
export function sendFishingReel(): void {
  if (roomMode !== "village") return;
  const payload: FishingEmptyPayload = {};
  room?.send(VillageMsg.FishingReel, payload);
}

/** Send a classroom (puzzle) message. No-op unless a classroom connection is open. */
export function sendEscape<K extends keyof EscapePayloads>(type: K, payload: EscapePayloads[K]): void {
  escapeRoom?.send(type, payload);
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
 * Send a chat line to the active room (hall chat in the hub, team chat in a classroom).
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

// ───────────────────────── World-only and instructor messages (main room) ─────────────────────────

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
 * Explicit maze return-to-lobby (design 34 후속: the 큐리 panel button). The
 * server validates the sender is actually in the goal chamber; elsewhere it is
 * a silent no-op.
 */
export function sendPortalReturn(): void {
  room?.send(MessageType.PortalReturn, {});
}

/**
 * Admin / teacher: set (or clear) the announcement banner — always on the main room (in a
 * class: the class, never a classroom). An empty/whitespace `text` clears it — that is
 * intentional and handled server-side. No-op if not connected; the server drops the message
 * unless this connection is admin / teacher.
 */
export function sendAnnounce(text: string): void {
  room?.send(MessageType.Announce, { text });
}

/**
 * Admin / teacher: kick the player owning `sid` — always on the main room. No-op if not
 * connected; the server drops the message unless this connection is admin / teacher, and
 * refuses self-kicks.
 */
export function sendKick(sid: string): void {
  room?.send(MessageType.Kick, { sid });
}

/**
 * What `waitForSelf` needs of a room — any player room (world, class, classroom) fits it
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
 * Tab close / navigation (`pagehide`, which fires on mobile too).
 * - World and village: a best-effort CONSENTED leave, so the server removes the player at once instead
 *   of holding a 20 s ghost window (unchanged for the world).
 * - Class (ruling, Task 13): NO leave of either room. A refresh or a closed tab must leave
 *   GHOSTS (Review Focus 1): the class ghost keeps its team and its `place`, so the same nickname
 *   coming back takes it over and is sent straight back into the same classroom. Teammates still
 *   see the change at once: the escape room recounts membership / solo on the drop (Task 10).
 *   The cost: a tab closed for good lingers as a ghost until the reconnection window ends.
 */
export function handlePageHide(): void {
  if (roomMode === "class") return;
  void room?.leave(true);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", handlePageHide);
}
