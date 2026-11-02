import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The reconnection driver in CLASS mode (Task 13): what a class connection's close leads to, and
 * the Phase-2 rejoin after a server restart (Review Focus 5). `./connection` is fully mocked (as
 * in resilience.test.ts) with a single room handle; the class sync binding is a spy; backoff
 * delays are squashed to 0 ms.
 */

const h = vi.hoisted(() => {
  let currentRoom: unknown = null;
  let escapeRoom: unknown = null;
  return {
    reconnect: vi.fn(),
    joinRoom: vi.fn(),
    joinClassRoom: vi.fn(),
    requestTeacherPass: vi.fn(),
    waitForSelf: vi.fn(),
    leaveEscape: vi.fn(async () => {
      escapeRoom = null;
    }),
    bindClassSync: vi.fn(),
    unbindClassSync: vi.fn(),
    getRoom: () => currentRoom,
    setRoom: (r: unknown) => {
      currentRoom = r;
    },
    getEscapeRoom: () => escapeRoom,
    setEscape: (r: unknown) => {
      escapeRoom = r;
    },
  };
});

vi.mock("./connection", () => ({
  client: { reconnect: h.reconnect },
  getRoom: h.getRoom,
  setRoom: h.setRoom,
  joinRoom: h.joinRoom,
  waitForSelf: h.waitForSelf,
  joinClassRoom: h.joinClassRoom,
  requestTeacherPass: h.requestTeacherPass,
  getEscapeRoom: h.getEscapeRoom,
  leaveEscape: h.leaveEscape,
}));
vi.mock("./classSync", () => ({ bindClassSync: h.bindClassSync, unbindClassSync: h.unbindClassSync }));
vi.mock("./backoff", () => ({ reconnectBackoffMs: () => [0, 0, 0] }));

import { CLASS_CLOSED_CODE } from "@caysonverse/shared/escape/constants";
import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { attachResilience } from "./resilience";
import { getTeacher, rememberTeacher, forgetTeacher } from "./teacherSession";
import { CLASS_ENDED_NOTICE, CLASS_NOT_FOUND_NOTICE, KICKED_NOTICE } from "./reconnectPolicy";
import { useAppStore } from "../stores/appStore";
import { useClassStore } from "../stores/classStore";

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

interface FakeRoom {
  sessionId: string;
  reconnectionToken: string;
  reconnection: { enabled: boolean };
  onLeave: (cb: (code: number) => void) => void;
  fireLeave: (code: number) => void;
  state: unknown;
}

function fakeRoom(sessionId: string): FakeRoom {
  const cbs: Array<(code: number) => void> = [];
  return {
    sessionId,
    reconnectionToken: `tok-${sessionId}`,
    reconnection: { enabled: true },
    onLeave: (cb) => void cbs.push(cb),
    fireLeave: (code) => cbs.slice().forEach((cb) => cb(code)),
    state: {},
  };
}

const flush = async (n = 30): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const ME = { nickname: "가람", appearance: DEFAULT_APPEARANCE, sessionId: "C0", classCode: "AB2CDE" };

/** A class connection in the hall, armed in class mode. */
function joinedClass(): FakeRoom {
  const r0 = fakeRoom("C0");
  h.setRoom(r0);
  attachResilience(r0 as never, "class");
  return r0;
}

/** Drop it after a server restart: the token is refused by a server that answers (numeric code). */
function restart(r0: FakeRoom): void {
  h.reconnect.mockRejectedValue({ code: 4212, message: "reconnection token invalid or expired" });
  r0.fireLeave(4001); // Colyseus SERVER_SHUTDOWN (ruling E3: a reconnect, not a kick)
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memStorage());
  vi.stubGlobal("localStorage", memStorage());
  for (const fn of [h.reconnect, h.joinRoom, h.joinClassRoom, h.requestTeacherPass, h.waitForSelf]) fn.mockReset();
  h.waitForSelf.mockResolvedValue(undefined);
  h.leaveEscape.mockClear();
  h.bindClassSync.mockClear();
  h.unbindClassSync.mockClear();
  h.setRoom(null);
  h.setEscape(null);
  forgetTeacher();
  useClassStore.getState().reset();
  useAppStore.setState({
    screen: "hub",
    identity: { ...ME },
    isAdmin: false,
    notice: null,
    reconnecting: false,
    mainReconnecting: false,
    escapeReconnecting: false,
    connectionEpoch: 0,
    escapeEpoch: 0,
  });
});

describe("arming a class connection", () => {
  it("turns the SDK's own reconnect off and binds the class sync before anything awaits", () => {
    const r0 = joinedClass();
    expect(r0.reconnection.enabled).toBe(false);
    expect(h.bindClassSync).toHaveBeenCalledWith(r0);
  });

  it("a world connection binds no class sync", () => {
    const w = fakeRoom("W0");
    h.setRoom(w);
    attachResilience(w as never);
    expect(h.bindClassSync).not.toHaveBeenCalled();
  });
});

describe("class connection closes", () => {
  it("CLASS_CLOSED_CODE → the entry with CLASS_ENDED_NOTICE, nothing retried, the class session cleaned up", async () => {
    rememberTeacher({ key: "TKEY", classCode: "AB2CDE", textLevel: "easy" });
    h.setEscape({});
    const r0 = joinedClass();
    r0.fireLeave(CLASS_CLOSED_CODE);
    await flush();
    const s = useAppStore.getState();
    expect(s.screen).toBe("entry");
    expect(s.notice).toBe(CLASS_ENDED_NOTICE);
    expect(h.reconnect).not.toHaveBeenCalled();
    expect(h.joinClassRoom).not.toHaveBeenCalled();
    expect(h.leaveEscape).toHaveBeenCalledTimes(1); // the classroom goes with the class
    expect(h.unbindClassSync).toHaveBeenCalledTimes(1);
    expect(getTeacher()).toBeNull(); // the teacher key is forgotten
    expect(h.getRoom()).toBeNull();
  });

  it("the teacher's kick (4101) → the entry with the kick notice, no reconnect", async () => {
    const r0 = joinedClass();
    r0.fireLeave(KICK_CLOSE_CODE);
    await flush();
    expect(useAppStore.getState().notice).toBe(KICKED_NOTICE);
    expect(h.reconnect).not.toHaveBeenCalled();
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
  });

  it("a plain drop rejoins the SAME session by token and keeps the class sync bound to the new room", async () => {
    const r0 = joinedClass();
    const r1 = fakeRoom("C0");
    h.reconnect.mockResolvedValueOnce(r1);
    r0.fireLeave(1006);
    await flush();
    expect(h.getRoom()).toBe(r1);
    expect(h.bindClassSync).toHaveBeenLastCalledWith(r1);
    expect(useAppStore.getState().connectionEpoch).toBe(1);
    expect(useAppStore.getState().screen).toBe("hub");
    expect(h.joinClassRoom).not.toHaveBeenCalled();
  });
});

describe("Phase 2 after a server restart (Review Focus 5)", () => {
  it("a student rejoins by the same code, waiting out 521 until the teacher re-opened the class", async () => {
    const r0 = joinedClass();
    const fresh = fakeRoom("C9");
    h.joinClassRoom
      .mockRejectedValueOnce({ code: 521, message: "no rooms found with provided criteria" })
      .mockRejectedValueOnce({ code: 521, message: "no rooms found with provided criteria" })
      .mockResolvedValueOnce(fresh);
    restart(r0);
    await flush();
    expect(h.joinClassRoom).toHaveBeenCalledTimes(3);
    expect(h.joinClassRoom).toHaveBeenLastCalledWith({
      classCode: "AB2CDE",
      nickname: "가람",
      appearance: DEFAULT_APPEARANCE,
      teacherPass: undefined,
    });
    expect(h.requestTeacherPass).not.toHaveBeenCalled();
    const s = useAppStore.getState();
    expect(h.getRoom()).toBe(fresh);
    expect(s.identity?.sessionId).toBe("C9");
    expect(s.isAdmin).toBe(false);
    expect(s.screen).toBe("hub");
  });

  it("a teacher re-opens THE SAME code with a new pass, then joins with that pass", async () => {
    rememberTeacher({ key: "TKEY", classCode: "AB2CDE", textLevel: "hard" });
    const r0 = joinedClass();
    const fresh = fakeRoom("T9");
    h.requestTeacherPass.mockResolvedValueOnce({ classCode: "AB2CDE", pass: "pass-2" });
    h.joinClassRoom.mockResolvedValueOnce(fresh);
    restart(r0);
    await flush();
    expect(h.requestTeacherPass).toHaveBeenCalledWith({ teacherKey: "TKEY", classCode: "AB2CDE", textLevel: "hard", reopen: true });
    expect(h.joinClassRoom).toHaveBeenCalledWith({
      classCode: "AB2CDE",
      nickname: "가람",
      appearance: DEFAULT_APPEARANCE,
      teacherPass: "pass-2",
    });
    expect(useAppStore.getState().isAdmin).toBe(true);
    expect(getTeacher()).not.toBeNull(); // still the teacher of this class
  });

  it("a teacher route that cannot answer yet (5xx) is retried; a wrong key (401) ends at the entry with its text", async () => {
    rememberTeacher({ key: "TKEY", classCode: "AB2CDE", textLevel: "easy" });
    const r0 = joinedClass();
    h.requestTeacherPass
      .mockRejectedValueOnce({ status: 503, message: "반을 열지 못했어요. 잠시 뒤에 다시 해 주세요" })
      .mockRejectedValueOnce({ status: 401, message: "선생님 키가 올바르지 않아요" });
    restart(r0);
    await flush();
    expect(h.requestTeacherPass).toHaveBeenCalledTimes(2);
    expect(h.joinClassRoom).not.toHaveBeenCalled();
    expect(useAppStore.getState().screen).toBe("entry");
    expect(useAppStore.getState().notice).toBe("선생님 키가 올바르지 않아요");
    expect(getTeacher()).toBeNull();
  });

  it("a class that never comes back ends at the entry with CLASS_NOT_FOUND_NOTICE", async () => {
    const r0 = joinedClass();
    h.joinClassRoom.mockRejectedValue({ code: 521, message: "no rooms found with provided criteria" });
    restart(r0);
    await flush();
    expect(h.joinClassRoom).toHaveBeenCalledTimes(4); // 1 + the 3 squashed backoff delays
    expect(useAppStore.getState().notice).toBe(CLASS_NOT_FOUND_NOTICE);
  });

  it("a Korean refusal is shown at once (not retried)", async () => {
    const r0 = joinedClass();
    h.joinClassRoom.mockRejectedValueOnce(new Error("입장이 제한되었습니다"));
    restart(r0);
    await flush();
    expect(h.joinClassRoom).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().notice).toBe("입장이 제한되었습니다");
  });

  it("from inside a classroom: the dead classroom is dropped and the screen goes back to the hall", async () => {
    useAppStore.setState({ screen: "escape" });
    const dead = {};
    h.setEscape(dead);
    const r0 = joinedClass();
    h.joinClassRoom.mockResolvedValueOnce(fakeRoom("C9"));
    restart(r0);
    await flush();
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().screen).toBe("hub");
  });

  it("an identity without a code rejoins the class whose state it last saw", async () => {
    useAppStore.setState({ identity: { ...ME, classCode: undefined } });
    useClassStore.setState({ classCode: "K7Q2XM" });
    const r0 = joinedClass();
    h.joinClassRoom.mockResolvedValueOnce(fakeRoom("C9"));
    restart(r0);
    await flush();
    expect(h.joinClassRoom).toHaveBeenCalledWith(expect.objectContaining({ classCode: "K7Q2XM" }));
  });

  it("no class code anywhere → the entry with the generic failure (nothing to rejoin)", async () => {
    useAppStore.setState({ identity: { ...ME, classCode: undefined } });
    const r0 = joinedClass();
    restart(r0);
    await flush();
    expect(h.joinClassRoom).not.toHaveBeenCalled();
    expect(useAppStore.getState().screen).toBe("entry");
  });
});
