/**
 * Where the skyline stands (2026-11-19): the park in its own metres, scaled by SKYLINE_SCALE and put behind the village's south gate, on a
 * plane fitted to the outer ground (outerGround.ts) so the whole park follows the land's gentle rise away from the village.
 *
 *   world x = OX + s * x_park          (the park gate's centre, park x 40, lines up with the village gate lot, world x -24)
 *   world z = OZ + s * z_park          (the park gate stands GATE_WORLD_Z, just beyond the village gate's back (z 104, lotsPrep LOT_GATE_BACK_Z))
 *   world y = OY + s * y_park + cx * (x - OX) + cz * (z - OZ)     (a shear: verticals stay vertical, the ground plane tilts with the hill)
 *
 * `groundLocal(x, z)` answers, in park metres, how far the real ground at that spot is above the skyline's y = 0 reference (negative: below),
 * so footings and decals follow the actual ground. The reference plane lies 0.3 m under the fitted plane: bases are buried, not floating.
 * Pure maths, no three.js object but the matrix elements.
 */
import { SKYLINE_SCALE, GATE, type GroundLocal } from "./skylineGeometry";

/** The village gate lot's centre (villageLots GATE) and the world z the park's gate stands at. */
export const VILLAGE_GATE_X = -24;
export const GATE_WORLD_Z = 106;
/** How far under the fitted ground plane the reference plane sits (m). */
export const SINK_M = 0.3;

export const OX = VILLAGE_GATE_X - GATE.x * SKYLINE_SCALE;
export const OZ = GATE_WORLD_Z - GATE.z * SKYLINE_SCALE;

export interface SkylinePlacement {
  /** Row-major 4x4 (Matrix4.set order). */
  elements: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  groundLocal: GroundLocal;
  /** The fitted plane: y = c0 + cx * x + cz * z (world). */
  plane: { c0: number; cx: number; cz: number };
  /** World bounds of the park's footprint (for tests and the walk-bounds check). */
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Park-local rectangle the skyline covers: from the gate to the coaster's far side. */
export const PARK_EXTENT = Object.freeze({ minX: -130, maxX: 360, minZ: -196, maxZ: 70 });

export function skylinePlacement(heightAt: (x: number, z: number) => number): SkylinePlacement {
  const s = SKYLINE_SCALE;
  // least squares of h = c0 + cx x + cz z over the footprint (the 3x3 normal equations)
  let n = 0;
  let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  for (let px = PARK_EXTENT.minX; px <= PARK_EXTENT.maxX; px += 30) {
    for (let pz = PARK_EXTENT.minZ; pz <= PARK_EXTENT.maxZ; pz += 26) {
      const x = OX + px * s;
      const z = OZ + pz * s;
      const h = heightAt(x, z);
      if (!Number.isFinite(h)) continue;
      n++;
      sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h;
    }
  }
  let c0 = 0, cx = 0, cz = 0;
  if (n >= 3) {
    // solve [[n sx sz][sx sxx sxz][sz sxz szz]] [c0 cx cz] = [sh sxh szh] by Cramer's rule
    const det = (a: number[]) => a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!) - a[1]! * (a[3]! * a[8]! - a[5]! * a[6]!) + a[2]! * (a[3]! * a[7]! - a[4]! * a[6]!);
    const A = [n, sx, sz, sx, sxx, sxz, sz, sxz, szz];
    const d = det(A);
    if (Math.abs(d) > 1e-9) {
      c0 = det([sh, sx, sz, sxh, sxx, sxz, szh, sxz, szz]) / d;
      cx = det([n, sh, sz, sx, sxh, sxz, sz, szh, szz]) / d;
      cz = det([n, sx, sh, sx, sxx, sxh, sz, sxz, szh]) / d;
    }
  }
  const OY = c0 + cx * OX + cz * OZ - SINK_M;
  const elements: SkylinePlacement["elements"] = [s, 0, 0, OX, cx * s, s, cz * s, OY, 0, 0, s, OZ, 0, 0, 0, 1];
  const groundLocal: GroundLocal = (px, pz) => {
    const h = heightAt(OX + px * s, OZ + pz * s);
    if (!Number.isFinite(h)) return 0;
    return (h - (OY + cx * s * px + cz * s * pz)) / s;
  };
  return {
    elements,
    groundLocal,
    plane: { c0, cx, cz },
    worldBounds: { minX: OX + PARK_EXTENT.minX * s, maxX: OX + PARK_EXTENT.maxX * s, minZ: OZ + PARK_EXTENT.minZ * s, maxZ: OZ + PARK_EXTENT.maxZ * s },
  };
}

/**
 * The village's far forest stands behind the gate (the ridge-side tree belt, mountains.ts cutFarBackdrop); inside the park's footprint it is
 * cut away (the park's own trees stand there) so the coaster and the wheel are seen, not hidden behind a wall of leaves. World metres.
 */
export const FOREST_CLEAR = Object.freeze({
  minX: OX + PARK_EXTENT.minX * SKYLINE_SCALE - 8,
  maxX: OX + PARK_EXTENT.maxX * SKYLINE_SCALE + 8,
  minZ: 98,
  maxZ: OZ + PARK_EXTENT.maxZ * SKYLINE_SCALE + 6,
});
export const skylineClearsForest = (x: number, z: number): boolean => x > FOREST_CLEAR.minX && x < FOREST_CLEAR.maxX && z > FOREST_CLEAR.minZ && z < FOREST_CLEAR.maxZ;

/** Dev switch: `?skyline=off` draws no skyline (and keeps the far forest): the before / after shots. */
export function skylineMode(): "on" | "off" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "on";
  return new URLSearchParams(location.search).get("skyline") === "off" ? "off" : "on";
}
