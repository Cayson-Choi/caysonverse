/**
 * Where the village is paved, as one signed distance (owner 2026-11-21, the path to the temple: "절로 가는 입구에 나무가 왜 도로에
 * 있는거야 꽃들도 그렇고"): a tree trunk, a flower bed or a shrub never stands on a lane, the ring road and its sidewalk, the bus
 * stop's pad, the footbridge or a doorstep. The village.glb bakes its street trees, shrubs and flower cards for the OLD lanes
 * (flat strips that the ground paths later redrew along other lines, ground/groundPaths.ts), so the placing code asks this.
 *
 * Everything here is plain data and maths (it runs in the flowers' worker too).
 */
import { BUS_STOP_PAD, VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { SIDEWALK_OUT_R, laneClearance } from "../ground/groundPaths";

/** Trunks keep this far (m) from any paved edge (a trunk's flare and a walker beside it). */
export const TRUNK_CLEAR_M = 0.8;
/** Bushes and flowers: the soil may touch the paving's edge but not lie on it. */
export const PLANT_CLEAR_M = 0;

/** The paved disc round the plaza centre: plaza, ring road and sidewalk (to the sidewalk's outer edge). */
export const PAVED_RADIUS = SIDEWALK_OUT_R;

const bridge = VILLAGE_LAYOUT.bridge;
const rectDist = (x: number, z: number, x0: number, x1: number, z0: number, z1: number): number => {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
  return -Math.min(x - x0, x1 - x, z - z0, z1 - z);
};

/** The bus stop's waiting pad (an L): its three boxes. */
const PAD_BOXES: ReadonlyArray<readonly [number, number, number, number]> = (() => {
  const xs = BUS_STOP_PAD.map((p) => p.x);
  const zs = BUS_STOP_PAD.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  return [[x0, x1, z0, z1]] as const;
})();

/** A door's step: the strip in front of a scenery house's door, from the wall out (the porch inside the footprint has its own beds). */
const DOORSTEPS: ReadonlyArray<readonly [number, number, number, number]> = VILLAGE_LAYOUT.sceneryHouses
  .filter((h) => h.kind === "house")
  .map((h) => {
    const hw = h.size.x / 2;
    const hd = h.size.z / 2;
    const out = 1.5;
    const half = 1.7;
    switch (h.doorSide) {
      case "n": return [h.centre.x - half, h.centre.x + half, h.centre.z - hd - out, h.centre.z - hd] as const;
      case "s": return [h.centre.x - half, h.centre.x + half, h.centre.z + hd, h.centre.z + hd + out] as const;
      case "e": return [h.centre.x + hw, h.centre.x + hw + out, h.centre.z - half, h.centre.z + half] as const;
      default: return [h.centre.x - hw - out, h.centre.x - hw, h.centre.z - half, h.centre.z + half] as const;
    }
  });

/** Distance (m) from a spot to the nearest paved surface's edge; negative: standing on it. */
export function pavedClearance(x: number, z: number): number {
  let d = Math.min(laneClearance(x, z), Math.hypot(x, z) - PAVED_RADIUS);
  d = Math.min(d, rectDist(x, z, bridge.minX, bridge.maxX, bridge.minZ, bridge.maxZ));
  for (const b of PAD_BOXES) d = Math.min(d, rectDist(x, z, b[0], b[1], b[2], b[3]));
  for (const b of DOORSTEPS) d = Math.min(d, rectDist(x, z, b[0], b[1], b[2], b[3]));
  return d;
}

/**
 * The nearest spot at least `margin` m off the paving, walked out along the clearance's slope (a few steps of 10 cm); the spot
 * itself when it is clear already.
 */
export function offPaving(x: number, z: number, margin: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let i = 0; i < 80 && pavedClearance(px, pz) < margin; i++) {
    const e = 0.05;
    const gx = pavedClearance(px + e, pz) - pavedClearance(px - e, pz);
    const gz = pavedClearance(px, pz + e) - pavedClearance(px, pz - e);
    const n = Math.hypot(gx, gz) || 1;
    px += (gx / n) * 0.1;
    pz += (gz / n) * 0.1;
  }
  return { x: px, z: pz };
}
