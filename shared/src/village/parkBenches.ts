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
