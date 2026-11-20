/**
 * Caysonland's twelve planted islands (stone-kerbed beds of mulch, shrubs, flowers and grass beside the two paved approaches and
 * round the plaza's outer curve), as data shared by the drawing (client land/parkBorders.ts) and the collision (parkArea.ts):
 * owner 2026-11-21: "화단에 식물이 있는데 이걸 그냥 통과해버리네". An island is an ellipse bent along its length; the player is
 * stopped at the kerb by a row of small boxes under it (the collision world is axis-aligned boxes).
 */
import type { AABB } from "../collision";

/** x, z, angle in degrees, half length, half width, bow in metres */
export const PARK_ISLANDS: ReadonlyArray<readonly [number, number, number, number, number, number]> = Object.freeze([
  [11.7, -89, 90, 5.5, 1.55, -0.6], [-7.7, -82, 90, 4.4, 1.25, 0.5],
  [11.7, -66, 90, 4.8, 1.45, -0.75], [-7.7, -59, 90, 5.2, 1.4, 0.65],
  [11.7, -41, 90, 4.5, 1.3, -0.5], [-7.7, -37, 90, 4.2, 1.3, 0.45],
  [25, -85, 29, 6.8, 1.7, 0.8], [55, -85, -29, 6.8, 1.7, 0.8],
  [81, -102.5, 0, 5.8, 1.4, 0.7], [103, -102.5, 0, 5.2, 1.4, 0.5],
  [139, -102.5, 0, 6.1, 1.5, 0.7], [168, -102.5, 0, 5.4, 1.3, 0.6],
] as const);

/** A point of an island's outline: u along (-1..1), v across (-1..1). */
export function islandPoint(island: (typeof PARK_ISLANDS)[number], u: number, v: number): { x: number; z: number } {
  const [cx, cz, degrees, length, width, bow] = island;
  const yaw = (degrees * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const along = u * length;
  const across = (1 + 0.12 * u) * v * width + bow * (1 - u * u);
  return { x: cx + along * c - across * s, z: cz + along * s + across * c };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** The boxes under every island: slices 0.8 m long of the outline, each box the slice's own corners (kerb to kerb, 4 cm in). */
export function islandSolids(): AABB[] {
  const out: AABB[] = [];
  for (const island of PARK_ISLANDS) {
    const slices = Math.ceil((2 * island[3]) / 0.8);
    for (let k = 0; k < slices; k++) {
      const pts: Array<{ x: number; z: number }> = [];
      for (const u of [-1 + (2 * k) / slices, -1 + (2 * (k + 1)) / slices]) {
        // the slice's ends sit at the ellipse's own width there (sqrt(1 - u^2)), so the ends taper like the bed
        const w = Math.sqrt(Math.max(0, 1 - u * u));
        pts.push(islandPoint(island, u, -w), islandPoint(island, u, w));
      }
      // mid-slice width is the larger of the ends' (the widest part of the slice): keep to the narrower so a box never over-reaches
      const xs = pts.map((p) => p.x);
      const zs = pts.map((p) => p.z);
      const b = { minX: r2(Math.min(...xs) + 0.04), maxX: r2(Math.max(...xs) - 0.04), minZ: r2(Math.min(...zs) + 0.04), maxZ: r2(Math.max(...zs) - 0.04) };
      if (b.maxX > b.minX && b.maxZ > b.minZ) out.push(b);
    }
  }
  return out;
}
