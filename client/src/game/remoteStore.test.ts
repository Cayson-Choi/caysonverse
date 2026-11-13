import { describe, it, expect, beforeEach } from "vitest";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  applyPreset,
} from "@caysonverse/shared/appearance";
import { RUN_SPEED } from "@caysonverse/shared/constants";
import { VILLAGE_SEATS as SEATS } from "@caysonverse/shared/village/benchSeats";
import {
  addRemote,
  removeRemote,
  clearRemotes,
  forEachRemotePosition,
  getRoster,
  getRemoteRecord,
  getRemotes,
  noteRemoteDrawn,
  receiveRemotePose,
  type RemotePlayerRecord,
} from "./remoteStore";
import { advancePlayout, createPlayout } from "./playout";
import { sample } from "./interpolation";
import { createSeatMotion, stepSeatMotion } from "./remoteSeat";
import { collectObstacles } from "./playerObstacles";
import { VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";

function rec(sessionId: string, over: Partial<RemotePlayerRecord> = {}): RemotePlayerRecord {
  return {
    sessionId,
    nickname: sessionId,
    appearance: { ...DEFAULT_APPEARANCE },
    connected: true,
    seatIndex: -1,
    snapshots: [],
    playout: createPlayout(),
    ...over,
  };
}

/**
 * A reconnection RESYNC is a `clearRemotes()` (teardown of the dropped room's
 * sync) followed by re-adding every player from the reconnected room's fresh
 * state (startRemoteSync's immediate onAdd replay). These tests feed such
 * add/remove/clear sequences and assert the roster never carries a duplicate.
 */
describe("remoteStore roster + resync rebuild dedup", () => {
  beforeEach(() => clearRemotes());

  it("keys by sessionId — a re-add replaces, never duplicates the roster", () => {
    addRemote(rec("a"));
    addRemote(rec("a", { nickname: "a2" }));
    expect(getRoster()).toEqual(["a"]);
    expect(getRemoteRecord("a")?.nickname).toBe("a2");
  });

  it("a clear→replay rebuild drops stale ids and dedups overlapping ones (last wins)", () => {
    // Pre-drop roster.
    addRemote(rec("a"));
    addRemote(rec("b"));
    // Resync: teardown clears, then the fresh state replays b, c, c (overlap).
    clearRemotes();
    addRemote(rec("b"));
    addRemote(rec("c"));
    addRemote(rec("c", { nickname: "c2" }));
    expect(getRoster()).toEqual(["b", "c"]); // sorted, unique; 'a' gone; one 'c'
    expect(getRemoteRecord("c")?.nickname).toBe("c2");
    expect(getRemoteRecord("a")).toBeUndefined();
  });

  it("a full add/remove/resync sequence yields a strictly unique roster", () => {
    addRemote(rec("x"));
    addRemote(rec("y"));
    removeRemote("y");
    // Reconnect resync — fresh state contains x, y again, plus z.
    clearRemotes();
    for (const id of ["x", "y", "z", "x"]) addRemote(rec(id)); // 'x' appears twice
    expect(getRoster()).toEqual(["x", "y", "z"]);
    expect(getRoster().length).toBe(new Set(getRoster()).size); // strictly unique
  });

  it("resyncing into an empty state clears the roster", () => {
    addRemote(rec("a"));
    clearRemotes();
    expect(getRoster()).toEqual([]);
  });
});

describe("remoteStore appearance", () => {
  beforeEach(() => clearRemotes());

  it("keeps the synced appearance on the record and in getRemotes()", () => {
    const princess = applyPreset(DEFAULT_APPEARANCE, APPEARANCE_PRESETS[1]);
    addRemote(rec("plain"));
    addRemote(rec("princess", { appearance: { ...princess, voice: 1 } }));

    expect(getRemoteRecord("plain")?.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(getRemoteRecord("princess")?.appearance).toEqual({ ...princess, voice: 1 });

    const remotes = getRemotes();
    expect(remotes.find((r) => r.sessionId === "plain")?.appearance).toEqual(DEFAULT_APPEARANCE);
    const view = remotes.find((r) => r.sessionId === "princess")!;
    expect(view.appearance).toEqual({ ...princess, voice: 1 });
    // The dev view is a copy: an E2E caller cannot reach into the live record.
    view.appearance.top = 0;
    expect(getRemoteRecord("princess")?.appearance.top).toBe(princess.top);
    // The pre-builder fields are gone from the view.
    expect(view).not.toHaveProperty("character");
    expect(view).not.toHaveProperty("tint");
  });
});

describe("remoteStore — the solid body is the one on screen (fix: collision on the drawn pose)", () => {
  beforeEach(() => clearRemotes());

  it("forEachRemotePosition reports the drawn pose once RemotePlayer drew one, the newest snapshot before that", () => {
    addRemote(rec("a"));
    receiveRemotePose("a", 1000, 0, 5, 6, 0);
    const seen: Array<[number, number]> = [];
    forEachRemotePosition((x, z) => seen.push([x, z]));
    expect(seen).toEqual([[5, 6]]);
    noteRemoteDrawn(getRemoteRecord("a")!, 4.2, 6);
    seen.length = 0;
    forEachRemotePosition((x, z) => seen.push([x, z]));
    expect(seen).toEqual([[4.2, 6]]);
  });

  it("a running remote blocks where it is drawn, not a playout lag ahead of it on empty floor", () => {
    setActiveMap(VILLAGE_ACTIVE_MAP);
    addRemote(rec("runner"));
    const record = getRemoteRecord("runner")!;
    receiveRemotePose("runner", 0, 0, 0, 0, Math.PI / 2);
    const drawn = { x: 0, z: 0, yaw: 0 };
    const motion = createSeatMotion(-1, SEATS, drawn);
    // Running along +x at RUN_SPEED, a stamped Move every 100 ms arriving 60 ms later; the viewer draws at 60 fps.
    let k = 1;
    for (let now = 0; now <= 2000; now += 1000 / 60) {
      while (100 * k + 60 <= now) {
        receiveRemotePose("runner", 100 * k + 60, 5000 + 100 * k, RUN_SPEED * 0.1 * k, 0, Math.PI / 2);
        k++;
      }
      const renderT = advancePlayout(record.playout, record.snapshots, now);
      const target = sample(record.snapshots, renderT)!;
      stepSeatMotion(motion, record.seatLine!, renderT, target, 1 / 60, SEATS, drawn, () => 0.8);
      noteRemoteDrawn(record, drawn.x, drawn.z);
    }
    const newest = record.snapshots[record.snapshots.length - 1];
    expect(newest.x - drawn.x).toBeGreaterThan(1.2); // the newest data is well ahead of the body on screen
    // The local player stands just ahead of the drawn body, on the floor the newest snapshot occupies.
    const list = collectObstacles(drawn.x + 1.0, 0.0);
    const box = list[list.length - 1];
    expect((box.minX + box.maxX) / 2).toBeCloseTo(drawn.x, 9);
    // (The old code put the box on the newest snapshot: the local player at drawn.x + 1 would have been blocked by
    // nothing visible, and could walk into the body it saw.)
    expect(Math.abs((box.minX + box.maxX) / 2 - newest.x)).toBeGreaterThan(1.2);
  });
});
