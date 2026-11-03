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
  hubActiveMap,
  mapBounds,
  setActiveMap,
  villageActiveMap,
} from "../game/activeMap";
import { getClickTarget, resetClickMove, setClickTarget } from "../game/clickMove";
import { LIGHTING } from "../game/sceneLighting";

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
  it("is an afternoon preset with a 60 to 220 m fog", () => {
    const v = LIGHTING.village;
    expect(v.fog).toEqual([60, 220]);
    expect(v.sky).toMatch(/^#[0-9a-f]{6}$/i);
    expect(v.key.position[1]).toBeGreaterThan(0);
    // A sun that is up but not overhead: the shadows are long but never lie flat.
    const [x, y, z] = v.key.position;
    const elevation = Math.atan2(y, Math.hypot(x, z));
    expect(elevation).toBeGreaterThan((25 * Math.PI) / 180);
    expect(elevation).toBeLessThan((65 * Math.PI) / 180);
  });
});
