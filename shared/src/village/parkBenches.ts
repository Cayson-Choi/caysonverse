/**
 * Caysonland's slatted benches along the promenade and the avenue (x, z, yaw), shared by the drawing (client land/ParkBenches.tsx)
 * and the collision (parkArea.ts): owner 2026-11-21: "의자도 통과해버리네". A bench is 2 m long (local z) and 0.7 m deep.
 */
import type { AABB } from "../collision";

export const PARK_BENCHES: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let z = -170; z <= -140; z += 10) out.push([34, z, Math.PI], [46, z, 0]);
  for (let x = 90; x <= 330; x += 30) out.push([x, -108.2, 0]);
  return out;
})();

/** A bench's box (the yaws are 0 or PI, so it stays axis-aligned): 0.72 m across the grain, 2 m along it. */
export function parkBenchSolids(): AABB[] {
  return PARK_BENCHES.map(([x, z]) => ({ minX: x - 0.36, maxX: x + 0.36, minZ: z - 1, maxZ: z + 1 }));
}

/**
 * What sitting on one needs of its model (client land/ParkBenches.tsx buildBench): four seat slats whose top is 0.496 m up, their front
 * edge 0.2985 m from the centre on the bench local -x (the side a sitter faces), the lowest slat of the backrest 0.19 m behind the
 * centre. The cast-iron arm frames stand 0.76 m either side of the middle.
 */
export const PARK_BENCH_MODEL = { seatTop: 0.496, frontEdge: 0.2985, backFace: 0.19, length: 2 } as const;

/** The way a sitter on a bench drawn with `yaw` faces (game yaw, atan2(x, z)): the bench local -x. */
export function parkBenchFacing(yaw: number): number {
  return Math.atan2(-Math.cos(yaw), Math.sin(yaw));
}
