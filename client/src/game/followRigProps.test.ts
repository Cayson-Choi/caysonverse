import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
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

  it("the café kiosk, the shelter's roof and light box and the lamps are props: not in the arm's boxes", () => {
    const all = cameraBoxes();
    const props = all.filter(isPropCameraBox);
    // kiosk, shelter roof, shelter light box, the lake's six lamps (the bus's two mirrors only while it is in the map)
    expect(props.length).toBeGreaterThanOrEqual(9);
    expect(armBoxes().length).toBe(all.length - props.length);
    // every house and the café stay walls
    expect(armBoxes().filter((b) => (b.height ?? 0) >= 12).length).toBe(11);
  });

  it("next to the kiosk, the camera behind it keeps the whole zoom", () => {
    const orbit: Orbit = { yaw: Math.PI / 2, pitch: 0.2, distance: 6 }; // the camera east of the head, through the kiosk (x 46.8..51.1)
    expect(arm(orbit, 45.3, -3.85)).toBeCloseTo(6, 4);
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
