import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The village's area filter inside the real `startRemoteSync` (케이슨 마을, Task 4): a remote in the OTHER area than
 * the local player's is not in the remote store, so RemotePlayers (which mounts the roster) never mounts it — no
 * model, nametag, bubble or draw call. Only the Colyseus state-callback API is faked (the real one needs a live
 * room): `getStateCallbacks(room)` hands out `onAdd` / `onRemove` for the players map and `onChange` / `listen`
 * for a player, with the 0.17 behaviour the sync relies on (`onAdd(cb, true)` replays, `listen` calls back at once).
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
  /** Change a synced field the way a state patch does: write it, then tell the field's listeners and onChange. */
  const patch = (p: FakePlayer, changes: Record<string, unknown>) => {
    Object.assign(p, changes);
    const r = reg(p);
    for (const field of Object.keys(changes)) for (const cb of [...(r.fields.get(field) ?? [])]) cb(changes[field]);
    for (const cb of [...r.change]) cb();
  };
  return { FakeRoom, getStateCallbacks, patch };
});

vi.mock("@colyseus/sdk", () => ({ getStateCallbacks: h.getStateCallbacks }));

import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { PLACE_ESCAPE, PLACE_HUB } from "@caysonverse/shared/escape/constants";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import { startRemoteSync, type PlayersRoom } from "./remoteSync";
import type { AreaGate } from "./areaFilter";
import { clearRemotes, getRemoteRecord, getRoster } from "./remoteStore";

let seq = 0;
type TestPlayer = Record<string, unknown>;
function player(over: TestPlayer = {}): TestPlayer {
  return { ...DEFAULT_APPEARANCE, nickname: `p${++seq}`, connected: true, seatIndex: -1, role: 0, place: PLACE_HUB, area: "village", x: 1, z: 2, yaw: 0, ...over };
}

/** A gate with its own state (the real one is villageArea's store; this keeps the test about the sync). */
function makeGate(start: AreaId = "village") {
  let area = start;
  const listeners = new Set<() => void>();
  const gate: AreaGate & { listenerCount(): number } = {
    local: () => area,
    setLocal(next) {
      if (next === area) return;
      area = next;
      for (const l of [...listeners]) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    listenerCount: () => listeners.size,
  };
  return gate;
}

let room: InstanceType<typeof h.FakeRoom>;
let stop: (() => void) | null = null;

function start(gate?: AreaGate, self: { x: number; z: number; yaw: number } = { x: 0, z: 0, yaw: 0 }): void {
  stop = startRemoteSync(room as unknown as PlayersRoom, () => 0, self, { index: -1 }, gate);
}
function join(sid: string, p: TestPlayer): TestPlayer {
  room.players.set(sid, p);
  for (const cb of [...room.addCbs]) cb(p, sid);
  return p;
}

beforeEach(() => {
  clearRemotes();
  room = new h.FakeRoom();
});
afterEach(() => {
  stop?.();
  stop = null;
  clearRemotes();
});

describe("startRemoteSync with an area gate (케이슨 마을)", () => {
  it("mounts only the players of the local player's area (a remote in the other area is not in the roster)", () => {
    const gate = makeGate("village");
    room.players.set("me", player());
    room.players.set("a", player({ area: "village" }));
    room.players.set("b", player({ area: "hall" }));
    start(gate);
    expect(getRoster()).toEqual(["a"]);
    expect(getRemoteRecord("b")).toBeUndefined();

    join("c", player({ area: "hall" })); // arrives in the hall: still not mounted
    join("d", player({ area: "village" }));
    expect(getRoster()).toEqual(["a", "d"]);
  });

  it("a remote coming through the door leaves my screen, and comes back where they stand", () => {
    const gate = makeGate("village");
    room.players.set("me", player());
    const a = join("a", player({ area: "village", x: 5, z: 6 }));
    start(gate);
    expect(getRoster()).toEqual(["a"]);

    h.patch(a, { area: "hall", x: 300, z: 3.6 }); // went into the memorial hall
    expect(getRoster()).toEqual([]);

    h.patch(a, { area: "village", x: 0, z: -49.4 }); // came out again
    expect(getRoster()).toEqual(["a"]);
    const snap = getRemoteRecord("a")!.snapshots.at(-1)!;
    expect([snap.x, snap.z]).toEqual([0, -49.4]); // seeded at the CURRENT position, not the old one
  });

  it("when I go through the door every remote is judged again: the village empties, the hall fills", () => {
    const gate = makeGate("village");
    const me = player();
    room.players.set("me", me);
    room.players.set("a", player({ area: "village" }));
    room.players.set("b", player({ area: "hall" }));
    start(gate);
    expect(getRoster()).toEqual(["a"]);

    h.patch(me, { area: "hall" }); // the server moved me inside
    expect(gate.local()).toBe("hall");
    expect(getRoster()).toEqual(["b"]);

    h.patch(me, { area: "village" });
    expect(gate.local()).toBe("village");
    expect(getRoster()).toEqual(["a"]);
  });

  it("seeds the local area from my own synced state (a reconnect into the hall starts in the hall)", () => {
    const gate = makeGate("village"); // stale: the scene would have seeded it, but the sync is the truth
    room.players.set("me", player({ area: "hall" }));
    room.players.set("a", player({ area: "village" }));
    room.players.set("b", player({ area: "hall" }));
    start(gate);
    expect(gate.local()).toBe("hall");
    expect(getRoster()).toEqual(["b"]);
  });

  it("through the door I am put down facing the way the server says (the camera swings behind that), not before", () => {
    const gate = makeGate("village");
    const me = player({ area: "village", x: 0, z: -51, yaw: 3.1 });
    room.players.set("me", me);
    const self = { x: 0, z: -51, yaw: 1.2 };
    start(gate, self);
    expect(self.yaw).toBe(1.2); // joining seeds the area; it does not turn me

    h.patch(me, { area: "hall", x: 300, z: 3.6, yaw: Math.PI }); // used the door
    expect(self.yaw).toBe(Math.PI);
    expect([self.x, self.z]).toEqual([300, 3.6]); // the position snap is the existing one

    h.patch(me, { yaw: 0.4 }); // an ordinary echo of my own facing is not a door
    expect(self.yaw).toBe(Math.PI);

    h.patch(me, { area: "village", x: 0, z: -49.4, yaw: 0 }); // and out again
    expect(self.yaw).toBe(0);
  });

  it("without a gate nothing about my facing is touched (a kick-back in the legacy world)", () => {
    const me = player({ area: "village", yaw: 2 });
    room.players.set("me", me);
    const self = { x: 0, z: 0, yaw: 1.2 };
    start(undefined, self);
    h.patch(me, { area: "hall", x: 300, z: 3.6, yaw: Math.PI });
    expect(self.yaw).toBe(1.2);
  });

  it("the classroom rule still applies on top (a remote inside a classroom is not shown even in my area)", () => {
    const gate = makeGate("village");
    room.players.set("me", player());
    const a = join("a", player({ area: "village" }));
    start(gate);
    h.patch(a, { place: PLACE_ESCAPE });
    expect(getRoster()).toEqual([]);
    h.patch(a, { place: PLACE_HUB });
    expect(getRoster()).toEqual(["a"]);
  });

  it("a player leaving is gone from the store, and teardown clears it and unsubscribes from the gate", () => {
    const gate = makeGate("village");
    room.players.set("me", player());
    room.players.set("a", player({ area: "village" }));
    start(gate);
    expect(gate.listenerCount()).toBe(1); // one subscription per remote shown or not
    for (const cb of [...room.removeCbs]) cb(room.players.get("a")!, "a");
    room.players.delete("a");
    expect(getRoster()).toEqual([]);
    expect(gate.listenerCount()).toBe(0);

    room.players.set("b", player({ area: "village" }));
    join("b", room.players.get("b")!);
    expect(gate.listenerCount()).toBe(1);
    stop!();
    stop = null;
    expect(getRoster()).toEqual([]);
    expect(gate.listenerCount()).toBe(0);
  });
});

describe("startRemoteSync WITHOUT a gate (the legacy world, the hall, a classroom) — nothing about areas", () => {
  it("shows every remote whatever its area field says, and the place filter works as before", () => {
    room.players.set("me", player());
    room.players.set("a", player({ area: "hall" }));
    room.players.set("b", player({ area: "village" }));
    start();
    expect(getRoster()).toEqual(["a", "b"]);
    const a = room.players.get("a")!;
    h.patch(a, { place: PLACE_ESCAPE });
    expect(getRoster()).toEqual(["b"]);
    h.patch(a, { place: PLACE_HUB });
    expect(getRoster()).toEqual(["a", "b"]);
  });
});
