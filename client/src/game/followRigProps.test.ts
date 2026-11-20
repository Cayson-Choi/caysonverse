import { VILLAGE_WALL_PLAN, VILLAGE_WALL_SOLIDS } from "@caysonverse/shared/village/parkWall";
import { lotGeometryColliders } from "@caysonverse/shared/village/villageLots";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { cameraWallBoxes } from "@caysonverse/shared/village/fallsWalk";
import { HEAD_HEIGHT } from "./constants";
import { VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";
import { armBoxes, cameraBoxes, isPropCameraBox } from "./cameraCollision";
import { createFollowRig, createFollowSpot, stepFollowRig } from "./followRig";
import type { Orbit } from "./types";

/**
 * Owner 2026-11-16: "카메라 거리가 자동으로 조정되고 이렇게 하지 마 … 건물이나 벽에서는 바뀌도록 하자". The third-person arm is the
 * distance the player set; only a building or a wall between the head and the camera shortens it. Props never do.
 */
const DT = 1 / 60;
const DESKTOP = 1280 / 800;

function arm(orbit: Orbit, x: number, z: number, frames = 30): number {
  const rig = createFollowRig(orbit);
  const out = createFollowSpot();
  for (let i = 0; i < frames; i++) stepFollowRig(rig, orbit, x, z, DESKTOP, DT, true, out);
  return Math.hypot(out.x - x, out.y - HEAD_HEIGHT, out.z - z);
}

describe("the follow camera's arm: the player's distance, shortened only by buildings and walls (owner 2026-11-16)", () => {
  beforeEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));
  afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

  it("the shelter's roof and light box and the lamps are props: not in the arm's boxes; the café kiosk is a building", () => {
    const all = cameraBoxes();
    const props = all.filter(isPropCameraBox);
    // shelter roof, shelter light box, the lake's six lamps (the bus's two mirrors only while it is in the map)
    expect(props.length).toBeGreaterThanOrEqual(8);
    expect(armBoxes().some((b) => b.minX === 46.8 && b.maxX === 51.1 && b.minZ === -5.85 && b.maxZ === -1.85)).toBe(true); // col__kiosk
    expect(armBoxes().length).toBe(all.length - props.length);
    // every house and the café stay walls, and so does the waterfall cliff's camera wall (terrain, B1 W5)
    const cliff = cameraWallBoxes(VILLAGE_LAYOUT);
    expect(cliff.length).toBeGreaterThan(0);
    for (const w of cliff) expect(armBoxes()).toContainEqual(w);
    // (lots v2, L5v2: the lot buildings' tall bodies are buildings too)
    const lotTall = lotGeometryColliders().cameraBoxes.filter((b) => (b.height ?? 0) >= 12 && b.minY === undefined).length;
    // (케이슨랜드's castle wall, parkWall.ts: its towers are buildings for the arm too)
    const wallTall = VILLAGE_WALL_SOLIDS.cameraBoxes.filter((b) => (b.height ?? 0) >= 12).length;
    expect(wallTall).toBe(VILLAGE_WALL_PLAN.towers.length);
    expect(armBoxes().filter((b) => (b.height ?? 0) >= 12).length).toBe(11 + cliff.length + lotTall + wallTall);
  });

  it("the café kiosk is a small building: a camera that would end up inside it is held in front of it (coordinator 2026-11-16)", () => {
    const orbit: Orbit = { yaw: Math.PI / 2, pitch: 0.2, distance: 6 }; // the camera east of the head, into the kiosk (x 46.8..51.1)
    expect(arm(orbit, 45.3, -3.85)).toBeLessThan(1.6);
    const away: Orbit = { yaw: -Math.PI / 2, pitch: 0.2, distance: 6 };
    expect(arm(away, 45.3, -3.85)).toBeCloseTo(6, 4);
  });

  it("under the bus shelter's roof a camera looking down from above keeps the whole zoom", () => {
    const c = VILLAGE_LAYOUT.busStop.shelter.centre;
    const orbit: Orbit = { yaw: 0, pitch: 0.9, distance: 6 };
    expect(arm(orbit, c.x, c.z)).toBeCloseTo(6, 4);
  });

  it("a house's wall behind the player still shortens it, and it grows back once the way is clear", () => {
    const orbit: Orbit = { yaw: -Math.PI / 2, pitch: 0.2, distance: 6 }; // camera west of the head, into house_5 (x -52.6..-43.65)
    expect(arm(orbit, -41.65, -8)).toBeLessThan(2.5);
    const away: Orbit = { yaw: Math.PI / 2, pitch: 0.2, distance: 6 };
    expect(arm(away, -41.65, -8)).toBeCloseTo(6, 4);
  });
});
