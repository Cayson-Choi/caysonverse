import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { HEAD_HEIGHT } from "./constants";
import { CAMERA_LOOK_LIFT } from "./cameraControls";
import { HALL_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";
import { HALL_CAMERA_LIMIT } from "./indoorCamera";
import { createFollowRig, createFollowSpot, stepFollowRig, type FollowSpot } from "./followRig";
import { SHOULDER, centerWeight, createShoulderPose, shoulderPose, shoulderTarget } from "./cameraShoulder";
import { resetViewMode } from "./viewState";

const DT = 1 / 60;
const DESKTOP = 1280 / 800;
const PHONE = 375 / 812;

/** The reviewer's spots (round 6): back to a wall, facing the room. yaw: the orbit's (the camera sits at +sin, +cos). */
const WALL_SPOTS = [
  { name: "letter table, west, facing east", x: 293.62, z: -0.97, yaw: -Math.PI / 2 },
  { name: "E bank, facing west", x: 306.06, z: -0.29, yaw: Math.PI / 2 },
  { name: "E bank north, facing west", x: 306.37, z: -3.17, yaw: Math.PI / 2 },
  { name: "the niche, facing south", x: 300.22, z: -4.34, yaw: Math.PI },
  { name: "A bank, facing south", x: 295.82, z: -4.52, yaw: Math.PI },
  { name: "B bank, facing south", x: 302.56, z: -4.27, yaw: Math.PI },
];

function settle(x: number, z: number, yaw: number, aspect: number, pitch = 0.35, distance = 6, seconds = 2): FollowSpot {
  const orbit = Object.freeze({ yaw, pitch, distance });
  const rig = createFollowRig(orbit);
  const spot = createFollowSpot();
  for (let i = 0; i < seconds / DT; i++) stepFollowRig(rig, orbit, x, z, aspect, DT, true, spot);
  return spot;
}

/** The view's tilt below the horizon (deg). */
function lookDown(spot: FollowSpot, x: number, z: number): number {
  const tx = x + spot.lookX - spot.x;
  const ty = HEAD_HEIGHT + CAMERA_LOOK_LIFT + spot.lookLift - spot.y;
  const tz = z + spot.lookZ - spot.z;
  return (Math.atan2(-ty, Math.hypot(tx, tz)) * 180) / Math.PI;
}

beforeEach(() => {
  resetViewMode();
  setActiveMap(HALL_ACTIVE_MAP);
});
afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

describe("over-the-shoulder camera against an indoor wall (round 6 review)", () => {
  it("the blend: off past 2.4 m from the head across the floor, whole at 1.7 m and under, smooth in between", () => {
    expect(shoulderTarget(3.1)).toBe(0); // arrival
    expect(shoulderTarget(3.35 * Math.cos(0.5))).toBe(0); // the least seat framing
    expect(shoulderTarget(SHOULDER.engageBelow)).toBe(0);
    expect(shoulderTarget(SHOULDER.fullBelow)).toBe(1);
    expect(shoulderTarget(1.0)).toBe(1);
    const mid = shoulderTarget((SHOULDER.engageBelow + SHOULDER.fullBelow) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  for (const aspect of [DESKTOP, PHONE]) {
    for (const s of WALL_SPOTS) {
      it(`${s.name} (${aspect > 1 ? "PC" : "phone"}): the camera is right behind the head on the view axis, a little over it, looking level`, () => {
        for (const pitch of [0.2, 0.35, 0.7]) {
          const spot = settle(s.x, s.z, s.yaw, aspect, pitch);
          const side = (spot.x - s.x) * Math.cos(s.yaw) - (spot.z - s.z) * Math.sin(s.yaw);
          expect(Math.abs(side), `pitch ${pitch} lateral`).toBeLessThan(0.05);
          expect(spot.y).toBeLessThanOrEqual(HALL_CAMERA_LIMIT.maxY + 1e-9);
          expect(spot.y, `pitch ${pitch} over the head`).toBeGreaterThan(HEAD_HEIGHT);
          const down = lookDown(spot, s.x, s.z);
          expect(down, `pitch ${pitch} look down`).toBeGreaterThan(-1);
          expect(down, `pitch ${pitch} look down`).toBeLessThan(18);
        }
      });
    }
  }

  it("arrival and the open hall: no shoulder view, the chosen spot and look are exact", () => {
    const { spawn } = VILLAGE_LAYOUT.memorial.interior;
    const spot = settle(spawn.x, spawn.z, 0, DESKTOP);
    expect(spot.lookX).toBe(0);
    expect(spot.lookZ).toBe(0);
    const open = settle(300, 0.5, Math.PI, DESKTOP, 0.35, 4);
    expect(open.lookX).toBe(0);
    expect(open.lookZ).toBe(0);
  });

  it("walking away from the wall: the shoulder view eases out and the camera is exactly back where the player put it", () => {
    const orbit = Object.freeze({ yaw: Math.PI / 2, pitch: 0.35, distance: 4 });
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    for (let i = 0; i < 90; i++) stepFollowRig(rig, orbit, 306.06, -0.29, DESKTOP, DT, true, spot);
    expect(rig.shoulder).toBeGreaterThan(0.99);
    let prev = { x: spot.x, y: spot.y, z: spot.z };
    let maxJump = 0;
    for (let i = 0; i < 240; i++) {
      const x = Math.max(300.5, 306.06 - i * 0.03); // 1.8 m/s west
      stepFollowRig(rig, orbit, x, -0.29, DESKTOP, DT, true, spot);
      maxJump = Math.max(maxJump, Math.hypot(spot.x - prev.x, spot.y - prev.y, spot.z - prev.z));
      prev = { x: spot.x, y: spot.y, z: spot.z };
    }
    expect(rig.shoulder).toBe(0);
    expect(spot.lookX).toBe(0);
    expect(spot.x).toBeCloseTo(300.5 + 4 * Math.cos(0.35), 6);
    expect(spot.y).toBeCloseTo(HEAD_HEIGHT + 4 * Math.sin(0.35), 6);
    // no pop: never more than 0.25 m in one frame while easing out (walking adds 0.03 m a frame)
    expect(maxJump).toBeLessThan(0.25);
  });
});

describe("centred view (owner 2026-11-19, every interior)", () => {
  it("the side view never triggers: the centred weight is 1 whatever the wall's distance", () => {
    for (const arm of [0, 0.3, 0.7, 1, 1.5, 2.2, 3]) expect(centerWeight(arm), `arm ${arm}`).toBe(1);
  });

  it.each([
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ])("%s: a wall 0.7 / 1.9 m behind puts the camera on the view axis, the look straight ahead and level", (_n, aspect) => {
    const yaw = Math.PI; // the camera behind a body facing +z
    for (const arm of [0.7, 1.9]) {
      const out = shoulderPose(10, 10, yaw, 10 + Math.sin(yaw) * arm, 10 + Math.cos(yaw) * arm, aspect, 0, [], 0.3, createShoulderPose());
      expect(Math.abs(out.x - 10), `arm ${arm}`).toBeLessThan(1e-6);
      expect(out.z).toBeCloseTo(10 - arm, 6);
      expect(out.y).toBeGreaterThan(HEAD_HEIGHT + 0.5);
      expect(Math.abs(out.lookX)).toBeLessThan(1e-6);
      expect(out.lookZ).toBeGreaterThan(1);
      expect(out.center).toBe(1);
    }
  });
});
