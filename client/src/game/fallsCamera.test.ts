/**
 * B1 waterfall, W5: the camera at the rest area, steady state, with the app's own spring arm (followRig.ts / cameraCollision.ts)
 * over the real camera boxes: 8 yaws x pitches (the whole range -0.1..1.2) x distances (3.2..18 m) at spots over the whole rest area.
 * Every camera stays on the pocket's side of the camera wall, above the floor stop, and out of the cliff's footprint.
 * (The rock itself, W0's falls_shape.py height field, is checked outside the repo against the positions this writes when
 * FALLS_CAMERA_OUT is set.)
 */
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { villageWalkArea } from "@caysonverse/shared/village/fallsWalk";
import { isBlocked } from "@caysonverse/shared/collision";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { HEAD_HEIGHT } from "./constants";
import { VILLAGE_CAMERA_PAD } from "./indoorCamera";
import { springArmDistance } from "./cameraCollision";

const W = VILLAGE_LAYOUT.backdrop.waterfall;
const boxes = villageGeometry.cameraBoxes;
const SPOTS: Array<[string, number, number]> = [
  ["S6 entry", -95.5, -78],
  ["S7 middle", -100, -79],
  ["S8 front rock", -103.9, -77.6],
  ["S9 north end", -100, -89.6],
  ["S10 south end", -100, -68.4],
  ["NW corner", -105.6, -89.6],
  ["SW corner", -105.6, -68.4],
  ["entry north", -95.4, -86],
  ["entry south", -95.4, -70],
];
const YAWS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
const PITCHES = [-0.1, 0.05, 0.2, 0.35, 0.6, 1.0, 1.2];
const DISTS = [3.2, 6, 12, 18];

function camera(x: number, z: number, yaw: number, pitch: number, dist: number) {
  const horiz = dist * Math.cos(pitch);
  const tx = x + horiz * Math.sin(yaw);
  let ty = HEAD_HEIGHT + dist * Math.sin(pitch);
  const tz = z + horiz * Math.cos(yaw);
  const offX = tx - x;
  const offY = ty - HEAD_HEIGHT;
  const offZ = tz - z;
  const reach = Math.sqrt(offX * offX + offY * offY + offZ * offZ);
  const arm = springArmDistance(x, HEAD_HEIGHT, z, tx, ty, tz, reach, boxes, VILLAGE_CAMERA_PAD);
  const k = Math.min(1, arm / reach);
  ty = HEAD_HEIGHT + offY * k;
  return { x: x + offX * k, y: Math.max(ty, 0.6), z: z + offZ * k, k };
}

describe("the camera at the rest area, steady state", () => {
  it("never reaches the camera wall's boxes or the cliff's footprint, and stops short of them when a long arm would", () => {
    const rec: unknown[] = [];
    let shortened = 0;
    for (const [name, x, z] of SPOTS) {
      expect(isBlocked(x, z, PLAYER_RADIUS - 0.01, villageGeometry.obstacles, 0), name).toBe(false);
      expect(x).toBeGreaterThanOrEqual(villageWalkArea(VILLAGE_LAYOUT).minX);
      for (const yaw of YAWS) for (const pitch of PITCHES) for (const dist of DISTS) {
        const c = camera(x, z, yaw, pitch, dist);
        rec.push({ spot: name, yaw: Math.round(yaw * 100) / 100, pitch, distance: dist, cam: [c.x, c.y, c.z].map((n) => Math.round(n * 100) / 100), player: [x, z] });
        if (c.k < 1) shortened++;
        for (const b of boxes) {
          const top = b.height ?? 2.6;
          const inside = c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ && c.y < top && c.y >= (b.minY ?? 0);
          // a camera of the rest area's cliff wall (tall boxes only; the village's own props are the village's tests)
          if (b.maxX < W.pocket.minX - 3 && b.minX <= W.site.minX) expect(inside, `${name} yaw ${yaw} pitch ${pitch} dist ${dist}: ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`).toBe(false);
        }
      }
    }
    expect(shortened).toBeGreaterThan(50); // the wall really stops long arms looking west
    if (process.env.FALLS_CAMERA_OUT) writeFileSync(process.env.FALLS_CAMERA_OUT, JSON.stringify(rec));
  });
});
