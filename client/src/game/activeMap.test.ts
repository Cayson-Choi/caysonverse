import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_GEOMETRY, SEATS } from "@caysonverse/shared/worldMap";
import { HUB_GEOMETRY_GATED, HUB_GEOMETRY_OPEN, hubGeometry, hubZoneLabel } from "@caysonverse/shared/school/hubMap";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import {
  LEGACY_ACTIVE_MAP,
  activeMapVersion,
  activeSeats,
  getActiveMap,
  hubActiveMap,
  setActiveMap,
  villageActiveMap,
  type ActiveMap,
} from "./activeMap";
import { CAMERA_BOXES, cameraBoxes } from "./cameraCollision";
import { zoneLabelAt } from "./hud";

afterEach(() => setActiveMap(LEGACY_ACTIVE_MAP));

describe("activeMap (Task 15 — the map seam)", () => {
  it("starts on the legacy world: its geometry and its room names", () => {
    expect(getActiveMap()).toBe(LEGACY_ACTIVE_MAP);
    expect(LEGACY_ACTIVE_MAP.geometry).toBe(LEGACY_GEOMETRY);
    expect(LEGACY_ACTIVE_MAP.zoneLabel(15, 0)).toBe(zoneLabelAt(15, 0));
    expect(LEGACY_ACTIVE_MAP.zoneLabel(15, 0)).toBe("강의실");
  });

  it("setActiveMap bumps the version only for a new map", () => {
    const v0 = activeMapVersion();
    setActiveMap(LEGACY_ACTIVE_MAP); // already current
    expect(activeMapVersion()).toBe(v0);

    const hub: ActiveMap = { geometry: hubGeometry(false), zoneLabel: hubZoneLabel };
    setActiveMap(hub);
    expect(activeMapVersion()).toBe(v0 + 1);
    expect(getActiveMap()).toBe(hub);
    setActiveMap(hub); // the same object again: ignored
    expect(activeMapVersion()).toBe(v0 + 1);

    // An equal-looking but different object IS a new map (identity, not deep equality).
    setActiveMap({ geometry: hubGeometry(false), zoneLabel: hubZoneLabel });
    expect(activeMapVersion()).toBe(v0 + 2);
    setActiveMap(LEGACY_ACTIVE_MAP);
    expect(activeMapVersion()).toBe(v0 + 3);
  });

  it("hubActiveMap hands out one prebuilt map per gate state (a re-render never bumps the version)", () => {
    expect(hubActiveMap(false)).toBe(hubActiveMap(false));
    expect(hubActiveMap(true)).toBe(hubActiveMap(true));
    expect(hubActiveMap(false).geometry).toBe(HUB_GEOMETRY_GATED);
    expect(hubActiveMap(true).geometry).toBe(HUB_GEOMETRY_OPEN);
    expect(hubActiveMap(true).zoneLabel(0, 0)).toBe("중앙 홀");
    expect(hubActiveMap(true).zoneLabel(30, 0)).toBe("동쪽 복도");
  });

  it("only the legacy world offers seats and AI 조교 (ruling E6)", () => {
    expect(LEGACY_ACTIVE_MAP.seatsAndNpcs).toBe(true);
    expect(hubActiveMap(false).seatsAndNpcs).toBeFalsy();
    expect(hubActiveMap(true).seatsAndNpcs).toBeFalsy();
  });

  it("each map names its seats: the world's chairs, the village's benches in both areas (one list), none in the hub", () => {
    expect(LEGACY_ACTIVE_MAP.seats).toBe(SEATS);
    expect(villageActiveMap("village").seats).toBe(VILLAGE_SEATS);
    expect(villageActiveMap("hall").seats).toBe(VILLAGE_SEATS);
    expect(villageActiveMap("village").seatsAndNpcs).toBeFalsy(); // benches, but no 조교 and no world chairs
    expect(hubActiveMap(false).seats).toBeUndefined();
    expect(activeSeats()).toBe(SEATS);
    setActiveMap(villageActiveMap("hall"));
    expect(activeSeats()).toBe(VILLAGE_SEATS);
    setActiveMap(hubActiveMap(true));
    expect(activeSeats()).toEqual([]);
  });

  it("cameraBoxes() follows the active map", () => {
    expect(cameraBoxes()).toBe(CAMERA_BOXES);
    setActiveMap(hubActiveMap(false));
    expect(cameraBoxes()).toBe(HUB_GEOMETRY_GATED.cameraBoxes);
    setActiveMap(hubActiveMap(true));
    expect(cameraBoxes()).toBe(HUB_GEOMETRY_OPEN.cameraBoxes);
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
