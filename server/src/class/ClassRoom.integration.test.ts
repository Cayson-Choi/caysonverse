import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { matchMaker } from "colyseus";
import { KICK_CLOSE_CODE, MAX_CLIENTS, ROLE_STUDENT, ROLE_TEACHER } from "@caysonverse/shared/constants";
import { MessageType, type SystemBroadcast } from "@caysonverse/shared/messages";
import { APPEARANCE_ERROR, DEFAULT_APPEARANCE, pickAppearance } from "@caysonverse/shared/appearance";
import { CLASS_CLOSED_CODE, CLASS_ROOM, PHASE1_OPEN_ROOMS, PLACE_HUB } from "@caysonverse/shared/escape/constants";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import { Team } from "@caysonverse/shared/schema";
import { HUB_SPAWN, HUB_SPAWN_JITTER } from "@caysonverse/shared/school/hubMap";
import type { Tracking } from "../rooms/PlayerRoom";
import { rooms } from "../rooms";
import { SPAWN_TOKEN } from "../rooms/spawnToken";
import { ClassRoom } from "./ClassRoom";
import { classRegistry, type ClassCreateOptions } from "./classRegistry";
import { mountClassApi } from "./classApi";
import { hashKey, type VerifiedKey } from "./teacherKeys";

/**
 * ClassRoom (escape phase 1, Task 5). ONE boot for the whole file (two boot() calls in one process
 * race on Colyseus's module-level matchmaker), on its own port (ruling E1: 2568 WorldRoom,
 * 2569 ClassRoom, 2570 EscapeRoom, 2571 link test, 2572 PlayerRoom).
 */
const PORT = 2569;

const OPENER = { id: "t1", group: "saebit", label: "새빛초 4-2" };
const T1: VerifiedKey = { id: "t1", label: "새빛초 4-2", group: "saebit", operator: false };
const COLLEAGUE: VerifiedKey = { id: "t2", label: "새빛초 4-3", group: "saebit", operator: false };
const STRANGER: VerifiedKey = { id: "t9", label: "한빛초 5-1", group: "hanbit", operator: false };
/** A teacher key for the HTTP route test (only its sha256 is "on file"). */
const HTTP_KEY = "TEST-KEY-CLASS-ROOM-1";

/** The copy a student/teacher sees (the client shows server Korean as is). */
const ERR = {
  code: "반 코드를 확인해 주세요",
  ended: "수업이 끝났어요",
  badNick: "다른 닉네임을 써 주세요",
  taken: "이 반에 같은 닉네임이 있어요. 다른 닉네임을 써 주세요.",
  pass: "선생님 입장권이 만료됐어요. 다시 반 열기를 눌러 주세요",
  tooMany: "시도가 너무 많아요. 1분 뒤에 다시 해 주세요",
  kicked: "입장이 제한되었습니다",
  spawn: "잘못된 접근이에요",
} as const;

const NOTICE = {
  start: "복도 문이 열렸어요! 팀과 함께 교실로 가 보세요.",
  pause: "선생님이 잠시 멈췄어요.",
  resume: "다시 시작해요!",
  end: "수업이 끝났어요. 함께해 줘서 고마워요!",
} as const;

/** Let broadcast/personal messages propagate to the in-process test clients. */
const flush = () => new Promise((r) => setTimeout(r, 60));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a getter until it is truthy (or timeout), then return its value. */
async function pollFor<T>(read: () => T, timeoutMs = 2000, stepMs = 20): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = read();
  while (!v && Date.now() < deadline) {
    await sleep(stepMs);
    v = read();
  }
  return v;
}

/** The error a refused join/create rejects with: its code and message. */
async function refusal(attempt: Promise<unknown>): Promise<{ code: unknown; message: string }> {
  try {
    await attempt;
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return { code: err.code, message: String(err.message) };
  }
  throw new Error("expected the attempt to be refused");
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(
    config({
      rooms,
      // The teacher HTTP route with its real createClassRoom (matchMaker.createRoom → ClassRoom).
      initializeExpress: (app) =>
        mountClassApi(app, {
          keys: () => [{ id: "t1", label: "새빛초 4-2", group: "saebit", sha256: hashKey(HTTP_KEY) }],
          operatorCode: () => undefined,
        }),
    }),
    PORT,
  );
});

afterAll(async () => {
  await colyseus.shutdown();
});

beforeEach(async () => {
  await colyseus.cleanup();
});

afterEach(() => {
  delete process.env.CV_CLASS_END_GRACE_MS;
  delete process.env.CV_CLASS_EMPTY_CLOSE_MS;
  delete process.env.CV_RECONNECT_WINDOW_S;
});

/** What the teacher HTTP route does: create the class room with the spawn token. */
function openClass(classCode: string, opts: Partial<ClassCreateOptions> = {}): Promise<ClassRoom> {
  const options: ClassCreateOptions = { spawnToken: SPAWN_TOKEN, classCode, textLevel: "easy", opener: OPENER, ...opts };
  return colyseus.createRoom<ClassRoom>(CLASS_ROOM, options);
}

/** A class join payload (stage-3 nested appearance, ruling E5). */
function joinOpts(classCode: string, nickname: string, extra: Record<string, unknown> = {}) {
  return { classCode, nickname, appearance: DEFAULT_APPEARANCE, ...extra };
}

/** Join `room` by id with its own class code. */
function enter(room: ClassRoom, nickname: string, extra: Record<string, unknown> = {}) {
  return colyseus.connectTo(room, joinOpts(room.state.classCode, nickname, extra));
}

/** A fresh one-time teacher pass for `code`, as the HTTP route would hand out. */
function passFor(code: string, key: VerifiedKey = T1): string {
  return classRegistry.issuePass(code, key, Date.now());
}

/** Send one message and wait until the room has handled it. */
async function sendTo(room: ClassRoom, client: { send(type: string, payload?: unknown): void }, type: string, payload?: unknown) {
  client.send(type, payload);
  await room.waitForNextMessage();
  await flush();
}

/** White-box handle on the base's per-session bookkeeping. */
function trackingOf(room: ClassRoom): Map<string, Tracking> {
  return (room as unknown as { tracking: Map<string, Tracking> }).tracking;
}

describe("ClassRoom creation", () => {
  it("refuses creation without the spawn token; a client cannot create a class via matchmaking", async () => {
    const options = { classCode: "N2KEYS", textLevel: "easy", opener: OPENER };
    expect((await refusal(matchMaker.createRoom(CLASS_ROOM, options))).message).toBe(ERR.spawn);
    expect((await refusal(matchMaker.createRoom(CLASS_ROOM, { ...options, spawnToken: "guess" }))).message).toBe(
      ERR.spawn,
    );
    // A client's create / joinOrCreate both end in onCreate, which refuses them.
    expect((await refusal(colyseus.sdk.create(CLASS_ROOM, joinOpts("N2KEYS", "가람")))).message).toBe(ERR.spawn);
    expect((await refusal(colyseus.sdk.joinOrCreate(CLASS_ROOM, joinOpts("N2KEYS", "가람")))).message).toBe(ERR.spawn);
    // Even the server cannot open a class under a malformed code.
    await expect(
      matchMaker.createRoom(CLASS_ROOM, { ...options, spawnToken: SPAWN_TOKEN, classCode: "0OOOOO" }),
    ).rejects.toThrow();
    expect(await matchMaker.query({ name: CLASS_ROOM })).toHaveLength(0);
    expect(classRegistry.get("N2KEYS")).toBeUndefined();

    // With the token the class opens, registered under its own room.
    const room = await openClass("K3YSPK", { textLevel: "hard" });
    expect(classRegistry.get("K3YSPK")).toMatchObject({ code: "K3YSPK", roomId: room.roomId, textLevel: "hard", opener: OPENER });
    expect(room.state.classCode).toBe("K3YSPK");
    expect(room.state.phase).toBe("lobby");
    expect(room.state.textLevel).toBe("hard");
    expect([...room.state.openRooms]).toEqual([...PHASE1_OPEN_ROOMS]);
    expect(room.autoDispose).toBe(false);
    expect(room.maxClients).toBe(MAX_CLIENTS);
    // The listing carries the class code (filterBy) and never the spawn token.
    const listing = await matchMaker.query({ name: CLASS_ROOM });
    expect(listing).toHaveLength(1);
    expect(listing[0].metadata).toEqual({ classCode: "K3YSPK" });
    expect(JSON.stringify(listing)).not.toContain(SPAWN_TOKEN);

    // A second room cannot take over a live code.
    expect((await refusal(openClass("K3YSPK"))).message).toBeTruthy();
    expect(classRegistry.get("K3YSPK")?.roomId).toBe(room.roomId);
    expect(await matchMaker.query({ name: CLASS_ROOM })).toHaveLength(1);
  });

  // Controller ruling (Task 4 registry hardening): Colyseus calls onDispose even on a room whose
  // onCreate threw. A student's create("class", { classCode: <live code> }) must not evict that class.
  it("a refused client create never evicts the live class: the orphan's onDispose leaves the registry alone", async () => {
    const live = await openClass("L5VECL");
    const pass = passFor("L5VECL");

    const original = ClassRoom.prototype.onCreate;
    const orphans: ClassRoom[] = [];
    const spy = vi.spyOn(ClassRoom.prototype, "onCreate").mockImplementation(function (this: ClassRoom, options) {
      orphans.push(this);
      return original.call(this, options);
    });
    try {
      expect((await refusal(colyseus.sdk.create(CLASS_ROOM, joinOpts("L5VECL", "침입자")))).message).toBe(ERR.spawn);
    } finally {
      spy.mockRestore();
    }
    expect(orphans).toHaveLength(1);
    const orphan = orphans[0];
    expect(orphan.roomId).not.toBe(live.roomId);

    // Colyseus disposes the orphan by itself ~seatReservationTimeout later; run that disposal now.
    const events = (orphan as unknown as { _events: { emit(e: string): void; once(e: string, cb: () => void): void } })
      ._events;
    const disposed = new Promise<void>((resolve) => events.once("disconnect", () => resolve()));
    events.emit("dispose");
    await disposed;
    orphan.onDispose(); // and once more by hand, for good measure

    // The live class is still registered, still listed, and its pass still admits the teacher.
    expect(classRegistry.get("L5VECL")?.roomId).toBe(live.roomId);
    expect(matchMaker.getLocalRoomById(live.roomId)).toBe(live);
    const teacher = await enter(live, "선생님", { teacherPass: pass });
    expect(live.state.players.get(teacher.sessionId)?.role).toBe(ROLE_TEACHER);
  });

  it("the teacher HTTP route opens a real ClassRoom and its pass admits the teacher", async () => {
    const res = await colyseus.http.post("/api/class/teacher", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teacherKey: HTTP_KEY, classCode: "HT2PPP", textLevel: "hard" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.data as { classCode: string; pass: string };
    expect(body.classCode).toBe("HT2PPP");

    const roomId = classRegistry.get("HT2PPP")?.roomId;
    expect(typeof roomId).toBe("string");
    const room = colyseus.getRoomById(roomId!) as ClassRoom;
    expect(room).toBeInstanceOf(ClassRoom);
    expect(room.state.classCode).toBe("HT2PPP");
    expect(room.state.textLevel).toBe("hard");

    // The student path: join by class code (the client never sees a room id).
    const teacher = await colyseus.sdk.join(CLASS_ROOM, joinOpts("HT2PPP", "선생님", { teacherPass: body.pass }));
    expect(teacher.roomId).toBe(roomId);
    await flush();
    expect(room.state.players.get(teacher.sessionId)?.role).toBe(ROLE_TEACHER);
  });
});

describe("ClassRoom join", () => {
  it("join by classCode lands only in that class (filterBy)", async () => {
    const a = await openClass("AB2CDE");
    const b = await openClass("ZZ3ZZZ");

    const inB = await colyseus.sdk.join(CLASS_ROOM, joinOpts("ZZ3ZZZ", "가람"));
    const inA = await colyseus.sdk.join(CLASS_ROOM, joinOpts("AB2CDE", "다온"));
    await flush();
    expect(inB.roomId).toBe(b.roomId);
    expect(inA.roomId).toBe(a.roomId);
    expect([...b.state.players.keys()]).toEqual([inB.sessionId]);
    expect([...a.state.players.keys()]).toEqual([inA.sessionId]);

    // The new player: the validated look, a student in the hub with no team, near the hub spawn.
    const p = b.state.players.get(inB.sessionId)!;
    expect(p.nickname).toBe("가람");
    expect(pickAppearance(p)).toEqual(DEFAULT_APPEARANCE);
    expect(p.role).toBe(ROLE_STUDENT);
    expect(p.place).toBe(PLACE_HUB);
    expect(p.teamId).toBe("");
    expect(p.connected).toBe(true);
    expect(Math.hypot(p.x - HUB_SPAWN.x, p.z - HUB_SPAWN.z)).toBeLessThanOrEqual(HUB_SPAWN_JITTER + 1e-9);

    // A code nobody opened finds no class (521) instead of creating one; the filter compares the
    // NORMALISED code, so the client must send normalizeClassCode(typed).
    expect((await refusal(colyseus.sdk.join(CLASS_ROOM, joinOpts("QQ4QQQ", "세온")))).code).toBe(521);
    expect((await refusal(colyseus.sdk.join(CLASS_ROOM, joinOpts("zz3zzz", "세온")))).code).toBe(521);
    expect(await matchMaker.query({ name: CLASS_ROOM })).toHaveLength(2);
  });

  // Ruling E18: the matchmaker refuses an ended (locked) or unknown class before onJoin runs — the
  // client turns 521/522 into its "check the code / the class may have ended" notice (Task 13).
  // onJoin's own code and ended checks stay as defence in depth, reached by id on an unlocked room.
  it("rejects a mismatched code, a profane nickname, an ended class with Korean errors", async () => {
    const room = await openClass("CD3EFG");

    // Matchmaking: a mismatched code finds no class.
    const wrong = await refusal(colyseus.sdk.join(CLASS_ROOM, joinOpts("CD3EFH", "가람")));
    expect(wrong.code).toBe(521);
    expect(wrong.message).toMatch(/no rooms/i);
    // Defence in depth: by id with another code, or a join with no code at all (it matches any class).
    expect((await refusal(colyseus.connectTo(room, joinOpts("CD3EFH", "가람")))).message).toBe(ERR.code);
    const noCode = await refusal(colyseus.sdk.join(CLASS_ROOM, { nickname: "가람", appearance: DEFAULT_APPEARANCE }));
    expect(noCode.message).toBe(ERR.code);
    // The stage-3 join validation runs first (nested appearance, ruling E5).
    expect((await refusal(colyseus.connectTo(room, { classCode: "CD3EFG", nickname: "가람" }))).message).toBe(
      APPEARANCE_ERROR,
    );
    expect((await refusal(colyseus.connectTo(room, joinOpts("CD3EFG", "가")))).message).toContain("닉네임");

    // A profane nickname.
    expect((await refusal(enter(room, "병신이"))).message).toBe(ERR.badNick);

    // Ended but (artificially) unlocked: onJoin's own check.
    room.state.phase = "ended";
    expect((await refusal(enter(room, "가람"))).message).toBe(ERR.ended);
    room.state.phase = "lobby";
    expect(room.state.players.size).toBe(0);

    // The real end: the teacher ends the class → the room locks → both matchmaking paths refuse.
    const teacher = await enter(room, "선생님", { teacherPass: passFor("CD3EFG") });
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "end" });
    expect(room.locked).toBe(true);
    const byCode = await refusal(colyseus.sdk.join(CLASS_ROOM, joinOpts("CD3EFG", "가람")));
    expect(byCode.code).toBe(521);
    expect(byCode.message).toMatch(/no rooms/i);
    const byId = await refusal(colyseus.connectTo(room, joinOpts("CD3EFG", "가람")));
    expect(byId.code).toBe(522);
    expect(byId.message).toMatch(/locked/);
    expect([...room.state.players.keys()]).toEqual([teacher.sessionId]);
  });

  it("teacherPass gives ROLE_TEACHER once; reuse or another class's pass fails", async () => {
    const room = await openClass("TE4CHR");
    const other = await openClass("TE5CHR");

    const pass = passFor("TE4CHR");
    const teacher = await enter(room, "선생님", { teacherPass: pass });
    expect(room.state.players.get(teacher.sessionId)!.role).toBe(ROLE_TEACHER);
    const student = await enter(room, "가람");
    expect(room.state.players.get(student.sessionId)!.role).toBe(ROLE_STUDENT);
    // An empty teacherPass means "no pass": an ordinary student.
    const blank = await enter(room, "다온", { teacherPass: "" });
    expect(room.state.players.get(blank.sessionId)!.role).toBe(ROLE_STUDENT);

    // Reuse: the first join spent it.                                                   failure 1
    expect((await refusal(enter(room, "선생님둘", { teacherPass: pass }))).message).toBe(ERR.pass);
    // Another class's pass does not open this one…                                       failure 2
    const otherPass = passFor("TE5CHR");
    expect((await refusal(enter(room, "선생님셋", { teacherPass: otherPass }))).message).toBe(ERR.pass);
    // …and is not burnt by the attempt.
    const otherTeacher = await enter(other, "선생님", { teacherPass: otherPass });
    expect(other.state.players.get(otherTeacher.sessionId)!.role).toBe(ROLE_TEACHER);
    // The opener's colleague (same group) may teach; a teacher of another group may not.  failure 3
    const colleague = await enter(room, "동료쌤", { teacherPass: passFor("TE4CHR", COLLEAGUE) });
    expect(room.state.players.get(colleague.sessionId)!.role).toBe(ROLE_TEACHER);
    expect((await refusal(enter(room, "남의쌤", { teacherPass: passFor("TE4CHR", STRANGER) }))).message).toBe(ERR.pass);
    // Garbage passes.                                                                   failures 4, 5
    expect((await refusal(enter(room, "가짜하나", { teacherPass: "nope" }))).message).toBe(ERR.pass);
    expect((await refusal(enter(room, "가짜둘", { teacherPass: 12345 }))).message).toBe(ERR.pass);
    expect(room.state.players.size).toBe(4);

    // Five failures from one address within a minute: the room stops checking passes, even a good one.
    expect((await refusal(enter(room, "선생님넷", { teacherPass: passFor("TE4CHR") }))).message).toBe(ERR.tooMany);
    // Students (no pass) are not affected.
    const late = await enter(room, "세온");
    expect(room.state.players.get(late.sessionId)!.role).toBe(ROLE_STUDENT);
  });

  it("an active duplicate nickname is rejected", async () => {
    const room = await openClass("DU2PLE");
    const garam = await enter(room, "Garam");
    expect((await refusal(enter(room, "garam"))).message).toBe(ERR.taken);
    expect((await refusal(enter(room, "  GARAM "))).message).toBe(ERR.taken);
    await enter(room, "가 람");
    expect((await refusal(enter(room, "가  람"))).message).toBe(ERR.taken);
    // A teacher with a valid pass is refused the same way (the pass is not spent on it).
    const pass = passFor("DU2PLE");
    expect((await refusal(enter(room, "GARAM", { teacherPass: pass }))).message).toBe(ERR.taken);
    const teacher = await enter(room, "선생님", { teacherPass: pass });
    expect(room.state.players.get(teacher.sessionId)!.role).toBe(ROLE_TEACHER);

    expect(room.state.players.size).toBe(3);
    expect(room.state.players.get(garam.sessionId)!.connected).toBe(true);
  });

  it("takes over a disconnected ghost: one player, new sid, same teamId (Review Focus 1)", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await openClass("GH2STS");
    const old = await enter(room, "Garam");
    const friend = await enter(room, "다온");
    const oldSid = old.sessionId;
    const oldToken = old.reconnectionToken;

    // A team (Task 6 forms teams by message; here it is placed directly).
    const team = new Team();
    team.id = "team-1";
    team.members.push(oldSid, friend.sessionId);
    room.state.teams.set("team-1", team);
    room.state.players.get(oldSid)!.teamId = "team-1";
    room.state.players.get(friend.sessionId)!.teamId = "team-1";
    // Let the team reach every screen before the refresh, as it would in class. (Colyseus 0.17 /
    // schema 4.0.27 race, not ClassRoom's: when a team is created, a client's join ack sends it the
    // full state and the team's slot 0 is then replaced, all inside one patch window, that client
    // decodes the re-sent ADD at index 0 as an unshift. See the Task 5 report.)
    await flush();
    await flush();

    // The tab is closed: an abnormal drop leaves a ghost for the reconnection window.
    old.reconnection.enabled = false;
    old.connection.close(4010, "tab closed");
    expect(await pollFor(() => room.state.players.get(oldSid)?.connected === false)).toBe(true);

    // A new tab joins with the same nickname (different case and spacing).
    const fresh = await enter(room, "  garam ");
    expect(fresh.sessionId).not.toBe(oldSid);
    expect(room.state.players.size).toBe(2);
    expect(room.state.players.has(oldSid)).toBe(false);
    const p = room.state.players.get(fresh.sessionId)!;
    expect(p.nickname).toBe("garam");
    expect(p.connected).toBe(true);
    expect(p.role).toBe(ROLE_STUDENT);
    expect(p.teamId).toBe("team-1");
    expect([...team.members]).toEqual([fresh.sessionId, friend.sessionId]);

    // The old session cannot come back, and its late departure removes nothing of the new one.
    await expect(colyseus.sdk.reconnect(oldToken)).rejects.toThrow();
    await flush();
    await flush();
    expect(room.state.players.has(fresh.sessionId)).toBe(true);
    expect(room.state.players.get(fresh.sessionId)!.teamId).toBe("team-1");
    expect([...team.members]).toEqual([fresh.sessionId, friend.sessionId]);

    // Everyone's screen agrees: one Garam, in the same team.
    await flush();
    const seen = friend.state as unknown as {
      players: Map<string, { nickname: string; teamId: string }>;
      teams: Map<string, { members: Iterable<string> }>;
    };
    expect([...seen.players.keys()].sort()).toEqual([fresh.sessionId, friend.sessionId].sort());
    expect(seen.players.get(fresh.sessionId)?.teamId).toBe("team-1");
    expect([...seen.teams.get("team-1")!.members]).toEqual([fresh.sessionId, friend.sessionId]);
    const freshView = fresh.state as unknown as typeof seen;
    expect([...freshView.teams.get("team-1")!.members]).toEqual([fresh.sessionId, friend.sessionId]);
  });

  it("a ghost is taken over only in its own role: a student cannot take a disconnected teacher's place", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await openClass("GH3TCH");
    const teacher = await enter(room, "선생님", { teacherPass: passFor("GH3TCH") });
    const teacherSid = teacher.sessionId;
    teacher.reconnection.enabled = false;
    teacher.connection.close(4010, "network blip");
    expect(await pollFor(() => room.state.players.get(teacherSid)?.connected === false)).toBe(true);

    // A student typing the teacher's nickname is refused; the teacher's ghost stays.
    expect((await refusal(enter(room, "선생님"))).message).toBe(ERR.taken);
    expect(room.state.players.has(teacherSid)).toBe(true);

    // The teacher's own refresh (a new pass from the HTTP route) takes the ghost over.
    const back = await enter(room, "선생님", { teacherPass: passFor("GH3TCH") });
    expect(room.state.players.has(teacherSid)).toBe(false);
    expect(room.state.players.get(back.sessionId)!.role).toBe(ROLE_TEACHER);

    // And a student's ghost is not taken by a teacher's pass.
    const student = await enter(room, "가람");
    const studentSid = student.sessionId;
    student.reconnection.enabled = false;
    student.connection.close(4010, "network blip");
    expect(await pollFor(() => room.state.players.get(studentSid)?.connected === false)).toBe(true);
    expect((await refusal(enter(room, "가람", { teacherPass: passFor("GH3TCH") }))).message).toBe(ERR.taken);
    expect(room.state.players.has(studentSid)).toBe(true);
  });
});

describe("ClassRoom phases", () => {
  it("only teachers change phase; the east gate drops moves before start and accepts them after", async () => {
    const room = await openClass("GA2TES");
    const teacher = await enter(room, "선생님", { teacherPass: passFor("GA2TES") });
    const student = await enter(room, "가람");
    const systems: SystemBroadcast[] = [];
    student.onMessage(MessageType.System, (m: SystemBroadcast) => systems.push(m));
    const player = room.state.players.get(student.sessionId)!;
    const track = trackingOf(room).get(student.sessionId)!;

    /** Stand just west of the east gate (x 13.75) and step 0.6 m east; returns the x the server kept. */
    const tryTheGate = async () => {
      player.x = 13;
      player.z = 0;
      player.yaw = 0;
      track.lastAcceptedAt = Date.now() - 200;
      await sendTo(room, student, MessageType.Move, { x: 13.6, z: 0, yaw: 0.5 });
      return player.x;
    };

    // Lobby: the gate is shut.
    expect(await tryTheGate()).toBe(13);
    // A student's start is ignored.
    await sendTo(room, student, ClassMsg.Command, { cmd: "start" });
    expect(room.state.phase).toBe("lobby");
    // The teacher's impossible or garbage commands are ignored too.
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "pause" });
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "begin" });
    await sendTo(room, teacher, ClassMsg.Command, "start");
    await sendTo(room, teacher, ClassMsg.Command, null);
    expect(room.state.phase).toBe("lobby");
    expect(systems).toEqual([]);
    expect(await tryTheGate()).toBe(13);

    // Start: the notice goes to everyone and the gate opens.
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "start" });
    expect(room.state.phase).toBe("running");
    expect(systems).toEqual([{ text: NOTICE.start }]);
    expect(await tryTheGate()).toBeCloseTo(13.6, 5);

    // Pause keeps the gate open; a student cannot resume; the teacher can.
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "pause" });
    expect(room.state.phase).toBe("paused");
    expect(await tryTheGate()).toBeCloseTo(13.6, 5);
    await sendTo(room, student, ClassMsg.Command, { cmd: "resume" });
    expect(room.state.phase).toBe("paused");
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "resume" });
    expect(room.state.phase).toBe("running");
    // A second start changes nothing and says nothing.
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "start" });
    expect(systems.map((m) => m.text)).toEqual([NOTICE.start, NOTICE.pause, NOTICE.resume]);
  });

  it("end: locks, broadcasts the end notice, closes everyone with CLASS_CLOSED_CODE after the grace, releases the registry", async () => {
    process.env.CV_CLASS_END_GRACE_MS = "300";
    const room = await openClass("EN2DED");
    const teacher = await enter(room, "선생님", { teacherPass: passFor("EN2DED") });
    const student = await enter(room, "가람");
    const codes: number[] = [];
    for (const c of [teacher, student]) {
      c.reconnection.enabled = false; // a close must show up as a leave, not be healed
      c.onLeave((code) => codes.push(code));
    }
    const systems: SystemBroadcast[] = [];
    student.onMessage(MessageType.System, (m: SystemBroadcast) => systems.push(m));

    await sendTo(room, teacher, ClassMsg.Command, { cmd: "end" });
    expect(room.state.phase).toBe("ended");
    expect(room.locked).toBe(true);
    expect(systems).toEqual([{ text: NOTICE.end }]);

    // During the grace (time to download the results): still connected and registered; a second
    // end does nothing.
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "end" });
    expect(systems).toHaveLength(1);
    expect(codes).toEqual([]);
    expect(classRegistry.get("EN2DED")?.roomId).toBe(room.roomId);

    // After the grace: everyone is closed with the class-closed code and the class is gone.
    expect(await pollFor(() => codes.length === 2, 3000)).toBe(true);
    expect(codes).toEqual([CLASS_CLOSED_CODE, CLASS_CLOSED_CODE]);
    expect(await pollFor(() => classRegistry.get("EN2DED") === undefined)).toBe(true);
    expect(matchMaker.getLocalRoomById(room.roomId)).toBeUndefined();
  });

  it("an empty class disposes after CLASS_EMPTY_CLOSE_MS; a join in between cancels it", async () => {
    process.env.CV_CLASS_EMPTY_CLOSE_MS = "300";

    // Opened but nobody ever came.
    const never = await openClass("EM2PTY");
    expect(await pollFor(() => classRegistry.get("EM2PTY") === undefined)).toBe(true);
    expect(matchMaker.getLocalRoomById(never.roomId)).toBeUndefined();

    const room = await openClass("EM3PTY");
    const first = await enter(room, "가람"); // cancels the timer armed at creation
    await sleep(450);
    expect(matchMaker.getLocalRoomById(room.roomId)).toBe(room);

    await first.leave(true); // the last one out arms it…
    await sleep(150);
    const second = await enter(room, "다온"); // …and a join cancels it
    await sleep(450);
    expect(matchMaker.getLocalRoomById(room.roomId)).toBe(room);
    expect(classRegistry.get("EM3PTY")?.roomId).toBe(room.roomId);

    await second.leave(true);
    expect(await pollFor(() => classRegistry.get("EM3PTY") === undefined)).toBe(true);
    expect(matchMaker.getLocalRoomById(room.roomId)).toBeUndefined();
  });
});

describe("ClassRoom teacher tools", () => {
  it("announce/kick: teacher only", async () => {
    const room = await openClass("KC2KKK");
    const teacher = await enter(room, "선생님", { teacherPass: passFor("KC2KKK") });
    const student = await enter(room, "가 람");
    const other = await enter(room, "다온");

    // Announce: a student's is dropped, the teacher's sets the banner (state, so late joiners see it).
    await sendTo(room, student, MessageType.Announce, { text: "가짜 공지" });
    expect(room.state.announcement).toBe("");
    await sendTo(room, teacher, MessageType.Announce, { text: "  모두 홀로 모여요  " });
    expect(room.state.announcement).toBe("모두 홀로 모여요");
    expect(room.state.announcedAt).toBeGreaterThan(0);
    await sendTo(room, teacher, MessageType.Announce, { text: "x".repeat(301) }); // over the cap → dropped
    expect(room.state.announcement).toBe("모두 홀로 모여요");

    // Kick: a student's is dropped; the teacher cannot kick themself.
    let kickedCode: number | null = null;
    student.onLeave((code) => {
      kickedCode = code;
    });
    await sendTo(room, other, MessageType.Kick, { sid: student.sessionId });
    await sendTo(room, teacher, MessageType.Kick, { sid: teacher.sessionId });
    expect(room.state.players.size).toBe(3);
    expect(kickedCode).toBeNull();

    // The teacher's kick closes the target with KICK_CLOSE_CODE, with no ghost…
    await sendTo(room, teacher, MessageType.Kick, { sid: student.sessionId });
    expect(await pollFor(() => kickedCode !== null)).toBe(true);
    expect(kickedCode).toBe(KICK_CLOSE_CODE);
    expect(await pollFor(() => !room.state.players.has(student.sessionId))).toBe(true);
    // …and the same nickname (any spacing/case — one normaliser, ruling E14) cannot come back.
    expect((await refusal(enter(room, "가  람"))).message).toBe(ERR.kicked);
    expect((await refusal(enter(room, "가 람"))).message).toBe(ERR.kicked);
    expect(room.state.players.has(other.sessionId)).toBe(true);
  });
});
