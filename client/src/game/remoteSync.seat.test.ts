import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real `startRemoteSync` with a faked Colyseus state-callback API (as in remoteSync.area.test.ts):
 *  - a remote's seat change goes with the pose of the same patch (stamped on its timeline), whichever of the
 *    decoder's callbacks runs first — the real 0.17 decoder runs the instance's onChange before the field
 *    listeners, the fake can run them either way round;
 *  - the self-correction leaves a refused Move alone while the server may still heal it (fix: refused-move snap).
 */

type Fn = (...args: unknown[]) => void;

const h = vi.hoisted(() => {
  interface FakePlayer {
    [field: string]: unknown;
  }
  const registry = new WeakMap<object, { fields: Map<string, Set<Fn>>; change: Set<Fn> }>();
  const reg = (p: object) => {
    let r = registry.get(p);
    if (!r) registry.set(p, (r = { fields: new Map(), change: new Set() }));
    return r;
  };
  class FakeRoom {
    sessionId = "me";
    players = new Map<string, FakePlayer>();
    addCbs = new Set<(p: FakePlayer, sid: string) => void>();
    removeCbs = new Set<(p: FakePlayer, sid: string) => void>();
    state = { players: this.players };
  }
  const getStateCallbacks = (room: FakeRoom) => (target: object) => {
    if (target === room.state) {
      return {
        players: {
          onAdd(cb: (p: FakePlayer, sid: string) => void, immediate?: boolean) {
            room.addCbs.add(cb);
            if (immediate) for (const [sid, p] of room.players) cb(p, sid);
            return () => room.addCbs.delete(cb);
          },
          onRemove(cb: (p: FakePlayer, sid: string) => void) {
            room.removeCbs.add(cb);
            return () => room.removeCbs.delete(cb);
          },
        },
      };
    }
    const r = reg(target);
    return {
      onChange(cb: Fn) {
        r.change.add(cb);
        return () => r.change.delete(cb);
      },
      listen(field: string, cb: Fn) {
        if (!r.fields.has(field)) r.fields.set(field, new Set());
        r.fields.get(field)!.add(cb);
        cb((target as FakePlayer)[field]); // immediate first call, as in 0.17
        return () => r.fields.get(field)!.delete(cb);
      },
    };
  };
  /**
   * Apply a state patch: write every field, then run the callbacks — the instance's onChange first and the field
   * listeners after (the real decoder's order), or the other way round.
   */
  const patch = (p: FakePlayer, changes: Record<string, unknown>, order: "change-first" | "fields-first" = "change-first") => {
    Object.assign(p, changes);
    const r = reg(p);
    const fields = () => {
      for (const field of Object.keys(changes)) for (const cb of [...(r.fields.get(field) ?? [])]) cb(changes[field]);
    };
    const change = () => {
      for (const cb of [...r.change]) cb();
    };
    if (order === "change-first") {
      change();
      fields();
    } else {
      fields();
      change();
    }
  };
  return { FakeRoom, getStateCallbacks, patch };
});

vi.mock("@colyseus/sdk", () => ({ getStateCallbacks: h.getStateCallbacks }));

import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { PLACE_HUB } from "@caysonverse/shared/escape/constants";
import { startRemoteSync, type PlayersRoom } from "./remoteSync";
import { clearRemotes, getRemoteRecord } from "./remoteStore";
import { clearSentMoves, createEchoWatch, healDeadline, noteEcho, recordSentMove } from "./sentMoves";
import { REFUSAL_HEAL_MS } from "./constants";

type TestPlayer = Record<string, unknown>;
function player(over: TestPlayer = {}): TestPlayer {
  return { ...DEFAULT_APPEARANCE, nickname: "p", connected: true, seatIndex: -1, role: 0, place: PLACE_HUB, area: "village", x: 1, z: 2, yaw: 0, moveT: 0, ...over };
}

let room: InstanceType<typeof h.FakeRoom>;
let stop: (() => void) | null = null;
let now = 0;
const self = { x: 0, z: 0, yaw: 0 };

function start(): void {
  stop = startRemoteSync(room as unknown as PlayersRoom, () => now, self, { index: -1 });
}

beforeEach(() => {
  clearRemotes();
  clearSentMoves();
  room = new h.FakeRoom();
  now = 10_000;
  Object.assign(self, { x: 0, z: 0, yaw: 0 });
});
afterEach(() => {
  stop?.();
  stop = null;
  clearRemotes();
  vi.useRealTimers();
});

describe("a remote's seat change is stamped with the pose of its patch", () => {
  it.each(["change-first", "fields-first"] as const)("%s: one placed snapshot, one stamped change, seatIndex at once", (order) => {
    const a = player({ x: 3, z: 4, moveT: 900 });
    room.players.set("me", player());
    room.players.set("a", a);
    start();
    now += 100;
    h.patch(a, { x: 3.4, z: 4, moveT: 1000 }, order); // a walk step
    now += 300;
    h.patch(a, { seatIndex: 5, x: 4.55, z: 9.465, yaw: -2.75 }, order); // the server seats it (moveT untouched)
    const rec = getRemoteRecord("a")!;
    expect(rec.seatIndex).toBe(5); // prompts / occupancy: now
    const placed = rec.snapshots.filter((s) => s.placed);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ x: 4.55, z: 9.465, yaw: -2.75 });
    expect(rec.seatLine!.pending).toEqual([{ t: placed[0].t, seat: 5 }]);
    expect(rec.seatLine!.drawn).toBe(-1); // the avatar sits when its render time gets there
    now += 2000;
    h.patch(a, { seatIndex: -1, x: 4.49, z: 9.019 }, order); // gets up: onto the dismount spot
    expect(rec.seatIndex).toBe(-1);
    expect(rec.snapshots.filter((s) => s.placed)).toHaveLength(2);
    expect(rec.seatLine!.pending.map((c) => c.seat)).toEqual([5, -1]);
    expect(rec.seatLine!.pending[1].t).toBe(rec.snapshots[rec.snapshots.length - 1].t);
  });
});

describe("the self-correction waits out a refused Move the server may still heal", () => {
  /** I ran north, a Move every 100 ms (stamped 1000, 1100, ...), and my own player is in the room. */
  function runner() {
    for (let k = 0; k <= 30; k++) recordSentMove({ x: 0, z: -0.64 * k, yaw: Math.PI, t: 1000 + 100 * k });
    const me = player({ x: 0, z: 0, moveT: 1000 });
    room.players.set("me", me);
    start();
    return me;
  }

  it("a refusal the server heals within ~0.3 s: no snap (the old check yanked me back 2.5 m at once)", () => {
    vi.useFakeTimers();
    const me = runner();
    h.patch(me, { z: -0.64 * 5, moveT: 1500 }); // accepted
    Object.assign(self, { x: 0, z: -0.64 * 9 }); // I am 0.4 s further on
    h.patch(me, { moveT: 0 }); // the burst after an uplink stall: its last Moves are over the budget
    expect(self.z).toBeCloseTo(-0.64 * 9, 9); // left alone
    now += 300;
    vi.advanceTimersByTime(300);
    Object.assign(self, { x: 0, z: -0.64 * 13 });
    h.patch(me, { z: -0.64 * 10, moveT: 2000 }); // the budget refilled: it took the next Move — healed
    now += 1000;
    vi.advanceTimersByTime(1000);
    expect(self.z).toBeCloseTo(-0.64 * 13, 9); // never yanked back
  });

  it("a refusal that lasts REFUSAL_HEAL_MS: snap to the server (it will not catch up by itself)", () => {
    vi.useFakeTimers();
    const me = runner();
    h.patch(me, { z: -0.64 * 5, moveT: 1500 });
    Object.assign(self, { x: 0, z: -0.64 * 9 });
    h.patch(me, { moveT: 0 });
    expect(self.z).toBeCloseTo(-0.64 * 9, 9);
    // No patch comes (the server's pose does not change while it refuses): the timer looks again at the deadline.
    now += REFUSAL_HEAL_MS - 1;
    vi.advanceTimersByTime(REFUSAL_HEAL_MS - 1);
    expect(self.z).toBeCloseTo(-0.64 * 9, 9);
    Object.assign(self, { x: 0, z: -0.64 * 15 });
    now += 1;
    vi.advanceTimersByTime(1);
    expect(self.z).toBeCloseTo(-0.64 * 5, 9); // resynced onto the server's pose
  });

  it("a refusal that lasts but leaves me within reach of the budget: no snap", () => {
    vi.useFakeTimers();
    const me = runner();
    h.patch(me, { z: -0.64 * 5, moveT: 1500 });
    Object.assign(self, { x: 0, z: -0.64 * 6 }); // I stopped 0.64 m on
    h.patch(me, { moveT: 0 });
    now += REFUSAL_HEAL_MS;
    vi.advanceTimersByTime(REFUSAL_HEAL_MS);
    expect(self.z).toBeCloseTo(-0.64 * 6, 9);
  });

  it("the teardown cancels a pending look", () => {
    vi.useFakeTimers();
    const me = runner();
    h.patch(me, { z: -0.64 * 5, moveT: 1500 });
    Object.assign(self, { x: 0, z: -0.64 * 15 });
    h.patch(me, { moveT: 0 });
    stop!();
    stop = null;
    now += REFUSAL_HEAL_MS;
    vi.advanceTimersByTime(REFUSAL_HEAL_MS);
    expect(self.z).toBeCloseTo(-0.64 * 15, 9);
  });
});

describe("noteEcho (sentMoves)", () => {
  it("ok on stamps and on a server that never echoed one; healing, then refused, once the echo went to 0", () => {
    const w = createEchoWatch();
    expect(noteEcho(w, 0, 100)).toBe("ok"); // never saw a stamp: an older server, or nothing sent yet
    expect(noteEcho(w, 1500, 200)).toBe("ok");
    expect(noteEcho(w, 0, 300)).toBe("healing");
    expect(healDeadline(w)).toBe(300 + REFUSAL_HEAL_MS);
    expect(noteEcho(w, 0, 300 + REFUSAL_HEAL_MS - 1)).toBe("healing");
    expect(noteEcho(w, 0, 300 + REFUSAL_HEAL_MS)).toBe("refused");
    expect(noteEcho(w, 1700, 1000)).toBe("ok"); // healed
    expect(noteEcho(w, 0, 1100)).toBe("healing"); // a new refusal counts from its own start
  });
});
