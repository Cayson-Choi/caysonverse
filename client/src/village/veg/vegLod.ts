/**
 * Distance levels (LOD) and cells for the runtime vegetation (veg3d). Pure: unit-tested.
 *
 * Instanced meshes have no per-instance culling or LOD in three, so the vegetation is cut into cells (flowers: 8 m
 * squares; cherries: one cell per tree), each cell gets a level from the camera's distance to its bounding sphere
 * (with a hysteresis band so a cell standing on a boundary does not flicker), and each level's instanced mesh is
 * refilled with the cells of that level only when the set of (cell, level) pairs changes.
 */

export type Vec3 = [number, number, number];

/** Levels by distance: level i is used up to `far[i]` metres; past the last one the cell is not drawn. */
export interface LodBands {
  /** Upper distance of each level, increasing. A negative entry is a level this tier never uses. */
  far: readonly number[];
  /** Metres a cell must move past a boundary before it changes level. */
  hysteresis: number;
}

/** The level for distance `d` (levels 0..far.length-1; far.length = hidden), keeping `prev` within the hysteresis. */
export function chooseLod(prev: number, d: number, bands: LodBands): number {
  const n = bands.far.length;
  let fresh = n;
  for (let i = 0; i < n; i++) {
    if (d <= bands.far[i]!) {
      fresh = i;
      break;
    }
  }
  if (prev < 0 || prev > n || fresh === prev) return fresh;
  // the band [lower, upper] of the previous level
  let lower = -Infinity;
  for (let i = prev - 1; i >= 0; i--) {
    if (bands.far[i]! >= 0) {
      lower = bands.far[i]!;
      break;
    }
  }
  const upper = prev < n ? bands.far[prev]! : Infinity;
  if (upper < 0) return fresh; // a level this tier never uses
  if (d >= lower - bands.hysteresis && d <= upper + bands.hysteresis) return prev;
  return fresh;
}

/** A bounding sphere. */
export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** Distance from a point to a sphere's surface (0 inside). */
export function sphereDistance(px: number, py: number, pz: number, s: Sphere): number {
  return Math.max(0, Math.hypot(px - s.x, py - s.y, pz - s.z) - s.r);
}

export interface Cell<T> {
  key: string;
  items: T[];
  bounds: Sphere;
}

/** Group items into square cells of `size` metres (by x, z), each with a bounding sphere padded by `pad`. */
export function groupIntoCells<T extends { x: number; y: number; z: number }>(items: readonly T[], size: number, pad = 0.5): Cell<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = `${Math.floor(it.x / size)},${Math.floor(it.z / size)}`;
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(it);
  }
  const cells: Cell<T>[] = [];
  for (const [key, list] of map) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const it of list) {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      minZ = Math.min(minZ, it.z);
      maxX = Math.max(maxX, it.x);
      maxY = Math.max(maxY, it.y);
      maxZ = Math.max(maxZ, it.z);
    }
    const x = (minX + maxX) / 2;
    const y = (minY + maxY) / 2;
    const z = (minZ + maxZ) / 2;
    let r = 0;
    for (const it of list) r = Math.max(r, Math.hypot(it.x - x, it.y - y, it.z - z));
    cells.push({ key, items: list, bounds: { x, y, z, r: r + pad } });
  }
  // a fixed order (by key) so refills are deterministic
  cells.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return cells;
}

/** Whether an item with hash `seed` in [0, 1) survives thinning to `fraction` of the items. */
export function keepThinned(seed: number, fraction: number): boolean {
  return seed < fraction;
}

/** The distance levels per tier. Flowers: 0 = full plants, 1 = simple plants, 2 = simple plants thinned and enlarged. */
export interface VegTierConfig {
  flowers: LodBands & { thin: number; thinScale: number; /** share of plants drawn at level 1 */ mid: number };
  cherry: LodBands & { thin: number; thinScale: number };
  /** Leafy crowns (broadleaf and willow): full leaf sprays, simple sprays, far thinned and enlarged. */
  green: LodBands & { thin: number; thinScale: number };
  /** Bushes: full sprigs, simple sprigs, the heart and a few leaves. */
  bush: LodBands;
  /** Wind on (rich) or only on the nearest level (light). */
  windFar: boolean;
}

export const VEG_TIERS: Readonly<Record<"high" | "low", VegTierConfig>> = {
  high: {
    flowers: { far: [10, 34, 110], hysteresis: 1.5, thin: 0.34, thinScale: 1.45, mid: 1 },
    cherry: { far: [9, 55, 600], hysteresis: 2, thin: 0.55, thinScale: 1.3 },
    green: { far: [14, 60, 700], hysteresis: 2, thin: 0.42, thinScale: 1.35 },
    bush: { far: [12, 45, 400], hysteresis: 1.5 },
    windFar: true,
  },
  low: {
    // phones: the full plants only right at the player's feet, the simple ones at half density, then sparse
    flowers: { far: [5, 18, 55], hysteresis: 1.5, thin: 0.2, thinScale: 1.7, mid: 0.5 },
    // the full blossom clusters and leaf sprays only right round the camera (never a flat sprite or a folded sliver
    // within a few metres), the bunch sprites and simple sprays beyond, half of them past 30 m
    cherry: { far: [6, 30, 600], hysteresis: 2, thin: 0.5, thinScale: 1.35 },
    green: { far: [7, 32, 600], hysteresis: 2, thin: 0.34, thinScale: 1.45 },
    bush: { far: [6, 24, 300], hysteresis: 1.5 },
    windFar: false,
  },
};
