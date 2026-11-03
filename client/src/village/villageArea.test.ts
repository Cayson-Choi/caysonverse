import { afterEach, describe, expect, it } from "vitest";
import type { PlayersRoom } from "../game/remoteSync";
import { isQuiet } from "../game/quiet";
import { areaGate, localArea, readSelfArea, resetLocalArea, setLocalArea, subscribeLocalArea } from "./villageArea";

afterEach(() => resetLocalArea());

function roomWith(players: Record<string, { area?: unknown }>, sessionId = "me"): PlayersRoom {
  return { sessionId, state: { players: new Map(Object.entries(players)) } } as unknown as PlayersRoom;
}

describe("villageArea — which area the local player is in", () => {
  it("starts in the village, and not quiet", () => {
    expect(localArea()).toBe("village");
    expect(isQuiet()).toBe(false);
  });

  it("follows the player through the door, notifying once per change", () => {
    const seen: string[] = [];
    const off = subscribeLocalArea(() => seen.push(localArea()));
    setLocalArea("hall");
    setLocalArea("hall"); // no change, no notice
    setLocalArea("village");
    off();
    setLocalArea("hall");
    expect(seen).toEqual(["hall", "village"]);
  });

  it("the hall is quiet (jump and emoji off), the village is not; a reset leaves it off", () => {
    setLocalArea("hall");
    expect(isQuiet()).toBe(true);
    setLocalArea("village");
    expect(isQuiet()).toBe(false);
    setLocalArea("hall");
    resetLocalArea();
    expect(localArea()).toBe("village");
    expect(isQuiet()).toBe(false);
  });

  it("readSelfArea reads our own player's synced area (a reconnect into the hall starts in the hall)", () => {
    expect(readSelfArea(roomWith({ me: { area: "hall" } }))).toBe("hall");
    expect(readSelfArea(roomWith({ me: { area: "village" } }))).toBe("village");
  });

  it("readSelfArea falls back to the village: no room, our player not synced yet, an unknown value", () => {
    expect(readSelfArea(null)).toBe("village");
    expect(readSelfArea(roomWith({ other: { area: "hall" } }))).toBe("village");
    expect(readSelfArea(roomWith({ me: { area: "garden" } }))).toBe("village");
    expect(readSelfArea(roomWith({ me: {} }))).toBe("village");
  });

  it("the gate hands the sync this store", () => {
    expect(areaGate.local()).toBe("village");
    let notified = 0;
    const off = areaGate.subscribe(() => notified++);
    areaGate.setLocal("hall");
    expect(localArea()).toBe("hall");
    expect(areaGate.local()).toBe("hall");
    expect(notified).toBe(1);
    off();
  });
});
