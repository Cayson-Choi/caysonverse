import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import {
  VILLAGE_ACTIVE_MAP,
  activeMapVersion,
  activeSeats,
  getActiveMap,
  setActiveMap,
  villageActiveMap,
  type ActiveMap,
} from "./activeMap";
import { cameraBoxes } from "./cameraCollision";

afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

describe("activeMap (the map seam)", () => {
  it("starts on the open village: its geometry and its name", () => {
    expect(getActiveMap()).toBe(VILLAGE_ACTIVE_MAP);
    expect(VILLAGE_ACTIVE_MAP.geometry).toBe(villageGeometry);
    expect(VILLAGE_ACTIVE_MAP.zoneLabel(0, 0)).toBe("케이슨 마을");
  });

  it("setActiveMap bumps the version only for a new map", () => {
    const v0 = activeMapVersion();
    setActiveMap(VILLAGE_ACTIVE_MAP); // already current
    expect(activeMapVersion()).toBe(v0);

    const other: ActiveMap = { geometry: villageGeometry, zoneLabel: () => "다른 곳" };
    setActiveMap(other);
    expect(activeMapVersion()).toBe(v0 + 1);
    expect(getActiveMap()).toBe(other);
    setActiveMap(other); // the same object again: ignored
    expect(activeMapVersion()).toBe(v0 + 1);

    // An equal-looking but different object IS a new map (identity, not deep equality).
    setActiveMap({ geometry: villageGeometry, zoneLabel: () => "다른 곳" });
    expect(activeMapVersion()).toBe(v0 + 2);
    setActiveMap(VILLAGE_ACTIVE_MAP);
    expect(activeMapVersion()).toBe(v0 + 3);
  });

  it("each map names its seats: the village's benches, one list for both areas", () => {
    expect(VILLAGE_ACTIVE_MAP.seats).toBe(VILLAGE_SEATS);
    expect(villageActiveMap("village").seats).toBe(VILLAGE_SEATS);
    expect(villageActiveMap("hall").seats).toBe(VILLAGE_SEATS);
    expect(activeSeats()).toBe(VILLAGE_SEATS);
    setActiveMap(villageActiveMap("hall"));
    expect(activeSeats()).toBe(VILLAGE_SEATS);
    setActiveMap({ geometry: villageGeometry, zoneLabel: () => "" }); // a map without seats: nowhere to sit
    expect(activeSeats()).toEqual([]);
  });

  it("cameraBoxes() follows the active map", () => {
    expect(cameraBoxes()).toBe(villageGeometry.cameraBoxes);
    const other: ActiveMap = { geometry: { ...villageGeometry, cameraBoxes: [] }, zoneLabel: () => "" };
    setActiveMap(other);
    expect(cameraBoxes()).toBe(other.geometry.cameraBoxes);
  });
});

describe("the map's bounds are read through activeMap.ts only (케이슨 마을 Task 4 fix)", () => {
  it("no scene or frame code outside activeMap.ts reads geometry.bounds: the village's geometry spans BOTH areas", () => {
    // The village is one geometry reaching from the village to the hall 300 m away, so a clamp to `geometry.bounds`
    // lets the body walk anywhere in between; `activeBounds()` / `mapBounds(map)` give the area the player is in.
    const dirs = [new URL("./", import.meta.url), new URL("../village/", import.meta.url)];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const name of readdirSync(dir)) {
        if (!/\.tsx?$/.test(name) || /\.test\./.test(name) || name === "activeMap.ts") continue;
        if (/geometry\.bounds\b/.test(readFileSync(new URL(name, dir), "utf8"))) offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard does catch the old read", () => {
    expect(/geometry\.bounds\b/.test("const bounds = getActiveMap().geometry.bounds;")).toBe(true);
  });
});
