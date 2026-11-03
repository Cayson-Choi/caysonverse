import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * connection.ts against a mocked Colyseus SDK (the real one would open sockets). A fake `window`
 * is installed before the module loads so its `pagehide` registration can be observed; the room
 * handles are plain fakes that record what is sent to them.
 */

const h = vi.hoisted(() => {
  const listeners: Record<string, Array<() => void>> = {};
  (globalThis as { window?: unknown }).window = {
    location: { origin: "http://caysonverse.test" },
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  return { join: vi.fn(), joinOrCreate: vi.fn(), joinById: vi.fn(), reconnect: vi.fn(), listeners };
});

vi.mock("@colyseus/sdk", () => ({
  Client: class {
    join = h.join;
    joinOrCreate = h.joinOrCreate;
    joinById = h.joinById;
    reconnect = h.reconnect;
  },
}));

import { CLASS_ROOM, ESCAPE_ROOM } from "@caysonverse/shared/escape/constants";
import { VILLAGE_ROOM, WORLD_ROOM } from "@caysonverse/shared/constants";
import { ClassMsg, EscapeMsg } from "@caysonverse/shared/escape/messages";
import { MessageType } from "@caysonverse/shared/messages";
import { VillageMsg } from "@caysonverse/shared/village/messages";
import { DEFAULT_APPEARANCE, APPEARANCE_FIELDS } from "@caysonverse/shared/appearance";
import {
  getActiveRoom,
  getEscapeRoom,
  getRoom,
  handlePageHide,
  joinClass,
  joinEscape,
  joinVillage,
  joinWorld,
  leaveEscape,
  requestTeacherPass,
  TEACHER_PASS_TIMEOUT_MS,
  getRoomMode,
  sendAnnounce,
  sendChat,
  sendClass,
  sendEmoji,
  sendEscape,
  sendJump,
  sendKick,
  sendMove,
  sendTyping,
  sendUseDoor,
  setEscapeRoom,
  setRoom,
} from "./connection";
import { SERVER_URL } from "./endpoint";
import { CLASS_NOT_FOUND_NOTICE, FAILED_NOTICE } from "./reconnectPolicy";
import { useClassStore } from "../stores/classStore";
import { useEscapeStore } from "../stores/escapeStore";

interface FakeRoom {
  sessionId: string;
  roomId: string;
  reconnectionToken: string;
  reconnection: { enabled: boolean };
  state: { players: Map<string, unknown> };
  send: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  onLeave: (cb: (code: number) => void) => void;
  onMessage: (type: string, cb: (payload: unknown) => void) => () => void;
  onStateChange: ((cb: () => void) => void) & { remove: (cb: () => void) => void };
  handlers: Map<string, (payload: unknown) => void>;
  fireLeave: (code: number) => void;
}

let seq = 0;
function fakeRoom(sid = `S${++seq}`): FakeRoom {
  const leaveCbs: Array<(code: number) => void> = [];
  const stateCbs = new Set<() => void>();
  const handlers = new Map<string, (payload: unknown) => void>();
  const onStateChange = Object.assign((cb: () => void) => void stateCbs.add(cb), {
    remove: (cb: () => void) => void stateCbs.delete(cb),
  });
  return {
    sessionId: sid,
    roomId: `room-${sid}`,
    reconnectionToken: `room-${sid}:tok`,
    reconnection: { enabled: true },
    // Our own player is already in the state, so waitForSelf resolves at once.
    state: { players: new Map([[sid, { nickname: "가람", x: 0, z: 0, yaw: 0, place: 0, teamId: "" }]]) },
    send: vi.fn(),
    leave: vi.fn(async () => 4000),
    onLeave: (cb) => void leaveCbs.push(cb),
    onMessage: (type, cb) => {
      handlers.set(type, cb);
      return () => void handlers.delete(type);
    },
    onStateChange,
    handlers,
    fireLeave: (code) => leaveCbs.slice().forEach((cb) => cb(code)),
  };
}

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const LOOK = { ...DEFAULT_APPEARANCE, top: 2, topColor: 3 };

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memStorage());
  vi.stubGlobal("localStorage", memStorage());
  h.join.mockReset();
  h.joinOrCreate.mockReset();
  h.joinById.mockReset();
  h.reconnect.mockReset();
  setEscapeRoom(null);
  setRoom(null);
  useClassStore.getState().reset();
  useEscapeStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("active-room routing", () => {
  it("move/chat/emoji/jump/typing go to the escape room while one is set, else to the class room", () => {
    const cls = fakeRoom(), esc = fakeRoom();
    setRoom(cls as never); sendChat("안녕"); expect(cls.send).toHaveBeenCalledTimes(1);
    setEscapeRoom(esc as never); sendChat("안녕"); expect(esc.send).toHaveBeenCalledTimes(1);

    cls.send.mockClear();
    esc.send.mockClear();
    sendMove({ x: 1, z: 2, yaw: 0 } as never);
    sendEmoji(3);
    sendJump();
    sendTyping(true);
    expect(esc.send.mock.calls.map((c) => c[0])).toEqual([
      MessageType.Move,
      MessageType.Emoji,
      MessageType.Jump,
      MessageType.Typing,
    ]);
    expect(cls.send).not.toHaveBeenCalled();
    expect(getActiveRoom()).toBe(esc);

    // Back in the hall: the same calls reach the class room again.
    setEscapeRoom(null);
    sendMove({ x: 1, z: 2, yaw: 0 } as never);
    sendEmoji(3);
    sendJump();
    sendTyping(false);
    sendChat("다시 홀");
    expect(cls.send).toHaveBeenCalledTimes(5);
    expect(getActiveRoom()).toBe(cls);
  });

  it("announce, kick and class messages always go to the class room; escape messages only to the escape room", async () => {
    const cls = fakeRoom(), esc = fakeRoom();
    h.join.mockResolvedValueOnce(cls);
    await joinClass({ classCode: "AB2CDE", nickname: "선생님", appearance: LOOK });
    setEscapeRoom(esc as never);

    sendAnnounce("공지");
    sendKick("sid-x");
    sendClass(ClassMsg.EscapeRejoin, {});
    expect(cls.send.mock.calls.map((c) => c[0])).toEqual([MessageType.Announce, MessageType.Kick, ClassMsg.EscapeRejoin]);
    sendEscape(EscapeMsg.Inspect, { objectId: "drawer" });
    expect(esc.send).toHaveBeenCalledWith(EscapeMsg.Inspect, { objectId: "drawer" });
    expect(cls.send).toHaveBeenCalledTimes(3);

    setEscapeRoom(null);
    sendEscape(EscapeMsg.HintRequest, {}); // no escape room: dropped
    expect(cls.send).toHaveBeenCalledTimes(3);
  });

  it("class messages are never sent to the legacy world room", async () => {
    const world = fakeRoom();
    h.join.mockResolvedValueOnce(world);
    await joinWorld({ nickname: "가람", appearance: LOOK });
    sendClass(ClassMsg.TeamLeave, {});
    expect(world.send).not.toHaveBeenCalled();
  });
});

describe("joinVillage (케이슨 마을)", () => {
  it("joinOrCreates the village room with exactly nickname + the NESTED appearance — never the world's join, never an admin code", async () => {
    const room = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(room);
    const joined = await joinVillage({ nickname: "가람", appearance: LOOK });

    expect(joined).toBe(room);
    expect(h.joinOrCreate).toHaveBeenCalledTimes(1);
    const [name, options] = h.joinOrCreate.mock.calls[0];
    expect(name).toBe(VILLAGE_ROOM);
    expect(options).toEqual({ nickname: "가람", appearance: LOOK });
    for (const field of APPEARANCE_FIELDS) expect(options).not.toHaveProperty(field); // never flat
    expect(options).not.toHaveProperty("adminCode");
    // The world's join-existing-only call is not used (the village is not a singleton).
    expect(h.join).not.toHaveBeenCalled();
    expect(h.join).not.toHaveBeenCalledWith(WORLD_ROOM, expect.anything());
  });

  it("drops any extra field a caller passes (the join options are fixed)", async () => {
    h.joinOrCreate.mockResolvedValueOnce(fakeRoom());
    await joinVillage({ nickname: "가람", appearance: LOOK, adminCode: "secret" } as never);
    expect(h.joinOrCreate.mock.calls[0][1]).toEqual({ nickname: "가람", appearance: LOOK });
  });

  it("adopts the room, arms the resilience (SDK reconnect off) and marks the connection as the village", async () => {
    const room = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(room);
    await joinVillage({ nickname: "가람", appearance: LOOK });

    expect(getRoom()).toBe(room);
    expect(getRoomMode()).toBe("village");
    expect(room.reconnection.enabled).toBe(false);
    // Village chat and moves go to the village room (the active room).
    sendChat("안녕하세요");
    sendMove({ x: 1, z: 2, yaw: 0 } as never);
    expect(room.send.mock.calls.map((c) => c[0])).toEqual([MessageType.Chat, MessageType.Move]);
    // Class messages never reach it.
    sendClass(ClassMsg.TeamLeave, {});
    expect(room.send).toHaveBeenCalledTimes(2);
  });

  it("sendUseDoor sends the village's UseDoor (no data) to the village room, and is a no-op in any other mode", async () => {
    const world = fakeRoom();
    h.join.mockResolvedValueOnce(world);
    await joinWorld({ nickname: "가람", appearance: LOOK });
    sendUseDoor();
    expect(world.send).not.toHaveBeenCalled(); // the world has no doors

    const village = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(village);
    await joinVillage({ nickname: "가람", appearance: LOOK });
    sendUseDoor();
    expect(village.send).toHaveBeenCalledTimes(1);
    expect(village.send).toHaveBeenCalledWith(VillageMsg.UseDoor, {});
  });

  it("a drop after a server restart rejoins by joinOrCreate(VILLAGE_ROOM) — never the world's join — and stays in village mode", async () => {
    // This is the only test that runs the REAL resilience against joinVillage: if joinVillage armed it in the default
    // "world" mode, the fresh rejoin would call client.join(WORLD_ROOM) and these assertions would fail.
    const first = fakeRoom();
    const second = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    h.reconnect.mockRejectedValue({ code: 4212, message: "reconnection token invalid or expired" });
    await joinVillage({ nickname: "가람", appearance: LOOK });
    expect(getRoomMode()).toBe("village");

    first.fireLeave(1006);
    for (let i = 0; i < 40 && h.joinOrCreate.mock.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 0));

    expect(h.reconnect).toHaveBeenCalled(); // phase 1 tried the token first and was refused
    expect(h.joinOrCreate).toHaveBeenCalledTimes(2);
    expect(h.joinOrCreate.mock.calls[1][0]).toBe(VILLAGE_ROOM);
    expect(h.join).not.toHaveBeenCalled();
    expect(getRoomMode()).toBe("village");
    expect(getRoom()).toBe(second);
  });

  it("a refusal shows the server's Korean words; anything else is the generic notice; nothing is adopted; no retry", async () => {
    h.joinOrCreate.mockRejectedValueOnce(new Error("닉네임은 한글·영문·숫자 2~12자로 입력하세요."));
    await expect(joinVillage({ nickname: "x", appearance: LOOK })).rejects.toThrow("닉네임은 한글·영문·숫자 2~12자로 입력하세요.");
    expect(getRoom()).toBeNull();

    h.joinOrCreate.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(joinVillage({ nickname: "가람", appearance: LOOK })).rejects.toThrow("서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
    expect(h.joinOrCreate).toHaveBeenCalledTimes(2); // one try each: joinOrCreate has no "no rooms found" to ride out
    expect(getRoom()).toBeNull();
  });
});

describe("joinClass (ruling E5)", () => {
  it("joins CLASS_ROOM with the normalised code, the NESTED appearance and the one-time teacher pass", async () => {
    const room = fakeRoom();
    h.join.mockResolvedValueOnce(room);
    const joined = await joinClass({ classCode: " ab2cde ", nickname: "선생님", appearance: LOOK, teacherPass: "pass-1" });

    expect(joined).toBe(room);
    expect(h.join).toHaveBeenCalledTimes(1);
    const [name, options] = h.join.mock.calls[0];
    expect(name).toBe(CLASS_ROOM);
    expect(options).toEqual({ classCode: "AB2CDE", nickname: "선생님", appearance: LOOK, teacherPass: "pass-1" });
    for (const field of APPEARANCE_FIELDS) expect(options).not.toHaveProperty(field); // never flat
    // Adopted and armed: the SDK's own reconnect loop is off, the class sync listens.
    expect(getRoom()).toBe(room);
    expect(room.reconnection.enabled).toBe(false);
    expect(room.handlers.has(ClassMsg.EscapeTicket)).toBe(true);
  });

  it("a student join carries no teacherPass key at all", async () => {
    h.join.mockResolvedValueOnce(fakeRoom());
    await joinClass({ classCode: "AB2CDE", nickname: "가람", appearance: LOOK });
    expect(h.join.mock.calls[0][1]).toEqual({ classCode: "AB2CDE", nickname: "가람", appearance: LOOK });
  });

  it("a code that can never match is refused locally; a missing class is CLASS_NOT_FOUND_NOTICE; server Korean passes", async () => {
    await expect(joinClass({ classCode: "0OIL11", nickname: "가람", appearance: LOOK })).rejects.toThrow(CLASS_NOT_FOUND_NOTICE);
    expect(h.join).not.toHaveBeenCalled();

    h.join.mockRejectedValueOnce({ code: 521, message: "no rooms found with provided criteria" });
    await expect(joinClass({ classCode: "AB2CDE", nickname: "가람", appearance: LOOK })).rejects.toThrow(CLASS_NOT_FOUND_NOTICE);
    expect(h.join).toHaveBeenCalledTimes(1); // no retry: a wrong code should answer at once

    h.join.mockRejectedValueOnce(new Error("이 반에 같은 닉네임이 있어요. 다른 닉네임을 써 주세요."));
    await expect(joinClass({ classCode: "AB2CDE", nickname: "가람", appearance: LOOK })).rejects.toThrow(
      "이 반에 같은 닉네임이 있어요. 다른 닉네임을 써 주세요.",
    );
    expect(getRoom()).toBeNull();
  });
});

describe("joinEscape / leaveEscape", () => {
  it("reaches the escape room ONLY by joinById(roomId, { ticket }) and adopts it", async () => {
    const cls = fakeRoom();
    setRoom(cls as never);
    const esc = fakeRoom();
    h.joinById.mockResolvedValueOnce(esc);

    const joined = await joinEscape("esc-room-1", "T".repeat(24));
    expect(joined).toBe(esc);
    expect(h.joinById).toHaveBeenCalledWith("esc-room-1", { ticket: "T".repeat(24) });
    expect(h.join).not.toHaveBeenCalledWith(ESCAPE_ROOM, expect.anything());
    expect(getEscapeRoom()).toBe(esc);
    expect(esc.reconnection.enabled).toBe(false);
    expect(esc.handlers.has(EscapeMsg.Content)).toBe(true); // bound before any await: Content is not missed
  });

  it("a newer escape session replaces the older one, which is left (consented)", async () => {
    const first = fakeRoom(), second = fakeRoom();
    h.joinById.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await joinEscape("esc-1", "a".repeat(24));
    await joinEscape("esc-1", "b".repeat(24));
    expect(getEscapeRoom()).toBe(second);
    expect(first.leave).toHaveBeenCalledWith(true);
    expect(second.leave).not.toHaveBeenCalled();
  });

  it("a refused ticket shows the server's Korean reason; anything else the generic failure", async () => {
    h.joinById.mockRejectedValueOnce(new Error("입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요."));
    await expect(joinEscape("esc-1", "x".repeat(24))).rejects.toThrow("입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요.");
    h.joinById.mockRejectedValueOnce({ code: 522, message: 'room "esc-1" not found' });
    await expect(joinEscape("esc-1", "x".repeat(24))).rejects.toThrow(FAILED_NOTICE);
    expect(getEscapeRoom()).toBeNull();
  });

  it("leaveEscape: consented leave, no escape room afterwards, sends go back to the class room", async () => {
    const cls = fakeRoom(), esc = fakeRoom();
    setRoom(cls as never);
    h.joinById.mockResolvedValueOnce(esc);
    await joinEscape("esc-1", "t".repeat(24));
    useEscapeStore.getState().showToast("x");

    await leaveEscape();
    expect(esc.leave).toHaveBeenCalledWith(true);
    expect(getEscapeRoom()).toBeNull();
    expect(useEscapeStore.getState().toast).toBeNull(); // the classroom's store is cleared
    sendChat("홀로 돌아왔어요");
    expect(cls.send).toHaveBeenCalledTimes(1);
    await expect(leaveEscape()).resolves.toBeUndefined(); // nothing to leave: fine
  });

  it("leaving a classroom whose connection is already dead does not hang (bounded wait)", async () => {
    const esc = fakeRoom();
    esc.leave.mockImplementation(() => new Promise(() => {})); // the SDK never answers a dead connection
    h.joinById.mockResolvedValueOnce(esc);
    await joinEscape("esc-1", "t".repeat(24));
    vi.useFakeTimers();
    try {
      let done = false;
      void leaveEscape().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(2900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(true);
      expect(getEscapeRoom()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("requestTeacherPass", () => {
  function stubFetch(impl: (url: string, init: RequestInit) => Promise<unknown>) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const response = (status: number, body: unknown, json = true) => ({
    ok: status >= 200 && status < 300,
    status,
    json: json ? async () => body : async () => Promise.reject(new SyntaxError("Unexpected token <")),
  });

  it("POSTs the key (+ code and level) to /api/class/teacher and returns { classCode, pass }", async () => {
    const fetchMock = stubFetch(async () => response(200, { classCode: "AB2CDE", pass: "pass-xyz" }));
    await expect(requestTeacherPass({ teacherKey: "KEY-1", classCode: "ab2cde", textLevel: "hard" })).resolves.toEqual({
      classCode: "AB2CDE",
      pass: "pass-xyz",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVER_URL}/api/class/teacher`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ teacherKey: "KEY-1", classCode: "AB2CDE", textLevel: "hard" });
  });

  it("opening a new class sends no classCode", async () => {
    const fetchMock = stubFetch(async () => response(200, { classCode: "K7Q2XM", pass: "p" }));
    await requestTeacherPass({ teacherKey: "KEY-1" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ teacherKey: "KEY-1" });
  });

  it("an error answer throws the server's Korean text with the HTTP status (never as `code`)", async () => {
    stubFetch(async () => response(401, { error: "선생님 키가 올바르지 않아요" }));
    const err = await requestTeacherPass({ teacherKey: "wrong" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("선생님 키가 올바르지 않아요");
    expect((err as { status?: number }).status).toBe(401);
    expect((err as { code?: unknown }).code).toBeUndefined();
  });

  it("no Korean text (proxy page, bad JSON, malformed 200) or no answer at all → FAILED_NOTICE", async () => {
    stubFetch(async () => response(502, null, false));
    await expect(requestTeacherPass({ teacherKey: "k" })).rejects.toMatchObject({ message: FAILED_NOTICE, status: 502 });
    stubFetch(async () => response(500, { error: "Internal Server Error" }));
    await expect(requestTeacherPass({ teacherKey: "k" })).rejects.toMatchObject({ message: FAILED_NOTICE, status: 500 });
    stubFetch(async () => response(200, { classCode: "AB2CDE" }));
    await expect(requestTeacherPass({ teacherKey: "k" })).rejects.toMatchObject({ message: FAILED_NOTICE });
    stubFetch(async () => Promise.reject(new TypeError("fetch failed")));
    await expect(requestTeacherPass({ teacherKey: "k" })).rejects.toMatchObject({ message: FAILED_NOTICE, status: 0 });
  });

  it("re-entering by code sends no reopen; only the restart recovery's reopen: true (with a code) goes out (final review I2)", async () => {
    const fetchMock = stubFetch(async () => response(200, { classCode: "AB2CDE", pass: "p" }));
    await requestTeacherPass({ teacherKey: "K", classCode: "AB2CDE" });
    await requestTeacherPass({ teacherKey: "K", classCode: "AB2CDE", reopen: true });
    await requestTeacherPass({ teacherKey: "K", reopen: true }); // no code: nothing to re-open
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string));
    expect(bodies).toEqual([
      { teacherKey: "K", classCode: "AB2CDE" },
      { teacherKey: "K", classCode: "AB2CDE", reopen: true },
      { teacherKey: "K" },
    ]);
  });

  it("asks with a 10 s timeout signal; a timed-out request fails with the network-error words, status 0", async () => {
    expect(TEACHER_PASS_TIMEOUT_MS).toBe(10_000);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = stubFetch(async () =>
      Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
    );
    await expect(requestTeacherPass({ teacherKey: "k" })).rejects.toMatchObject({ message: FAILED_NOTICE, status: 0 });
    expect(timeout).toHaveBeenCalledWith(TEACHER_PASS_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0][1].signal).toBe(timeout.mock.results[0].value);
  });
});

describe("pagehide (ruling: class mode keeps both ghosts — Review Focus 1)", () => {
  it("is registered on window 'pagehide'", () => {
    expect(h.listeners.pagehide).toContain(handlePageHide);
  });

  it("in class mode, pagehide sends no leave — neither the class room nor the escape room", async () => {
    const cls = fakeRoom(), esc = fakeRoom();
    h.join.mockResolvedValueOnce(cls);
    await joinClass({ classCode: "AB2CDE", nickname: "가람", appearance: LOOK });
    h.joinById.mockResolvedValueOnce(esc);
    await joinEscape("esc-1", "t".repeat(24));

    for (const fn of h.listeners.pagehide) fn();
    expect(cls.leave).not.toHaveBeenCalled();
    expect(esc.leave).not.toHaveBeenCalled();
    // The crash screen reads the same mode (AppErrorBoundary: no consented leave in a class).
    expect(getRoomMode()).toBe("class");
  });

  it("village mode leaves like the world: pagehide is a consented leave of the village room", async () => {
    const village = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(village);
    await joinVillage({ nickname: "가람", appearance: LOOK });
    expect(getRoomMode()).toBe("village");
    for (const fn of h.listeners.pagehide) fn();
    expect(village.leave).toHaveBeenCalledWith(true);
  });

  it("world mode is unchanged: pagehide is a consented leave of the world room", async () => {
    const world = fakeRoom();
    h.join.mockResolvedValueOnce(world);
    await joinWorld({ nickname: "가람", appearance: LOOK });
    expect(getRoomMode()).toBe("world");
    for (const fn of h.listeners.pagehide) fn();
    expect(world.leave).toHaveBeenCalledWith(true);
  });
});
