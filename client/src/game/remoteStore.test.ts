import { describe, it, expect, beforeEach } from "vitest";
import {
  addRemote,
  removeRemote,
  clearRemotes,
  getRoster,
  getRemoteRecord,
  type RemotePlayerRecord,
} from "./remoteStore";

function rec(sessionId: string, over: Partial<RemotePlayerRecord> = {}): RemotePlayerRecord {
  return {
    sessionId,
    nickname: sessionId,
    character: 0,
    tint: 0,
    connected: true,
    snapshots: [],
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
