import type { AuthContext, Client, Deferred, Delayed } from "colyseus";
import { ClassState, Player, Team } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import {
  KICK_CLOSE_CODE,
  MAX_CLIENTS,
  PATCH_RATE_MS,
  ROLE_STUDENT,
  ROLE_TEACHER,
} from "@caysonverse/shared/constants";
import { APPEARANCE_FIELDS } from "@caysonverse/shared/appearance";
import {
  CLASS_CLOSED_CODE,
  CLASS_EMPTY_CLOSE_MS,
  CLASS_END_GRACE_MS,
  PHASE1_OPEN_ROOMS,
  PLACE_HUB,
  TEAM_COLORS,
  TEAM_NAMES,
  type ClassCommand,
  type RoomId,
  type TextLevel,
} from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
import { ClassMsg, type NoticePayload } from "@caysonverse/shared/escape/messages";
import { HUB_SPAWN, HUB_SPAWN_JITTER, doorAtPad, hubGeometry, inTeamZone } from "@caysonverse/shared/school/hubMap";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { PlayerRoom, baseTracking, spawnInDisk, type Tracking } from "../rooms/PlayerRoom";
import { validateJoinOptions } from "../rooms/joinValidation";
import { sanitizeAnnounce } from "../rooms/announce";
import { DenySet } from "../rooms/denySet";
import { resolveClientIp } from "../rooms/clientIp";
import { AdminAttemptLimiter } from "../rooms/adminAuth";
import { checkProfanity as checkWords } from "../rooms/profanity";
import { assertSpawnToken } from "../rooms/spawnToken";
import { classRegistry, type ClassCreateOptions } from "./classRegistry";
import { CLASS_API_ERRORS } from "./classApi";
import { canTeach } from "./teacherKeys";
import { isClassCommand, nextPhase } from "./classPhase";
import { decideNickname, nicknameKey } from "./nickname";
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

/** Fixed creation refusals: they never echo the options (which carry the spawn token). */
const CREATE_BAD_OPTIONS = "반을 열 수 없어요: 반을 여는 정보가 올바르지 않아요";
const CREATE_CODE_IN_USE = "반을 열 수 없어요: 이 반 코드는 이미 다른 방이 쓰고 있어요";

/** Limiter key for failed teacher passes when the client IP is unknown (same idea as WorldRoom). */
const GLOBAL_IP_KEY = "__no_ip__";

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

    // 7. Into the hall, around the spawn point — or, taking a ghost over, where the ghost stood.
    const at = inherited ?? this.spawnPosition();
    const player = new Player();
    player.nickname = result.nickname;
    for (const field of APPEARANCE_FIELDS) player[field] = result.appearance[field];
    player.x = at.x;
    player.z = at.z;
    player.yaw = inherited?.yaw ?? 0;
    player.connected = true;
    player.role = wantsTeacher ? ROLE_TEACHER : ROLE_STUDENT; // the only write of role
    player.place = PLACE_HUB;
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

  /** The hub: the east gate stays shut until the class starts (and shuts again at the end). */
  protected geometry(): MapGeometry {
    return hubGeometry(this.state.phase === "running" || this.state.phase === "paused");
  }

  protected spawnPosition(): { x: number; z: number } {
    return spawnInDisk(HUB_SPAWN.x, HUB_SPAWN.z, HUB_SPAWN_JITTER, this.geometry());
  }

  protected createTracking(now: number): ClassTracking {
    return { ...baseTracking(now), padDoor: null, padSince: 0 };
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
   * player inherits: the team ("" if none), the ghost's spot and its door-pad arrival.
   * (Task 11 adds the way back into the team's escape room.)
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
      inEscape: team.escapeRoomId !== "",
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
    if (next === "ended") this.endClass();
  }

  /**
   * The class is over: no new joins (lock → the matchmaker refuses), and after the grace (time to
   * download the results) everyone is closed with CLASS_CLOSED_CODE and the room disposes.
   */
  private endClass(): void {
    this.cancelEmptyClose();
    void this.lock();
    this.clock.setTimeout(() => {
      void this.disconnect(CLASS_CLOSED_CODE);
    }, testOverrideMs("CV_CLASS_END_GRACE_MS", CLASS_END_GRACE_MS));
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
   * with KICK_CLOSE_CODE (no reconnection window, see PlayerRoom.onDrop).
   */
  private handleKick(client: Client, payload: unknown): void {
    if (!this.isTeacher(client)) return; // silent drop
    const sid = (payload as { sid?: unknown } | null | undefined)?.sid;
    if (typeof sid !== "string" || sid.length === 0 || sid === client.sessionId) return;
    const target = this.clients.getById(sid);
    if (!target) return;
    const nickname = this.state.players.get(sid)?.nickname ?? "";
    this.denySet.add({ ip: (target.userData as ClassMarker | undefined)?.ip ?? null, nickname });
    target.leave(KICK_CLOSE_CODE);
  }
}
