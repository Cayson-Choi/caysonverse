import { bedAt, type BedGrid } from "../waterBed";
import { mulberry32, type StoneSpec } from "../creek/creekStones";
import type { FlowerSpec, LeafSpec } from "../waterPlants";

/**
 * The temple's lotus pond (마을 절, lot_temple): where the lotus leaves, the flowers and the bed's pebbles go. The pond is two half-disc
 * lobes with a granite bridge across the waist (world z -44 .. -43.6), 0.43 m of water over a stone-and-gravel bed. Pure functions of the
 * bed grid (waterBed.ts), deterministic, unit-tested (pond.test.ts).
 */

/**
 * The pond's water surface, its floor and the bridge's band across the waist. The lot file sinks the pond 0.55 m (glass plane at -0.12),
 * but the village's own lawn (y 0, 5 m cells) runs under the whole plot with no hole there: that lawn was the "neon green" showing
 * through the basin. The pond is drawn above the lawn instead: a floor 6 mm over it, the water 13 cm up, inside the granite rim.
 */
export const POND_FLOOR_Y = 0.006;
export const POND_WATER_Y = 0.13;
export const POND_BRIDGE_Z = { min: -44.55, max: -43.45 } as const;

/** The pond's own rectangle in the world (m), a little over the basin. */
export const POND_RECT = { x0: -48.6, z0: -47.2, x1: -43.4, z1: -40.8 } as const;

export interface PondPlan {
  leaves: LeafSpec[];
  flowers: FlowerSpec[];
  pebbles: StoneSpec[];
}

/** The distance from (x, z) to the nearest texel that is not deep enough (the rim, the bridge): how far inside the water it stands. */
function insideDistance(grid: BedGrid, x: number, z: number, maxR: number): number {
  const deep = (px: number, pz: number): boolean => bedAt(grid, px, pz, 0.5) < POND_FLOOR_Y + 0.05;
  if (!deep(x, z)) return 0;
  for (let r = 0.1; r <= maxR; r += 0.1) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (!deep(x + Math.cos(a) * r, z + Math.sin(a) * r)) return r;
    }
  }
  return maxR;
}

/** True where a plant may stand: well inside the water, clear of the bridge's band. */
export function pondSpot(grid: BedGrid, x: number, z: number, margin: number): boolean {
  if (z > POND_BRIDGE_Z.min - margin && z < POND_BRIDGE_Z.max + margin) return false;
  return insideDistance(grid, x, z, margin + 0.01) >= margin;
}

/**
 * `flowerAt` and `leafAt` are the model's own lotus flowers and leaves (the instanced ones the lot file drew as flat discs): they keep
 * their places, the new ones are drawn there; more leaves are scattered in the gaps.
 */
export function planPond(grid: BedGrid, flowerAt: readonly { x: number; z: number }[], leafAt: readonly { x: number; z: number }[], low: boolean): PondPlan {
  const rnd = mulberry32(5521);
  const leaves: LeafSpec[] = [];
  const flowers: FlowerSpec[] = [];
  const bedY = (x: number, z: number) => bedAt(grid, x, z, POND_FLOOR_Y);
  const place = (x: number, z: number, r: number): boolean => leaves.every((l) => Math.hypot(l.x - x, l.z - z) > (l.r + r) * 0.85);

  // the model's leaves: most float on the water, a few rise on stalks like real lotus leaves
  leafAt.forEach((p, i) => {
    if (!pondSpot(grid, p.x, p.z, 0.3)) return;
    const raised = i % 3 === 1;
    const r = raised ? 0.3 + rnd() * 0.08 : 0.22 + rnd() * 0.08;
    leaves.push({
      x: p.x,
      z: p.z,
      y: raised ? POND_WATER_Y + 0.14 + rnd() * 0.16 : POND_WATER_Y + 0.012,
      r,
      yaw: rnd() * 6.28,
      seed: 20 + i,
      tone: 0.85 + rnd() * 0.3,
      cup: raised ? 0.28 : 0.05,
      stalkFrom: raised ? bedY(p.x, p.z) : undefined,
    });
  });
  // more pads in the gaps
  const want = low ? 6 : 12;
  for (let tries = 0, got = 0; tries < 400 && got < want; tries++) {
    const x = POND_RECT.x0 + rnd() * (POND_RECT.x1 - POND_RECT.x0);
    const z = POND_RECT.z0 + rnd() * (POND_RECT.z1 - POND_RECT.z0);
    const raised = rnd() < 0.3;
    const r = raised ? 0.28 + rnd() * 0.08 : 0.17 + rnd() * 0.1;
    if (!pondSpot(grid, x, z, 0.28) || !place(x, z, r)) continue;
    leaves.push({
      x,
      z,
      y: raised ? POND_WATER_Y + 0.12 + rnd() * 0.16 : POND_WATER_Y + 0.012,
      r,
      yaw: rnd() * 6.28,
      seed: 60 + got,
      tone: 0.85 + rnd() * 0.3,
      cup: raised ? 0.28 : 0.05,
      stalkFrom: raised ? bedY(x, z) : undefined,
    });
    got++;
  }
  // the model's flowers: open blooms and buds on stalks above the leaves
  flowerAt.forEach((p, i) => {
    if (!pondSpot(grid, p.x, p.z, 0.2)) return;
    const bud = i % 4 === 3;
    flowers.push({
      x: p.x,
      z: p.z,
      y: POND_WATER_Y + 0.3 + rnd() * 0.18,
      r: bud ? 0.09 : 0.13 + rnd() * 0.03,
      yaw: rnd() * 6.28,
      seed: 90 + i,
      open: bud ? 0.05 : 0.7 + rnd() * 0.3,
      pink: 0.75 + rnd() * 0.25,
      stalkFrom: bedY(p.x, p.z),
    });
  });
  // pebbles on the bed (seen through the clear water), none under the bridge's band
  const pebbles: StoneSpec[] = [];
  const nPeb = low ? 26 : 56;
  for (let tries = 0; tries < 600 && pebbles.length < nPeb; tries++) {
    const x = POND_RECT.x0 + rnd() * (POND_RECT.x1 - POND_RECT.x0);
    const z = POND_RECT.z0 + rnd() * (POND_RECT.z1 - POND_RECT.z0);
    if (!pondSpot(grid, x, z, 0.08)) continue;
    const r = 0.04 + rnd() * rnd() * 0.12;
    pebbles.push({ x, z, top: bedY(x, z) + r * 0.7, rx: r * (1 + rnd() * 0.5), rz: r * (1 + rnd() * 0.4), depth: r * 1.2, yaw: rnd() * 6.28, flat: rnd() * 0.4, seed: 300 + pebbles.length, tone: 0.75 + rnd() * 0.5, detail: low ? 1 : 2 });
  }
  return { leaves, flowers, pebbles };
}
