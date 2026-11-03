import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PlayersRoom } from "../game/remoteSync";
import { isQuiet } from "../game/quiet";
import {
  areaGate,
  localArea,
  readSelfArea,
  releaseLocalArea,
  resetLocalArea,
  seedLocalArea,
  setLocalArea,
  subscribeLocalArea,
} from "./villageArea";

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

describe("villageArea — a scene seeds the area and releases only what it seeded (reconnect across areas)", () => {
  it("seeds the area (quiet in the hall) and releases back to the village on unmount", () => {
    const token = seedLocalArea("hall");
    expect(localArea()).toBe("hall");
    expect(isQuiet()).toBe(true);
    releaseLocalArea(token);
    expect(localArea()).toBe("village");
    expect(isQuiet()).toBe(false);
  });

  it("a newer scene's seed survives the older scene's unmount: no village blip inside the hall", () => {
    const seen: string[] = [];
    const first = seedLocalArea("hall"); // the scene before the reconnect
    const off = subscribeLocalArea(() => seen.push(localArea()));
    const second = seedLocalArea("hall"); // the remounted scene seeds (the same area: no notice)...
    releaseLocalArea(first); // ...then the old one unmounts
    expect(localArea()).toBe("hall");
    expect(isQuiet()).toBe(true);
    expect(seen).toEqual([]); // nothing ever flipped to the village and back
    releaseLocalArea(second); // the live scene going away does reset
    expect(localArea()).toBe("village");
    expect(seen).toEqual(["village"]);
    off();
  });

  it("the old scene unmounting FIRST (a layout-effect cleanup before the new seed) works too, and a stale token is ignored", () => {
    const first = seedLocalArea("hall");
    releaseLocalArea(first);
    expect(localArea()).toBe("village");
    const second = seedLocalArea("hall");
    expect(localArea()).toBe("hall");
    releaseLocalArea(first); // a double cleanup: ignored
    expect(localArea()).toBe("hall");
    releaseLocalArea(second);
    expect(localArea()).toBe("village");
  });

  it("the scene publishes the area from a layout effect with a token, never by writing the store while it renders", () => {
    const src = readFileSync(new URL("./VillageScene.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/\bsetLocalArea\(/);
    expect(src).not.toMatch(/\bresetLocalArea\(/);
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?seedLocalArea\([\s\S]*?releaseLocalArea\(/);
  });
});
