import { randomBytes } from "node:crypto";
import { matchMaker, type AuthContext, type Client, type Deferred, type Delayed } from "colyseus";
import { ClassState, Player, Team } from "@caysonverse/shared/schema";
import { MessageType, type ChatBroadcast } from "@caysonverse/shared/messages";
import {
  KICK_CLOSE_CODE,
  MAX_CLIENTS,
  PATCH_RATE_MS,
  ROLE_STUDENT,
  ROLE_TEACHER,
} from "@caysonverse/shared/constants";
import { APPEARANCE_FIELDS, pickAppearance } from "@caysonverse/shared/appearance";
import {
  CLASS_CLOSED_CODE,
  CLASS_EMPTY_CLOSE_MS,
  CLASS_END_GRACE_MS,
  CLASS_RECONNECT_WINDOW_S,
  ESCAPE_ROOM,
  ESCAPE_TIME_LIMIT_S,
  PHASE1_OPEN_ROOMS,
  PLACE_ESCAPE,
  PLACE_HUB,
  ROOM_IDS,
  ROOM_LABELS,
  TEAM_COLORS,
  TEAM_MIN,
  TEAM_NAMES,
  type ClassCommand,
  type RoomId,
  type TextLevel,
} from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
import {
  ClassMsg,
  type EscapeTicketPayload,
  type NoticePayload,
  type ResultsCsvPayload,
  type TeamChatMirrorPayload,
} from "@caysonverse/shared/escape/messages";
import { teamDisplayName } from "@caysonverse/shared/escape/teams";
import { HUB_DOORS, HUB_SPAWN, HUB_SPAWN_JITTER, doorAtPad, hubGeometry, inTeamZone } from "@caysonverse/shared/school/hubMap";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { PlayerRoom, baseTracking, spawnInDisk, type Tracking } from "../rooms/PlayerRoom";
import { validateJoinOptions } from "../rooms/joinValidation";
import { sanitizeAnnounce } from "../rooms/announce";
import { DenySet } from "../rooms/denySet";
import { resolveClientIp } from "../rooms/clientIp";
import { AdminAttemptLimiter } from "../rooms/adminAuth";
import { checkProfanity as checkWords } from "../rooms/profanity";
import { SPAWN_TOKEN, assertSpawnToken } from "../rooms/spawnToken";
import type { Admission, EscapeCreateOptions, EscapeResult, EscapeRoom } from "../escape/EscapeRoom";
import { classRegistry, type ClassCreateOptions } from "./classRegistry";
import { CLASS_API_ERRORS } from "./classApi";
import { canTeach } from "./teacherKeys";
import { isClassCommand, nextPhase } from "./classPhase";
import { decideNickname, nicknameKey } from "./nickname";
import { buildResultsCsv } from "./resultsCsv";
import {
  TEAM_ERRORS,
  autoAssign,
  createTeam,
  joinTeam,
  leaveTeam,
  teamPadStatus,
  type PadPresence,
  type TeamPlan,
  type TeamRec,
} from "./teams";

/**
 * Why a class join was refused — Korean, shown to the student/teacher as is. (A class that has
 * ended, or a code nobody opened, is normally refused earlier by the matchmaker — the room is
 * locked / no room matches the code — and the client shows its own notice for that; `wrongCode`
 * and `ended` are the room's defence in depth, ruling E18.)
 */
export const CLASS_JOIN_ERRORS = {
  wrongCode: "반 코드를 확인해 주세요",
  ended: "수업이 끝났어요",
  /** Same text as the world's kick deny (WorldRoom). */
  kicked: "입장이 제한되었습니다",
  badNickname: "다른 닉네임을 써 주세요",
  nicknameTaken: "이 반에 같은 닉네임이 있어요. 다른 닉네임을 써 주세요.",
  passExpired: "선생님 입장권이 만료됐어요. 다시 반 열기를 눌러 주세요",
  /** Same text as the teacher HTTP route's failure limit. */
  tooManyPassAttempts: CLASS_API_ERRORS.tooManyAttempts,
} as const;

/** The System notice every client gets when the teacher changes the phase. */
export const PHASE_NOTICES: Readonly<Record<ClassCommand, string>> = {
  start: "복도 문이 열렸어요! 팀과 함께 교실로 가 보세요.",
  pause: "선생님이 잠시 멈췄어요.",
  resume: "다시 시작해요!",
  end: "수업이 끝났어요. 함께해 줘서 고마워요!",
};

/**
 * Why a press of "입장" (`ClassMsg.EnterRoom`) was refused — Korean, sent to the presser alone as a
 * `ClassMsg.Notice`. `failed` is the one the brief does not list: the server could not open the
 * team's classroom (it does not happen in normal play; pressing again retries).
 */
export const ENTER_ERRORS = {
  lobby: "선생님이 아직 시작하지 않았어요",
  paused: "잠깐! 선생님이 멈췄어요",
  notOpen: "이 교실은 아직 열리지 않았어요",
  teamElsewhere: "팀이 다른 교실에 있어요",
  alreadyEscaped: "이미 탈출한 교실이에요",
  needTeammates: "팀원이 2명 이상 모여야 해요",
  notLeader: "먼저 온 팀장이 눌러 주세요",
  failed: "교실 문을 열지 못했어요. 잠시 뒤 다시 눌러 주세요",
} as const;

/** The teacher's chat mirror files a held-back hall line under this name (with teamId ""). */
export const HALL_MIRROR_NAME = "중앙 홀";

/**
 * The System notice every client gets when a team escapes, e.g. "햇살(파랑) 팀이 상담실을 탈출했어요!".
 * Every ROOM_LABELS word ends in a final consonant, so the particle is always 을.
 */
export function escapedNotice(teamName: string, roomId: RoomId): string {
  return `${teamName} 팀이 ${ROOM_LABELS[roomId]}을 탈출했어요!`;
}

/** Fixed creation refusals: they never echo the options (which carry the spawn token). */
const CREATE_BAD_OPTIONS = "반을 열 수 없어요: 반을 여는 정보가 올바르지 않아요";
const CREATE_CODE_IN_USE = "반을 열 수 없어요: 이 반 코드는 이미 다른 방이 쓰고 있어요";

/** Limiter key for failed teacher passes when the client IP is unknown (same idea as WorldRoom). */
const GLOBAL_IP_KEY = "__no_ip__";

/**
 * Fixed log lines for a failed call between the class and an escape room. A failed
 * `matchMaker.createRoom` / `remoteRoomCall` carries the options or the arguments (spawn token,
 * tickets, nicknames) in its error, so only these lines are ever logged — never the error.
 */
const LOG_OPEN_FAILED = "[caysonverse] the class could not open an escape room";
const LOG_ENTER_FAILED = "[caysonverse] the class could not handle a press of the door";
const LOG_ADMIT_FAILED = "[caysonverse] the class could not admit a member to its escape room";
type EscapeCall = "classCommand" | "kickMember";
const logCallFailed = (method: EscapeCall) => `[caysonverse] class call to an escape room failed: ${method}`;

/** A ticket is 18 random bytes = 24 base64url symbols (EscapeRoom accepts 16–128). */
const TICKET_BYTES = 18;
/**
 * One session is sent at most one ticket per this gap by its own presses (EnterRoom at the team's
 * door, EscapeRejoin): a double press must not revoke the ticket its client is using (a newer
 * ticket for the same member replaces the older one in EscapeRoom), and a flood of rejoins is cut.
 */
const TICKET_REPEAT_GAP_MS = 2000;
/** At the class's end, wait at most this long for every running classroom to end and report. */
const END_RESULTS_WAIT_MS = 3000;
/** A member coming out of a classroom lands this close (m) to the door's return point (on its pad). */
const RETURN_JITTER = 0.6;
/** Hints the escape rooms may give per stage (phase 1: all three tiers). */
const MAX_HINT_TIER = 3;

function isRoomId(v: unknown): v is RoomId {
  return typeof v === "string" && (ROOM_IDS as readonly string[]).includes(v);
}

/** Server-only, per connection (never synced). Colyseus carries it over a reconnect. */
interface ClassMarker {
  ip: string | null;
  /** True only for a connection admitted with a verified one-time teacher pass. */
  teacher: boolean;
}

/** What `onAuth` hands to `onJoin`. */
interface AuthResult {
  ip: string | null;
}

/** The base bookkeeping plus the door pad this player stands on (never synced). */
interface ClassTracking extends Tracking {
  /** The room whose door pad the player is on, or null. Updated on every accepted move. */
  padDoor: RoomId | null;
  /** When (ms) the player stepped onto that pad — "먼저 모인 사람" leads the team (0 when off). */
  padSince: number;
  /** When (ms) this session was last sent an escape-room ticket (0 = never). */
  ticketAt: number;
}

/** What a session that takes a ghost over inherits from it (Review Focus 1). */
interface Inherited {
  /** The ghost's team ("" if none). */
  teamId: string;
  x: number;
  z: number;
  yaw: number;
  padDoor: RoomId | null;
  padSince: number;
  /** Where the ghost was: PLACE_ESCAPE → the new session goes straight back into the classroom. */
  place: number;
}

function isIndex(v: unknown, length: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < length;
}

/**
 * A positive number from a TEST-ONLY environment override (same pattern as CV_RECONNECT_WINDOW_S),
 * read each time it is needed; production never sets these.
 */
function testOverrideMs(name: "CV_CLASS_END_GRACE_MS" | "CV_CLASS_EMPTY_CLOSE_MS", fallback: number): number {
  const raw = process.env[name];
  const ms = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}

function readOpener(v: unknown): ClassCreateOptions["opener"] | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.group !== "string" || typeof o.label !== "string") return null;
  return { id: o.id, group: o.group, label: o.label };
}

/**
 * One class (반) of "AI 학교 탈출": the hub (hall + east corridor) where a class gathers, forms
 * teams and walks to the room doors, with the teacher's controls.
 *
 * Created ONLY by server code (the teacher HTTP route) with the spawn token; registered as
 * `defineRoom(ClassRoom).filterBy(["classCode"])`, so a student's `join(CLASS_ROOM, { classCode })`
 * lands in exactly that class and never creates one.
 *
 * Join (binding order): stage-3 join validation → class code → not ended → kick deny list →
 * nickname profanity → nickname decision (taken / take over a ghost / new) → teacher pass. The
 * join changes nothing until every check has passed.
 *
 * Phases: the teacher's `ClassMsg.Command` (start / pause / resume / end, `nextPhase`). The east
 * gate is shut in the lobby (and after the end) — `geometry()` follows the phase. End locks the
 * room, announces it, and closes every connection with CLASS_CLOSED_CODE after CLASS_END_GRACE_MS.
 * An empty class closes after CLASS_EMPTY_CLOSE_MS (a join or a reconnect cancels that).
 *
 * The shared player messages (Move, Chat, Emoji, Jump, Typing) and the reconnection lifecycle come
 * from PlayerRoom; hall chat is the base's public chat. Announce and Kick work as in the world,
 * for teachers only.
 *
 * Teams (Task 6, rules in ./teams.ts): a student standing on the team rug (`inTeamZone`, in the hall,
 * not inside an escape room) creates, joins or leaves a team; anything else about those messages —
 * a teacher, off the rug, a malformed payload, an unknown team — is dropped silently, and only a
 * rule refusal (already in a team, combo taken, team full, too many teams) gets a personal
 * `ClassMsg.Notice`. The teacher's `TeamAuto` fills or shuffles. Invariant: `player.teamId === id`
 * exactly when the player's sid is in `teams[id].members`; a team nobody is left in is deleted. A
 * permanent leave takes the player out of its team; a ghost keeps its seat until then.
 *
 * Door pads: every accepted move checks `doorAtPad`; stepping on or off a pad (rare) records the
 * arrival time and recounts that team's `padDoor/padLeaderSid/padCount` (`teamPadStatus`: connected
 * members in the hub only), as do disconnects, reconnects, leaves and membership changes.
 *
 * Team classrooms (Task 11): the pad leader's `EnterRoom` opens the team's EscapeRoom
 * (`matchMaker.createRoom` with the spawn token, one at a time per team) and every member on that
 * pad gets a one-time ticket (`admit` by remoteRoomCall, then `ClassMsg.EscapeTicket` to that
 * member only — never in state, never logged). A teammate who comes to the pad later, a refreshed
 * tab that takes over a ghost who was inside, and an `EscapeRejoin` get a ticket of their own.
 * Teachers never get one (phase 1: a teacher is not a puzzle member). The escape room reports back
 * through the public callbacks below (entered / left / chat / result / disposed); `place` follows
 * them, the teacher sees every team chat (`TeamChatMirror`), and the class keeps the last result per
 * (team, room) for the CSV. The teacher's pause / resume / end reach every running classroom; a
 * kick reaches the kicked member's classroom too. Members inside a classroom neither walk in the
 * hub nor hear (or speak in) the hall chat (ruling E13).
 */
export class ClassRoom extends PlayerRoom<ClassState, ClassTracking> {
  patchRate = PATCH_RATE_MS;
  state = new ClassState();

  /**
   * True once onCreate has passed every check and this room owns its registry entry. Colyseus
   * calls onDispose even on a room whose onCreate threw (a refused client create) — such a room
   * owns nothing and must not touch the registry (Task 4 registry hardening).
   */
  private created = false;
  private classCode = "";
  private opener: ClassCreateOptions["opener"] = { id: "", group: "", label: "" };

  /** Kick deny list — this class only, memory only. */
  private readonly denySet = new DenySet();
  /** Failed teacher passes per IP (or one shared key when the IP is unknown). */
  private readonly passAttempts = new AdminAttemptLimiter();
  /** Open reconnection windows by sessionId, so a takeover can close the ghost's window. */
  private readonly reconnectWindows = new Map<string, Deferred<Client>>();
  /** The pending "close the empty class" timer, if any. */
  private emptyClose: Delayed | null = null;
  /** Team ids are "team-<n>", never reused within a class. */
  private teamSeq = 0;
  /** Teams whose classroom is being opened right now (set before the first await: one per team). */
  private readonly creating = new Set<string>();
  /** The last result per (team, room), by `${teamId}/${roomId}`, in first-report order (the CSV). */
  private readonly results = new Map<string, EscapeResult>();
  /** Clients that must not hear the hall chat (inside a classroom); refilled per line, never reallocated. */
  private readonly awayClients: Client[] = [];

  onCreate(options: ClassCreateOptions): void {
    // FIRST: only server code knows the token, so a client's create / joinOrCreate stops here,
    // before this room has touched anything.
    assertSpawnToken(options);

    const o = options as unknown as Record<string, unknown>;
    const code = normalizeClassCode(o.classCode);
    const opener = readOpener(o.opener);
    const textLevel: TextLevel | null = o.textLevel === "easy" || o.textLevel === "hard" ? o.textLevel : null;
    if (code === null || opener === null || textLevel === null) throw new Error(CREATE_BAD_OPTIONS);
    // Claim the code: fills the HTTP route's reservation (or registers a directly created class),
    // never another live room's entry.
    if (!classRegistry.attach(code, this.roomId, { code, opener, textLevel, openedAt: this.now() })) {
      throw new Error(CREATE_CODE_IN_USE);
    }

    // Every check passed — from here on nothing throws, and this room owns the code.
    this.created = true;
    this.classCode = code;
    this.opener = opener;
    this.state.classCode = code;
    this.state.textLevel = textLevel;
    this.state.openRooms.push(...PHASE1_OPEN_ROOMS);
    this.autoDispose = false; // lives until ended or empty (see armEmptyClose), not until the last leave
    this.maxClients = MAX_CLIENTS;

    // Move, Chat, Emoji, Jump, Typing (+ the "*" catch-all for stray types).
    this.registerPlayerMessages();
    this.onMessage(ClassMsg.Command, (client, payload) => {
      this.handleCommand(client, payload);
    });
    this.onMessage(MessageType.Announce, (client, payload) => {
      this.handleAnnounce(client, payload);
    });
    this.onMessage(MessageType.Kick, (client, payload) => {
      this.handleKick(client, payload);
    });
    this.onMessage(ClassMsg.TeamCreate, (client, payload) => {
      this.handleTeamCreate(client, payload);
    });
    this.onMessage(ClassMsg.TeamJoin, (client, payload) => {
      this.handleTeamJoin(client, payload);
    });
    this.onMessage(ClassMsg.TeamLeave, (client) => {
      this.handleTeamLeave(client);
    });
    this.onMessage(ClassMsg.TeamAuto, (client, payload) => {
      this.handleTeamAuto(client, payload);
    });
    this.onMessage(ClassMsg.EnterRoom, (client, payload) => {
      // Async and not awaited by Colyseus: a rejection must never reach the process (it would end it).
      this.handleEnterRoom(client, payload).catch(() => console.error(LOG_ENTER_FAILED));
    });
    this.onMessage(ClassMsg.EscapeRejoin, (client) => {
      this.handleEscapeRejoin(client);
    });
    this.onMessage(ClassMsg.ResultsRequest, (client) => {
      this.handleResultsRequest(client);
    });

    // A class nobody ever enters closes like one everybody left.
    this.armEmptyClose();
  }

  onDispose(): void {
    if (!this.created) return; // a refused create owns nothing
    classRegistry.release(this.classCode, this.roomId);
  }

  /** The client IP for the teacher-pass limiter (see WorldRoom.onAuth for the trust model). */
  onAuth(_client: Client, _options: unknown, context: AuthContext): AuthResult {
    return { ip: resolveClientIp(context) };
  }

  onJoin(client: Client, options: unknown, auth?: AuthResult): void {
    const ip = auth?.ip ?? null;

    // 1. Nickname + nested appearance (stage 3, ruling E5).
    const result = validateJoinOptions(options);
    if ("error" in result) throw new Error(result.error);
    const o = options as { classCode?: unknown; teacherPass?: unknown };

    // 2–3. This class, still running. (The matchmaker's filter and lock normally refuse first.)
    if (normalizeClassCode(o.classCode) !== this.state.classCode) throw new Error(CLASS_JOIN_ERRORS.wrongCode);
    if (this.state.phase === "ended") throw new Error(CLASS_JOIN_ERRORS.ended);

    // A nickname the teacher kicked stays out (nickname key only, as in the world).
    if (this.denySet.isDenied({ ip, nickname: result.nickname })) throw new Error(CLASS_JOIN_ERRORS.kicked);

    // 4. A nickname everybody will see must be clean.
    if (!checkWords(result.nickname).ok) throw new Error(CLASS_JOIN_ERRORS.badNickname);

    // 5. One player per nickname: refuse an active one, take over a ghost (a refreshed tab) —
    //    but only in the ghost's own role, so a student cannot push a disconnected teacher out
    //    (nor a teacher's pass take a student's place). Decided before the pass is spent.
    const wantsTeacher = o.teacherPass !== undefined && o.teacherPass !== null && o.teacherPass !== "";
    const decision = decideNickname(this.roster(), nicknameKey(result.nickname));
    if (decision.kind === "taken") throw new Error(CLASS_JOIN_ERRORS.nicknameTaken);
    if (decision.kind === "takeover" && this.isTeacherSid(decision.sid) !== wantsTeacher) {
      throw new Error(CLASS_JOIN_ERRORS.nicknameTaken);
    }

    // 6. A teacher proves it with a one-time pass from the HTTP route (throws when it fails).
    if (wantsTeacher) this.admitTeacher(o.teacherPass, ip);

    // ── Every check passed: from here the join changes state. ──
    const inherited = decision.kind === "takeover" ? this.takeOver(decision.sid, client.sessionId) : null;

    // 7. Into the hall, around the spawn point — or, taking a ghost over, where the ghost stood (and
    //    straight back into the team's classroom if the ghost was inside one that still runs).
    const at = inherited ?? this.spawnPosition();
    const backInto = inherited?.place === PLACE_ESCAPE ? this.escapeRoomOf(inherited.teamId) : "";
    const player = new Player();
    player.nickname = result.nickname;
    for (const field of APPEARANCE_FIELDS) player[field] = result.appearance[field];
    player.x = at.x;
    player.z = at.z;
    player.yaw = inherited?.yaw ?? 0;
    player.connected = true;
    player.role = wantsTeacher ? ROLE_TEACHER : ROLE_STUDENT; // the only write of role
    player.place = backInto !== "" ? PLACE_ESCAPE : PLACE_HUB;
    player.teamId = inherited?.teamId ?? "";

    const marker: ClassMarker = { ip, teacher: wantsTeacher };
    client.userData = marker;
    this.seatPlayer(client, player);
    if (inherited) {
      // Same spot, same arrival on the same pad: a refreshed pad leader stays the leader.
      const track = this.tracking.get(client.sessionId)!;
      track.padDoor = inherited.padDoor;
      track.padSince = inherited.padSince;
      if (player.teamId !== "") this.refreshPad(player.teamId);
    }
    this.cancelEmptyClose();
    // A refreshed tab that was inside: a new ticket at once (Review Focus 1). It reaches the client
    // right after its join completes (Colyseus queues messages sent while it is joining).
    if (backInto !== "") void this.sendTicket(client, player, backInto);
  }

  /** Base drop handling (ghost + reconnection window), then the empty-class timer if nobody is left. */
  onDrop(client: Client, code?: number): void {
    super.onDrop(client, code);
    this.refreshPadOf(client.sessionId); // a ghost is not counted on a pad
    this.armEmptyClose();
  }

  onReconnect(client: Client): void {
    this.reconnectWindows.delete(client.sessionId);
    super.onReconnect(client);
    this.refreshPadOf(client.sessionId);
    this.cancelEmptyClose();
  }

  /**
   * Permanent departure (consented leave, kick, expired or closed reconnection window): out of its
   * team (the last one out deletes it), then out of the state. Keyed by the departing sessionId
   * only, so the late leave of a session that was taken over never touches the session that
   * replaced it (Review Focus 1).
   */
  onLeave(client: Client): void {
    this.reconnectWindows.delete(client.sessionId);
    this.leaveTeamOf(client.sessionId);
    this.unseatPlayer(client.sessionId);
    this.armEmptyClose();
  }

  /**
   * The base's reconnection window, remembered by sessionId so `takeOver` can close it. Colyseus
   * answers with a plain rejected Promise when no window can be opened (a client that never
   * finished joining, a room being disposed); only a real window is remembered.
   */
  allowReconnection(previousClient: Client, seconds: number | "manual"): Deferred<Client> {
    const window = super.allowReconnection(previousClient, seconds);
    if (typeof (window as { reject?: unknown }).reject === "function") {
      this.reconnectWindows.set(previousClient.sessionId, window);
    }
    return window;
  }

  /**
   * A dropped student keeps its team for CLASS_RECONNECT_WINDOW_S (180 s), not the world's 20 s:
   * a phone that locks for half a minute comes back to the same team (and the same classroom).
   * Teammates see a ghost meanwhile; only the expiry (onLeave) takes the player out of its team.
   */
  protected defaultReconnectWindowSeconds(): number {
    return CLASS_RECONNECT_WINDOW_S;
  }

  /** The hub: the east gate stays shut until the class starts (and shuts again at the end). */
  protected geometry(): MapGeometry {
    return hubGeometry(this.state.phase === "running" || this.state.phase === "paused");
  }

  protected spawnPosition(): { x: number; z: number } {
    return spawnInDisk(HUB_SPAWN.x, HUB_SPAWN.z, HUB_SPAWN_JITTER, this.geometry());
  }

  protected createTracking(now: number): ClassTracking {
    return { ...baseTracking(now), padDoor: null, padSince: 0, ticketAt: 0 };
  }

  /** A member inside a classroom is not in the hub: its class Move and Jump are dropped (one compare). */
  protected canMove(player: Player): boolean {
    return player.place === PLACE_HUB;
  }

  /**
   * Hall chat (ruling E13): only the clients in the hub hear it, and a member inside a classroom does
   * not speak in it (their chat is the team chat, in the escape room). One broadcast, encoded once;
   * the reused `awayClients` list holds who is inside (usually nobody).
   */
  protected deliverChat(client: Client, player: Player, text: string): void {
    if (player.place !== PLACE_HUB) return;
    const away = this.awayClients;
    away.length = 0;
    for (const c of this.clients) {
      if (this.state.players.get(c.sessionId)?.place === PLACE_ESCAPE) away.push(c);
    }
    const line: ChatBroadcast = { sid: client.sessionId, name: player.nickname, text };
    this.broadcast(MessageType.Chat, line, away.length > 0 ? { except: away } : undefined);
    away.length = 0;
  }

  /** A held-back hall line: the teachers see it masked, filed under "중앙 홀". */
  protected onChatBlocked(_client: Client, player: Player, masked: string): void {
    const m: TeamChatMirrorPayload = {
      teamId: "",
      teamName: HALL_MIRROR_NAME,
      name: player.nickname,
      text: masked,
      filtered: true,
      at: this.now(),
    };
    this.mirrorToTeachers(m);
  }

  /**
   * Door-pad tracking, on every accepted move (hot path): one `doorAtPad` lookup and a compare —
   * nothing is allocated unless the player steps on or off a pad.
   */
  protected afterMove(_client: Client, player: Player, track: ClassTracking, now: number): void {
    const door = doorAtPad(player.x, player.z);
    if (door === track.padDoor) return;
    track.padDoor = door;
    track.padSince = door === null ? 0 : now;
    if (player.teamId !== "") this.refreshPad(player.teamId);
  }

  /** Everyone in the class, for the nickname decision. */
  private roster(): { sid: string; key: string; connected: boolean }[] {
    const out: { sid: string; key: string; connected: boolean }[] = [];
    this.state.players.forEach((p, sid) => {
      out.push({ sid, key: nicknameKey(p.nickname), connected: p.connected });
    });
    return out;
  }

  private isTeacherSid(sid: string): boolean {
    return this.state.players.get(sid)?.role === ROLE_TEACHER;
  }

  /** True if this connection was admitted as a teacher (server-side marker only). */
  private isTeacher(client: Client): boolean {
    return (client.userData as ClassMarker | undefined)?.teacher === true;
  }

  /**
   * Spend a one-time teacher pass for THIS class and check its key may teach the class's opener.
   * Throws the Korean refusal otherwise. Failures are limited per IP (5 per minute); once blocked,
   * no pass is even looked at. The pass itself is never logged or echoed.
   */
  private admitTeacher(pass: unknown, ip: string | null): void {
    const limiterKey = ip ?? GLOBAL_IP_KEY;
    const now = this.now();
    if (this.passAttempts.isBlocked(limiterKey, now)) throw new Error(CLASS_JOIN_ERRORS.tooManyPassAttempts);
    const key = classRegistry.consumePass(pass, this.classCode, now);
    if (key && canTeach(key, this.opener)) return;
    this.passAttempts.recordFailure(limiterKey, now);
    throw new Error(CLASS_JOIN_ERRORS.passExpired);
  }

  /**
   * Replace a disconnected player (`ghostSid`) by the joining session: the ghost leaves the state,
   * its team seat (and the pad lead, if it held it) goes to `newSid`, and its reconnection window
   * is closed so the old session can never come back next to the new one. Returns what the new
   * player inherits: the team ("" if none), the ghost's spot, its door-pad arrival and its place
   * (inside a classroom → onJoin sends the new session a ticket back in).
   */
  private takeOver(ghostSid: string, newSid: string): Inherited {
    const ghost = this.state.players.get(ghostSid);
    const track = this.tracking.get(ghostSid);
    const teamId = ghost?.teamId ?? "";
    const team = teamId !== "" ? this.state.teams.get(teamId) : undefined;
    const seat = team ? team.members.indexOf(ghostSid) : -1;
    if (team && seat >= 0) {
      const members = [...team.members];
      members[seat] = newSid;
      this.writeMembers(team, members);
      if (team.padLeaderSid === ghostSid) team.padLeaderSid = newSid;
    }
    const at = ghost ?? this.spawnPosition(); // (decideNickname found the ghost in state)
    const inherited: Inherited = {
      teamId: seat >= 0 ? teamId : "",
      x: at.x,
      z: at.z,
      yaw: ghost?.yaw ?? 0,
      padDoor: track?.padDoor ?? null,
      padSince: track?.padSince ?? 0,
      place: seat >= 0 ? (ghost?.place ?? PLACE_HUB) : PLACE_HUB,
    };

    this.unseatPlayer(ghostSid);
    const window = this.reconnectWindows.get(ghostSid);
    if (window) {
      this.reconnectWindows.delete(ghostSid);
      window.reject(new Error("taken over")); // Colyseus then runs onLeave(ghost): sid-keyed, harmless
    }
    return inherited;
  }

  // ───────────────────────────────────── Teams ─────────────────────────────────────

  private notice(client: Client, text: string): void {
    const payload: NoticePayload = { text };
    client.send(ClassMsg.Notice, payload);
  }

  /** The sender's player if it may make team moves: a student, in the hub, on the team rug. */
  private teamActor(client: Client): Player | null {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.isTeacher(client) || player.place !== PLACE_HUB) return null;
    return inTeamZone(player.x, player.z) ? player : null;
  }

  private recOf(team: Team): TeamRec {
    return {
      id: team.id,
      nameIndex: team.nameIndex,
      colorIndex: team.colorIndex,
      members: [...team.members],
      // A team whose classroom is being opened counts as inside: auto-assign must not regroup it.
      inEscape: team.escapeRoomId !== "" || this.creating.has(team.id),
    };
  }

  private teamRecs(): TeamRec[] {
    const out: TeamRec[] = [];
    this.state.teams.forEach((team) => out.push(this.recOf(team)));
    return out;
  }

  /** Students with no team, connected and in the hall, in joining order (auto-assign's input). */
  private looseStudents(): string[] {
    const out: string[] = [];
    this.state.players.forEach((p, sid) => {
      if (p.role === ROLE_STUDENT && p.teamId === "" && p.connected && p.place === PLACE_HUB) out.push(sid);
    });
    return out;
  }

  /**
   * The ONLY way a team's member list changes after creation: one `clear()` + `push(...next)` —
   * never splice, pop, unshift or an index write. Colyseus 0.17 / @colyseus/schema 4.0.27: a client
   * that joins inside a patch window gets the full state (already holding the window's changes) and
   * then that window's patch on top; ArraySchema ops encoded against the window's starting layout
   * (a DELETE by old index, an ADD at an index that has since moved, an ADD at index 0 that the
   * decoder treats as unshift) corrupt that client's copy. A CLEAR followed by ADD 0..n-1 of the
   * current values decodes to the same list whatever the client held before. (Pinned by the
   * "mid-patch-window" integration test.) No-op when the list is unchanged.
   */
  private writeMembers(team: Team, next: readonly string[]): void {
    const cur = team.members;
    if (cur.length === next.length && next.every((sid, i) => cur[i] === sid)) return;
    cur.clear();
    if (next.length > 0) cur.push(...next);
  }

  /** Add a new team to the state, point its members at it and count its pad. */
  private addTeam(id: string, nameIndex: number, colorIndex: number, members: readonly string[]): void {
    const team = new Team();
    team.id = id;
    team.nameIndex = nameIndex;
    team.colorIndex = colorIndex;
    team.members.push(...members);
    this.state.teams.set(id, team);
    for (const sid of members) {
      const p = this.state.players.get(sid);
      if (p) p.teamId = id;
    }
    this.refreshPad(id);
  }

  /** Take `sid` out of its team, if any; the last one out deletes the team. */
  private leaveTeamOf(sid: string): void {
    const player = this.state.players.get(sid);
    if (!player || player.teamId === "") return;
    const team = this.state.teams.get(player.teamId);
    player.teamId = "";
    if (!team) return;
    const rec = this.recOf(team);
    if (leaveTeam(rec, sid).empty) {
      this.state.teams.delete(team.id);
      return;
    }
    this.writeMembers(team, rec.members);
    this.refreshPad(team.id);
  }

  /** Recount the door-pad status of `sid`'s team (if it has one). */
  private refreshPadOf(sid: string): void {
    const teamId = this.state.players.get(sid)?.teamId ?? "";
    if (teamId !== "") this.refreshPad(teamId);
  }

  /**
   * Recount a team's door-pad status from its members' tracking: only connected members in the hub
   * count (a ghost or a member inside an escape room does not). Runs on pad changes, connectivity
   * changes and membership changes — never on a plain move — so its small array is not a hot-path
   * allocation. Writes only the fields that changed.
   */
  private refreshPad(teamId: string): void {
    const team = this.state.teams.get(teamId);
    if (!team) return;
    const presence: PadPresence[] = [];
    for (const sid of team.members) {
      const p = this.state.players.get(sid);
      const t = this.tracking.get(sid);
      const counted = p !== undefined && t !== undefined && p.connected && p.place === PLACE_HUB;
      presence.push({ sid, door: counted ? t.padDoor : null, arrivedAt: t?.padSince ?? 0 });
    }
    const status = teamPadStatus(presence);
    if (team.padDoor !== status.door) team.padDoor = status.door;
    if (team.padLeaderSid !== status.leaderSid) team.padLeaderSid = status.leaderSid;
    if (team.padCount !== status.count) team.padCount = status.count;
  }

  /** `{ nameIndex, colorIndex }` from a student on the rug: a new team of one, or a notice why not. */
  private handleTeamCreate(client: Client, payload: unknown): void {
    const player = this.teamActor(client);
    if (!player) return; // silent drop
    const p = payload as { nameIndex?: unknown; colorIndex?: unknown } | null | undefined;
    const nameIndex = p?.nameIndex;
    const colorIndex = p?.colorIndex;
    if (!isIndex(nameIndex, TEAM_NAMES.length) || !isIndex(colorIndex, TEAM_COLORS.length)) return;
    const made = createTeam(this.teamRecs(), client.sessionId, nameIndex, colorIndex, `team-${this.teamSeq + 1}`);
    if ("error" in made) {
      this.notice(client, made.error);
      return;
    }
    this.teamSeq++;
    this.addTeam(made.id, made.nameIndex, made.colorIndex, made.members);
  }

  /** `{ teamId }` from a student on the rug: join at the end, or a notice why not. */
  private handleTeamJoin(client: Client, payload: unknown): void {
    const player = this.teamActor(client);
    if (!player) return; // silent drop
    const teamId = (payload as { teamId?: unknown } | null | undefined)?.teamId;
    if (typeof teamId !== "string") return;
    const team = this.state.teams.get(teamId);
    if (!team) return; // unknown (or just dissolved) team
    if (player.teamId !== "") {
      this.notice(client, TEAM_ERRORS.alreadyInTeam);
      return;
    }
    const rec = this.recOf(team);
    const refused = joinTeam(rec, client.sessionId);
    if (refused) {
      this.notice(client, refused.error);
      return;
    }
    this.writeMembers(team, rec.members);
    player.teamId = team.id;
    this.refreshPad(team.id);
  }

  /** A student on the rug leaves its team (no team → dropped). */
  private handleTeamLeave(client: Client): void {
    const player = this.teamActor(client);
    if (!player || player.teamId === "") return; // silent drop
    this.leaveTeamOf(client.sessionId);
  }

  /** Teacher only: `{ mode: "fill" | "shuffle" }` → autoAssign over the loose students. */
  private handleTeamAuto(client: Client, payload: unknown): void {
    if (!this.isTeacher(client)) return; // silent drop
    const mode = (payload as { mode?: unknown } | null | undefined)?.mode;
    if (mode !== "fill" && mode !== "shuffle") return;
    this.applyPlan(autoAssign(this.teamRecs(), this.looseStudents(), mode, Math.random));
  }

  /** Write an auto-assign plan into state: dissolve, then joins (one member write per team), then new teams. */
  private applyPlan(plan: TeamPlan): void {
    for (const id of plan.dissolve) {
      const team = this.state.teams.get(id);
      if (!team) continue;
      for (const sid of team.members) {
        const p = this.state.players.get(sid);
        if (p && p.teamId === id) p.teamId = "";
      }
      this.state.teams.delete(id);
    }

    const grown = new Map<string, string[]>();
    for (const { teamId, sid } of plan.joins) {
      let members = grown.get(teamId);
      if (!members) {
        const team = this.state.teams.get(teamId);
        if (!team) continue;
        members = [...team.members];
        grown.set(teamId, members);
      }
      members.push(sid);
    }
    for (const [teamId, members] of grown) {
      this.writeMembers(this.state.teams.get(teamId)!, members);
      for (const sid of members) {
        const p = this.state.players.get(sid);
        if (p) p.teamId = teamId;
      }
      this.refreshPad(teamId);
    }

    for (const c of plan.creates) {
      this.teamSeq++;
      this.addTeam(`team-${this.teamSeq}`, c.nameIndex, c.colorIndex, c.members);
    }
  }

  /** Teacher only: apply a phase change, announce it to everyone, and close the class after an end. */
  private handleCommand(client: Client, payload: unknown): void {
    if (!this.isTeacher(client)) return; // silent drop
    const cmd = (payload as { cmd?: unknown } | null | undefined)?.cmd;
    if (!isClassCommand(cmd)) return;
    const next = nextPhase(this.state.phase, cmd);
    if (next === null) return; // not applicable now → ignored, nothing said

    this.state.phase = next;
    this.broadcast(MessageType.System, { text: PHASE_NOTICES[cmd] });
    // Every running classroom stops and goes on with the class (its timer, hint gap, cool-down).
    if (cmd === "pause" || cmd === "resume") void Promise.all(this.commandEscapeRooms(cmd));
    if (next === "ended") void this.endClass();
  }

  /**
   * The class is over: no new joins (lock → the matchmaker refuses; the registry refuses a teacher
   * pass for it); every running classroom ends and reports its result — an unfinished one too — and
   * the class waits for that (at most END_RESULTS_WAIT_MS) so the CSV has every team. That final
   * CSV is pushed to every connected teacher at once (final review I1: the teacher would otherwise
   * have to think of asking for it within the grace). Then, after the grace, everyone is closed
   * with CLASS_CLOSED_CODE and the room disposes.
   */
  private async endClass(): Promise<void> {
    this.cancelEmptyClose();
    void this.lock();
    classRegistry.markEnded(this.classCode, this.roomId);
    await this.settleWithin(this.commandEscapeRooms("end"), END_RESULTS_WAIT_MS);
    this.sendFinalResults();
    this.clock.setTimeout(() => {
      void this.disconnect(CLASS_CLOSED_CODE);
    }, testOverrideMs("CV_CLASS_END_GRACE_MS", CLASS_END_GRACE_MS));
  }

  /** The results as CSV (the last one per team and room); `final` marks the end-of-class copy. */
  private resultsPayload(final: boolean): ResultsCsvPayload {
    const csv = buildResultsCsv([...this.results.values()]);
    return final ? { csv, final: true } : { csv };
  }

  /** The end-of-class CSV, once, to every teacher connected now (one CSV built for all of them). */
  private sendFinalResults(): void {
    let payload: ResultsCsvPayload | null = null;
    for (const c of this.clients) {
      if (!this.isTeacher(c)) continue;
      payload ??= this.resultsPayload(true);
      c.send(ClassMsg.ResultsCsv, payload);
    }
  }

  /** Resolves when every call has settled (they never reject), or after `ms`, whichever comes first. */
  private settleWithin(calls: Promise<void>[], ms: number): Promise<void> {
    if (calls.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(resolve, ms);
      void Promise.all(calls).then(() => {
        timer.clear();
        resolve();
      });
    });
  }

  /** Start the empty-class timer when nobody is connected (no-op if it already runs, or after the end). */
  private armEmptyClose(): void {
    if (!this.created || this.emptyClose !== null) return;
    if (this.clients.length > 0 || this.state.phase === "ended") return;
    this.emptyClose = this.clock.setTimeout(() => {
      this.emptyClose = null;
      void this.disconnect();
    }, testOverrideMs("CV_CLASS_EMPTY_CLOSE_MS", CLASS_EMPTY_CLOSE_MS));
  }

  private cancelEmptyClose(): void {
    if (this.emptyClose === null) return;
    this.emptyClose.clear();
    this.emptyClose = null;
  }

  /** Teacher only — the world's announce rules (sanitizeAnnounce; "" clears the banner). */
  private handleAnnounce(client: Client, payload: unknown): void {
    if (!this.isTeacher(client)) return; // silent drop
    const text = sanitizeAnnounce((payload as { text?: unknown } | null | undefined)?.text);
    if (text === null) return;
    this.state.announcement = text;
    this.state.announcedAt = this.now();
  }

  /**
   * Teacher only — the world's kick rules: never oneself, the target must be connected, its
   * nickname goes on this class's deny list (nickname key only, never the IP), and it is closed
   * with KICK_CLOSE_CODE (no reconnection window, see PlayerRoom.onDrop). When the target's team
   * has a classroom running, the classroom puts the member out too (`kickMember`: out of the room
   * and its slot, and any ticket not used yet is revoked — so also a member still on the way in).
   */
  private handleKick(client: Client, payload: unknown): void {
    if (!this.isTeacher(client)) return; // silent drop
    const sid = (payload as { sid?: unknown } | null | undefined)?.sid;
    if (typeof sid !== "string" || sid.length === 0 || sid === client.sessionId) return;
    const target = this.clients.getById(sid);
    if (!target) return;
    const player = this.state.players.get(sid);
    const nickname = player?.nickname ?? "";
    this.denySet.add({ ip: (target.userData as ClassMarker | undefined)?.ip ?? null, nickname });
    const inside = player ? this.escapeRoomOf(player.teamId) : "";
    if (inside !== "") void this.callEscapeRoom(inside, "kickMember", [nicknameKey(nickname)]);
    target.leave(KICK_CLOSE_CODE);
  }

  // ─────────────────────────────── Team classrooms (Task 11) ───────────────────────────────

  /** The running classroom (EscapeRoom roomId) of a team, or "" (no team, no classroom). */
  private escapeRoomOf(teamId: string): string {
    return teamId === "" ? "" : (this.state.teams.get(teamId)?.escapeRoomId ?? "");
  }

  /** The press came from a session that was sent a ticket a moment ago (see TICKET_REPEAT_GAP_MS). */
  private ticketedJustNow(track: ClassTracking): boolean {
    return track.ticketAt > 0 && this.now() - track.ticketAt < TICKET_REPEAT_GAP_MS;
  }

  /**
   * `{ room }` — "입장" at a door. Binding order (the brief's rules 1–6):
   *  1. the team already has that door's classroom → a member on that pad goes in alone (a teammate
   *     who came later); anything else is ignored;
   *  2. lobby / paused → why not; ended → ignored;
   *  3. a door not open in this phase → why not;
   *  4. the team is in another classroom, or already escaped from this one → why not;
   *  5. fewer than TEAM_MIN of the team on this door's pad (or no team) → why not; not the pad
   *     leader (the first one there) → why not;
   *  6. one classroom per team: `creating` is set before the first await, so a double press, or two
   *     members pressing at once, opens exactly one (Review Focus 3).
   * Dropped silently: a teacher, a malformed payload, a sender inside a classroom.
   */
  private async handleEnterRoom(client: Client, payload: unknown): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track || this.isTeacher(client) || player.role !== ROLE_STUDENT) return;
    if (player.place !== PLACE_HUB) return;
    const room = (payload as { room?: unknown } | null | undefined)?.room;
    if (!isRoomId(room)) return;
    const team = player.teamId !== "" ? this.state.teams.get(player.teamId) : undefined;

    // 1. A teammate who arrives later at the door the team went through. (Not while the pad's
    //    tickets are still being handed out: that member may be next in line for one.)
    if (team && team.escapeRoomId !== "" && team.escapeDoor === room) {
      if (track.padDoor === room && !this.creating.has(team.id) && !this.ticketedJustNow(track)) {
        await this.sendTicket(client, player, team.escapeRoomId);
      }
      return;
    }

    // 2. The class must be running.
    const phase = this.state.phase;
    if (phase === "ended") return;
    if (phase === "lobby") return this.notice(client, ENTER_ERRORS.lobby);
    if (phase === "paused") return this.notice(client, ENTER_ERRORS.paused);

    // 3. Only the doors open in this phase.
    if (!this.state.openRooms.includes(room)) return this.notice(client, ENTER_ERRORS.notOpen);

    // 4. One classroom at a time, and never one the team already escaped from.
    if (team && team.escapeRoomId !== "") return this.notice(client, ENTER_ERRORS.teamElsewhere);
    if (team && team.escaped.includes(room)) return this.notice(client, ENTER_ERRORS.alreadyEscaped);

    // 5. Enough of the team on this door's pad, and the one who got there first presses.
    if (!team || team.padDoor !== room || team.padCount < TEAM_MIN) {
      return this.notice(client, ENTER_ERRORS.needTeammates);
    }
    if (team.padLeaderSid !== client.sessionId) return this.notice(client, ENTER_ERRORS.notLeader);

    // 6. Exactly one classroom per team, even when presses arrive together.
    if (this.creating.has(team.id)) return;
    await this.openEscapeRoom(client, team.id, room);
  }

  /**
   * Open the team's classroom behind `door` and send every member on that pad in. `creating` is set
   * synchronously, before the first await, and cleared in `finally`. After the room exists the class
   * re-reads its own state (the await let anything happen): a team that is gone or a class that
   * ended meanwhile gets no tickets and the new room is ended at once; a class paused meanwhile
   * pauses it.
   */
  private async openEscapeRoom(leader: Client, teamId: string, door: RoomId): Promise<void> {
    const team = this.state.teams.get(teamId)!;
    this.creating.add(teamId);
    try {
      const options: EscapeCreateOptions = {
        spawnToken: SPAWN_TOKEN,
        classRoomId: this.roomId,
        teamId,
        teamName: teamDisplayName(team.nameIndex, team.colorIndex),
        roomDefId: door,
        textLevel: this.state.textLevel,
        timeLimitS: ESCAPE_TIME_LIMIT_S,
        maxHintTier: MAX_HINT_TIER,
      };
      let roomId: string;
      try {
        roomId = await this.createEscapeRoom(options);
      } catch {
        console.error(LOG_OPEN_FAILED); // never the error: it may carry the options (spawn token)
        this.notice(leader, ENTER_ERRORS.failed);
        return;
      }

      const now = this.state.teams.get(teamId);
      if (now === undefined || this.state.phase === "ended") {
        void this.callEscapeRoom(roomId, "classCommand", ["end"]);
        return;
      }
      now.escapeRoomId = roomId;
      now.escapeDoor = door;
      if (this.state.phase === "paused") void this.callEscapeRoom(roomId, "classCommand", ["pause"]);

      // Everyone of the team on this pad now (connected, in the hub) — a copy: the awaits below let
      // the member list change.
      for (const sid of [...now.members]) {
        if (now.escapeRoomId !== roomId) break; // the classroom closed meanwhile
        const c = this.clients.getById(sid);
        const p = this.state.players.get(sid);
        const t = this.tracking.get(sid);
        if (!c || !p || !t || !p.connected || p.place !== PLACE_HUB || t.padDoor !== door) continue;
        await this.sendTicket(c, p, roomId);
      }
    } finally {
      this.creating.delete(teamId);
    }
  }

  /** Creates the EscapeRoom and returns its roomId (its own method so a test can hold it open). */
  protected async createEscapeRoom(options: EscapeCreateOptions): Promise<string> {
    return (await matchMaker.createRoom(ESCAPE_ROOM, options)).roomId;
  }

  /**
   * One member's way into a classroom: a fresh one-time ticket (18 random bytes), admitted by the
   * escape room first (`admit` by remoteRoomCall: bound to the member's nickname key, with the
   * class Player's nickname, look and role), then sent to that member alone as
   * `ClassMsg.EscapeTicket`. The ticket is never put in state and never logged; when `admit` fails
   * (the room is ending or gone) only a fixed line is logged and nothing is sent.
   * Phase 1: a teacher is never sent one (they would count as a puzzle member).
   */
  private async sendTicket(client: Client, player: Player, roomId: string): Promise<void> {
    if (player.role !== ROLE_STUDENT || this.isTeacher(client)) return;
    const track = this.tracking.get(client.sessionId);
    if (track) track.ticketAt = this.now(); // before the await: a press arriving meanwhile waits
    const ticket = randomBytes(TICKET_BYTES).toString("base64url");
    const admission: Admission = {
      ticket,
      memberKey: nicknameKey(player.nickname),
      nickname: player.nickname,
      role: player.role,
      appearance: pickAppearance(player),
    };
    try {
      await matchMaker.remoteRoomCall<EscapeRoom>(roomId, "admit", [admission]);
    } catch {
      console.error(LOG_ADMIT_FAILED); // never the error: it carries the admission (the ticket)
      return;
    }
    const payload: EscapeTicketPayload = { roomId, ticket };
    client.send(ClassMsg.EscapeTicket, payload);
  }

  /** `classCommand` / `kickMember` on a classroom; a failure logs one fixed line (never the error). */
  private async callEscapeRoom(roomId: string, method: EscapeCall, args: unknown[]): Promise<void> {
    try {
      await matchMaker.remoteRoomCall<EscapeRoom>(roomId, method, args);
    } catch {
      console.error(logCallFailed(method));
    }
  }

  /** The teacher's pause / resume / end for every running classroom (the calls never reject). */
  private commandEscapeRooms(cmd: "pause" | "resume" | "end"): Promise<void>[] {
    const calls: Promise<void>[] = [];
    this.state.teams.forEach((team) => {
      if (team.escapeRoomId !== "") calls.push(this.callEscapeRoom(team.escapeRoomId, "classCommand", [cmd]));
    });
    return calls;
  }

  /**
   * The client could not restore its classroom connection: a member who is inside (place 1) of
   * their team's running classroom gets a new ticket (at most one per TICKET_REPEAT_GAP_MS). Anyone
   * else — in the hub, no team, no classroom, a teacher — is ignored.
   */
  private handleEscapeRejoin(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track || player.place !== PLACE_ESCAPE || this.ticketedJustNow(track)) return;
    const roomId = this.escapeRoomOf(player.teamId);
    if (roomId !== "") void this.sendTicket(client, player, roomId);
  }

  /** Teacher only: the results so far as CSV (the last one per team and room). */
  private handleResultsRequest(client: Client): void {
    if (!this.isTeacher(client)) return; // silent drop
    client.send(ClassMsg.ResultsCsv, this.resultsPayload(false));
  }

  private mirrorToTeachers(m: TeamChatMirrorPayload): void {
    for (const c of this.clients) if (this.isTeacher(c)) c.send(ClassMsg.TeamChatMirror, m);
  }

  /** The class session of the team member whose nickname key is `memberKey`, or null. */
  private memberSid(teamId: unknown, memberKey: unknown): string | null {
    if (typeof teamId !== "string" || typeof memberKey !== "string") return null;
    const team = this.state.teams.get(teamId);
    if (!team) return null;
    for (const sid of team.members) {
      const p = this.state.players.get(sid);
      if (p && nicknameKey(p.nickname) === memberKey) return sid;
    }
    return null;
  }

  /**
   * Out of a classroom, back into the hub: place 0, a spot around `door`'s return point (on its
   * pad), the move clock restarted (no budget from the time inside), and the pad arrival recorded.
   * The caller recounts the team's pad. No-op for someone already in the hub.
   */
  private returnToHub(sid: string, door: string): void {
    const player = this.state.players.get(sid);
    const track = this.tracking.get(sid);
    if (!player || !track || player.place === PLACE_HUB) return;
    player.place = PLACE_HUB;
    const hubDoor = HUB_DOORS.find((d) => d.room === door);
    if (hubDoor) {
      const at = spawnInDisk(hubDoor.returnPoint.x, hubDoor.returnPoint.z, RETURN_JITTER, this.geometry());
      player.x = at.x;
      player.z = at.z;
    }
    const now = this.now();
    track.lastAcceptedAt = now;
    track.padDoor = doorAtPad(player.x, player.z);
    track.padSince = track.padDoor === null ? 0 : now;
  }

  // ── Called by the team's EscapeRoom (matchMaker.remoteRoomCall). The team may be gone by now
  //    (the last member left the class), so every one of them tolerates a missing team or member.

  /** The member came into the classroom (also after a refresh): place 1, not counted on the pad. */
  escapeMemberEntered(teamId: string, memberKey: string): void {
    const sid = this.memberSid(teamId, memberKey);
    if (sid === null) return;
    const player = this.state.players.get(sid)!;
    if (player.place !== PLACE_ESCAPE) player.place = PLACE_ESCAPE;
    this.refreshPad(teamId);
  }

  /** The member left the classroom for good: back in the hub at the door the team went through. */
  escapeMemberLeft(teamId: string, memberKey: string): void {
    const sid = this.memberSid(teamId, memberKey);
    if (sid === null) return;
    this.returnToHub(sid, this.state.teams.get(teamId)!.escapeDoor);
    this.refreshPad(teamId);
  }

  /** A team-chat line (or a held-back one, masked) from a classroom: to the teachers only. */
  escapeChat(m: TeamChatMirrorPayload): void {
    if (typeof m !== "object" || m === null) return;
    this.mirrorToTeachers(m);
  }

  /**
   * A team's result in a room: kept for the CSV (the last one per team and room). An escape also
   * lights the room on the progress board, records the escape and its stars on the team (when the
   * team is still here), and tells the whole class.
   */
  escapeResult(r: EscapeResult): void {
    if (typeof r !== "object" || r === null || typeof r.teamId !== "string" || !isRoomId(r.roomId)) return;
    this.results.set(`${r.teamId}/${r.roomId}`, r);
    if (r.escaped !== true) return;
    if (!this.state.litRooms.includes(r.roomId)) this.state.litRooms.push(r.roomId);
    const team = this.state.teams.get(r.teamId);
    if (team) {
      if (!team.escaped.includes(r.roomId)) team.escaped.push(r.roomId);
      team.stars.set(r.roomId, r.stars);
    }
    this.broadcast(MessageType.System, { text: escapedNotice(r.teamName, r.roomId) });
  }

  /**
   * The team's classroom closed (end, empty, shutdown). Only the team's current one counts: a late
   * report from an older instance is ignored. The team is free again (its door stays recorded), and
   * a member still marked inside (a lost leave report) comes back to the door.
   */
  escapeDisposed(teamId: string, roomId: string): void {
    if (typeof teamId !== "string" || typeof roomId !== "string") return;
    const team = this.state.teams.get(teamId);
    if (!team || team.escapeRoomId === "" || team.escapeRoomId !== roomId) return;
    team.escapeRoomId = "";
    for (const sid of [...team.members]) this.returnToHub(sid, team.escapeDoor);
    this.refreshPad(teamId);
  }
}
