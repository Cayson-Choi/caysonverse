import { CloseCode, matchMaker, type Client, type Deferred, type Delayed } from "colyseus";
import { EscapeState, Player } from "@caysonverse/shared/schema";
import { KICK_CLOSE_CODE, PATCH_RATE_MS, ROLE_STUDENT, ROLE_TEACHER } from "@caysonverse/shared/constants";
import { APPEARANCE_FIELDS, validateAppearance, type AppearanceField } from "@caysonverse/shared/appearance";
import {
  CLASS_CLOSED_CODE,
  ESCAPE_ACTION_RATE,
  ESCAPE_EMPTY_DISPOSE_MS,
  ESCAPE_INTRO_MS,
  ESCAPE_MAX_CLIENTS,
  ESCAPE_RETRY_EXTRA_S,
  INSPECT_REACH,
  ROOM_IDS,
  SOLO_HOLD_MS,
  TICKET_TTL_MS,
  type EscapePhase,
  type RoomId,
  type TextLevel,
} from "@caysonverse/shared/escape/constants";
import {
  EscapeMsg,
  type EscapeEventPayload,
  type EscapeSummary,
  type EscapedEvent,
  type RoomContent,
  type StoryLine,
  type TeamChatMirrorPayload,
} from "@caysonverse/shared/escape/messages";
import { ROOM_MAPS, type RoomMap } from "@caysonverse/shared/school/roomMaps";
import type { ObjectAnchor } from "@caysonverse/shared/school/counselMap";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { PlayerRoom, baseTracking, spawnInDisk, type Tracking } from "../rooms/PlayerRoom";
import { RateWindow } from "../rooms/rateLimit";
import { assertSpawnToken } from "../rooms/spawnToken";
import { publicContent, resolveText } from "./content";
import { cancelHold, isSolo } from "./coop";
import { applyAction, createEngineState, inspectView, type EngineAction, type EngineCtx, type EngineEvent, type EngineState } from "./engine";
import { GameClock } from "./gameClock";
import { projectToSchema } from "./projection";
import { ROOM_DEFS } from "./rooms";
import { computeStars } from "./stars";
import type { RoomDef } from "./types";

/** What ClassRoom passes to `matchMaker.createRoom(ESCAPE_ROOM, …)` (Task 11). */
export interface EscapeCreateOptions {
  spawnToken: string;
  /** The class (ClassRoom roomId) this team belongs to: every `report` goes there. */
  classRoomId: string;
  teamId: string;
  teamName: string;
  roomDefId: RoomId;
  textLevel: TextLevel;
  timeLimitS: number;
  maxHintTier: number;
}

/**
 * One member's admission (ClassRoom → `admit`, by remoteRoomCall): a one-time ticket for this
 * team's instance, bound to the member's class identity (`memberKey` = nicknameKey). The look and
 * role are copied from the member's class Player.
 */
export interface Admission {
  ticket: string;
  memberKey: string;
  nickname: string;
  role: number;
  appearance: Record<AppearanceField, number>;
}

/** One team's result in one room (→ ClassRoom `escapeResult`, the results CSV). */
export interface EscapeResult {
  teamId: string;
  teamName: string;
  roomId: RoomId;
  /** Nicknames of the members (students) who came in, in arrival order. */
  members: string[];
  escaped: boolean;
  overtime: boolean;
  elapsedS: number;
  remainingS: number;
  hintsUsed: number;
  wrongAttempts: number;
  stars: number;
  /** PrincipleId → whether the team's first choice at that last-door step was right. */
  firstTry: Record<string, boolean>;
}

/** The ClassRoom methods an escape room calls (Task 11 implements them). */
export type ClassCallback = "escapeMemberEntered" | "escapeMemberLeft" | "escapeChat" | "escapeResult" | "escapeDisposed";
type ClassCallbacks = Record<ClassCallback, (...args: never[]) => unknown>;

/** Why a join was refused — Korean, shown to the student as is. */
export const ESCAPE_JOIN_ERRORS = {
  ticket: "입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요.",
} as const;

/** Fixed refusals: they never echo the options or the admission (token, ticket, nickname). */
const CREATE_BAD_OPTIONS = "교실을 열 수 없어요: 교실을 여는 정보가 올바르지 않아요";
const ADMIT_REFUSED = "입장 허가를 받을 수 없어요";

/** From the end command until every connection is closed with CLASS_CLOSED_CODE. */
const ESCAPE_END_GRACE_MS = 5000;
/** The scheduled hold check runs this long after the hold could be done (game time vs. the tick). */
const HOLD_CHECK_MARGIN_MS = 50;
const TICK_MS = 1000;

/** Bounds on what an admission may carry (ClassRoom's tickets are 24 base64url symbols). */
const TICKET_MIN = 16;
const TICKET_MAX = 128;
const KEY_MAX = 32;
/** Longest id a puzzle message may name (every room id is far shorter). */
const ID_MAX = 64;
const UINT8_MAX = 255;
const UINT16_MAX = 65_535;

type TestOverride = "CV_ESCAPE_INTRO_MS" | "CV_ESCAPE_EMPTY_DISPOSE_MS" | "CV_ESCAPE_END_GRACE_MS";

/**
 * A positive number from a TEST-ONLY environment override (same pattern as CV_RECONNECT_WINDOW_S),
 * read each time it is needed; production never sets these.
 */
function testOverrideMs(name: TestOverride, fallback: number): number {
  const raw = process.env[name];
  const ms = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}

function isText(v: unknown, min: number, max: number): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max;
}

/** A puzzle id from a client payload field, or null. */
function idOf(v: unknown): string | null {
  return isText(v, 0, ID_MAX) ? v : null;
}

function field(payload: unknown, key: string): unknown {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[key] : undefined;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

interface ValidOptions {
  classRoomId: string;
  teamId: string;
  teamName: string;
  roomDefId: RoomId;
  def: RoomDef;
  map: RoomMap;
  textLevel: TextLevel;
  timeLimitS: number;
  maxHintTier: number;
}

/** The create options when they are complete and name a room with puzzle data and a map; else null. */
function readCreateOptions(options: unknown): ValidOptions | null {
  if (typeof options !== "object" || options === null) return null;
  const o = options as Record<string, unknown>;
  if (!isText(o.classRoomId, 1, ID_MAX) || !isText(o.teamId, 1, ID_MAX) || !isText(o.teamName, 1, ID_MAX)) return null;
  const roomDefId = ROOM_IDS.find((id) => id === o.roomDefId);
  const def = roomDefId === undefined ? undefined : ROOM_DEFS[roomDefId];
  const map = roomDefId === undefined ? undefined : ROOM_MAPS[roomDefId];
  if (roomDefId === undefined || def === undefined || map === undefined) return null;
  if (o.textLevel !== "easy" && o.textLevel !== "hard") return null;
  if (!isInt(o.timeLimitS, 1, UINT16_MAX) || !isInt(o.maxHintTier, 0, 3)) return null;
  return {
    classRoomId: o.classRoomId,
    teamId: o.teamId,
    teamName: o.teamName,
    roomDefId,
    def,
    map,
    textLevel: o.textLevel,
    timeLimitS: o.timeLimitS,
    maxHintTier: o.maxHintTier,
  };
}

/** A well-formed admission (fresh copy, appearance reduced to its 15 fields), or null. */
function readAdmission(v: unknown): Admission | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isText(o.ticket, TICKET_MIN, TICKET_MAX) || !isText(o.memberKey, 1, KEY_MAX) || !isText(o.nickname, 1, KEY_MAX)) {
    return null;
  }
  if (o.role !== ROLE_STUDENT && o.role !== ROLE_TEACHER) return null;
  const appearance = validateAppearance(o.appearance);
  if (appearance === null) return null;
  return { ticket: o.ticket, memberKey: o.memberKey, nickname: o.nickname, role: o.role, appearance };
}

/** The base bookkeeping plus the puzzle-action cap (never synced). */
interface EscapeTracking extends Tracking {
  actionRate: RateWindow;
}

/** A member's place in the arrival order. A refresh keeps it, so split halves never swap. */
interface Slot {
  memberKey: string;
  /** The member's current sessionId (a refreshed tab replaces it). */
  sid: string;
  nickname: string;
  /** A teacher (ROLE_TEACHER) watches: never a puzzle member, never in the result's member list. */
  teacher: boolean;
}

/**
 * One team's classroom of "AI 학교 탈출" (Task 10): the server-authoritative puzzle (engine.ts,
 * coop.ts) over the shared player room (PlayerRoom: move, team chat, emoji, jump, typing,
 * reconnection).
 *
 * Created ONLY by server code (ClassRoom, Task 11) with the spawn token; never matchmade (private,
 * no filterBy: a client reaches it by id with a one-time ticket). ClassRoom `admit`s each member, and
 * the escape room reports back by `report` (remoteRoomCall): entered / left / chat / result /
 * disposed.
 *
 * Puzzle messages (binding order): the client's action cap (ESCAPE_ACTION_RATE) → the room must be
 * in play or finale, not paused, not timed up → an action naming an object (and a lock's input or
 * submit, through its object) needs the player within the object's reach → engine →
 * `projectToSchema` → each event to the team (`EscapeMsg.Event`, after the state patch). Inspect
 * changes nothing and answers the asker only. HoldEnd is exempt from the cap and the reach check:
 * it can only end the sender's own hold.
 *
 * Membership (ruling E13): who is connected (`connected`, in slot order, with `names` in step) is
 * re-derived on every join, drop, reconnect and leave, and the engine's `membership` action runs
 * then — immediately while the room is live, otherwise as soon as it is live again (a drop during
 * a pause or the intro decides nothing until play goes on). `solo` follows at once.
 *
 * Time (GameClock): the intro (ESCAPE_INTRO_MS) starts at the first join, then the limit counts
 * down. Game time stands still while paused, timed up, escaped or ended, so a pause freezes the
 * timer, the hint gap and the last-door cool-down, and "다시 도전" adds exactly ESCAPE_RETRY_EXTRA_S.
 *
 * Nothing here logs: not an action, an input, an answer, a ticket or a chat line. The only log is
 * the fixed line of a failed `report`.
 */
export class EscapeRoom extends PlayerRoom<EscapeState, EscapeTracking> {
  patchRate = PATCH_RATE_MS;
  state = new EscapeState();

  /**
   * True once onCreate has passed every check. Colyseus calls onDispose even on a room whose
   * onCreate threw (a refused client create): such a room reports nothing to any class.
   */
  private created = false;
  private classRoomId = "";
  private teamId = "";
  private def!: RoomDef;
  private map!: RoomMap;
  private level: TextLevel = "easy";
  private limitS = 0;
  private extraS = 0;
  private introMs = ESCAPE_INTRO_MS;
  private content!: RoomContent;
  private anchors = new Map<string, ObjectAnchor>();
  /** lockId → the object whose reach its input and submit need. */
  private lockObjects = new Map<string, string>();

  /** The engine state (server only; `projectToSchema` publishes its public part). */
  private es!: EngineState;
  /** Started by the first join. */
  private gameClock: GameClock | null = null;
  private timeUp = false;
  private ended = false;
  /** A membership change waiting for the room to be live again. */
  private membershipPending = false;
  /** The escape, kept to re-send its lines to a member who (re)joins afterwards. */
  private escapedEvent: EscapedEvent | null = null;
  private resultReported = false;

  /** Arrival order of the members (one slot per memberKey). */
  private readonly slots: Slot[] = [];
  /** Connected sessionIds in slot order, and their nicknames: the engine's view of the team. */
  private readonly connected: string[] = [];
  private readonly names = new Map<string, string>();
  private ctx!: EngineCtx;
  private readonly sidByMember = new Map<string, string>();
  private readonly memberBySid = new Map<string, string>();

  /** Admitted, not yet used tickets (server memory only). */
  private readonly tickets = new Map<string, { admission: Admission; expiresAt: number }>();
  /** Open reconnection windows by sessionId, so a takeover or a kick can close a ghost's window. */
  private readonly reconnectWindows = new Map<string, Deferred<Client>>();
  private emptyTimer: Delayed | null = null;
  private holdTimer: Delayed | null = null;

  onCreate(options: EscapeCreateOptions): void {
    // FIRST: only server code knows the token, so a client's create / joinOrCreate stops here,
    // before this room has touched anything.
    assertSpawnToken(options);
    const o = readCreateOptions(options);
    if (o === null) throw new Error(CREATE_BAD_OPTIONS);

    // Every check passed — from here on nothing throws.
    this.created = true;
    this.classRoomId = o.classRoomId;
    this.teamId = o.teamId;
    this.def = o.def;
    this.map = o.map;
    this.level = o.textLevel;
    this.limitS = o.timeLimitS;
    this.introMs = testOverrideMs("CV_ESCAPE_INTRO_MS", ESCAPE_INTRO_MS);
    this.content = publicContent(o.def, o.textLevel);
    for (const a of o.map.anchors) this.anchors.set(a.id, a);
    for (const l of o.def.locks) this.lockObjects.set(l.id, l.objectId);
    this.es = createEngineState(o.def);
    this.ctx = { now: 0, connected: this.connected, names: this.names, maxHintTier: o.maxHintTier, level: o.textLevel };

    this.state.roomDefId = o.roomDefId;
    this.state.teamName = o.teamName;
    this.state.textLevel = o.textLevel;
    this.state.timeLeftS = o.timeLimitS;
    projectToSchema(this.es, this.state);

    this.autoDispose = false; // lives until ended or empty (armEmptyDispose), not until the last leave
    this.maxClients = ESCAPE_MAX_CLIENTS; // every member's ghost + fresh session + one spare
    // Never matchmade: join / joinOrCreate by name cannot land in a team's room; joinById (with a
    // ticket) still works.
    void this.setPrivate(true);

    // Move, Chat, Emoji, Jump, Typing (+ the "*" catch-all for stray types).
    this.registerPlayerMessages();
    this.registerPuzzleMessages();
    this.clock.setInterval(() => this.tick(), TICK_MS);

    // An instance nobody enters closes like one everybody left.
    this.armEmptyDispose();
  }

  /** Tell the class the team's instance is gone (whatever closed it: end, empty, shutdown). */
  onDispose(): void {
    if (!this.created) return; // a refused create owns nothing
    void this.report("escapeDisposed", [this.teamId, this.roomId]);
  }

  // ───────────────────────────── Calls from the class (remoteRoomCall) ─────────────────────────────

  /** Admits one member: a one-time ticket valid for TICKET_TTL_MS (a newer one replaces theirs). */
  admit(a: Admission): void {
    if (!this.created || this.ended) throw new Error(ADMIT_REFUSED);
    const admission = readAdmission(a);
    if (admission === null) throw new Error(ADMIT_REFUSED);
    const now = this.now();
    this.pruneTickets(now);
    this.revokeTickets(admission.memberKey);
    this.tickets.set(admission.ticket, { admission, expiresAt: now + TICKET_TTL_MS });
  }

  /** The teacher's pause / resume / end, forwarded by the class. Anything else is ignored. */
  classCommand(cmd: "pause" | "resume" | "end"): void {
    if (!this.created || this.ended) return;
    if (cmd === "pause") {
      if (this.state.paused) return;
      this.state.paused = true;
      this.syncClockFreeze();
      this.cancelHoldNow();
      this.refresh();
    } else if (cmd === "resume") {
      if (!this.state.paused) return;
      this.state.paused = false;
      this.syncClockFreeze();
      this.refresh();
      this.flushMembership();
    } else if (cmd === "end") {
      this.endRoom();
    }
  }

  /** The teacher kicked this member from the class: out of this room too, with no way back in. */
  kickMember(memberKey: string): void {
    if (!this.created || typeof memberKey !== "string") return;
    this.revokeTickets(memberKey);
    const at = this.slots.findIndex((s) => s.memberKey === memberKey);
    if (at >= 0) this.slots.splice(at, 1);
    const sid = this.sidByMember.get(memberKey);
    if (sid === undefined) return;
    const client = this.clients.getById(sid);
    if (client) {
      client.leave(KICK_CLOSE_CODE); // PlayerRoom.onDrop opens no window for a kick → onLeave
      return;
    }
    this.closeWindow(sid, "kicked"); // a ghost: Colyseus then runs onLeave for it
  }

  /**
   * Tests only: moves game time forward (GameClock.skip throws outside the test runner) and ticks.
   * The scheduled hold check waits in real time, so a hold is checked here at once and re-armed.
   */
  debugAdvance(ms: number): void {
    if (this.gameClock === null) throw new Error("debugAdvance: nobody has joined yet");
    this.gameClock.skip(ms);
    this.tick();
    this.clearHoldTimer();
    if (this.es.hold !== null && this.isLive()) this.run({ t: "holdCheck" });
    this.armHoldTimer();
  }

  /**
   * Tell the class something (remoteRoomCall). Its error message carries the arguments as JSON
   * (chat lines, nicknames), so it is never logged: only this fixed line.
   */
  protected async report(method: ClassCallback, args: unknown[]): Promise<void> {
    try {
      await matchMaker.remoteRoomCall<ClassCallbacks>(this.classRoomId, method, args);
    } catch {
      console.error(`[caysonverse] escape room report to the class failed: ${method}`);
    }
  }

  // ─────────────────────────────────────── Joins and leaves ───────────────────────────────────────

  /** Spends the join's one-time ticket. Missing, used, revoked or expired → the Korean refusal. */
  onAuth(_client: Client, options: unknown): Admission {
    const ticket = field(options, "ticket");
    const entry = typeof ticket === "string" ? this.tickets.get(ticket) : undefined;
    if (entry === undefined || this.ended) throw new Error(ESCAPE_JOIN_ERRORS.ticket);
    this.tickets.delete(ticket as string);
    if (this.now() >= entry.expiresAt) throw new Error(ESCAPE_JOIN_ERRORS.ticket);
    return entry.admission;
  }

  onJoin(client: Client, _options: unknown, auth?: Admission): void {
    if (auth === undefined) throw new Error(ESCAPE_JOIN_ERRORS.ticket);
    const sid = client.sessionId;

    // A previous session of this member (a refreshed tab, a lost connection) gives way.
    const previous = this.sidByMember.get(auth.memberKey);
    if (previous !== undefined && previous !== sid) this.replaceSession(previous);

    const player = new Player();
    player.nickname = auth.nickname;
    for (const f of APPEARANCE_FIELDS) player[f] = auth.appearance[f];
    const at = this.spawnPosition();
    player.x = at.x;
    player.z = at.z;
    player.yaw = Math.PI; // facing north, into the room
    player.connected = true;
    player.role = auth.role;
    this.seatPlayer(client, player);

    this.sidByMember.set(auth.memberKey, sid);
    this.memberBySid.set(sid, auth.memberKey);
    const slot = this.slots.find((s) => s.memberKey === auth.memberKey);
    const teacher = auth.role === ROLE_TEACHER;
    if (slot) {
      slot.sid = sid; // the same place in the arrival order (stable split halves)
      slot.nickname = auth.nickname;
      slot.teacher = teacher;
    } else {
      this.slots.push({ memberKey: auth.memberKey, sid, nickname: auth.nickname, teacher });
    }
    this.cancelEmptyDispose();

    this.sendRoomTo(client);
    void this.report("escapeMemberEntered", [this.teamId, auth.memberKey]);
    if (this.gameClock === null) {
      this.gameClock = new GameClock(this.now()); // the intro starts with the first member
      this.syncClockFreeze(); // (a class paused before anyone came in)
      this.refresh();
    }
    this.membershipChanged();
  }

  /** Base drop handling (ghost + reconnection window), then who is here changed. */
  onDrop(client: Client, code?: number): void {
    super.onDrop(client, code);
    this.membershipChanged();
    this.armEmptyDispose();
  }

  onReconnect(client: Client): void {
    this.reconnectWindows.delete(client.sessionId);
    super.onReconnect(client);
    this.cancelEmptyDispose();
    this.sendRoomTo(client);
    this.membershipChanged();
  }

  /**
   * Permanent departure (consented leave, kick, expired or closed window). Reported to the class
   * only when the departing session is the member's current one, so the late leave of a replaced
   * session never moves the member who is still here (Review Focus 1).
   */
  onLeave(client: Client): void {
    const sid = client.sessionId;
    this.reconnectWindows.delete(sid);
    const memberKey = this.memberBySid.get(sid);
    this.memberBySid.delete(sid);
    if (memberKey !== undefined && this.sidByMember.get(memberKey) === sid) {
      this.sidByMember.delete(memberKey);
      void this.report("escapeMemberLeft", [this.teamId, memberKey]);
    }
    this.unseatPlayer(sid);
    this.membershipChanged();
    this.armEmptyDispose();
  }

  /** The base's reconnection window, remembered by sessionId (see ClassRoom.allowReconnection). */
  allowReconnection(previousClient: Client, seconds: number | "manual"): Deferred<Client> {
    const window = super.allowReconnection(previousClient, seconds);
    if (typeof (window as { reject?: unknown }).reject === "function") {
      this.reconnectWindows.set(previousClient.sessionId, window);
    }
    return window;
  }

  protected geometry(): MapGeometry {
    return this.map.geometry;
  }

  protected spawnPosition(): { x: number; z: number } {
    return spawnInDisk(this.map.spawn.x, this.map.spawn.z, this.map.spawnJitter, this.map.geometry);
  }

  protected createTracking(now: number): EscapeTracking {
    return { ...baseTracking(now), actionRate: new RateWindow(ESCAPE_ACTION_RATE.count, ESCAPE_ACTION_RATE.windowMs) };
  }

  /**
   * Walking out of reach of the switch one is holding ends the hold (hot path: one compare when
   * nobody holds, no allocation).
   */
  protected afterMove(client: Client, player: Player): void {
    const hold = this.es.hold;
    if (hold === null || hold.sid !== client.sessionId) return;
    if (!this.inReach(player, hold.objectId)) this.cancelHoldNow();
  }

  /** Team chat: this room only (the base's broadcast), and a copy for the teacher. */
  protected deliverChat(client: Client, player: Player, text: string): void {
    super.deliverChat(client, player, text);
    this.mirrorChat(player.nickname, text, false);
  }

  /** A held-back line: the teacher sees it masked. */
  protected onChatBlocked(_client: Client, player: Player, masked: string): void {
    this.mirrorChat(player.nickname, masked, true);
  }

  private mirrorChat(name: string, text: string, filtered: boolean): void {
    const m: TeamChatMirrorPayload = { teamId: this.teamId, teamName: this.state.teamName, name, text, filtered, at: this.now() };
    void this.report("escapeChat", [m]);
  }

  /** The content (every join and reconnect) and, after the escape, the escape event with its lines. */
  private sendRoomTo(client: Client): void {
    client.send(EscapeMsg.Content, this.content);
    if (this.escapedEvent !== null) client.send(EscapeMsg.Event, this.escapedEvent);
  }

  /**
   * The previous session of a member who just came in again: out of the state at once, its
   * reconnection window closed (its late onLeave is then sid-keyed and reports nothing), and a
   * connection that is somehow still open is closed as a consented leave (no ghost window).
   */
  private replaceSession(previous: string): void {
    this.unseatPlayer(previous);
    this.closeWindow(previous, "taken over");
    this.clients.getById(previous)?.leave(CloseCode.CONSENTED);
  }

  private closeWindow(sid: string, reason: string): void {
    const window = this.reconnectWindows.get(sid);
    if (!window) return;
    this.reconnectWindows.delete(sid);
    window.reject(new Error(reason));
  }

  private revokeTickets(memberKey: string): void {
    for (const [ticket, entry] of this.tickets) if (entry.admission.memberKey === memberKey) this.tickets.delete(ticket);
  }

  private pruneTickets(now: number): void {
    for (const [ticket, entry] of this.tickets) if (now >= entry.expiresAt) this.tickets.delete(ticket);
  }

  // ─────────────────────────────────────────── Membership ───────────────────────────────────────────

  /**
   * Rebuild the connected list (slot order) and the names in step with it; `solo` follows. A teacher
   * is never a puzzle member (split halves, votes, presses, solo) — ClassRoom admits none, this is
   * the second guard.
   */
  private syncMembers(): void {
    this.connected.length = 0;
    this.names.clear();
    for (const slot of this.slots) {
      const p = this.state.players.get(slot.sid);
      if (p === undefined || !p.connected || p.role === ROLE_TEACHER) continue;
      this.connected.push(slot.sid);
      this.names.set(slot.sid, p.nickname);
    }
    const solo = isSolo(this.connected);
    if (this.state.solo !== solo) this.state.solo = solo;
  }

  /** Who is connected may have changed (E13): the engine re-derives holds, presses and votes. */
  private membershipChanged(): void {
    this.syncMembers();
    if (this.gameClock === null) return;
    this.refresh();
    if (this.isLive()) {
      this.membershipPending = false;
      this.run({ t: "membership" });
    } else {
      // Paused, intro, time up, escaped or ended: decide nothing now, but let clients re-read.
      this.membershipPending = true;
      this.sendEvent({ e: "members" });
    }
  }

  private flushMembership(): void {
    if (!this.membershipPending || !this.isLive()) return;
    this.membershipPending = false;
    this.run({ t: "membership" });
  }

  // ─────────────────────────────────────────── Puzzle messages ───────────────────────────────────────────

  private registerPuzzleMessages(): void {
    this.onAction(EscapeMsg.Inspect, (client, player, payload) => {
      const objectId = idOf(field(payload, "objectId"));
      if (objectId === null || !this.inReach(player, objectId)) return;
      this.ctx.now = this.gameNow();
      const view = inspectView(this.def, this.es, objectId, client.sessionId, this.ctx, this.level);
      if (view !== null) client.send(EscapeMsg.InspectView, view);
    });
    this.onObjectAction(EscapeMsg.Pickup, (sid, objectId) => ({ t: "pickup", sid, objectId }));
    this.onObjectAction(EscapeMsg.Press, (sid, objectId) => ({ t: "press", sid, objectId }));
    this.onObjectAction(EscapeMsg.HoldStart, (sid, objectId) => ({ t: "holdStart", sid, objectId }));
    this.onAction(EscapeMsg.Combine, (client, _player, payload) => {
      const a = idOf(field(payload, "a"));
      const b = idOf(field(payload, "b"));
      if (a !== null && b !== null) this.run({ t: "combine", sid: client.sessionId, a, b });
    });
    this.onAction(EscapeMsg.LockInput, (client, player, payload) => {
      const lockId = this.reachableLock(player, payload);
      const value = idOf(field(payload, "value"));
      if (lockId !== null && value !== null) this.run({ t: "input", sid: client.sessionId, lockId, value });
    });
    this.onAction(EscapeMsg.BoardPlace, (client, player, payload) => {
      const lockId = this.reachableLock(player, payload);
      const cardId = idOf(field(payload, "cardId"));
      const bin = idOf(field(payload, "bin"));
      if (lockId !== null && cardId !== null && bin !== null) this.run({ t: "place", sid: client.sessionId, lockId, cardId, bin });
    });
    this.onAction(EscapeMsg.LockSubmit, (client, player, payload) => {
      const lockId = this.reachableLock(player, payload);
      if (lockId !== null) this.run({ t: "submit", sid: client.sessionId, lockId });
    });
    this.onAction(EscapeMsg.Vote, (client, _player, payload) => {
      const optionId = idOf(field(payload, "optionId"));
      if (optionId !== null) this.run({ t: "vote", sid: client.sessionId, optionId });
    });
    this.onAction(EscapeMsg.HintRequest, (client) => {
      this.run({ t: "hint", sid: client.sessionId });
    });

    // Exempt from the cap, the phase gate and the reach check: it can only end the sender's own
    // hold, and a release that got dropped would let the hold finish.
    this.onMessage(EscapeMsg.HoldEnd, (client, payload) => {
      const hold = this.es.hold;
      const objectId = idOf(field(payload, "objectId"));
      if (hold === null || hold.sid !== client.sessionId || hold.objectId !== objectId) return;
      this.run({ t: "holdEnd", sid: client.sessionId, objectId });
    });

    // "다시 도전": only when the time is up (and not paused).
    this.onMessage(EscapeMsg.Retry, (client) => {
      const track = this.tracking.get(client.sessionId);
      if (!track || !track.actionRate.tryAccept(this.now())) return;
      this.refresh();
      if (!this.timeUp || this.state.paused || this.ended) return;
      this.timeUp = false;
      this.extraS += ESCAPE_RETRY_EXTRA_S;
      this.state.overtime = true;
      this.syncClockFreeze();
      this.refresh();
      this.flushMembership();
    });
  }

  /**
   * A puzzle message: the sender has a seat → its action cap → the room is live (play / finale, not
   * paused; the timer is brought up to date first) → `handle` (shape, reach, engine).
   */
  private onAction(type: string, handle: (client: Client, player: Player, payload: unknown) => void): void {
    this.onMessage(type, (client, payload) => {
      const player = this.state.players.get(client.sessionId);
      const track = this.tracking.get(client.sessionId);
      if (!player || !track) return;
      if (!track.actionRate.tryAccept(this.now())) return; // flood → silent drop
      this.refresh();
      if (!this.isLive()) return;
      this.flushMembership();
      handle(client, player, payload);
    });
  }

  /** `{ objectId }` actions: only within reach of that object. */
  private onObjectAction(type: string, action: (sid: string, objectId: string) => EngineAction): void {
    this.onAction(type, (client, player, payload) => {
      const objectId = idOf(field(payload, "objectId"));
      if (objectId !== null && this.inReach(player, objectId)) this.run(action(client.sessionId, objectId));
    });
  }

  /** The payload's lockId when the player is within reach of that lock's object; else null. */
  private reachableLock(player: Player, payload: unknown): string | null {
    const lockId = idOf(field(payload, "lockId"));
    const objectId = lockId === null ? undefined : this.lockObjects.get(lockId);
    return objectId !== undefined && this.inReach(player, objectId) ? lockId : null;
  }

  /** On the ground plane, within the object's `reach ?? INSPECT_REACH`. An object without an anchor is out of reach. */
  private inReach(player: Player, objectId: string): boolean {
    const a = this.anchors.get(objectId);
    if (a === undefined) return false;
    const reach = a.reach ?? INSPECT_REACH;
    const dx = player.x - a.x;
    const dz = player.z - a.z;
    return dx * dx + dz * dz <= reach * reach;
  }

  // ───────────────────────────────────────────── Engine ─────────────────────────────────────────────

  private run(action: EngineAction): void {
    this.ctx.now = this.gameNow();
    this.publish(applyAction(this.def, this.es, action, this.ctx));
  }

  /** Sync the state, then tell the team what happened (hints are kept, the escape gets its extras). */
  private publish(events: readonly EngineEvent[]): void {
    projectToSchema(this.es, this.state);
    this.refresh();
    this.armHoldTimer();
    for (const ev of events) {
      if (ev.e === "escaped") {
        this.escape(ev.lines);
        continue;
      }
      if (ev.e === "hint") this.state.hints.push(ev.text);
      this.sendEvent(ev);
    }
  }

  /** Events go out after the state patch that carries their effect. */
  private sendEvent(ev: EscapeEventPayload): void {
    this.broadcast(EscapeMsg.Event, ev, { afterNextPatch: true });
  }

  /** Cancel the active hold now (pause, time up, walking away) and tell the team. */
  private cancelHoldNow(): void {
    this.publish(cancelHold(this.es));
  }

  /**
   * The hold check runs on game time: scheduled for when the hold can be done (+ a margin) and
   * re-armed while the hold lasts (game time never runs faster than real time; a pause or the time
   * running out cancels the hold). Cleared as soon as nobody holds.
   */
  private armHoldTimer(): void {
    const hold = this.es.hold;
    if (hold === null) {
      this.clearHoldTimer();
      return;
    }
    if (this.holdTimer !== null) return;
    const wait = Math.max(0, hold.since + SOLO_HOLD_MS - this.gameNow()) + HOLD_CHECK_MARGIN_MS;
    this.holdTimer = this.clock.setTimeout(() => {
      this.holdTimer = null;
      this.refresh();
      if (this.es.hold !== null && this.isLive()) this.run({ t: "holdCheck" });
      this.armHoldTimer();
    }, wait);
  }

  private clearHoldTimer(): void {
    this.holdTimer?.clear();
    this.holdTimer = null;
  }

  /** The team escaped: stars, time, the summary at the team's level; told to all, reported once. */
  private escape(lines: StoryLine[]): void {
    // A hold still running (a coop usable at the last door) ends here; otherwise its check would
    // re-arm until the room is disposed (the room is no longer live).
    this.cancelHoldNow();
    const now = this.gameNow();
    const elapsedS = this.elapsedSAt(now);
    const remainingS = this.timeLeftAt(now);
    const stars = computeStars({
      escaped: true,
      overtime: this.state.overtime,
      remainingS,
      hintsUsed: this.es.hintsUsed,
      wrongAttempts: this.es.wrongAttempts,
    });
    this.escapedEvent = { e: "escaped", lines, stars, elapsedS, summary: this.summary() };
    this.state.timeLeftS = Math.min(remainingS, UINT16_MAX);
    this.syncClockFreeze();
    this.refresh();
    this.sendEvent(this.escapedEvent);
    this.reportResult(this.result(true, elapsedS, remainingS, stars));
  }

  private summary(): EscapeSummary {
    const s = this.def.summary;
    return {
      lines: s.lines.map((t) => resolveText(t, this.level)),
      question: resolveText(s.question, this.level),
      source: s.source,
    };
  }

  private result(escaped: boolean, elapsedS: number, remainingS: number, stars: number): EscapeResult {
    return {
      teamId: this.teamId,
      teamName: this.state.teamName,
      roomId: this.def.id,
      members: this.slots.filter((s) => !s.teacher).map((s) => s.nickname),
      escaped,
      overtime: this.state.overtime,
      elapsedS,
      remainingS,
      hintsUsed: this.es.hintsUsed,
      wrongAttempts: this.es.wrongAttempts,
      stars,
      firstTry: Object.fromEntries(this.es.firstTry),
    };
  }

  /** The result of a room left unfinished (class ended, or everybody left). */
  private unfinishedResult(): EscapeResult {
    const now = this.gameNow();
    return this.result(false, this.elapsedSAt(now), this.timeLeftAt(now), 0);
  }

  /** One result per instance: the escape, or else the end / the empty close. */
  private reportResult(r: EscapeResult): void {
    if (this.resultReported) return;
    this.resultReported = true;
    void this.report("escapeResult", [r]);
  }

  private hasProgress(): boolean {
    return this.es.flags.size > 0 || this.es.bag.length > 0 || this.es.wrongAttempts > 0 || this.es.hintsUsed > 0;
  }

  // ─────────────────────────────────────────── Time and phase ───────────────────────────────────────────

  private gameNow(): number {
    return this.gameClock === null ? 0 : this.gameClock.now(this.now());
  }

  /** Whole seconds of play (the intro does not count). */
  private elapsedSAt(now: number): number {
    return Math.max(0, Math.floor((now - this.introMs) / 1000));
  }

  private timeLeftAt(now: number): number {
    return Math.max(0, this.limitS + this.extraS - this.elapsedSAt(now));
  }

  private phaseAt(now: number): EscapePhase {
    if (this.ended) return "ended";
    if (this.es.phase === "escaped") return "escaped";
    if (this.timeUp) return "timeup";
    if (this.gameClock === null || now < this.introMs) return "intro";
    return this.es.phase;
  }

  /** Puzzle actions are accepted: play or finale, and the class is not paused. */
  private isLive(): boolean {
    const phase = this.state.phase;
    return !this.state.paused && (phase === "play" || phase === "finale");
  }

  /** Game time runs only while the team can play (or watches the intro). */
  private syncClockFreeze(): void {
    const clock = this.gameClock;
    if (clock === null) return;
    const frozen = this.state.paused || this.timeUp || this.ended || this.es.phase === "escaped";
    if (frozen) clock.pause(this.now());
    else clock.resume(this.now());
  }

  /**
   * Bring the synced timer, cool-down and phase up to the current game time (changed fields only).
   * The moment the time runs out: time up, the hold is cancelled, game time stops.
   */
  private refresh(): void {
    if (this.gameClock === null) return;
    const st = this.state;
    const now = this.gameNow();
    if (!this.ended && this.es.phase !== "escaped" && !this.timeUp) {
      const left = this.timeLeftAt(now);
      const shown = Math.min(left, UINT16_MAX);
      if (st.timeLeftS !== shown) st.timeLeftS = shown;
      if (left === 0) {
        this.timeUp = true;
        this.syncClockFreeze();
        this.cancelHoldNow();
      }
    }
    const cooldown =
      this.es.phase === "finale" ? Math.min(UINT8_MAX, Math.max(0, Math.ceil((this.es.cooldownUntil - now) / 1000))) : 0;
    if (st.cooldownS !== cooldown) st.cooldownS = cooldown;
    const phase = this.phaseAt(now);
    if (st.phase !== phase) st.phase = phase;
  }

  /** Every second: tickets expire, the timer and phase move on (time up, intro over → pending membership). */
  private tick(): void {
    this.pruneTickets(this.now());
    if (this.gameClock === null) return;
    this.refresh();
    this.flushMembership();
  }

  /**
   * The class ended: the unfinished result first (if anyone played), then no more joins or
   * actions, and after ESCAPE_END_GRACE_MS everyone is closed with CLASS_CLOSED_CODE.
   */
  private endRoom(): void {
    if (this.gameClock !== null) this.reportResult(this.unfinishedResult());
    this.cancelHoldNow();
    this.ended = true;
    this.tickets.clear();
    this.syncClockFreeze();
    this.refresh();
    this.cancelEmptyDispose();
    void this.lock();
    this.clock.setTimeout(() => {
      void this.disconnect(CLASS_CLOSED_CODE);
    }, testOverrideMs("CV_ESCAPE_END_GRACE_MS", ESCAPE_END_GRACE_MS));
  }

  /** Nobody connected: close after ESCAPE_EMPTY_DISPOSE_MS (a join or a reconnect cancels it). */
  private armEmptyDispose(): void {
    if (!this.created || this.ended || this.emptyTimer !== null || this.clients.length > 0) return;
    this.emptyTimer = this.clock.setTimeout(() => {
      this.emptyTimer = null;
      if (this.clients.length > 0) return;
      if (this.gameClock !== null && this.hasProgress()) this.reportResult(this.unfinishedResult());
      void this.disconnect();
    }, testOverrideMs("CV_ESCAPE_EMPTY_DISPOSE_MS", ESCAPE_EMPTY_DISPOSE_MS));
  }

  private cancelEmptyDispose(): void {
    if (this.emptyTimer === null) return;
    this.emptyTimer.clear();
    this.emptyTimer = null;
  }
}
