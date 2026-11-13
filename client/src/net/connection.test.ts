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

import { VILLAGE_ROOM } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import { VillageMsg } from "@caysonverse/shared/village/messages";
import { DEFAULT_APPEARANCE, APPEARANCE_FIELDS } from "@caysonverse/shared/appearance";
import {
  getActiveRoom,
  getRoom,
  handlePageHide,
  joinVillage,
  sendChat,
  sendEmoji,
  sendJump,
  sendMove,
  sendTyping,
  sendUseDoor,
  sendKeypad,
  setRoom,
} from "./connection";

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
    state: { players: new Map([[sid, { nickname: "가람", x: 0, z: 0, yaw: 0 }]]) },
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
  setRoom(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("active-room routing", () => {
  it("move/chat/emoji/jump/typing go to the village room", () => {
    const village = fakeRoom();
    setRoom(village as never);
    sendMove({ x: 1, z: 2, yaw: 0 } as never);
    sendChat("안녕");
    sendEmoji(3);
    sendJump();
    sendTyping(true);
    expect(village.send.mock.calls.map((c) => c[0])).toEqual([
      MessageType.Move,
      MessageType.Chat,
      MessageType.Emoji,
      MessageType.Jump,
      MessageType.Typing,
    ]);
    expect(getActiveRoom()).toBe(village);
  });

  it("with no room set, every send is a quiet no-op", () => {
    expect(getActiveRoom()).toBeNull();
    expect(() => {
      sendMove({ x: 1, z: 2, yaw: 0 } as never);
      sendChat("안녕");
      sendEmoji(1);
      sendJump();
      sendTyping(false);
      sendUseDoor();
      sendKeypad("house_1", "1004");
    }).not.toThrow();
  });
});

describe("joinVillage (케이슨 마을)", () => {
  it("joinOrCreates the village room with exactly nickname + the NESTED appearance — never an admin code", async () => {
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
    // The village is not a singleton: never a join-existing-only call.
    expect(h.join).not.toHaveBeenCalled();
  });

  it("drops any extra field a caller passes (the join options are fixed)", async () => {
    h.joinOrCreate.mockResolvedValueOnce(fakeRoom());
    await joinVillage({ nickname: "가람", appearance: LOOK, adminCode: "secret" } as never);
    expect(h.joinOrCreate.mock.calls[0][1]).toEqual({ nickname: "가람", appearance: LOOK });
  });

  it("adopts the room and arms the resilience (SDK reconnect off)", async () => {
    const room = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(room);
    await joinVillage({ nickname: "가람", appearance: LOOK });

    expect(getRoom()).toBe(room);
    expect(room.reconnection.enabled).toBe(false);
    // Village chat and moves go to the village room (the active room).
    sendChat("안녕하세요");
    sendMove({ x: 1, z: 2, yaw: 0 } as never);
    expect(room.send.mock.calls.map((c) => c[0])).toEqual([MessageType.Chat, MessageType.Move]);
  });

  it("sendUseDoor sends the village's UseDoor (no data) to the village room", async () => {
    const village = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(village);
    await joinVillage({ nickname: "가람", appearance: LOOK });
    sendUseDoor();
    expect(village.send).toHaveBeenCalledTimes(1);
    expect(village.send).toHaveBeenCalledWith(VillageMsg.UseDoor, {});
  });

  it("sendKeypad sends only the claimed house id and typed digits", async () => {
    const village = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(village);
    await joinVillage({ nickname: "가람", appearance: LOOK });
    sendKeypad("house_1", "1004");
    expect(village.send).toHaveBeenCalledWith(VillageMsg.Keypad, { buildingId: "house_1", code: "1004" });
  });

  it("a drop after a server restart rejoins by joinOrCreate(VILLAGE_ROOM)", async () => {
    // This is the only test that runs the REAL resilience against joinVillage.
    const first = fakeRoom();
    const second = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    h.reconnect.mockRejectedValue({ code: 4212, message: "reconnection token invalid or expired" });
    await joinVillage({ nickname: "가람", appearance: LOOK });

    first.fireLeave(1006);
    for (let i = 0; i < 40 && h.joinOrCreate.mock.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 0));

    expect(h.reconnect).toHaveBeenCalled(); // phase 1 tried the token first and was refused
    expect(h.joinOrCreate).toHaveBeenCalledTimes(2);
    expect(h.joinOrCreate.mock.calls[1][0]).toBe(VILLAGE_ROOM);
    expect(h.join).not.toHaveBeenCalled();
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

describe("pagehide", () => {
  it("is registered on window 'pagehide'", () => {
    expect(h.listeners.pagehide).toContain(handlePageHide);
  });

  it("pagehide is a consented leave of the village room", async () => {
    const village = fakeRoom();
    h.joinOrCreate.mockResolvedValueOnce(village);
    await joinVillage({ nickname: "가람", appearance: LOOK });
    for (const fn of h.listeners.pagehide) fn();
    expect(village.leave).toHaveBeenCalledWith(true);
  });

  it("without a room pagehide does nothing", () => {
    expect(() => handlePageHide()).not.toThrow();
  });
});
