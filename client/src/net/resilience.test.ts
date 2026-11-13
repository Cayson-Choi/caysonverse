import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Driver-level tests for the reconnection flow. The real `./connection` module
 * constructs a Colyseus `Client` and reads `window` at import — neither exists in
 * the node test env — so it is fully mocked here (a fresh Colyseus client is
 * never built). `getRoom`/`setRoom` are backed by a single test-local handle so
 * the driver's room adoption is observable. Backoff is squashed to 0ms delays so
 * the retry schedule runs without real waits.
 */

// ── connection mock (shared room handle via vi.hoisted) ──
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
    resetRoom: () => {
      currentRoom = null;
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

vi.mock("./backoff", () => ({ reconnectBackoffMs: () => [0, 0, 0, 0] }));

import { attachResilience } from "./resilience";
import { useAppStore } from "../stores/appStore";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";

// ── in-memory storage stubs (loadToken / loadIdentity / kickSeam) ──
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
  onMessage: (type: string, cb: (message: never) => void) => () => void;
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
    onMessage: () => () => undefined, // the village clock / candles listen on every armed room
    fireLeave: (code) => cbs.slice().forEach((cb) => cb(code)),
    state: {},
  };
}

const flush = async (n = 25): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** Arm resilience on an initial room, then drop it to kick off recovery. These
 *  tests exercise the Phase-2 fresh-join path, so clear the token attachResilience
 *  persisted (no Phase-1 token reconnect). */
function dropInitialRoom(): FakeRoom {
  const r0 = fakeRoom("R0");
  h.setRoom(r0);
  attachResilience(r0 as never);
  sessionStorage.removeItem("cv.reconnectToken"); // force straight to Phase 2
  r0.fireLeave(1006); // abnormal close → reconnect flow (not a kick/consented)
  return r0;
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memStorage());
  vi.stubGlobal("localStorage", memStorage());
  h.reconnect.mockReset();
  h.joinVillageRoom.mockReset();
  h.waitForSelf.mockReset();
  h.resetRoom();
  useAppStore.setState({
    screen: "village",
    identity: { nickname: "u", appearance: DEFAULT_APPEARANCE, sessionId: "R0" },
    notice: null,
    reconnecting: false,
    connectionEpoch: 0,
  });
});

describe("F4 — a drop during the confirm wait must not strand a zombie village", () => {
  it("adopts+arms the room BEFORE waitForSelf, and retries when it closes mid-wait", async () => {
    const roomA = fakeRoom("A"); // first fresh join, drops again during waitForSelf
    const roomB = fakeRoom("B"); // the retry that succeeds
    h.joinVillageRoom.mockResolvedValueOnce(roomA).mockResolvedValueOnce(roomB);
    // waitForSelf never resolves for A (we abort it via the mid-wait close);
    // resolves immediately for B.
    h.waitForSelf.mockImplementation((r: FakeRoom) =>
      r === roomB ? Promise.resolve() : never<void>(),
    );

    dropInitialRoom(); // no token → straight to Phase-2 fresh join
    await flush(); // let recovery park at waitForSelf(A)

    // A was adopted (getRoom===A) and its onLeave armed BEFORE the wait resolved —
    // otherwise this close would fire into a handler-less, SDK-destroyed room.
    expect(h.getRoom()).toBe(roomA);
    roomA.fireLeave(1006); // second drop DURING the confirm wait
    await flush();

    // Recovered on the retry rather than stranding: B is adopted, overlay cleared.
    expect(h.joinVillageRoom).toHaveBeenCalledTimes(2);
    expect(h.getRoom()).toBe(roomB);
    const s = useAppStore.getState();
    expect(s.reconnecting).toBe(false);
    expect(s.connectionEpoch).toBe(1);
    expect(s.screen).toBe("village"); // never fell back to entry
  });
});

describe("fresh re-join carries this tab's appearance (character stage 3)", () => {
  it("joins with the in-memory nickname + appearance, never the pre-builder character/tint", async () => {
    const look = { ...DEFAULT_APPEARANCE, top: 3, topColor: 5, voice: 1 };
    useAppStore.setState({ identity: { nickname: "케이슨", appearance: look, sessionId: "R0" } });
    h.joinVillageRoom.mockResolvedValueOnce(fakeRoom("A"));
    h.waitForSelf.mockResolvedValue(undefined);

    dropInitialRoom(); // no token → straight to Phase-2 fresh join
    await flush();

    expect(h.joinVillageRoom).toHaveBeenCalledTimes(1);
    // Exactly nickname + appearance: no sessionId, no pre-builder character/tint.
    expect(h.joinVillageRoom.mock.calls[0][0]).toEqual({ nickname: "케이슨", appearance: look });
  });

  it("ignores a different look another tab's builder saved to localStorage meanwhile", async () => {
    const mine = { ...DEFAULT_APPEARANCE, hat: 4, hatColor: 11, voice: 1 };
    const otherTab = { ...DEFAULT_APPEARANCE, top: 2, topColor: 0, voice: 0 };
    useAppStore.setState({ identity: { nickname: "케이슨", appearance: mine, sessionId: "R0" } });
    // Another tab entered later with another look and nickname: the shared cache now holds THAT one.
    localStorage.setItem("cv.entry", JSON.stringify({ nickname: "다른탭", appearance: otherTab }));
    h.joinVillageRoom.mockResolvedValueOnce(fakeRoom("A"));
    h.waitForSelf.mockResolvedValue(undefined);

    dropInitialRoom();
    await flush();

    expect(h.joinVillageRoom).toHaveBeenCalledTimes(1);
    expect(h.joinVillageRoom.mock.calls[0][0]).toEqual({ nickname: "케이슨", appearance: mine });
    // The rejoined village still shows the look this tab entered with.
    expect(useAppStore.getState().identity?.appearance).toEqual(mine);
  });

  it("falls back to the cached identity only when no in-memory identity exists", async () => {
    const cached = { ...DEFAULT_APPEARANCE, shoes: 3, voice: 1 };
    useAppStore.setState({ identity: null });
    localStorage.setItem("cv.entry", JSON.stringify({ nickname: "캐시", appearance: cached }));
    h.joinVillageRoom.mockResolvedValueOnce(fakeRoom("A"));
    h.waitForSelf.mockResolvedValue(undefined);

    dropInitialRoom();
    await flush();

    expect(h.joinVillageRoom).toHaveBeenCalledTimes(1);
    expect(h.joinVillageRoom.mock.calls[0][0]).toEqual({ nickname: "캐시", appearance: cached });
  });
});

describe("D2 — deterministic rejections surface the real reason immediately", () => {
  it("does NOT retry a server-authored (Hangul) rejection and shows it verbatim", async () => {
    // denySet kick in the lost-kick-close race: every attempt is refused with the same
    // Korean reason. It must terminate on the FIRST attempt, not after ~31s.
    h.joinVillageRoom.mockRejectedValue(new Error("입장이 제한되었습니다")); // 입장이 제한되었습니다

    dropInitialRoom();
    await flush();

    expect(h.joinVillageRoom).toHaveBeenCalledTimes(1); // no backoff hammering
    const s = useAppStore.getState();
    expect(s.screen).toBe("entry");
    expect(s.notice).toBe("입장이 제한되었습니다"); // 입장이 제한되었습니다 (the real reason)
  });

  it("keeps retrying a transient/network failure through the backoff", async () => {
    const roomC = fakeRoom("C");
    h.joinVillageRoom
      .mockRejectedValueOnce(new TypeError("fetch failed")) // transient
      .mockResolvedValueOnce(roomC);
    h.waitForSelf.mockResolvedValue(undefined);

    dropInitialRoom();
    await flush();

    expect(h.joinVillageRoom).toHaveBeenCalledTimes(2); // retried, then recovered
    expect(useAppStore.getState().screen).toBe("village");
  });
});
