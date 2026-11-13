import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { CAMERA, HEAD_HEIGHT } from "./constants";
import { CAMERA_LOOK_LIFT, ZOOM_BAND } from "./cameraControls";
import { HALL_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";
import { HALL_CAMERA_LIMIT } from "./indoorCamera";
import { createFollowRig, createFollowSpot, noteAreaLimit, stepFollowRig, type FollowRig, type FollowSpot } from "./followRig";
import { applyZoom, beginSeatCamera, endSeatCamera, resetViewMode, viewState } from "./viewState";
import type { Orbit } from "./types";

const DT = 1 / 60;
const DESKTOP = 1280 / 800;
const EPS_DIGITS = 6;

/** Distance (m) from the head over (x, z) to the camera spot. */
function armLength(spot: FollowSpot, x: number, z: number): number {
  return Math.hypot(spot.x - x, spot.y - HEAD_HEIGHT, spot.z - z);
}

/** The spot the player's orbit asks for, with no wall, ceiling or floor in the way. */
function chosenSpot(orbit: Readonly<Orbit>, x: number, z: number, aspect = DESKTOP): { x: number; y: number; z: number } {
  const d = orbit.distance * (aspect >= 1 ? 1 : Math.min(Math.sqrt(1 / aspect), 1.6));
  return {
    x: x + d * Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    y: HEAD_HEIGHT + d * Math.sin(orbit.pitch),
    z: z + d * Math.cos(orbit.pitch) * Math.cos(orbit.yaw),
  };
}

function expectAtChosenSpot(spot: FollowSpot, orbit: Readonly<Orbit>, x: number, z: number, label = ""): void {
  const want = chosenSpot(orbit, x, z);
  expect(spot.x, `${label} x`).toBeCloseTo(want.x, EPS_DIGITS);
  expect(spot.y, `${label} y`).toBeCloseTo(want.y, EPS_DIGITS);
  expect(spot.z, `${label} z`).toBeCloseTo(want.z, EPS_DIGITS);
  expect(spot.lookLift, `${label} look lift`).toBe(0);
}

/** A walking body: integrates a heading at a speed, like LocalPlayer moves the pose. */
interface Walker {
  x: number;
  z: number;
}

/** Step the rig `seconds` long while the body walks at `speed` m/s along (dx, dz); `each` sees every frame. */
function walk(
  rig: FollowRig,
  orbit: Readonly<Orbit>,
  body: Walker,
  spot: FollowSpot,
  seconds: number,
  speed: number,
  dx: number,
  dz: number,
  each?: (spot: FollowSpot, body: Walker) => void,
): void {
  const n = Math.round(seconds / DT);
  const len = Math.hypot(dx, dz) || 1;
  for (let i = 0; i < n; i++) {
    body.x += (dx / len) * speed * DT;
    body.z += (dz / len) * speed * DT;
    stepFollowRig(rig, orbit, body.x, body.z, DESKTOP, DT, true, spot);
    each?.(spot, body);
  }
}

/** A frozen copy: any write to it throws (ES modules are strict), so a passing test proves nothing wrote the orbit. */
function frozen(o: Orbit): Readonly<Orbit> {
  return Object.freeze({ ...o });
}

beforeEach(() => {
  resetViewMode();
  setActiveMap(VILLAGE_ACTIVE_MAP);
});
afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

describe("follow rig — the zoom set with the wheel holds while the player moves", () => {
  it("walking, running, stopping and turning on the open plaza: the camera stays exactly at the chosen distance and angle", () => {
    const live: Orbit = { yaw: 0, pitch: 0.35, distance: CAMERA.distance };
    const rig = createFollowRig(live);
    const spot = createFollowSpot();
    applyZoom(live, 3.5, ZOOM_BAND); // the wheel: 6 → 9.5 m
    const orbit = frozen(live);
    const body = { x: 0, z: 14 }; // the village spawn
    walk(rig, orbit, body, spot, 2, 0, 0, 1); // the zoom glide lands on the new value
    expect(armLength(spot, body.x, body.z)).toBeCloseTo(9.5, EPS_DIGITS);

    const check = (s: FollowSpot, b: Walker) => {
      expect(armLength(s, b.x, b.z)).toBeCloseTo(9.5, EPS_DIGITS);
      expectAtChosenSpot(s, orbit, b.x, b.z);
    };
    walk(rig, orbit, body, spot, 2, MOVE_SPEED, 0, -1, check); // walk north
    walk(rig, orbit, body, spot, 1, RUN_SPEED, 1, -1, check); // run, turning north-east
    walk(rig, orbit, body, spot, 1, 0, 0, 0, check); // stop: nothing settles, nothing drifts
    walk(rig, orbit, body, spot, 1.5, RUN_SPEED, -1, 0.3, check); // turn back west at a run
    walk(rig, orbit, body, spot, 0.5, MOVE_SPEED, 0, 1, check); // and south toward the camera
    expect(live.distance).toBeCloseTo(9.5, 12); // the zoom value itself is what the wheel set
  });

  it("a teleport (respawn, kick-back, sitting on a seat) re-seats the camera with the body at once, at the same distance", () => {
    const orbit = frozen({ yaw: 0.6, pitch: 0.5, distance: 11 });
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    stepFollowRig(rig, orbit, 0, 14, DESKTOP, DT, true, spot);
    expectAtChosenSpot(spot, orbit, 0, 14, "before");
    stepFollowRig(rig, orbit, -10, 2, DESKTOP, DT, true, spot); // the server put the player somewhere else
    expectAtChosenSpot(spot, orbit, -10, 2, "the very next frame");
  });

  it("sitting down and standing up (the sit flow's camera hooks) change nothing the camera draws", () => {
    const orbit = frozen({ yaw: -0.8, pitch: 0.42, distance: 7.5 });
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    const body = { x: 5, z: 10 };
    walk(rig, orbit, body, spot, 0.5, 0, 0, 0);
    expectAtChosenSpot(spot, orbit, body.x, body.z, "standing");
    beginSeatCamera(orbit as Orbit, 1.2); // a frozen orbit: any write would throw here
    expect(viewState.orbitGoal).toBeNull();
    walk(rig, orbit, body, spot, 2, 0, 0, 0, (s, b) => expectAtChosenSpot(s, orbit, b.x, b.z, "seated"));
    endSeatCamera(orbit as Orbit);
    walk(rig, orbit, body, spot, 2, 4, 1, 0, (s, b) => expectAtChosenSpot(s, orbit, b.x, b.z, "stood up, walking off"));
  });
});

describe("follow rig — doors into and out of a building", () => {
  const HALL = VILLAGE_LAYOUT.memorial.interior;

  it("into the memorial hall and back out: no swing, no tilt reset, no zoom-in; outside the camera is exactly back", () => {
    const orbit = frozen({ yaw: 1.0, pitch: 0.5, distance: 9.5 });
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    const outside = { x: 0, z: -45 }; // the lane south of the memorial's door
    walk(rig, orbit, outside, spot, 0.5, 0, 0, 0);
    expectAtChosenSpot(spot, orbit, outside.x, outside.z, "village");

    // The door: the scene switches to the hall's map and the server puts the player at the hall's spawn.
    setActiveMap(HALL_ACTIVE_MAP);
    expect(noteAreaLimit(rig, orbit, HALL_ACTIVE_MAP.cameraLimit)).toBe(true);
    const inside = { x: HALL.spawn.x, z: HALL.spawn.z };
    const room = HALL.room;
    walk(rig, orbit, inside, spot, 3, 1.5, 0, -1, (s) => {
      expect(s.y).toBeLessThanOrEqual(HALL_CAMERA_LIMIT.maxY + 1e-9); // under the roof
      expect(s.x).toBeGreaterThan(room.minX); // inside the walls
      expect(s.x).toBeLessThan(room.maxX);
      expect(s.z).toBeGreaterThan(room.minZ);
      expect(s.z).toBeLessThan(room.maxZ);
    });
    expect(orbit).toEqual({ yaw: 1.0, pitch: 0.5, distance: 9.5 }); // the yaw, the tilt and the zoom came through untouched

    // Out again: the village's map, the door's arrival point outside.
    setActiveMap(VILLAGE_ACTIVE_MAP);
    expect(noteAreaLimit(rig, orbit, VILLAGE_ACTIVE_MAP.cameraLimit)).toBe(true);
    const arrival = VILLAGE_LAYOUT.memorial.exterior.arrival;
    const back = { x: arrival.x, z: arrival.z };
    stepFollowRig(rig, orbit, back.x, back.z, DESKTOP, DT, true, spot);
    expectAtChosenSpot(spot, orbit, back.x, back.z, "first frame outside");
    expect(armLength(spot, back.x, back.z)).toBeCloseTo(9.5, EPS_DIGITS);
  });

  it("inside the hall the zoom is not capped: where the room has space the camera keeps the player's horizontal reach", () => {
    setActiveMap(HALL_ACTIVE_MAP);
    // A short zoom that fits the room, looking from the north-west corner's side: nothing is in the way.
    const orbit = frozen({ yaw: Math.PI, pitch: 0.2, distance: 4.5 });
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    const body = { x: 300, z: 3.6 };
    walk(rig, orbit, body, spot, 1, 0, 0, 0);
    expect(spot.y).toBeLessThanOrEqual(HALL_CAMERA_LIMIT.maxY);
    expectAtChosenSpot(spot, orbit, body.x, body.z, "hall, clear");
  });

  it("at the hall's door, facing the near wall, the player's own head stays well inside the view at any zoom, tilt or screen", () => {
    // Review 2026-11-10: with the 3.6 m cap gone, the indoor arm shaping (keep the height, lift the look by (1 − k) ×
    // 1.3 m) used k = clearance / the uncapped wanted arm, so a long zoom near a wall raised the look so far that the
    // avatar slid off the bottom of the screen (31° below centre at zoom 18; the vertical half-fov is 27.5°).
    // Against a wall the arm is now shaped as with the old 3.6 m reference (main: 17.3°).
    setActiveMap(HALL_ACTIVE_MAP);
    const body = { x: HALL.spawn.x, z: HALL.spawn.z };
    for (const distance of [6, 10, 18]) {
      for (const pitch of [0.35, 0.55]) {
        for (const aspect of [DESKTOP, 0.46]) {
          const orbit = frozen({ yaw: 0, pitch, distance }); // looking at the south wall, as right after the door
          const rig = createFollowRig(orbit);
          const spot = createFollowSpot();
          for (let i = 0; i < 90; i += 1) stepFollowRig(rig, orbit, body.x, body.z, aspect, DT, true, spot);
          const lookY = HEAD_HEIGHT + CAMERA_LOOK_LIFT + spot.lookLift;
          const v = [body.x - spot.x, lookY - spot.y, body.z - spot.z];
          const h = [body.x - spot.x, HEAD_HEIGHT - spot.y, body.z - spot.z];
          const cos = (v[0] * h[0] + v[1] * h[1] + v[2] * h[2]) / (Math.hypot(v[0], v[1], v[2]) * Math.hypot(h[0], h[1], h[2]));
          const below = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
          expect(below, `zoom ${distance}, tilt ${pitch}, aspect ${aspect.toFixed(2)}`).toBeLessThan(20);
          expect(spot.y).toBeLessThanOrEqual(HALL_CAMERA_LIMIT.maxY + 1e-9);
        }
      }
    }
  });

  it("noteAreaLimit is not a crossing when the limit stays the same (a re-render, a hub gate): nothing is reset", () => {
    const orbit = frozen({ yaw: 0, pitch: 0.35, distance: 6 });
    const rig = createFollowRig(orbit);
    rig.armLimit = 3;
    expect(noteAreaLimit(rig, orbit, undefined)).toBe(false);
    expect(rig.armLimit).toBe(3);
  });
});

describe("follow rig — walls and the floor shape the frame, never the player's choice", () => {
  it("a house between the head and the camera pulls the camera in along its own line; clear again, it is exactly back", () => {
    const orbit = frozen({ yaw: 0, pitch: 0.35, distance: 9.5 }); // the camera to the south (+z) of the player
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    const body = { x: -46, z: -14 }; // just north of house 5 (x -50..-42, z -11..-5): it stands between
    walk(rig, orbit, body, spot, 0.2, 0, 0, 0);
    const pulled = armLength(spot, body.x, body.z);
    expect(pulled).toBeLessThan(5); // in front of the house, not inside or behind it
    // The angle is kept: the shortened camera lies on the chosen line from the head.
    const want = chosenSpot(orbit, body.x, body.z);
    const k = pulled / 9.5;
    expect(spot.x - body.x).toBeCloseTo((want.x - body.x) * k, EPS_DIGITS);
    expect(spot.y - HEAD_HEIGHT).toBeCloseTo((want.y - HEAD_HEIGHT) * k, EPS_DIGITS);
    expect(spot.z - body.z).toBeCloseTo((want.z - body.z) * k, EPS_DIGITS);

    // Walk west, clear of the house: the arm grows back and then sits exactly on the chosen spot.
    walk(rig, orbit, body, spot, 1, 14, -1, 0); // 14 m west, to x = -60
    walk(rig, orbit, body, spot, 2, 0, 0, 0);
    expectAtChosenSpot(spot, orbit, body.x, body.z, "clear of the house");
    expect(orbit).toEqual({ yaw: 0, pitch: 0.35, distance: 9.5 });
  });

  it("the floor stop: a low tilt at a long zoom holds the camera at CAMERA.minY; tilted up, the chosen spot is exact again", () => {
    const low = frozen({ yaw: 0, pitch: CAMERA.minPitch, distance: CAMERA.maxDistance });
    const rig = createFollowRig(low);
    const spot = createFollowSpot();
    stepFollowRig(rig, low, 0, 14, DESKTOP, DT, true, spot);
    expect(chosenSpot(low, 0, 14).y).toBeLessThan(0); // the wanted spot is under the ground
    expect(spot.y).toBe(CAMERA.minY);
    // The player drags the tilt up (a new orbit value): nothing of the floor stop is left over.
    const up = frozen({ ...low, pitch: 0.35 });
    stepFollowRig(rig, up, 0, 14, DESKTOP, DT, true, spot);
    expectAtChosenSpot(spot, up, 0, 14, "tilted up");
  });

  it("first person (the TP term not drawn) skips the walls and leaves the arm free for the way back out", () => {
    const orbit = frozen({ yaw: 0, pitch: 0.35, distance: 9.5 });
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    stepFollowRig(rig, orbit, -46, -14, DESKTOP, DT, true, spot);
    expect(rig.armLimit).toBeLessThan(9.5);
    stepFollowRig(rig, orbit, -46, -14, DESKTOP, DT, false, spot);
    expect(rig.armLimit).toBeGreaterThan(CAMERA.maxDistance * 1.6);
  });
});
