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

/** Whether (x, z) lies on an island's bed, `inset` m inside its outline (the kerb's own width). */
export function onIsland(island: (typeof PARK_ISLANDS)[number], x: number, z: number, inset = 0): boolean {
  const [cx, cz, degrees, length, width, bow] = island;
  const yaw = (degrees * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = x - cx;
  const dz = z - cz;
  const along = dx * c + dz * s;
  const across = -dx * s + dz * c;
  const u = along / (length - inset);
  if (Math.abs(u) >= 1) return false;
  const half = (1 + 0.12 * u) * (width - inset) * Math.sqrt(1 - u * u);
  return Math.abs(across - bow * (1 - u * u)) <= half;
}

/** Rows this deep (m) and cells this wide make an island's boxes. */
const ROW = 0.4;
const CELL = 0.1;

/**
 * The boxes under every island: the bed cut into rows 0.4 m deep, each row one box per run of bed (the outline is followed to 10 cm
 * along a row, so the turned islands by the plaza get no box corner standing out on the lawn). The kerb's outer 4 cm are left free.
 */
export function islandSolids(): AABB[] {
  const out: AABB[] = [];
  for (const island of PARK_ISLANDS) {
    const reach = island[3] + island[4] + Math.abs(island[5]) + 0.5;
    const z0 = Math.floor((island[1] - reach) / ROW) * ROW;
    for (let z = z0; z < island[1] + reach; z += ROW) {
      let start: number | null = null;
      for (let x = island[0] - reach; x <= island[0] + reach + CELL; x += CELL) {
        // a cell is bed when the row's two edges and its middle are (the tapering ends stay inside the outline)
        const inside = onIsland(island, x, z + ROW / 2, 0.04) && (onIsland(island, x, z + 0.02, 0.04) || onIsland(island, x, z + ROW - 0.02, 0.04));
        if (inside && start === null) start = x;
        if (!inside && start !== null) {
          if (x - CELL - start >= 0.2) out.push({ minX: r2(start), maxX: r2(x - CELL), minZ: r2(z), maxZ: r2(z + ROW) });
          start = null;
        }
      }
    }
  }
  return out;
}
