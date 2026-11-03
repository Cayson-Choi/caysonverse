import { afterEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import {
  HALL_ACTIVE_MAP,
  LEGACY_ACTIVE_MAP,
  VILLAGE_ACTIVE_MAP,
  activeBounds,
  activeMapVersion,
  getActiveMap,
  hubActiveMap,
  mapBounds,
  setActiveMap,
  villageActiveMap,
} from "../game/activeMap";
import { getClickTarget, resetClickMove, setClickTarget } from "../game/clickMove";
import { LIGHTING } from "../game/sceneLighting";
import { VILLAGE_CAMERA_PLANES } from "./villageModelPrep";

afterEach(() => {
  setActiveMap(LEGACY_ACTIVE_MAP);
  resetClickMove();
});

describe("the village's two maps (one geometry, the bounds of the area the player is in)", () => {
  it("the geometry spans both areas, but each map's bounds are its own area's", () => {
    // One collision truth for the server and the client...
    expect(VILLAGE_ACTIVE_MAP.geometry).toBe(villageGeometry);
    expect(HALL_ACTIVE_MAP.geometry).toBe(villageGeometry);
    // ...whose bounds reach from the village to the hall (x -95..310) — the wrong rectangle for any frame.
    expect(villageGeometry.bounds.minX).toBeLessThan(-90);
    expect(villageGeometry.bounds.maxX).toBeGreaterThan(300);
    expect(mapBounds(VILLAGE_ACTIVE_MAP)).toEqual(VILLAGE_LAYOUT.areas.village);
    expect(mapBounds(HALL_ACTIVE_MAP)).toEqual(VILLAGE_LAYOUT.areas.hall);
    expect(mapBounds(VILLAGE_ACTIVE_MAP).maxX).toBe(95);
    expect(mapBounds(HALL_ACTIVE_MAP).minX).toBeGreaterThan(290);
  });

  it("maps without their own bounds (the legacy world, the hub) read the geometry's, as before", () => {
    expect(mapBounds(LEGACY_ACTIVE_MAP)).toBe(LEGACY_ACTIVE_MAP.geometry.bounds);
    expect(mapBounds(hubActiveMap(false))).toBe(hubActiveMap(false).geometry.bounds);
    expect(mapBounds(hubActiveMap(true))).toBe(hubActiveMap(true).geometry.bounds);
  });

  it("villageActiveMap hands out one prebuilt map per area, so a re-render is never a switch", () => {
    expect(villageActiveMap("village")).toBe(VILLAGE_ACTIVE_MAP);
    expect(villageActiveMap("hall")).toBe(HALL_ACTIVE_MAP);
    expect(villageActiveMap("hall")).toBe(villageActiveMap("hall"));
  });

  it("activeBounds follows the active map when the area flips (the sun, the overview and the click-move read it)", () => {
    setActiveMap(VILLAGE_ACTIVE_MAP);
    expect(activeBounds()).toEqual(VILLAGE_LAYOUT.areas.village);
    const v = activeMapVersion();
    setActiveMap(villageActiveMap("hall")); // the door
    expect(activeMapVersion()).toBe(v + 1);
    expect(activeBounds()).toEqual(VILLAGE_LAYOUT.areas.hall);
    setActiveMap(villageActiveMap("village")); // and back
    expect(activeBounds()).toEqual(VILLAGE_LAYOUT.areas.village);
  });

  it("the HUD names the area: 케이슨 마을 outside, 추모관 inside", () => {
    expect(VILLAGE_ACTIVE_MAP.zoneLabel(0, 0)).toBe("케이슨 마을");
    expect(HALL_ACTIVE_MAP.zoneLabel(300, 0)).toBe("추모관");
  });

  it("a click far outside clamps to the area the player is in, not to the spanning rectangle", () => {
    setActiveMap(VILLAGE_ACTIVE_MAP);
    setClickTarget(5000, 5000);
    const v = VILLAGE_LAYOUT.areas.village;
    expect(getClickTarget()).toEqual({ x: v.maxX - PLAYER_RADIUS, z: v.maxZ - PLAYER_RADIUS });

    setActiveMap(HALL_ACTIVE_MAP);
    setClickTarget(5000, 5000);
    const hall = VILLAGE_LAYOUT.areas.hall;
    expect(getClickTarget()).toEqual({ x: hall.maxX - PLAYER_RADIUS, z: hall.maxZ - PLAYER_RADIUS });
    setClickTarget(-5000, -5000);
    expect(getClickTarget()).toEqual({ x: hall.minX + PLAYER_RADIUS, z: hall.minZ + PLAYER_RADIUS });
  });
});

describe("the village's lighting (data, so the clock can drive it later)", () => {
  it("is an afternoon preset whose light fog fits the model: barely any inside the village, none past the far plane", () => {
    const v = LIGHTING.village;
    expect(v.fog).toEqual([120, 900]);
    // The farthest corner of the walk bounds seen from the opposite one is ~270 m: the village's own ground fades
    // only a little, so it meets the fog-free backdrop (haze baked in) without a seam.
    expect(v.fog[0]).toBeGreaterThan(Math.hypot(95, 95) - 20);
    expect(v.fog[1]).toBeLessThan(VILLAGE_CAMERA_PLANES.far);
    expect(v.sky).toMatch(/^#[0-9a-f]{6}$/i);
    expect(v.key.position[1]).toBeGreaterThan(0);
    // A sun that is up but not overhead: the shadows are long but never lie flat.
    const [x, y, z] = v.key.position;
    const elevation = Math.atan2(y, Math.hypot(x, z));
    expect(elevation).toBeGreaterThan((25 * Math.PI) / 180);
    expect(elevation).toBeLessThan((65 * Math.PI) / 180);
    // From the baked sun's side (Task 6: azimuth 70° clockwise from north), so the live shadows of the players fall
    // the same way as the baked ones.
    const azimuth = (Math.atan2(x, -z) * 180) / Math.PI;
    expect(azimuth).toBeCloseTo(70, 0);
    // Its own tone curve and exposure (the unlit, light-mapped model under the curve; the brightness gate, Task 7).
    expect(v.toneCurve).toBe("neutral");
    expect(v.exposure).toBeGreaterThan(1);
    expect(v.exposure).toBeLessThan(2);
  });
});

describe("the camera limit of each map (케이슨 마을 Task 5: a building's camera stays under its ceiling)", () => {
  it("inside the memorial hall: 3.1 m high, 3.6 m away, no overview — under its 3.4 m ceiling", () => {
    expect({ ...HALL_ACTIVE_MAP.cameraLimit }).toEqual({ maxY: 3.1, maxDistance: 3.6, overview: false });
    expect(HALL_ACTIVE_MAP.cameraLimit!.maxY).toBeLessThan(VILLAGE_LAYOUT.memorial.interior.ceilingHeight);
  });

  it("the open village, the legacy world and the hub have no limit (their camera is as before)", () => {
    expect(VILLAGE_ACTIVE_MAP.cameraLimit).toBeUndefined();
    expect(LEGACY_ACTIVE_MAP.cameraLimit).toBeUndefined();
    expect(hubActiveMap(false).cameraLimit).toBeUndefined();
    expect(hubActiveMap(true).cameraLimit).toBeUndefined();
  });

  it("the limit follows the area through the door", () => {
    setActiveMap(villageActiveMap("hall"));
    expect(getActiveMap().cameraLimit).toBe(HALL_ACTIVE_MAP.cameraLimit);
    setActiveMap(villageActiveMap("village"));
    expect(getActiveMap().cameraLimit).toBeUndefined();
  });
});
