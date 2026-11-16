/**
 * 집 실내 G, design chapter 8.4: the third-person camera inside every finished house floor. From every spot a body can stand on (a 1.0 m
 * grid over the walkable floor), 8 yaws, 3 tilts (low, medium, high) and the nearest and farthest zoom, the camera — after the rig has
 * settled (the spring arm, the ceiling limit, the walls' camera boxes) — is inside the floor's room, under the ceiling, not in a tall
 * box (a wall, a partition, a bookcase), above the floor, and no nearer the head than the spring's minimum. The solid model (the GLB's
 * triangles, registered while a house is on screen) is not in a unit test; it only pulls the camera in further.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { GENERATED_HOUSE_NUMBERS } from "@caysonverse/shared/village/generated/houses";
import { HOUSE_FLOORS, HOUSE_ROOM, houseFloorBounds, houseFloorArea } from "@caysonverse/shared/village/houseAreas";
import { isBlocked } from "@caysonverse/shared/collision";
import { CAMERA, HEAD_HEIGHT } from "./constants";
import { VILLAGE_ACTIVE_MAP, setActiveMap, villageActiveMap } from "./activeMap";
import { SPRING, isPropCameraBox } from "./cameraCollision";
import { createFollowRig, createFollowSpot, stepFollowRig } from "./followRig";
import type { Orbit } from "./types";

const DT = 1 / 60;
const ASPECTS = [1280 / 800, 375 / 812]; // a PC window and an iPhone held upright
const YAWS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
// (the steepest tilts up to 1.2 are looked at in the browser: past about 1.1 the over-the-shoulder pose, which the solid model corrects, can lie in a tall box)
const PITCHES = [CAMERA.minPitch + 0.02, 0.5, 0.95];
const DISTANCES = [CAMERA.minDistance, CAMERA.distance, CAMERA.maxDistance];

afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

describe("the camera in every house floor", () => {
  for (const n of GENERATED_HOUSE_NUMBERS) {
    for (const floor of HOUSE_FLOORS) {
      it(`house ${n} floor ${floor}: every standable spot x 8 yaws x 3 tilts x 3 zooms x PC / phone stays inside the room under the ceiling`, () => {
        const area = houseFloorArea(n, floor);
        const map = villageActiveMap(area);
        setActiveMap(map);
        const room = houseFloorBounds(n, floor);
        const ceil = HOUSE_ROOM.ceiling;
        const bad: string[] = [];
        let spots = 0;
        let cases = 0;
        for (let x = room.minX + 0.6; x <= room.maxX - 0.6; x += 1.0) {
          for (let z = room.minZ + 0.6; z <= room.maxZ - 0.6; z += 1.0) {
            if (isBlocked(x, z, PLAYER_RADIUS + 0.05, map.geometry.obstacles, 0)) continue;
            spots++;
            for (const aspect of ASPECTS) {
              for (const yaw of YAWS) {
                for (const pitch of PITCHES) {
                  for (const distance of DISTANCES) {
                    const orbit: Orbit = { yaw, pitch, distance };
                    const rig = createFollowRig(orbit);
                    const spot = createFollowSpot();
                    for (let i = 0; i < 90; i++) stepFollowRig(rig, orbit, x, z, aspect, DT, true, spot);
                    cases++;
                    const tag = `(${x.toFixed(1)}, ${z.toFixed(1)}) yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)} d ${distance} a ${aspect.toFixed(2)}`;
                    const inside = spot.x > room.minX + 0.05 && spot.x < room.maxX - 0.05 && spot.z > room.minZ + 0.05 && spot.z < room.maxZ - 0.05;
                    if (!inside) bad.push(`outside the room ${tag}: ${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}`);
                    if (!(spot.y < ceil - 0.05 && spot.y > 0.2)) bad.push(`height ${spot.y.toFixed(2)} ${tag}`);
                    // not inside a tall box (the walls' own boxes are the room's rim: the test above covers them)
                    for (const b of map.geometry.cameraBoxes) {
                      // (the owner's camera rule, 2026-11-16: only walls and buildings shorten the arm — a fridge or a lamp is a prop the lens may pass)
                      if (b.height === undefined || b.height < 1.6 || b.minY !== undefined || isPropCameraBox(b)) continue;
                      const within = spot.x > b.minX && spot.x < b.maxX && spot.z > b.minZ && spot.z < b.maxZ && spot.y < b.height;
                      if (within) bad.push(`inside a ${b.height} m box [${b.minX}..${b.maxX}, ${b.minZ}..${b.maxZ}] ${tag}: camera ${spot.x.toFixed(2)}, ${spot.y.toFixed(2)}, ${spot.z.toFixed(2)}`);
                    }
                    const arm = Math.hypot(spot.x - x, spot.y - HEAD_HEIGHT, spot.z - z);
                    if (arm < SPRING.minDist - 0.05 && spot.fovAdd === 0 && Math.hypot(spot.x - x, spot.z - z) < 0.01) bad.push(`on the head ${tag}`);
                  }
                }
              }
            }
          }
        }
        expect(spots, `standable spots of house ${n} floor ${floor}`).toBeGreaterThan(15);
        expect(cases).toBeGreaterThan(2000); // a furnished floor: 15+ spots × 144 views (the blockout had 5000+)
        expect(bad.slice(0, 12).join("\n")).toBe("");
      }, 240_000);
    }
  }
});
