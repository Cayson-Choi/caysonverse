import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_GEOMETRY } from "@caysonverse/shared/worldMap";
import { HUB_GEOMETRY_GATED, HUB_GEOMETRY_OPEN, hubGeometry, hubZoneLabel } from "@caysonverse/shared/school/hubMap";
import {
  LEGACY_ACTIVE_MAP,
  activeMapVersion,
  getActiveMap,
  hubActiveMap,
  setActiveMap,
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

  it("cameraBoxes() follows the active map", () => {
    expect(cameraBoxes()).toBe(CAMERA_BOXES);
    setActiveMap(hubActiveMap(false));
    expect(cameraBoxes()).toBe(HUB_GEOMETRY_GATED.cameraBoxes);
    setActiveMap(hubActiveMap(true));
    expect(cameraBoxes()).toBe(HUB_GEOMETRY_OPEN.cameraBoxes);
  });
});
