import { describe, expect, it } from "vitest";
import { obstacleIndex, type AABB } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { VILLAGE_SEATS } from "./benchSeats";
import { villageWalkArea } from "./fallsWalk";
import { VILLAGE_VEG_COLLIDERS, VILLAGE_VEG_GHOSTS } from "./generated/villageVegColliders";
import { PATH_PLANT_MOVES, movedBox } from "./pathPlants";
import { LANE_LAMPS, LAMP_COLLIDER_HALF } from "./streetPoles";
import { VILLAGE_LAYOUT, villageGeometry } from "./villageLayout";
import { LOT_BED_SOLIDS, VILLAGE_LOTS, lotBox, lotDoorPoints } from "./villageLots";

// owner 2026-11-21: flowerbeds, bushes, trunks and lamp posts became solid in the village (the plants where the game draws them, the
// lots' beds, the two lane lamps). The other half of the job: none of the new solids blocks a path, a door or a seat's approach, and
// none makes a pocket a walker cannot get out of. A flood fill over the whole village from the arrival spot (a body of 0.4 m, on a
// 0.25 m grid) is the proof: everything a visitor goes to is reached, and every free spot beside a new solid is too.
const R = PLAYER_RADIUS;
const STEP = 0.25;
const area = villageWalkArea(VILLAGE_LAYOUT);
const index = obstacleIndex(villageGeometry.obstacles);
const start = VILLAGE_LAYOUT.spawn;
const cols = Math.ceil((area.maxX - area.minX) / STEP) + 2;
const key = (x: number, z: number): number => Math.round((z - start.z) / STEP + 2000) * 8192 + Math.round((x - start.x) / STEP + 2000);
const freeAt = (x: number, z: number): boolean => x >= area.minX + R && x <= area.maxX - R && z >= area.minZ + R && z <= area.maxZ - R && !index.isBlocked(x, z, R);

let memo: Set<number> | null = null;
function reached(): Set<number> {
  if (memo) return memo;
  expect(cols).toBeLessThan(8192);
  expect(freeAt(start.x, start.z)).toBe(true);
  const seen = new Set<number>([key(start.x, start.z)]);
  const stack: Array<[number, number]> = [[start.x, start.z]];
  while (stack.length) {
    const [x, z] = stack.pop()!;
    for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      const k = key(nx, nz);
      if (seen.has(k) || !freeAt(nx, nz)) continue;
      seen.add(k);
      stack.push([nx, nz]);
    }
  }
  memo = seen;
  return seen;
}
/** A reached grid point within `tol` m of (x, z). */
function near(x: number, z: number, tol: number): boolean {
  const set = reached();
  const n = Math.ceil(tol / STEP) + 1;
  const gx = start.x + Math.round((x - start.x) / STEP) * STEP;
  const gz = start.z + Math.round((z - start.z) / STEP) * STEP;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (Math.hypot(gx + i * STEP - x, gz + j * STEP - z) <= tol && set.has(key(gx + i * STEP, gz + j * STEP))) return true;
  return false;
}

/** The solids of 2026-11-21: the plants' boxes, the moved trees, the lots' beds and borders, the two lane lamps. */
const NEW_SOLIDS: Array<{ name: string; box: AABB }> = [
  ...VILLAGE_VEG_COLLIDERS.map((box, i) => ({ name: `plant ${i}`, box })),
  ...PATH_PLANT_MOVES.map((m) => ({ name: `moved ${m.id}`, box: movedBox(m) })),
  ...VILLAGE_LOTS.flatMap((lot) => (LOT_BED_SOLIDS[lot.id] ?? []).map((r, i) => ({ name: `${lot.id} bed ${i}`, box: lotBox(lot, r) }))),
  ...LANE_LAMPS.map((l, i) => ({ name: `lane lamp ${i}`, box: { minX: l.x - LAMP_COLLIDER_HALF, maxX: l.x + LAMP_COLLIDER_HALF, minZ: l.z - LAMP_COLLIDER_HALF, maxZ: l.z + LAMP_COLLIDER_HALF } })),
];

describe("the village with its plants, beds and lamps solid: everything is still reached on foot", () => {
  it("the flood fill covers the village (the plaza, the lanes, the lots' forecourts, the lake's shore)", () => {
    expect(reached().size).toBeGreaterThan(250000);
    for (const [x, z] of [[0, 14], [0, -40], [-35, -36], [35, -36], [-24, 60], [60, 0], [-60, 0], [100, 0]] as const) expect(near(x, z, 1.5), `(${x}, ${z})`).toBe(true);
  }, 120000);

  it("every seat's standing spot, every lot door's pad and every house's doorstep is reached", () => {
    const missed: string[] = [];
    for (const s of VILLAGE_SEATS) if (s.area === "village" && !near(s.standX, s.standZ, 0.45)) missed.push(`seat ${s.bench} (${s.standX.toFixed(2)}, ${s.standZ.toFixed(2)})`);
    for (const lot of VILLAGE_LOTS) for (const d of lotDoorPoints(lot)) if (!near(d.pad.x, d.pad.z, d.pad.radius + 0.5)) missed.push(`${lot.id} door pad (${d.pad.x.toFixed(2)}, ${d.pad.z.toFixed(2)})`);
    for (const h of VILLAGE_LAYOUT.sceneryHouses) {
      if (h.kind !== "house") continue;
      const hw = h.size.x / 2 + 0.9;
      const hd = h.size.z / 2 + 0.9;
      const p = h.doorSide === "n" ? { x: h.centre.x, z: h.centre.z - hd } : h.doorSide === "s" ? { x: h.centre.x, z: h.centre.z + hd } : h.doorSide === "e" ? { x: h.centre.x + hw, z: h.centre.z } : { x: h.centre.x - hw, z: h.centre.z };
      if (!near(p.x, p.z, 1.2)) missed.push(`doorstep of ${h.id} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    }
    expect(missed).toEqual([]);
  }, 120000);

  it("no pocket: every spot a body fits on within 3 m of a new solid is reached from the arrival", () => {
    const set = reached();
    const stranded: string[] = [];
    const seen = new Set<number>();
    for (const { name, box } of NEW_SOLIDS) {
      for (let x = box.minX - 3; x <= box.maxX + 3; x += STEP) {
        for (let z = box.minZ - 3; z <= box.maxZ + 3; z += STEP) {
          const gx = start.x + Math.round((x - start.x) / STEP) * STEP;
          const gz = start.z + Math.round((z - start.z) / STEP) * STEP;
          const k = key(gx, gz);
          if (seen.has(k)) continue;
          seen.add(k);
          if (freeAt(gx, gz) && !set.has(k)) stranded.push(`${name}: (${gx.toFixed(2)}, ${gz.toFixed(2)})`);
        }
      }
    }
    expect(NEW_SOLIDS.length).toBeGreaterThan(50);
    expect(stranded).toEqual([]);
  }, 120000);

  it("each new solid is walked up to: a free, reached spot within a metre of every one", () => {
    const lonely: string[] = [];
    for (const { name, box } of NEW_SOLIDS) {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const reach = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + R + 1;
      if (cx < area.minX + 1 || cx > area.maxX - 1 || cz < area.minZ + 1 || cz > area.maxZ - 1) continue; // (the orchard's far rows, beyond the walk area)
      if (!near(cx, cz, reach)) lonely.push(`${name} ${JSON.stringify(box)}`);
    }
    expect(lonely).toEqual([]);
  }, 120000);

  it("the boxes nothing was drawn in are gone: the temple's and the chapel's lanes carry no invisible box", () => {
    const lane = VILLAGE_VEG_GHOSTS.filter((g) => Math.abs(Math.abs((g.minX + g.maxX) / 2) - 32) < 2.5 && Math.abs((g.minZ + g.maxZ) / 2 + 29.7) < 2.5);
    expect(lane).toHaveLength(4); // col__shrub_1 / 3 / 14 / 16
    for (const g of lane) expect(index.isBlocked((g.minX + g.maxX) / 2, (g.minZ + g.maxZ) / 2, 0.05), JSON.stringify(g)).toBe(false);
  });
});
