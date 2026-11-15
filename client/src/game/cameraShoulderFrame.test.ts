/**
 * Round 7 review: with the back to a wall the over-the-shoulder view must show the room AND the player's own avatar,
 * recognisably — the head and shoulders whole on screen (a phone portrait: the upper body), not a see-through dome at the
 * bottom. The avatar's head-and-shoulders box is projected through the real camera (fov, aspect) at the reviewer's seven spots.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { HEAD_HEIGHT } from "./constants";
import { CAMERA_LOOK_LIFT } from "./cameraControls";
import { HALL_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";
import { HALL_CAMERA_LIMIT } from "./indoorCamera";
import { createFollowRig, createFollowSpot, stepFollowRig, type FollowSpot } from "./followRig";
import { BASE_FOV } from "./cameraShoulder";
import { resetViewMode } from "./viewState";

const DT = 1 / 60;
const DESKTOP = 1280 / 800;
const WIDE = 1920 / 1080;
const PHONE = 375 / 812;

/** The seven spots of the round 6/7 probes (back to a bank, a wall or the niche, facing the room). */
export const WALL_SPOTS7 = [
  { name: "letter table west", x: 293.3, z: -1.0, yaw: -Math.PI / 2 },
  { name: "E bank", x: 306.4, z: -0.3, yaw: Math.PI / 2 },
  { name: "E bank north", x: 306.4, z: -3.5, yaw: Math.PI / 2 },
  { name: "the niche", x: 299.9, z: -4.4, yaw: Math.PI },
  { name: "A bank", x: 295.5, z: -4.6, yaw: Math.PI },
  { name: "B bank", x: 302.6, z: -4.6, yaw: Math.PI },
  { name: "letter table north", x: 294.4, z: -4.6, yaw: Math.PI },
];

/** The chibi's head and shoulders (m, round the body): measured in game (Box3 of the avatar: 0.62 m wide, head top 1.86 m). */
const HS = { half: 0.33, bottom: 1.0, top: 1.9 };

function settle(x: number, z: number, yaw: number, aspect: number, pitch = 0.35, distance = 6): FollowSpot {
  const orbit = Object.freeze({ yaw, pitch, distance });
  const rig = createFollowRig(orbit);
  const spot = createFollowSpot();
  for (let i = 0; i < 2 / DT; i++) stepFollowRig(rig, orbit, x, z, aspect, DT, true, spot);
  return spot;
}

function cameraFor(spot: FollowSpot, x: number, z: number, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(BASE_FOV + spot.fovAdd, aspect, 0.1, 100);
  cam.position.set(spot.x, spot.y, spot.z);
  cam.lookAt(x + spot.lookX, HEAD_HEIGHT + CAMERA_LOOK_LIFT + spot.lookLift, z + spot.lookZ);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Screen box (NDC) of the head-and-shoulders box, and how much of the screen it covers. */
export function headShoulderOnScreen(spot: FollowSpot, x: number, z: number, aspect: number) {
  const cam = cameraFor(spot, x, z, aspect);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let behind = false;
  const p = new Vector3();
  for (const dx of [-HS.half, HS.half])
    for (const dz of [-HS.half, HS.half])
      for (const y of [HS.bottom, HS.top]) {
        p.set(x + dx, y, z + dz);
        const local = p.clone().applyMatrix4(cam.matrixWorldInverse);
        if (local.z > -0.05) behind = true;
        p.project(cam);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
  const area = ((Math.min(1, maxX) - Math.max(-1, minX)) * (Math.min(1, maxY) - Math.max(-1, minY))) / 4;
  // the look's tilt below the horizon (deg)
  const dir = new Vector3();
  cam.getWorldDirection(dir);
  const down = (Math.asin(-dir.y) * 180) / Math.PI;
  return { minX, maxX, minY, maxY, behind, area, down };
}

beforeEach(() => {
  resetViewMode();
  setActiveMap(HALL_ACTIVE_MAP);
});
afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

describe("over-the-shoulder view shows the own avatar whole (round 7 review)", () => {
  for (const [label, aspect] of [
    ["PC", DESKTOP],
    ["PC wide", WIDE],
    ["phone", PHONE],
  ] as const) {
    for (const s of WALL_SPOTS7) {
      it(`${s.name} (${label}): head and shoulders whole on screen, the room above them, a near-level look`, () => {
        // the orbit is seldom square to the wall (a player turns by hand): ±0.12 rad either way too
        for (const [pitch, dyaw] of [
          [0.2, 0],
          [0.35, 0],
          [0.7, 0],
          [0.35, 0.12],
          [0.35, -0.12],
        ] as const) {
          const spot = settle(s.x, s.z, s.yaw + dyaw, aspect, pitch);
          // the shoulder view is on (it looks ahead past the body, not at the head)
          expect(Math.hypot(spot.lookX, spot.lookZ), `pitch ${pitch}: in the shoulder view`).toBeGreaterThan(1);
          expect(spot.y).toBeLessThanOrEqual(HALL_CAMERA_LIMIT.maxY + 1e-9);
          const o = headShoulderOnScreen(spot, s.x, s.z, aspect);
          const msg = `pitch ${pitch} yaw ${dyaw} ${JSON.stringify(o)}`;
          expect(o.behind, msg).toBe(false);
          expect(o.minX, msg).toBeGreaterThan(-0.98);
          expect(o.maxX, msg).toBeLessThan(0.98);
          expect(o.minY, msg).toBeGreaterThan(-0.98);
          expect(o.maxY, msg).toBeLessThan(0.98);
          // the room fills most of the view: the head-and-shoulders box takes well under half the screen
          expect(o.area, msg).toBeLessThan(aspect > 1 ? 0.3 : 0.55);
          expect(o.down, msg).toBeGreaterThan(-0.5);
          expect(o.down, msg).toBeLessThan(17);
        }
      });
    }
  }
});
