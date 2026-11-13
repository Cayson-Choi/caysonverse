import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The reconnection driver (케이슨 마을): the village is not a singleton, so the Phase-2 fresh
 * rejoin after a server restart is `joinOrCreate` (`joinVillageRoom`); it carries no admin code. `./connection`
 * is fully mocked (as in resilience.test.ts) with a single room handle; backoff delays are squashed to 0 ms.
 */

const h = vi.hoisted(() => {
  let currentRoom: unknown = null;
  return {
    reconnect: vi.fn(),
    joinVillageRoom: vi.fn(),
    waitForSelf: vi.fn(),
    getRoom: () => currentRoom,
    setRoom: (r: unknown) => {
      currentRoom = r;
    },
  };
});

vi.mock("./connection", () => ({
  client: { reconnect: h.reconnect },
  getRoom: h.getRoom,
  setRoom: h.setRoom,
  joinVillageRoom: h.joinVillageRoom,
  waitForSelf: h.waitForSelf,
}));
vi.mock("./backoff", () => ({ reconnectBackoffMs: () => [0, 0, 0] }));

import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import { attachResilience } from "./resilience";
import { villageClock } from "../village/villageClock";
import { KICKED_NOTICE } from "./reconnectPolicy";
import { useAppStore } from "../stores/appStore";

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
  /** The room's message handlers by type (a village room is armed with the server's clock, Task 7A). */
  handlers: Map<string, (message: unknown) => void>;
  onMessage: (type: string, cb: (message: never) => void) => () => void;
  state: unknown;
}

function fakeRoom(sessionId: string): FakeRoom {
  const cbs: Array<(code: number) => void> = [];
  const handlers = new Map<string, (message: unknown) => void>();
  return {
    handlers,
    onMessage: (type, cb) => {
      handlers.set(type, cb as (message: unknown) => void);
      return () => void handlers.delete(type);
    },
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

const ME = { nickname: "가람", appearance: DEFAULT_APPEARANCE, sessionId: "V0" };

/** A village connection, armed in village mode. */
function joinedVillage(): FakeRoom {
  const r0 = fakeRoom("V0");
  h.setRoom(r0);
  attachResilience(r0 as never);
  return r0;
}

/** Drop it after a server restart: the token is refused by a server that answers (numeric code). */
function restart(r0: FakeRoom): void {
  h.reconnect.mockRejectedValue({ code: 4212, message: "reconnection token invalid or expired" });
  r0.fireLeave(4001); // Colyseus SERVER_SHUTDOWN: a reconnect, not a kick
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memStorage());
  vi.stubGlobal("localStorage", memStorage());
  for (const fn of [h.reconnect, h.joinVillageRoom, h.waitForSelf]) fn.mockReset();
  h.waitForSelf.mockResolvedValue(undefined);
  h.setRoom(null);
  useAppStore.setState({
    screen: "village",
    identity: { ...ME },
    notice: null,
    reconnecting: false,
    connectionEpoch: 0,
  });
});

describe("arming a village connection", () => {
  it("turns the SDK's own reconnect off", () => {
    const r0 = joinedVillage();
    expect(r0.reconnection.enabled).toBe(false);
  });

  it("listens for the server's clock (ServerTime) before anything awaits, on the first room and on every reconnect's", async () => {
    const r0 = joinedVillage();
    expect(r0.handlers.has("ServerTime")).toBe(true);
    const r1 = fakeRoom("V0");
    h.reconnect.mockResolvedValueOnce(r1);
    r0.fireLeave(1006);
    await flush();
    expect(h.getRoom()).toBe(r1);
    expect(r1.handlers.has("ServerTime")).toBe(true);
  });

  it("feeds the village's clock: a device clock 3 h wrong still reads the server's time", () => {
    const offsetBefore = villageClock.offsetMs();
    const r0 = joinedVillage();
    const serverNow = Date.now() + 3 * 3_600_000; // the device is 3 h behind the server
    r0.handlers.get("ServerTime")!({ serverTimeMs: serverNow });
    expect(Math.abs(villageClock.nowMs() - serverNow)).toBeLessThan(2000);
    villageClock.sync(Date.now() + offsetBefore, Date.now()); // put the module's clock back
  });
});

describe("village connection closes", () => {
  it("a plain drop rejoins the SAME session by token (Phase 1), no fresh join", async () => {
    const r0 = joinedVillage();
    const r1 = fakeRoom("V0");
    h.reconnect.mockResolvedValueOnce(r1);
    r0.fireLeave(1006);
    await flush();
    expect(h.getRoom()).toBe(r1);
    expect(useAppStore.getState().connectionEpoch).toBe(1);
    expect(useAppStore.getState().screen).toBe("village");
    expect(h.joinVillageRoom).not.toHaveBeenCalled();
  });

  it("a kick code → the entry with the kick notice, nothing retried", async () => {
    const r0 = joinedVillage();
    r0.fireLeave(KICK_CLOSE_CODE);
    await flush();
    const s = useAppStore.getState();
    expect(s.screen).toBe("entry");
    expect(s.notice).toBe(KICKED_NOTICE);
    expect(h.reconnect).not.toHaveBeenCalled();
    expect(h.joinVillageRoom).not.toHaveBeenCalled();
    expect(h.getRoom()).toBeNull();
  });
});

describe("Phase 2 after a server restart: joinOrCreate", () => {
  it("rejoins with joinVillageRoom({ nickname, appearance }) as THIS tab's identity", async () => {
    const r0 = joinedVillage();
    sessionStorage.removeItem("cv.reconnectToken"); // straight to Phase 2
    const fresh = fakeRoom("V9");
    h.joinVillageRoom.mockResolvedValueOnce(fresh);
    r0.fireLeave(1006);
    await flush();

    expect(h.joinVillageRoom).toHaveBeenCalledTimes(1);
    expect(h.joinVillageRoom).toHaveBeenCalledWith({ nickname: "가람", appearance: DEFAULT_APPEARANCE });
    expect(h.getRoom()).toBe(fresh);
    const s = useAppStore.getState();
    expect(s.screen).toBe("village");
    expect(s.identity?.sessionId).toBe("V9");
    expect(s.connectionEpoch).toBe(1);
    expect(s.reconnecting).toBe(false);
  });

  it("after the token is refused by the restarted server it also lands on joinOrCreate", async () => {
    const r0 = joinedVillage();
    const fresh = fakeRoom("V8");
    h.joinVillageRoom.mockResolvedValueOnce(fresh);
    restart(r0);
    await flush();
    expect(h.joinVillageRoom).toHaveBeenCalledTimes(1);
    expect(h.getRoom()).toBe(fresh);
  });

  it("re-arms the new room (SDK reconnect off) so a second drop is recovered in village mode too", async () => {
    const r0 = joinedVillage();
    sessionStorage.removeItem("cv.reconnectToken");
    const fresh = fakeRoom("V7");
    h.joinVillageRoom.mockResolvedValueOnce(fresh);
    r0.fireLeave(1006);
    await flush();
    expect(fresh.reconnection.enabled).toBe(false);

    // The second drop: again a fresh village join, again joinOrCreate.
    sessionStorage.removeItem("cv.reconnectToken");
    const again = fakeRoom("V6");
    h.joinVillageRoom.mockResolvedValueOnce(again);
    fresh.fireLeave(1006);
    await flush();
    expect(h.joinVillageRoom).toHaveBeenCalledTimes(2);
    expect(h.getRoom()).toBe(again);
  });

  it("retries a transient failure through the backoff, then recovers", async () => {
    const r0 = joinedVillage();
    sessionStorage.removeItem("cv.reconnectToken");
    const fresh = fakeRoom("V5");
    h.joinVillageRoom.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(fresh);
    r0.fireLeave(1006);
    await flush();
    expect(h.joinVillageRoom).toHaveBeenCalledTimes(2);
    expect(h.getRoom()).toBe(fresh);
    expect(useAppStore.getState().screen).toBe("village");
  });

  it("a Korean refusal is terminal at once: back to the entry with the server's words", async () => {
    const r0 = joinedVillage();
    sessionStorage.removeItem("cv.reconnectToken");
    h.joinVillageRoom.mockRejectedValue(new Error("닉네임은 한글·영문·숫자 2~12자로 입력하세요."));
    r0.fireLeave(1006);
    await flush();
    expect(h.joinVillageRoom).toHaveBeenCalledTimes(1);
    const s = useAppStore.getState();
    expect(s.screen).toBe("entry");
    expect(s.notice).toBe("닉네임은 한글·영문·숫자 2~12자로 입력하세요.");
  });
});
