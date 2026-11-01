import type { AuthContext, Client, Deferred, Delayed } from "colyseus";
import { ClassState, Player } from "@caysonverse/shared/schema";
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
  type ClassCommand,
  type TextLevel,
} from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import { HUB_SPAWN, HUB_SPAWN_JITTER, hubGeometry } from "@caysonverse/shared/school/hubMap";
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
 */
export class ClassRoom extends PlayerRoom<ClassState> {
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
    const teamId = decision.kind === "takeover" ? this.takeOver(decision.sid, client.sessionId) : "";

    // 7. Into the hall, around the spawn point.
    const spawn = this.spawnPosition();
    const player = new Player();
    player.nickname = result.nickname;
    for (const field of APPEARANCE_FIELDS) player[field] = result.appearance[field];
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = 0;
    player.connected = true;
    player.role = wantsTeacher ? ROLE_TEACHER : ROLE_STUDENT; // the only write of role
    player.place = PLACE_HUB;
    player.teamId = teamId;

    const marker: ClassMarker = { ip, teacher: wantsTeacher };
    client.userData = marker;
    this.seatPlayer(client, player);
    this.cancelEmptyClose();
  }

  /** Base drop handling (ghost + reconnection window), then the empty-class timer if nobody is left. */
  onDrop(client: Client, code?: number): void {
    super.onDrop(client, code);
    this.armEmptyClose();
  }

  onReconnect(client: Client): void {
    this.reconnectWindows.delete(client.sessionId);
    super.onReconnect(client);
    this.cancelEmptyClose();
  }

  /**
   * Permanent departure (consented leave, kick, expired or closed reconnection window). Keyed by
   * the departing sessionId only, so the late leave of a session that was taken over never touches
   * the session that replaced it (Review Focus 1).
   */
  onLeave(client: Client): void {
    this.reconnectWindows.delete(client.sessionId);
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

  protected createTracking(now: number): Tracking {
    return baseTracking(now);
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
   * its team seat goes to `newSid`, and its reconnection window is closed so the old session can
   * never come back next to the new one. Returns the team id the new player inherits ("" if none).
   * (Task 11 adds the way back into the team's escape room.)
   */
  private takeOver(ghostSid: string, newSid: string): string {
    const teamId = this.state.players.get(ghostSid)?.teamId ?? "";
    const team = teamId !== "" ? this.state.teams.get(teamId) : undefined;
    const seat = team ? team.members.indexOf(ghostSid) : -1;
    if (team && seat >= 0) team.members[seat] = newSid;

    this.unseatPlayer(ghostSid);
    const window = this.reconnectWindows.get(ghostSid);
    if (window) {
      this.reconnectWindows.delete(ghostSid);
      window.reject(new Error("taken over")); // Colyseus then runs onLeave(ghost): sid-keyed, harmless
    }
    return seat >= 0 ? teamId : "";
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
