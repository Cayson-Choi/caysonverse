import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { matchMaker } from "colyseus";
import { KICK_CLOSE_CODE, MAX_CLIENTS, ROLE_STUDENT, ROLE_TEACHER } from "@caysonverse/shared/constants";
import { MessageType, type SystemBroadcast } from "@caysonverse/shared/messages";
import { APPEARANCE_ERROR, DEFAULT_APPEARANCE, pickAppearance } from "@caysonverse/shared/appearance";
import {
  CLASS_ACTION_RATE,
  CLASS_CLOSED_CODE,
  CLASS_ROOM,
  PHASE1_OPEN_ROOMS,
  PLACE_ESCAPE,
  PLACE_HUB,
  TEAM_MAX,
} from "@caysonverse/shared/escape/constants";
import { ClassMsg, type NoticePayload, type ResultsCsvPayload } from "@caysonverse/shared/escape/messages";
import { Team } from "@caysonverse/shared/schema";
import { HUB_DOORS, HUB_SPAWN, HUB_SPAWN_JITTER, TEAM_ZONE } from "@caysonverse/shared/school/hubMap";
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

/** POST /api/class/teacher over HTTP: the status and the JSON answer (httpie rejects a 4xx; both come back here). */
async function postTeacher(body: Record<string, unknown>): Promise<{ statusCode: number; data: Record<string, unknown> }> {
  try {
    const res = await colyseus.http.post("/api/class/teacher", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { statusCode: res.statusCode as number, data: res.data as Record<string, unknown> };
  } catch (e) {
    const err = e as { statusCode?: number; data?: Record<string, unknown> };
    if (typeof err.statusCode !== "number") throw e;
    return { statusCode: err.statusCode, data: err.data ?? {} };
  }
}

/** White-box handle on the base's per-session bookkeeping. */
function trackingOf(room: ClassRoom): Map<string, Tracking> {
  return (room as unknown as { tracking: Map<string, Tracking> }).tracking;
}

/** A test client (only what these tests use). */
type TestClient = Awaited<ReturnType<typeof enter>>;

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
      // A chosen code: the restart recovery's re-open (a new class from the entry form has no code).
      body: JSON.stringify({ teacherKey: HTTP_KEY, classCode: "HT2PPP", textLevel: "hard", reopen: true }),
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

  it(
    "a teacher whose tab reloaded re-enters THEIR class by its code: a pass for that class, no new room, the ghost taken over (final review I2)",
    async () => {
      process.env.CV_RECONNECT_WINDOW_S = "5";
      const opened = await postTeacher({ teacherKey: HTTP_KEY }); // 반 열기 from the entry form: a new class
      expect(opened.statusCode).toBe(200);
      const code = opened.data.classCode as string;
      const roomId = classRegistry.get(code)!.roomId!;
      const room = colyseus.getRoomById(roomId) as ClassRoom;
      const first = await colyseus.sdk.join(CLASS_ROOM, joinOpts(code, "김쌤", { teacherPass: opened.data.pass }));
      await flush();
      expect(room.state.players.get(first.sessionId)?.role).toBe(ROLE_TEACHER);

      // F5: the connection drops (no consent) and the teacher is a ghost in the class.
      first.reconnection.enabled = false;
      first.connection.close(4010, "reload");
      expect(await pollFor(() => room.state.players.get(first.sessionId)?.connected === false)).toBe(true);

      // The entry form sends the cached code (any case): a pass for the SAME class, nothing new opened.
      const classes = classRegistry.list().length;
      const again = await postTeacher({ teacherKey: HTTP_KEY, classCode: code.toLowerCase() });
      expect(again.statusCode).toBe(200);
      expect(again.data.classCode).toBe(code);
      expect(classRegistry.list().length).toBe(classes);
      expect(classRegistry.get(code)?.roomId).toBe(roomId);

      // Same nickname: the new session takes the teacher's ghost over, as the teacher.
      const back = await colyseus.sdk.join(CLASS_ROOM, joinOpts(code, "김쌤", { teacherPass: again.data.pass }));
      expect(back.roomId).toBe(roomId);
      await flush();
      expect(room.state.players.get(back.sessionId)?.role).toBe(ROLE_TEACHER);
      expect(room.state.players.has(first.sessionId)).toBe(false);
      expect(room.state.players.size).toBe(1);
      // And can run the class again.
      await sendTo(room, back, ClassMsg.Command, { cmd: "start" });
      expect(room.state.phase).toBe("running");
    },
    10_000,
  );

  it("a class code with no live class is refused in Korean and opens nothing: unknown, then ended (final review I2)", async () => {
    process.env.CV_CLASS_END_GRACE_MS = "3000";
    const unknown = await postTeacher({ teacherKey: HTTP_KEY, classCode: "ZZ2ZZZ" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.data).toEqual({ error: "그 반 코드는 지금 열려 있지 않아요. 새 반을 열려면 반 코드를 비워 주세요" });
    expect(classRegistry.get("ZZ2ZZZ")).toBeUndefined();

    // A class its teacher ended (waiting out its grace) is not entered again.
    const opened = await postTeacher({ teacherKey: HTTP_KEY });
    const code = opened.data.classCode as string;
    const room = colyseus.getRoomById(classRegistry.get(code)!.roomId!) as ClassRoom;
    const teacher = await colyseus.sdk.join(CLASS_ROOM, joinOpts(code, "김쌤", { teacherPass: opened.data.pass }));
    teacher.onMessage(ClassMsg.ResultsCsv, () => {});
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "end" });
    expect(room.state.phase).toBe("ended");
    const ended = await postTeacher({ teacherKey: HTTP_KEY, classCode: code });
    expect(ended.statusCode).toBe(404);
    expect(classRegistry.get(code)?.roomId).toBe(room.roomId); // still that class, closing
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
    // decodes the re-sent ADD at index 0 as an unshift. See the Task 5 report. Since Task 6 ClassRoom
    // itself rewrites members as clear + push — see the "mid-patch-window" test in `teams`.)
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
    const csvs: { who: string; payload: ResultsCsvPayload }[] = [];
    teacher.onMessage(ClassMsg.ResultsCsv, (m: ResultsCsvPayload) => csvs.push({ who: "teacher", payload: m }));
    student.onMessage(ClassMsg.ResultsCsv, (m: ResultsCsvPayload) => csvs.push({ who: "student", payload: m }));

    await sendTo(room, teacher, ClassMsg.Command, { cmd: "end" });
    expect(room.state.phase).toBe("ended");
    expect(room.locked).toBe(true);
    expect(systems).toEqual([{ text: NOTICE.end }]);
    // The final results go to the teacher by themselves (final review I1), once; never to a student.
    expect(await pollFor(() => csvs.length === 1)).toBe(true);
    expect(csvs[0].who).toBe("teacher");
    expect(csvs[0].payload.final).toBe(true);
    expect(csvs[0].payload.csv.startsWith("\uFEFF팀,팀원,교실,결과")).toBe(true);

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

describe("teams", () => {
  /** The brief's Korean notices (ClassMsg.Notice). */
  const TEAM_ERR = {
    already: "이미 팀에 있어요. 먼저 팀에서 나와 주세요",
    taken: "이미 있는 팀 이름과 색이에요",
    full: "팀이 가득 찼어요 (최대 6명)",
  } as const;
  /** A spot on the team rug (TEAM_ZONE x -12..-5, z 1..9). */
  const RUG = { x: -8, z: 5 } as const;
  const COUNSEL = HUB_DOORS.find((d) => d.room === "counsel")!;
  const LIBRARY = HUB_DOORS.find((d) => d.room === "library")!;
  type Door = (typeof HUB_DOORS)[number];

  /** The decoded view a client holds (the SDK's state, read structurally). */
  interface SeenTeam {
    members: Iterable<string>;
    nameIndex: number;
    colorIndex: number;
    padDoor: string;
    padLeaderSid: string;
    padCount: number;
  }
  interface Seen {
    players: Map<string, { teamId: string }>;
    teams: Map<string, SeenTeam>;
  }
  const seen = (c: TestClient) => c.state as unknown as Seen;

  /** Join and let the join confirmation settle (waitForNextMessage also resolves on it). */
  async function join(room: ClassRoom, nickname: string, extra: Record<string, unknown> = {}): Promise<TestClient> {
    const c = await enter(room, nickname, extra);
    await flush();
    return c;
  }

  function playerOf(room: ClassRoom, c: TestClient) {
    return room.state.players.get(c.sessionId)!;
  }

  /** Put a player somewhere directly in server state (white box). */
  function standAt(room: ClassRoom, c: TestClient, x: number, z: number): void {
    const p = playerOf(room, c);
    p.x = x;
    p.z = z;
  }

  /** Stand at `from` and send one small legal Move to `to`, so the room's move hook runs (brief Step 3). */
  async function step(room: ClassRoom, c: TestClient, from: { x: number; z: number }, to: { x: number; z: number }) {
    standAt(room, c, from.x, from.z);
    trackingOf(room).get(c.sessionId)!.lastAcceptedAt = Date.now() - 200;
    await sendTo(room, c, MessageType.Move, { x: to.x, z: to.z, yaw: 0 });
    expect(playerOf(room, c).x).toBeCloseTo(to.x, 4); // the move really was accepted
    expect(playerOf(room, c).z).toBeCloseTo(to.z, 4);
  }

  /** On a pad (its centre), and on the corridor side just off it (|z| 0.5; pads start at |z| 0.8). */
  const onPad = (d: Door) => ({ x: d.x, z: d.returnPoint.z });
  const offPad = (d: Door) => ({ x: d.x, z: Math.sign(d.returnPoint.z) * 0.5 });
  const stepOn = (room: ClassRoom, c: TestClient, d: Door) => step(room, c, offPad(d), onPad(d));
  const stepOff = (room: ClassRoom, c: TestClient, d: Door) => step(room, c, onPad(d), offPad(d));

  function noticesOf(c: TestClient): string[] {
    const out: string[] = [];
    c.onMessage(ClassMsg.Notice, (m: NoticePayload) => out.push(m.text));
    return out;
  }

  function teamOf(room: ClassRoom, c: TestClient): Team | undefined {
    const id = playerOf(room, c).teamId;
    return id === "" ? undefined : room.state.teams.get(id);
  }

  function padOf(team: { padDoor: string; padLeaderSid: string; padCount: number }) {
    return { door: team.padDoor, leader: team.padLeaderSid, count: team.padCount };
  }

  /** Every team's members as the server holds them, and as client `c` decoded them. */
  function serverMembers(room: ClassRoom): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    room.state.teams.forEach((t, id) => (out[id] = [...t.members]));
    return out;
  }
  function clientMembers(c: TestClient): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    seen(c).teams.forEach((t, id) => (out[id] = [...t.members]));
    return out;
  }
  const sameMembers = (room: ClassRoom, c: TestClient) =>
    JSON.stringify(clientMembers(c)) === JSON.stringify(serverMembers(room));

  it("team and door messages are capped per client (CLASS_ACTION_RATE): a burst is cut, other clients are not, the window refills (final fix B1)", async () => {
    expect(CLASS_ACTION_RATE).toEqual({ count: 10, windowMs: 1000 }); // the puzzle actions' cap (ESCAPE_ACTION_RATE)
    const room = await openClass("RT2LMT");
    const a = await join(room, "가람");
    const b = await join(room, "다온");
    const c = await join(room, "세온");
    for (const k of [a, b]) standAt(room, k, RUG.x, RUG.z);
    const noticesOf = (k: TestClient) => {
      const out: string[] = [];
      k.onMessage(ClassMsg.Notice, (m: NoticePayload) => out.push(m.text));
      return out;
    };
    const [na, nb, nc] = [noticesOf(a), noticesOf(b), noticesOf(c)];
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 5 });
    expect(playerOf(room, a).teamId).not.toBe("");

    // B floods TeamCreate with A's combo: each one handled answers "taken"; past the cap they are dropped unseen.
    for (let i = 0; i < 25; i++) b.send(ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 5 });
    // C floods the door in the lobby: each one handled answers "not started".
    for (let i = 0; i < 25; i++) c.send(ClassMsg.EnterRoom, { room: "counsel" });
    await sleep(400);
    expect(nb).toEqual(Array(CLASS_ACTION_RATE.count).fill(TEAM_ERR.taken));
    expect(nc).toEqual(Array(CLASS_ACTION_RATE.count).fill("선생님이 아직 시작하지 않았어요"));
    expect(na).toEqual([]); // another client's flood costs A nothing
    // B's capped flood made nothing either: still teamless, one team in the class.
    expect(playerOf(room, b).teamId).toBe("");
    expect(room.state.teams.size).toBe(1);

    // A second later the window has room again.
    await sleep(CLASS_ACTION_RATE.windowMs + 50);
    await sendTo(room, c, ClassMsg.EnterRoom, { room: "counsel" });
    expect(nc).toHaveLength(CLASS_ACTION_RATE.count + 1);
    await sendTo(room, b, ClassMsg.TeamJoin, { teamId: playerOf(room, a).teamId });
    expect(playerOf(room, b).teamId).toBe(playerOf(room, a).teamId);
  });

  it("TeamCreate outside TEAM_ZONE is dropped; inside creates the team and sets teamId", async () => {
    const room = await openClass("TM2CRE");
    const a = await join(room, "가람");
    const notes = noticesOf(a);

    // At the spawn (outside the zone): dropped silently.
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 5 });
    expect(room.state.teams.size).toBe(0);
    expect(playerOf(room, a).teamId).toBe("");
    // Just beyond the rug's 0.5 m tolerance band: still outside.
    standAt(room, a, TEAM_ZONE.maxX + 0.7, RUG.z);
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 5 });
    expect(room.state.teams.size).toBe(0);

    // On the rug, malformed payloads are dropped too.
    standAt(room, a, RUG.x, RUG.z);
    for (const bad of [
      null,
      "0,5",
      {},
      { nameIndex: 12, colorIndex: 0 },
      { nameIndex: 0, colorIndex: 8 },
      { nameIndex: -1, colorIndex: 0 },
      { nameIndex: 1.5, colorIndex: 0 },
      { nameIndex: "0", colorIndex: 5 },
    ]) {
      await sendTo(room, a, ClassMsg.TeamCreate, bad);
    }
    expect(room.state.teams.size).toBe(0);
    expect(notes).toEqual([]);

    // (Those ten went out within a second: they used up A's CLASS_ACTION_RATE window. Let it refill.)
    await sleep(CLASS_ACTION_RATE.windowMs + 50);
    // A good one: a team of one; the creator's teamId points at it.
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 5 });
    expect(room.state.teams.size).toBe(1);
    const team = [...room.state.teams.values()][0];
    expect(playerOf(room, a).teamId).toBe(team.id);
    expect(team.id).not.toBe("");
    expect([team.nameIndex, team.colorIndex]).toEqual([0, 5]);
    expect([...team.members]).toEqual([a.sessionId]);
    expect(padOf(team)).toEqual({ door: "", leader: "", count: 0 });
    expect(team.escapeRoomId).toBe("");
    expect(notes).toEqual([]);

    // The rug's edge band (inTeamZone's default 0.5 m margin) counts as the zone.
    const b = await join(room, "다온");
    standAt(room, b, TEAM_ZONE.maxX + 0.3, RUG.z);
    await sendTo(room, b, ClassMsg.TeamCreate, { nameIndex: 1, colorIndex: 1 });
    expect(teamOf(room, b)?.members.length).toBe(1);

    // A student inside an escape room (place 1) cannot form teams, even at "zone" coordinates.
    const c = await join(room, "세온");
    standAt(room, c, RUG.x, RUG.z);
    playerOf(room, c).place = PLACE_ESCAPE;
    await sendTo(room, c, ClassMsg.TeamCreate, { nameIndex: 2, colorIndex: 2 });
    expect(playerOf(room, c).teamId).toBe("");
    expect(room.state.teams.size).toBe(2);

    // Everyone's screen agrees.
    expect(await pollFor(() => seen(c).players.get(a.sessionId)?.teamId === team.id)).toBe(true);
    const view = seen(c).teams.get(team.id)!;
    expect([...view.members]).toEqual([a.sessionId]);
    expect([view.nameIndex, view.colorIndex]).toEqual([0, 5]);
  });

  it("the 7th TeamJoin gets the full-team notice; leaving the last member deletes the team", async () => {
    const room = await openClass("TM3FUL");
    const kids: TestClient[] = [];
    for (const name of ["가람", "다온", "세온", "하늘", "보라", "누리", "이음"]) {
      const c = await join(room, name);
      standAt(room, c, RUG.x, RUG.z);
      kids.push(c);
    }
    const notes = kids.map(noticesOf);

    await sendTo(room, kids[0], ClassMsg.TeamCreate, { nameIndex: 3, colorIndex: 3 });
    const teamId = playerOf(room, kids[0]).teamId;
    expect(teamId).not.toBe("");
    for (let i = 1; i < TEAM_MAX; i++) await sendTo(room, kids[i], ClassMsg.TeamJoin, { teamId });
    const team = room.state.teams.get(teamId)!;
    expect([...team.members]).toEqual(kids.slice(0, TEAM_MAX).map((c) => c.sessionId));
    for (const c of kids.slice(0, TEAM_MAX)) expect(playerOf(room, c).teamId).toBe(teamId);

    // The 7th: the full-team notice, nothing changes.
    await sendTo(room, kids[6], ClassMsg.TeamJoin, { teamId });
    expect(notes[6]).toEqual([TEAM_ERR.full]);
    expect(team.members.length).toBe(TEAM_MAX);
    expect(playerOf(room, kids[6]).teamId).toBe("");

    // A member cannot join again or start another team; nobody can reuse a (name, colour).
    await sendTo(room, kids[1], ClassMsg.TeamJoin, { teamId });
    await sendTo(room, kids[1], ClassMsg.TeamCreate, { nameIndex: 4, colorIndex: 4 });
    expect(notes[1]).toEqual([TEAM_ERR.already, TEAM_ERR.already]);
    await sendTo(room, kids[6], ClassMsg.TeamCreate, { nameIndex: 3, colorIndex: 3 });
    expect(notes[6]).toEqual([TEAM_ERR.full, TEAM_ERR.taken]);
    // Unknown or malformed team ids are dropped silently.
    for (const bad of [{ teamId: "nope" }, { teamId: 7 }, {}, null, { teamId: "__proto__" }]) {
      await sendTo(room, kids[6], ClassMsg.TeamJoin, bad);
    }
    expect(notes[6]).toEqual([TEAM_ERR.full, TEAM_ERR.taken]);
    expect(room.state.teams.size).toBe(1);

    // Leaving keeps the others' order; leaving without a team is dropped.
    await sendTo(room, kids[2], ClassMsg.TeamLeave, {});
    expect(playerOf(room, kids[2]).teamId).toBe("");
    expect([...team.members]).toEqual([0, 1, 3, 4, 5].map((i) => kids[i].sessionId));
    await sendTo(room, kids[2], ClassMsg.TeamLeave, {});
    expect(notes[2]).toEqual([]);
    // Now there is room for the 7th.
    await sendTo(room, kids[6], ClassMsg.TeamJoin, { teamId });
    expect([...team.members].at(-1)).toBe(kids[6].sessionId);

    // Everyone leaves; the last one out deletes the team.
    for (const i of [0, 1, 3, 4, 5]) await sendTo(room, kids[i], ClassMsg.TeamLeave, {});
    expect([...team.members]).toEqual([kids[6].sessionId]);
    expect(room.state.teams.has(teamId)).toBe(true);
    await sendTo(room, kids[6], ClassMsg.TeamLeave, {});
    expect(room.state.teams.has(teamId)).toBe(false);
    for (const c of kids) expect(playerOf(room, c).teamId).toBe("");
    expect(await pollFor(() => !seen(kids[0]).teams.has(teamId))).toBe(true);
    // The freed (name, colour) can be used again.
    await sendTo(room, kids[2], ClassMsg.TeamCreate, { nameIndex: 3, colorIndex: 3 });
    expect(teamOf(room, kids[2])?.nameIndex).toBe(3);
  });

  it("TeamLeave works only in the zone; a permanent leave from the class also leaves the team", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "0.3";
    const room = await openClass("TM4LEV");
    const [a, b, c] = [await join(room, "가람"), await join(room, "다온"), await join(room, "세온")];
    for (const k of [a, b, c]) standAt(room, k, RUG.x, RUG.z);
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 5, colorIndex: 2 });
    const teamId = playerOf(room, a).teamId;
    await sendTo(room, b, ClassMsg.TeamJoin, { teamId });
    await sendTo(room, c, ClassMsg.TeamJoin, { teamId });
    const team = room.state.teams.get(teamId)!;

    // Away from the rug (or inside an escape room) TeamLeave is dropped.
    standAt(room, b, HUB_SPAWN.x, HUB_SPAWN.z);
    await sendTo(room, b, ClassMsg.TeamLeave, {});
    expect(playerOf(room, b).teamId).toBe(teamId);
    standAt(room, b, RUG.x, RUG.z);
    playerOf(room, b).place = PLACE_ESCAPE;
    await sendTo(room, b, ClassMsg.TeamLeave, {});
    expect(playerOf(room, b).teamId).toBe(teamId);
    playerOf(room, b).place = PLACE_HUB;
    // On the rug it works.
    await sendTo(room, b, ClassMsg.TeamLeave, null);
    expect(playerOf(room, b).teamId).toBe("");
    expect([...team.members]).toEqual([a.sessionId, c.sessionId]);

    // A consented leave from the class takes the student out of the team.
    await c.leave(true);
    expect(await pollFor(() => team.members.length === 1)).toBe(true);
    expect([...team.members]).toEqual([a.sessionId]);

    // A dropped connection keeps the seat while the reconnection window is open (Review Focus 1)…
    a.reconnection.enabled = false;
    a.connection.close(4010, "tab closed");
    expect(await pollFor(() => room.state.players.get(a.sessionId)?.connected === false)).toBe(true);
    expect([...team.members]).toEqual([a.sessionId]);
    // …and when it expires, the last member is gone and so is the team.
    expect(await pollFor(() => !room.state.teams.has(teamId), 3000)).toBe(true);
    expect(room.state.players.has(a.sessionId)).toBe(false);
    expect(await pollFor(() => !seen(b).teams.has(teamId))).toBe(true);
  });

  it("teachers cannot form teams; teacher TeamAuto applies the plan and syncs teamId", async () => {
    const room = await openClass("TM5AUT");
    const teacher = await join(room, "선생님", { teacherPass: passFor("TM5AUT") });
    standAt(room, teacher, RUG.x, RUG.z);
    const kids: TestClient[] = [];
    for (const name of ["가람", "다온", "세온", "하늘", "보라", "누리", "이음"]) kids.push(await join(room, name));
    standAt(room, kids[0], RUG.x, RUG.z);

    // A teacher on the rug cannot create or join; a student cannot auto-assign.
    await sendTo(room, teacher, ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 0 });
    expect(room.state.teams.size).toBe(0);
    await sendTo(room, kids[0], ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 0 });
    const firstId = playerOf(room, kids[0]).teamId;
    await sendTo(room, teacher, ClassMsg.TeamJoin, { teamId: firstId });
    expect([...room.state.teams.get(firstId)!.members]).toEqual([kids[0].sessionId]);
    await sendTo(room, kids[1], ClassMsg.TeamAuto, { mode: "fill" });
    expect(room.state.teams.size).toBe(1);
    // Garbage modes are dropped.
    for (const bad of [{ mode: "mix" }, {}, null, "fill"]) await sendTo(room, teacher, ClassMsg.TeamAuto, bad);
    expect(room.state.teams.size).toBe(1);

    // Fill: the 1-member team is topped up to TEAM_TARGET (4), the other 3 make a new team.
    await sendTo(room, teacher, ClassMsg.TeamAuto, { mode: "fill" });
    expect(room.state.teams.size).toBe(2);
    expect([...room.state.teams.get(firstId)!.members]).toEqual(kids.slice(0, 4).map((c) => c.sessionId));
    const newTeam = [...room.state.teams.values()].find((t) => t.id !== firstId)!;
    expect([...newTeam.members]).toEqual(kids.slice(4).map((c) => c.sessionId));
    for (const c of kids.slice(4)) expect(playerOf(room, c).teamId).toBe(newTeam.id);
    expect(playerOf(room, teacher).teamId).toBe("");
    expect(await pollFor(() => seen(kids[6]).players.get(kids[5].sessionId)?.teamId === newTeam.id)).toBe(true);
    expect([...seen(kids[6]).teams.get(newTeam.id)!.members]).toEqual([...newTeam.members]);

    // Shuffle: every team in the hall is redone, 7 students → teams of 4 and 3, all distinct combos.
    await sendTo(room, teacher, ClassMsg.TeamAuto, { mode: "shuffle" });
    const teams = [...room.state.teams.values()];
    expect(teams.map((t) => t.members.length).sort()).toEqual([3, 4]);
    expect(teams.map((t) => t.id)).not.toContain(firstId);
    expect(new Set(teams.map((t) => `${t.nameIndex}/${t.colorIndex}`)).size).toBe(2);
    const placed = teams.flatMap((t) => [...t.members]);
    expect([...placed].sort()).toEqual(kids.map((c) => c.sessionId).sort());
    for (const t of teams) for (const sid of t.members) expect(room.state.players.get(sid)!.teamId).toBe(t.id);
    expect(playerOf(room, teacher).teamId).toBe("");
    expect(await pollFor(() => sameMembers(room, kids[0]))).toBe(true);
  });

  it("TeamAuto leaves a team inside an escape room alone", async () => {
    const room = await openClass("TM6ESC");
    const teacher = await join(room, "선생님", { teacherPass: passFor("TM6ESC") });
    const [a, b, c] = [await join(room, "가람"), await join(room, "다온"), await join(room, "세온")];
    for (const k of [a, b]) standAt(room, k, RUG.x, RUG.z);
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 6, colorIndex: 6 });
    const teamId = playerOf(room, a).teamId;
    await sendTo(room, b, ClassMsg.TeamJoin, { teamId });
    room.state.teams.get(teamId)!.escapeRoomId = "escape-room-1"; // (Task 11 sets this on entry)

    // Shuffle with one loose student and only an escape team: nothing to regroup.
    await sendTo(room, teacher, ClassMsg.TeamAuto, { mode: "shuffle" });
    expect([...room.state.teams.keys()]).toEqual([teamId]);
    expect([...room.state.teams.get(teamId)!.members]).toEqual([a.sessionId, b.sessionId]);
    expect(playerOf(room, c).teamId).toBe("");
    // Fill does not put the loose student into it either.
    await sendTo(room, teacher, ClassMsg.TeamAuto, { mode: "fill" });
    expect(room.state.teams.get(teamId)!.members.length).toBe(2);
    expect(playerOf(room, c).teamId).toBe("");
  });

  it("pad status syncs on moves and updates when a member steps off or disconnects", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await openClass("PA2DSS");
    const teacher = await join(room, "선생님", { teacherPass: passFor("PA2DSS") });
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "start" });
    const [a, b, c] = [await join(room, "가람"), await join(room, "다온"), await join(room, "세온")];
    const loner = await join(room, "하늘"); // no team: tracked, but no team status to update
    for (const k of [a, b, c]) standAt(room, k, RUG.x, RUG.z);
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 7, colorIndex: 1 });
    const team = teamOf(room, a)!;
    await sendTo(room, b, ClassMsg.TeamJoin, { teamId: team.id });
    await sendTo(room, c, ClassMsg.TeamJoin, { teamId: team.id });
    expect(padOf(team)).toEqual({ door: "", leader: "", count: 0 });

    // A steps onto the counsel pad, then B: A arrived first and leads.
    await stepOn(room, a, COUNSEL);
    expect(doorOf(room, a)).toBe("counsel");
    expect(padOf(team)).toEqual({ door: "counsel", leader: a.sessionId, count: 1 });
    await stepOn(room, b, COUNSEL);
    expect(padOf(team)).toEqual({ door: "counsel", leader: a.sessionId, count: 2 });
    // C goes to the library pad: counsel still has more.
    await stepOn(room, c, LIBRARY);
    expect(padOf(team)).toEqual({ door: "counsel", leader: a.sessionId, count: 2 });
    // Walking around ON the pad changes nothing.
    await step(room, a, onPad(COUNSEL), { x: COUNSEL.x + 0.5, z: COUNSEL.returnPoint.z });
    expect(padOf(team)).toEqual({ door: "counsel", leader: a.sessionId, count: 2 });
    // A teamless student on a pad touches no team.
    await stepOn(room, loner, COUNSEL);
    expect(doorOf(room, loner)).toBe("counsel");
    expect(padOf(team)).toEqual({ door: "counsel", leader: a.sessionId, count: 2 });
    // Every client sees it.
    expect(await pollFor(() => seen(c).teams.get(team.id)?.padCount === 2)).toBe(true);
    expect(padOf(seen(c).teams.get(team.id)!)).toEqual({ door: "counsel", leader: a.sessionId, count: 2 });

    // A steps off: 1 vs 1 → the door whose first arrival came earlier (B before C) → counsel, B leads.
    await stepOff(room, a, COUNSEL);
    expect(doorOf(room, a)).toBeNull();
    expect(padOf(team)).toEqual({ door: "counsel", leader: b.sessionId, count: 1 });
    // A comes back: now after B, so B keeps the lead.
    await stepOn(room, a, COUNSEL);
    expect(padOf(team)).toEqual({ door: "counsel", leader: b.sessionId, count: 2 });

    // B's connection drops: a ghost is not counted. Counsel (A, back just now) and library (C, there
    // before A came back) have one each → the tie goes to the earlier arrival: library, C leads.
    b.reconnection.enabled = false;
    b.connection.close(4010, "network blip");
    expect(await pollFor(() => team.padCount === 1)).toBe(true);
    expect(padOf(team)).toEqual({ door: "library", leader: c.sessionId, count: 1 });
    // A member inside an escape room is not counted either (Task 11 moves `place`; any recount sees it).
    playerOf(room, a).place = PLACE_ESCAPE;
    await stepOff(room, c, LIBRARY);
    expect(padOf(team)).toEqual({ door: "", leader: "", count: 0 });
    expect(await pollFor(() => seen(c).teams.get(team.id)?.padCount === 0)).toBe(true);
    expect(padOf(seen(c).teams.get(team.id)!)).toEqual({ door: "", leader: "", count: 0 });
  });

  it("a taken-over pad leader stays leader: the new session keeps the ghost's spot, arrival and the lead", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await openClass("PA3TKV");
    const teacher = await join(room, "선생님", { teacherPass: passFor("PA3TKV") });
    await sendTo(room, teacher, ClassMsg.Command, { cmd: "start" });
    const [a, b] = [await join(room, "Garam"), await join(room, "다온")];
    for (const k of [a, b]) standAt(room, k, RUG.x, RUG.z);
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 8, colorIndex: 3 });
    const team = teamOf(room, a)!;
    await sendTo(room, b, ClassMsg.TeamJoin, { teamId: team.id });
    await stepOn(room, a, COUNSEL);
    await stepOn(room, b, COUNSEL);
    expect(padOf(team)).toEqual({ door: "counsel", leader: a.sessionId, count: 2 });
    const spot = { x: playerOf(room, a).x, z: playerOf(room, a).z };

    // A's tab closes: B leads while A is a ghost.
    const oldSid = a.sessionId;
    a.reconnection.enabled = false;
    a.connection.close(4010, "tab closed");
    expect(await pollFor(() => team.padLeaderSid === b.sessionId)).toBe(true);
    expect(padOf(team)).toEqual({ door: "counsel", leader: b.sessionId, count: 1 });

    // A's new tab takes the ghost over: same team slot, same spot on the pad, same arrival → leads again.
    const fresh = await join(room, "garam");
    expect(room.state.players.has(oldSid)).toBe(false);
    expect([...team.members]).toEqual([fresh.sessionId, b.sessionId]);
    expect(playerOf(room, fresh).teamId).toBe(team.id);
    expect(playerOf(room, fresh).x).toBeCloseTo(spot.x, 4);
    expect(playerOf(room, fresh).z).toBeCloseTo(spot.z, 4);
    expect(doorOf(room, fresh)).toBe("counsel");
    expect(padOf(team)).toEqual({ door: "counsel", leader: fresh.sessionId, count: 2 });
    expect(await pollFor(() => seen(b).teams.get(team.id)?.padLeaderSid === fresh.sessionId)).toBe(true);
    expect([...seen(b).teams.get(team.id)!.members]).toEqual([fresh.sessionId, b.sessionId]);
    // The pad keeps tracking the new session.
    await stepOff(room, fresh, COUNSEL);
    expect(padOf(team)).toEqual({ door: "counsel", leader: b.sessionId, count: 1 });
  });

  // Colyseus 0.17 / @colyseus/schema 4.0.27: a client that joins inside a patch window receives the
  // full state (already containing the window's changes) and then the window's patch on top. Array
  // ops encoded against the window's starting layout (a DELETE by old index, an ADD at an index that
  // has since moved, an ADD at index 0 = "unshift" on the decoder) would then corrupt its copy.
  it("a client joining mid-patch-window after team churn decodes the same members as the server", async () => {
    const room = await openClass("RA2CES");
    const kids: TestClient[] = [];
    for (const name of ["가람", "다온", "세온", "하늘", "보라"]) {
      const k = await join(room, name);
      standAt(room, k, RUG.x, RUG.z);
      kids.push(k);
    }
    const [a, b, c, e, f] = kids;
    await sendTo(room, a, ClassMsg.TeamCreate, { nameIndex: 9, colorIndex: 4 });
    const t1 = playerOf(room, a).teamId;
    await sendTo(room, b, ClassMsg.TeamJoin, { teamId: t1 });
    await sendTo(room, c, ClassMsg.TeamJoin, { teamId: t1 });
    expect(await pollFor(() => sameMembers(room, f))).toBe(true);

    // From here patches go out only when the test says so: one long patch window.
    room.patchRate = 0;
    await flush();
    await sendTo(room, a, ClassMsg.TeamLeave, {}); // [b, c]      (slot 0 removed)
    await sendTo(room, e, ClassMsg.TeamJoin, { teamId: t1 }); // [b, c, e]
    await sendTo(room, f, ClassMsg.TeamCreate, { nameIndex: 10, colorIndex: 5 }); // new team [f]
    const t2 = playerOf(room, f).teamId;

    // D joins now and gets the full state as it is mid-window…
    const d = await join(room, "누리");
    expect(await pollFor(() => seen(d).teams?.get(t1) !== undefined && seen(d).teams?.get(t2) !== undefined)).toBe(true);
    expect(clientMembers(d)).toEqual(serverMembers(room));
    // …then more churn in the same window, including slot 0 of the new team being replaced.
    standAt(room, d, RUG.x, RUG.z);
    await sendTo(room, a, ClassMsg.TeamJoin, { teamId: t1 }); // [b, c, e, a]
    await sendTo(room, d, ClassMsg.TeamJoin, { teamId: t2 }); // [f, d]
    await sendTo(room, f, ClassMsg.TeamLeave, {}); // [d]     (slot 0 replaced)
    await sendTo(room, b, ClassMsg.TeamLeave, {}); // [c, e, a]

    // The window closes: one patch for everyone.
    room.broadcastPatch();
    await flush();
    await flush();
    const expected = serverMembers(room);
    expect(expected).toEqual({ [t1]: [c, e, a].map((k) => k.sessionId), [t2]: [d.sessionId] });
    for (const k of [...kids, d]) expect(clientMembers(k), k.sessionId).toEqual(expected);
  });
});

/** The door pad the session is tracked on (white box: ClassRoom's tracking). */
function doorOf(room: ClassRoom, c: { sessionId: string }): string | null {
  return (trackingOf(room).get(c.sessionId) as unknown as { padDoor: string | null }).padDoor;
}
