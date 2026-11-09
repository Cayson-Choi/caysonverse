import { describe, it, expect, beforeEach } from "vitest";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  applyPreset,
} from "@caysonverse/shared/appearance";
import {
  addRemote,
  removeRemote,
  clearRemotes,
  getRoster,
  getRemoteRecord,
  getRemotes,
  type RemotePlayerRecord,
} from "./remoteStore";
import { createPlayout } from "./playout";

function rec(sessionId: string, over: Partial<RemotePlayerRecord> = {}): RemotePlayerRecord {
  return {
    sessionId,
    nickname: sessionId,
    appearance: { ...DEFAULT_APPEARANCE },
    connected: true,
    seatIndex: -1,
    role: 0,
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

describe("remoteStore role", () => {
  beforeEach(() => clearRemotes());

  it("keeps the synced role on the record and in getRemotes()", () => {
    addRemote(rec("student"));
    addRemote(rec("teacher", { role: 1 }));

    expect(getRemoteRecord("student")?.role).toBe(0);
    expect(getRemoteRecord("teacher")?.role).toBe(1);

    const remotes = getRemotes();
    expect(remotes.find((r) => r.sessionId === "student")?.role).toBe(0);
    expect(remotes.find((r) => r.sessionId === "teacher")?.role).toBe(1);
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
