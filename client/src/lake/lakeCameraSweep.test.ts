/**
 * Design 12.6: the third-person camera at the 30 fishing chairs (8 directions x 3 pitches) and at the 8 walking places of the lake
 * (office front, pier mouth, T end, both floating walkways, both 좌대, the pavilion) with the spring arm of cameraCollision.ts as the
 * rig casts it (followRig.ts: head at HEAD_HEIGHT, the camera `distance` along (yaw, pitch)): the camera is never inside the office, a
 * hut or a lamp post, never under the water (surface + 0.3 m), and the fishing camera's view of the float is not cut by a hut or the office.
 */
import { describe, it, expect } from "vitest";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { LAKE_PAVILION, LAKE_WATER_Y, LAKE_FISHING_SPOTS, LAKE_JWADAE_A, LAKE_JWADAE_B, LAKE_PIER_T, LAKE_RENTAL_PAD, LAKE_WALKWAY_A, LAKE_WALKWAY_B, lakeCameraBoxes, lakeSeats } from "@caysonverse/shared/village/lakeLayout";
import { HEAD_HEIGHT } from "./../game/constants";
import { segmentHitFraction, springArmDistance } from "../game/cameraCollision";
import { WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { FISHING_VIEW } from "./lakeCamera";

const boxes = villageGeometry.cameraBoxes;
const PAD = 0.3; // the village's camera pad (VILLAGE_CAMERA_PAD)
const YAWS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
const PITCHES = [0.2, 0.6, 1.0];
const DISTANCES = [FISHING_VIEW.distance, 6, 12];

/** The camera point the rig draws for a body at (x, z): the arm shortened by the spring arm. */
function camera(x: number, z: number, yaw: number, pitch: number, distance: number) {
  const horiz = distance * Math.cos(pitch);
  const cx = x + horiz * Math.sin(yaw);
  const cy = HEAD_HEIGHT + distance * Math.sin(pitch);
  const cz = z + horiz * Math.cos(yaw);
  const d = springArmDistance(x, HEAD_HEIGHT, z, cx, cy, cz, distance, boxes, PAD);
  const k = d / distance;
  return { x: x + (cx - x) * k, y: HEAD_HEIGHT + (cy - HEAD_HEIGHT) * k, z: z + (cz - z) * k };
}

const lakeBoxes = lakeCameraBoxes();
const inside = (p: { x: number; y: number; z: number }) =>
  lakeBoxes.filter((b) => p.x > b.minX - 0.05 && p.x < b.maxX + 0.05 && p.z > b.minZ - 0.05 && p.z < b.maxZ + 0.05 && p.y < (b.height ?? WALL_HEIGHT) + 0.05);

describe("the camera at the lake (12.6)", () => {
  it("the office, the huts and the lamps are camera boxes (the arm stops at them)", () => {
    expect(lakeBoxes.length).toBeGreaterThanOrEqual(5);
    for (const b of lakeBoxes) expect(boxes).toContainEqual(b);
  });

  it("at all 30 fishing chairs, 8 directions x 3 pitches x 3 distances: never inside a lake facility, never under the water", () => {
    const bad: string[] = [];
    const chairs = lakeSeats().filter((s) => s.kind === "fishing_chair");
    chairs.forEach((c, i) => {
      for (const yaw of YAWS) for (const pitch of PITCHES) for (const dist of DISTANCES) {
        const p = camera(c.x, c.z, yaw, pitch, dist);
        const hit = inside(p);
        if (hit.length) bad.push(`${LAKE_FISHING_SPOTS[i]!.id} yaw ${yaw.toFixed(2)} pitch ${pitch} d ${dist}: inside a box at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
        if (p.y < LAKE_WATER_Y + 0.3) bad.push(`${LAKE_FISHING_SPOTS[i]!.id} yaw ${yaw.toFixed(2)} pitch ${pitch} d ${dist}: y ${p.y.toFixed(2)} under the water`);
      }
    });
    expect(bad).toEqual([]);
  });

  it("at the 8 walking places of the lake, 8 directions x 3 pitches: the same", () => {
    const places: Array<[string, number, number]> = [
      ["office front", LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z],
      ["pier mouth", 108, -12],
      ["T end", (LAKE_PIER_T.minX + LAKE_PIER_T.maxX) / 2, (LAKE_PIER_T.minZ + LAKE_PIER_T.maxZ) / 2],
      ["walkway A", (LAKE_WALKWAY_A.minX + LAKE_WALKWAY_A.maxX) / 2, (LAKE_WALKWAY_A.minZ + LAKE_WALKWAY_A.maxZ) / 2],
      ["walkway B", (LAKE_WALKWAY_B.minX + LAKE_WALKWAY_B.maxX) / 2, (LAKE_WALKWAY_B.minZ + LAKE_WALKWAY_B.maxZ) / 2],
      ["jwadae A", LAKE_JWADAE_A.minX + 1, LAKE_JWADAE_A.maxZ - 0.8],
      ["jwadae B", LAKE_JWADAE_B.minX + 1, LAKE_JWADAE_B.minZ + 0.8],
      ["pavilion", LAKE_PAVILION.centre.x, LAKE_PAVILION.centre.z],
    ];
    const bad: string[] = [];
    for (const [name, x, z] of places) for (const yaw of YAWS) for (const pitch of PITCHES) for (const dist of [6, 12]) {
      const p = camera(x, z, yaw, pitch, dist);
      if (inside(p).length) bad.push(`${name} yaw ${yaw.toFixed(2)} pitch ${pitch} d ${dist}: inside a box`);
      if (p.y < LAKE_WATER_Y + 0.3) bad.push(`${name} yaw ${yaw.toFixed(2)} pitch ${pitch}: under the water`);
    }
    expect(bad).toEqual([]);
  });

  it("the fishing camera sees the float: from the over-the-shoulder spot of every chair the line of sight to the float is not cut by a hut or the office", () => {
    const chairs = lakeSeats().filter((s) => s.kind === "fishing_chair");
    const bad: string[] = [];
    chairs.forEach((c, i) => {
      const spot = LAKE_FISHING_SPOTS[i]!;
      const yaw = (spot.yaw + Math.PI + FISHING_VIEW.shoulder) % (2 * Math.PI);
      const p = camera(c.x, c.z, yaw, FISHING_VIEW.pitch, FISHING_VIEW.distance);
      const t = segmentHitFraction(p.x, p.y, p.z, spot.float.x, LAKE_WATER_Y + 0.25, spot.float.z, lakeBoxes, WALL_HEIGHT, 0);
      if (t < 1) bad.push(`${spot.id}: the float is hidden (hit at ${t.toFixed(2)})`);
    });
    expect(bad).toEqual([]);
  });

  it("the village's own walls are still camera boxes", () => {
    expect(boxes.length).toBeGreaterThan(lakeBoxes.length);
    expect(VILLAGE_LAYOUT.areas.village.maxX).toBeGreaterThanOrEqual(186);
  });
});
