import { LAKE_DECKS, LAKE_FISHING_SPOTS, LAKE_REEDS, LAKE_SHORE, LAKE_SHOP, LAKE_WATER_Y, distToPolygonEdge, insidePolygon, onLakeDeck } from "@caysonverse/shared/village/lakeLayout";
import { bedAt, type BedGrid } from "../village/waterBed";
import { mulberry32 } from "../village/creek/creekStones";
import type { ReedClump } from "../village/creek/creekPlan";
import type { FlowerSpec, LeafSpec } from "../village/waterPlants";

/**
 * Where the fishing lake's shoreline plants go (owner 2026-11-18): reed and sedge clumps standing in the shallows of the bays, and lily
 * pads (a few white flowers among them) floating a little further out. Pure functions of the bed grid, deterministic (seeded) and
 * kept clear of the decks, the office, the fishing spots and where the floats land.
 */

/** The bays that get lilies (centres of LAKE_REEDS' wide beds, in the lake's own order). */
export const LILY_BAYS: readonly { x: number; z: number; r: number }[] = [
  { x: 123, z: 24, r: 7 },
  { x: 170, z: -40, r: 9 },
  { x: 174, z: 18, r: 8 },
  { x: 160, z: 31, r: 5 },
];

export interface LakeShorePlan {
  reeds: ReedClump[];
  leaves: LeafSpec[];
  flowers: FlowerSpec[];
}

/** A float lands about here (every spot's cast point): nothing grows within `m` of it. */
function nearFloat(x: number, z: number, m: number): boolean {
  return LAKE_FISHING_SPOTS.some((s) => Math.hypot(s.float.x - x, s.float.z - z) < m);
}

function clearOfFacilities(x: number, z: number, pad: number): boolean {
  if (onLakeDeck(x, z)) return false;
  for (const d of LAKE_DECKS) {
    const b = d.box;
    if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return false;
  }
  return !(x > LAKE_SHOP.minX - 2 && x < LAKE_SHOP.maxX + 2 && z > LAKE_SHOP.minZ - 2 && z < LAKE_SHOP.maxZ + 2);
}

export function planLakeShore(grid: BedGrid, low: boolean): LakeShorePlan {
  const rnd = mulberry32(8812);
  const reeds: ReedClump[] = [];
  const leaves: LeafSpec[] = [];
  const flowers: FlowerSpec[] = [];
  const bed = (x: number, z: number) => bedAt(grid, x, z, -1.5);
  const waterY = LAKE_WATER_Y - 0.05; // the water mesh's own level (-0.6)

  // reeds and sedges: in the shallows of every reed bed, 0.1 .. 0.5 m deep
  for (const rb of LAKE_REEDS) {
    const want = Math.round((rb.radius * 3.2) * (low ? 0.55 : 1));
    let placed = 0;
    for (let tries = 0; tries < want * 14 && placed < want; tries++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * rb.radius;
      const x = rb.centre.x + Math.cos(a) * rr;
      const z = rb.centre.z + Math.sin(a) * rr;
      if (!insidePolygon(x, z, LAKE_SHORE) || !clearOfFacilities(x, z, 1.5) || nearFloat(x, z, 3.2)) continue;
      const y = bed(x, z);
      const depth = waterY - y;
      if (depth < 0.08 || depth > 0.55) continue;
      reeds.push({ x, y: y - 0.02, z, h: 1.1 + rnd() * 1.0, seed: 400 + reeds.length, sedge: rnd() < 0.3 ? 1 : 0 });
      placed++;
    }
  }
  // sedge tufts along the rest of the waterline here and there (the bank's low spots)
  const edgeTufts = low ? 14 : 30;
  for (let tries = 0, got = 0; tries < edgeTufts * 40 && got < edgeTufts; tries++) {
    const k = Math.floor(rnd() * LAKE_SHORE.length);
    const p = LAKE_SHORE[k]!;
    const q = LAKE_SHORE[(k + 1) % LAKE_SHORE.length]!;
    const t = rnd();
    const x = p.x + (q.x - p.x) * t;
    const z = p.z + (q.z - p.z) * t;
    if (!clearOfFacilities(x, z, 2.5) || nearFloat(x, z, 3.5) || (!insidePolygon(x, z, LAKE_SHORE) && distToPolygonEdge(x, z, LAKE_SHORE) > 0.4)) continue;
    // a step inland from the waterline
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const out = -0.3 - rnd() * 0.5;
    const sx = x + (dz / len) * out, sz = z - (dx / len) * out;
    const depth = waterY - bed(sx, sz);
    if (depth < -0.3 || depth > 0.4) continue;
    reeds.push({ x: sx, y: bed(sx, sz) - 0.02, z: sz, h: 0.6 + rnd() * 0.5, seed: 700 + got, sedge: 1 });
    got++;
  }

  // lilies in a few bays, where the water is 0.4 .. 1.6 m deep
  for (const bay of LILY_BAYS) {
    const want = Math.round(bay.r * (low ? 2.0 : 3.4));
    let placed = 0;
    for (let tries = 0; tries < want * 20 && placed < want; tries++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * bay.r;
      const x = bay.x + Math.cos(a) * rr;
      const z = bay.z + Math.sin(a) * rr;
      if (!insidePolygon(x, z, LAKE_SHORE) || !clearOfFacilities(x, z, 3) || nearFloat(x, z, 5)) continue;
      const depth = waterY - bed(x, z);
      if (depth < 0.4 || depth > 1.7) continue;
      if (leaves.some((l) => Math.hypot(l.x - x, l.z - z) < l.r * 1.7)) continue;
      const r = 0.2 + rnd() * 0.16;
      leaves.push({ x, y: waterY + 0.012, z, r, yaw: rnd() * 6.28, seed: 900 + leaves.length, tone: 0.8 + rnd() * 0.45, cup: 0.04 + rnd() * 0.05 });
      if (rnd() < 0.18) flowers.push({ x: x + (rnd() - 0.5) * 0.3, y: waterY + 0.02, z: z + (rnd() - 0.5) * 0.3, r: 0.09 + rnd() * 0.03, yaw: rnd() * 6.28, seed: 1500 + flowers.length, open: 0.7 + rnd() * 0.3, pink: 0.05 });
      placed++;
    }
  }
  return { reeds, leaves, flowers };
}
