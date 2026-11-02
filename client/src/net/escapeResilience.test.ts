import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The team classroom's connection-loss driver (escapeResilience.ts) with fake timers. The
 * connection layer is mocked: `adoptEscapeRoom` makes a room current and arms it with the real
 * driver (as connection.ts does), `leaveEscape` cancels a recovery and forgets the room (as
 * connection.ts does). A ticket's join is simulated the way joinEscape + classSync do it:
 * cancel the recovery, adopt the new room, enterEscape.
 */

const h = vi.hoisted(() => ({
  current: null as unknown,
  mainRoom: {} as unknown,
  joinPending: false,
  reconnect: vi.fn(),
  sendClass: vi.fn(),
  waitForSelf: vi.fn(async () => undefined),
  adopt: vi.fn(),
  leaveEscape: vi.fn(),
}));

vi.mock("./connection", () => ({
  client: { reconnect: h.reconnect },
  getEscapeRoom: () => h.current,
  getRoom: () => h.mainRoom,
  adoptEscapeRoom: (r: unknown) => h.adopt(r),
  leaveEscape: () => h.leaveEscape(),
  sendClass: h.sendClass,
  escapeJoinPending: () => h.joinPending,
  waitForSelf: h.waitForSelf,
}));

import { RECONNECT_WINDOW_S, KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import { CLASS_CLOSED_CODE } from "@caysonverse/shared/escape/constants";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import {
  attachEscapeResilience,
  cancelEscapeRecovery,
  isEscapeRecovering,
  ESCAPE_REJOIN_GAP_MS,
  ESCAPE_TICKET_WAIT_MS,
} from "./escapeResilience";
import { ESCAPE_LOST_NOTICE } from "./reconnectPolicy";
import { wasKicked, clearKicked } from "./kickSeam";
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
  leave: ReturnType<typeof vi.fn>;
}

let n = 0;
function fakeRoom(): FakeRoom {
  const id = `E${++n}`;
  const cbs: Array<(code: number) => void> = [];
  return {
    sessionId: id,
    reconnectionToken: `esc:${id}`,
    reconnection: { enabled: true },
    onLeave: (cb) => void cbs.push(cb),
    fireLeave: (code) => cbs.slice().forEach((cb) => cb(code)),
    leave: vi.fn(async () => 4000),
  };
}

/** In a classroom: the room is current and armed. */
function inClassroom(): FakeRoom {
  const r = fakeRoom();
  h.adopt(r);
  useAppStore.getState().enterEscape();
  return r;
}

/** What joinEscape + classSync do when a ticket arrives. */
function ticketJoin(): FakeRoom {
  const r = fakeRoom();
  cancelEscapeRecovery();
  h.adopt(r);
  useAppStore.getState().enterEscape();
  return r;
}

const refused = { code: 4212, message: "reconnection token invalid or expired" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("sessionStorage", memStorage());
  clearKicked();
  cancelEscapeRecovery();
  h.current = null;
  h.mainRoom = {};
  h.joinPending = false;
  h.reconnect.mockReset();
  h.sendClass.mockReset();
  h.adopt.mockReset().mockImplementation((r: FakeRoom) => {
    h.current = r;
    attachEscapeResilience(r as never);
  });
  h.leaveEscape.mockReset().mockImplementation(async () => {
    cancelEscapeRecovery();
    h.current = null;
  });
  useClassStore.getState().reset();
  useAppStore.setState({
    screen: "hub",
    identity: { nickname: "가람", appearance: DEFAULT_APPEARANCE, sessionId: "C0", classCode: "AB2CDE" },
    reconnecting: false,
    mainReconnecting: false,
    escapeReconnecting: false,
    escapeEpoch: 0,
  });
});

afterEach(() => {
  cancelEscapeRecovery();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("arming", () => {
  it("turns the SDK's own reconnect loop off", () => {
    const r = inClassroom();
    expect(r.reconnection.enabled).toBe(false);
  });
});

describe("a dropped classroom connection", () => {
  it("is restored by its token: the same session, the classroom remounted, the overlay gone", async () => {
    const r0 = inClassroom();
    const r1 = fakeRoom();
    let answer: (r: FakeRoom) => void = () => {};
    h.reconnect.mockImplementationOnce(() => new Promise((res) => (answer = res)));

    r0.fireLeave(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(isEscapeRecovering()).toBe(true);
    expect(useAppStore.getState().reconnecting).toBe(true); // "재연결 중..." + input held
    expect(h.current).toBe(r0); // sends go nowhere meanwhile (never into the hall chat)

    answer(r1);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.reconnect).toHaveBeenCalledWith("esc:" + r0.sessionId);
    expect(h.current).toBe(r1);
    expect(useAppStore.getState().escapeEpoch).toBe(2);
    expect(useAppStore.getState().screen).toBe("escape");
    expect(useAppStore.getState().reconnecting).toBe(false);
    expect(isEscapeRecovering()).toBe(false);
    expect(h.sendClass).not.toHaveBeenCalled();
  });

  it("an unreachable server keeps the token retries going for the whole window, then asks for a ticket", async () => {
    const r0 = inClassroom();
    h.reconnect.mockRejectedValue(new TypeError("fetch failed")); // no answer: no numeric code
    r0.fireLeave(1006);
    await vi.advanceTimersByTimeAsync(RECONNECT_WINDOW_S * 1000 - 1500);
    expect(h.reconnect.mock.calls.length).toBeGreaterThan(10);
    expect(h.sendClass).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sendClass).toHaveBeenCalledWith(ClassMsg.EscapeRejoin, {});
  });

  it("token refused → EscapeRejoin through the class; the ticket's join ends the recovery", async () => {
    const r0 = inClassroom();
    h.reconnect.mockRejectedValue(refused);
    r0.fireLeave(4001); // server restart: recovered, never a kick (ruling E3)
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sendClass).toHaveBeenCalledTimes(1);
    expect(h.sendClass).toHaveBeenCalledWith(ClassMsg.EscapeRejoin, {});

    await vi.advanceTimersByTimeAsync(1000);
    const r2 = ticketJoin();
    await vi.advanceTimersByTimeAsync(ESCAPE_TICKET_WAIT_MS * 3);
    expect(h.current).toBe(r2);
    expect(useAppStore.getState().screen).toBe("escape");
    expect(useAppStore.getState().reconnecting).toBe(false);
    expect(h.sendClass).toHaveBeenCalledTimes(1);
    expect(h.leaveEscape).not.toHaveBeenCalled();
  });

  it("no ticket within ESCAPE_TICKET_WAIT_MS → back to the corridor with the notice; asks ≥ 2 s apart", async () => {
    const r0 = inClassroom();
    h.reconnect.mockRejectedValue(refused);
    const askedAt: number[] = [];
    h.sendClass.mockImplementation(() => askedAt.push(Date.now()));
    r0.fireLeave(1006);
    await vi.advanceTimersByTimeAsync(ESCAPE_TICKET_WAIT_MS + 500);

    expect(ESCAPE_REJOIN_GAP_MS).toBeGreaterThanOrEqual(2000);
    expect(askedAt.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < askedAt.length; i++) expect(askedAt[i] - askedAt[i - 1]).toBeGreaterThanOrEqual(2000);
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().screen).toBe("hub");
    expect(useClassStore.getState().toast?.text).toBe(ESCAPE_LOST_NOTICE);
    expect(ESCAPE_LOST_NOTICE).toBe("교실 연결이 끊겨 복도로 돌아왔어요.");
    expect(useAppStore.getState().reconnecting).toBe(false);
  });

  it("while the class connection itself is down, no EscapeRejoin is sent", async () => {
    const r0 = inClassroom();
    h.mainRoom = null;
    h.reconnect.mockRejectedValue(refused);
    r0.fireLeave(1006);
    await vi.advanceTimersByTimeAsync(ESCAPE_TICKET_WAIT_MS + 500);
    expect(h.sendClass).not.toHaveBeenCalled();
    expect(useAppStore.getState().screen).toBe("hub");
  });

  it("a classroom join in flight at the deadline is waited for (no flick to the hall and back)", async () => {
    const r0 = inClassroom();
    h.reconnect.mockRejectedValue(refused);
    r0.fireLeave(1006);
    await vi.advanceTimersByTimeAsync(ESCAPE_TICKET_WAIT_MS - 200);
    h.joinPending = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(useAppStore.getState().screen).toBe("escape");
    expect(h.leaveEscape).not.toHaveBeenCalled();
    h.joinPending = false;
    ticketJoin();
    await vi.advanceTimersByTimeAsync(1000);
    expect(useAppStore.getState().screen).toBe("escape");
    expect(h.leaveEscape).not.toHaveBeenCalled();
  });

  it("a deliberate leave cancels the recovery; a late token answer is then left, not adopted", async () => {
    const r0 = inClassroom();
    const late = fakeRoom();
    let answer: (r: FakeRoom) => void = () => {};
    h.reconnect.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    r0.fireLeave(1006);
    await vi.advanceTimersByTimeAsync(0);
    await h.leaveEscape();
    useAppStore.getState().exitEscape();
    expect(useAppStore.getState().reconnecting).toBe(false);

    answer(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.adopt).toHaveBeenCalledTimes(1); // only the first classroom
    expect(late.leave).toHaveBeenCalledWith(true);
    expect(h.current).toBeNull();
    expect(useAppStore.getState().screen).toBe("hub");
  });
});

describe("other closes of the classroom connection", () => {
  it("the class ended (4102) → back to the hall, nothing retried", async () => {
    const r0 = inClassroom();
    r0.fireLeave(CLASS_CLOSED_CODE);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.reconnect).not.toHaveBeenCalled();
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().screen).toBe("hub");
  });

  it("the teacher's kick (4101) → marked kicked, the classroom dropped, nothing retried (the class connection moves the screen)", async () => {
    const r0 = inClassroom();
    r0.fireLeave(KICK_CLOSE_CODE);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(wasKicked()).toBe(true);
    expect(h.reconnect).not.toHaveBeenCalled();
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().screen).toBe("escape");
  });

  it("a clean server-side close → back to the hall with the notice, no retry", async () => {
    const r0 = inClassroom();
    r0.fireLeave(4000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.reconnect).not.toHaveBeenCalled();
    expect(useAppStore.getState().screen).toBe("hub");
    expect(useClassStore.getState().toast?.text).toBe(ESCAPE_LOST_NOTICE);
  });

  it("a superseded session's close (a newer one is current) is ignored", async () => {
    const r0 = inClassroom();
    const r1 = ticketJoin();
    r0.fireLeave(1006);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.reconnect).not.toHaveBeenCalled();
    expect(h.current).toBe(r1);
    expect(useAppStore.getState().screen).toBe("escape");
  });
});
