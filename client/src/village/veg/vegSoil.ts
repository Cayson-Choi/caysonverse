import { LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, NoColorSpace, TextureLoader, type BufferGeometry, type Texture } from "three";
import { versionedUrl } from "../modelUrl";
import { PLAZA_BEDS, SPECIES, type Bed, type Plant } from "./flowerPlacement";
import { GeoBuilder } from "./vegGeometry";
import { valueNoise3 } from "./vegRandom";
import type { Vec3 } from "./vegLod";

/**
 * The beds' soil (veg3d, 2026-11-16 plants2; the owner on a plaza planter at night: "여기 화단에 흙들도 너무 엉성해
 * 실제와 비슷한 느낌이 나야지"). The village file's soil is one flat brown plane, and the first plants rebuild laid
 * flat bark-chip cut-outs on it that ran over the stone rims. Now every bed has a real soil surface of its own:
 *
 *  - its shape: a plaza bed's own outline (the round planters' soil inside the 1.3 m inner wall, the square granite
 *    planters' inside a new raised granite coping, the fountain's corner beds inside their stone edge), every other bed
 *    (house borders, the ring's verge strip, window boxes, the memorial's strips, the kiosk) the ground round its
 *    plants, with a soft natural edge (a signed field cut at its zero line, never a jagged grid);
 *  - its surface: a grid (8-9 cm) mounded toward the middle and uneven (noise), its top a few cm below the rim it sits
 *    in, never over it;
 *  - its look: one shared 1 m tile of pine-bark mulch on damp dark soil with a few pebbles, cherry petals and dry
 *    leaves (soil_c*.jpg, made from Poly Haven CC0 photos by docs/designs/plants2/tools/make_veg_textures.py) with its
 *    normal map, lit per pixel by the vegetation material;
 *  - contact shade (in the vertex colour): darker along the rim, round every plant's foot, round a tree's trunk and
 *    under a bush.
 * The bed plants stand on this surface (`soilHeight`): their feet go where the soil is.
 */

export const SOIL_TILE = 1.0; // m per texture repeat
const STEP_PLAZA = 0.08;
const STEP_BED = 0.09;
/** A bed plant covers this round it with soil (m); plants nearer than twice this share one bed. */
const COVER = 0.26;

/** The square planters' raised granite coping (m): its outer edge on the planter's, its width, its top. */
export const COPING = { outer: 1.1, inner: 0.97, bottom: 0.5, top: 0.6 } as const;

interface SoilShape {
  /** Signed distance (m) inside the bed's soil (positive inside). */
  sd(x: number, z: number): number;
  bbox: [number, number, number, number];
  floor: number;
  /** How high the middle is mounded (m) over its edge, and the edge's height over the floor. */
  mound: number;
  edge: number;
  /** A dark ring round the middle (a tree's trunk, a bush's foot): its radius (m), 0 for none. */
  heart: number;
  step: number;
  /** The plants on it (contact shade and light). */
  plants: Plant[];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function plazaShape(bed: Bed, plants: Plant[]): SoilShape {
  const floor = plants.length ? plants.reduce((a, p) => a + p.y, 0) / plants.length : 0;
  if (bed.kind === "ring") {
    const R = 1.27;
    return { sd: (x, z) => R - Math.hypot(x - bed.x, z - bed.z), bbox: [bed.x - R, bed.x + R, bed.z - R, bed.z + R], floor, mound: 0.028, edge: 0.006, heart: 0.42, step: STEP_PLAZA, plants };
  }
  if (bed.kind === "square") {
    const h = COPING.inner;
    return { sd: (x, z) => h - Math.max(Math.abs(x - bed.x), Math.abs(z - bed.z)), bbox: [bed.x - h, bed.x + h, bed.z - h, bed.z + h], floor, mound: 0.03, edge: 0.008, heart: 0.72, step: STEP_PLAZA, plants };
  }
  // the fountain's corner beds: inside the square edge, outside the basin's circle (soil 1-2 cm under the stone's top)
  const half = 5.88;
  const r0 = 6.1;
  return {
    sd: (x, z) => Math.min(half - Math.max(Math.abs(x), Math.abs(z)), Math.hypot(x, z) - r0),
    bbox: [-half, half, -half, half],
    floor,
    mound: 0.012,
    edge: 0.002,
    heart: 0,
    step: STEP_PLAZA,
    plants,
  };
}

/** Bed plants (not the meadow's wild flowers, not grass or reeds). */
const isBedPlant = (p: Plant) => !p.wild && p.species !== SPECIES.grass && p.species !== SPECIES.reed;

/** Which plaza bed a plant is on, or null. */
function plazaBedOf(p: Plant): Bed | null {
  for (const bed of PLAZA_BEDS) {
    if (bed.kind === "ring" && Math.hypot(p.x - bed.x, p.z - bed.z) < 1.4) return bed;
    if (bed.kind === "square" && Math.max(Math.abs(p.x - bed.x), Math.abs(p.z - bed.z)) < 1.15) return bed;
    if (bed.kind === "fountain" && Math.max(Math.abs(p.x), Math.abs(p.z)) < 6.1 && Math.hypot(p.x, p.z) > 5.9) return bed;
  }
  return null;
}

/** The other beds: the plants grouped into connected clumps (on one floor), each a bed round its plants. */
function clumps(plants: Plant[]): SoilShape[] {
  const cell = COVER * 2;
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number, y: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)},${Math.round(y / 0.25)}`;
  plants.forEach((p, i) => {
    const k = key(p.x, p.z, p.y);
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  });
  const seen = new Uint8Array(plants.length);
  const out: SoilShape[] = [];
  for (let i = 0; i < plants.length; i++) {
    if (seen[i]) continue;
    const group: Plant[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const p = plants[j]!;
      group.push(p);
      const gx = Math.floor(p.x / cell);
      const gz = Math.floor(p.z / cell);
      const gy = Math.round(p.y / 0.25);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const k of grid.get(`${gx + a},${gz + b},${gy}`) ?? []) {
            if (seen[k]) continue;
            const q = plants[k]!;
            if (Math.hypot(q.x - p.x, q.z - p.z) < COVER * 2 && Math.abs(q.y - p.y) < 0.15) {
              seen[k] = 1;
              stack.push(k);
            }
          }
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let floor = 0;
    for (const p of group) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
      floor += p.y;
    }
    floor /= group.length;
    // the field: the largest (cover - distance) over the plants (a union of discs, soft-edged by its zero line)
    // numeric cell keys and plain sqrt: this field is read a few hundred thousand times per village (perf/no-hitch: it was
    // the build's largest single cost on a slow phone, string keys and Math.hypot)
    const g2 = new Map<number, Plant[]>();
    const c2 = 0.3;
    const key2 = (gx: number, gz: number) => (gx + 32768) * 65536 + (gz + 32768);
    for (const p of group) {
      const k = key2(Math.floor(p.x / c2), Math.floor(p.z / c2));
      const l = g2.get(k);
      if (l) l.push(p);
      else g2.set(k, [p]);
    }
    const sd = (x: number, z: number) => {
      let best = -1;
      const gx = Math.floor(x / c2);
      const gz = Math.floor(z / c2);
      for (let a = -2; a <= 2; a++)
        for (let b = -2; b <= 2; b++) {
          const cell = g2.get(key2(gx + a, gz + b));
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            const p = cell[i]!;
            const dx = x - p.x;
            const dz = z - p.z;
            const v = COVER - Math.sqrt(dx * dx + dz * dz);
            if (v > best) best = v;
          }
        }
      // a little wobble on the edge (dug by hand)
      return best + 0.025 * (valueNoise3(x * 3.1, 0.5, z * 3.1, 77) - 0.5);
    };
    out.push({ sd, bbox: [x0 - COVER, x1 + COVER, z0 - COVER, z1 + COVER], floor, mound: 0.03, edge: 0.004, heart: 0, step: STEP_BED, plants: group });
  }
  return out;
}

/** One bed's soil mesh, or null when it has none. */
function soilMesh(b: GeoBuilder, s: SoilShape, centre: [number, number] | null): void {
  const [x0, x1, z0, z1] = s.bbox;
  const nx = Math.max(1, Math.ceil((x1 - x0) / s.step));
  const nz = Math.max(1, Math.ceil((z1 - z0) / s.step));
  // the plants near each vertex (contact shade): a coarse hash
  const ph = new Map<number, Plant[]>();
  const keyP = (gx: number, gz: number) => (gx + 32768) * 65536 + (gz + 32768);
  for (const p of s.plants) {
    const k = keyP(Math.floor(p.x / 0.2), Math.floor(p.z / 0.2));
    const l = ph.get(k);
    if (l) l.push(p);
    else ph.set(k, [p]);
  }
  const light = s.plants.length ? s.plants.reduce((a, p) => a + p.light, 0) / s.plants.length : 1;
  const ids: number[] = new Array((nx + 1) * (nz + 1)).fill(-1);
  const sds: number[] = new Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) sds[j * (nx + 1) + i] = s.sd(x0 + i * s.step, z0 + j * s.step);
  const vert = (i: number, j: number) => {
    const at = j * (nx + 1) + i;
    if (ids[at]! >= 0) return ids[at]!;
    const x = x0 + i * s.step;
    const z = z0 + j * s.step;
    const d = sds[at]!;
    const inside = smooth(0, 0.35, d);
    const bump = 0.007 * (valueNoise3(x * 6.5, 1.5, z * 6.5, 31) - 0.5) + 0.004 * (valueNoise3(x * 17, 3.5, z * 17, 37) - 0.5);
    const y = s.floor + s.edge + s.mound * inside + bump * smooth(0, 0.05, d);
    // the normal from the mound's slope (the surface's own; the texture's normal map adds the chips)
    const ddx = (s.sd(x + 0.03, z) - s.sd(x - 0.03, z)) / 0.06;
    const ddz = (s.sd(x, z + 0.03) - s.sd(x, z - 0.03)) / 0.06;
    const slope = (s.mound / 0.35) * (d > 0 && d < 0.35 ? 1.5 * (1 - (2 * d) / 0.35 + (d / 0.35) ** 2) * 1.0 : 0);
    const n: Vec3 = [-ddx * slope, 1, -ddz * slope];
    // contact shade: the rim, every plant's foot, the trunk or bush in the middle
    let ao = 0.58 + 0.42 * smooth(0.0, 0.14, d);
    let near = 9;
    const gx = Math.floor(x / 0.2);
    const gz = Math.floor(z / 0.2);
    for (let a = -1; a <= 1; a++)
      for (let c = -1; c <= 1; c++) {
        const cell = ph.get(keyP(gx + a, gz + c));
        if (!cell) continue;
        for (const p of cell) {
          const dx = x - p.x;
          const dz = z - p.z;
          near = Math.min(near, Math.sqrt(dx * dx + dz * dz) / Math.max(0.6, p.scale));
        }
      }
    ao *= 0.7 + 0.3 * smooth(0.02, 0.13, near);
    if (centre && s.heart > 0) ao *= 0.62 + 0.38 * smooth(s.heart * 0.45, s.heart, Math.hypot(x - centre[0], z - centre[1]));
    // alpha: the soft edge (0.5 on the zero line)
    const alpha = Math.max(0, Math.min(1, 0.5 + d / 0.03));
    b.tangent = [1, 0, 0];
    ids[at] = b.v([x, y, z], n, [ao, ao, ao, alpha], [x / SOIL_TILE, -z / SOIL_TILE], 0, light);
    return ids[at]!;
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = sds[j * (nx + 1) + i]!;
      const bb = sds[j * (nx + 1) + i + 1]!;
      const c = sds[(j + 1) * (nx + 1) + i]!;
      const d = sds[(j + 1) * (nx + 1) + i + 1]!;
      if (Math.max(a, bb, c, d) < -0.015) continue;
      const v00 = vert(i, j);
      const v10 = vert(i + 1, j);
      const v01 = vert(i, j + 1);
      const v11 = vert(i + 1, j + 1);
      b.tri(v00, v01, v11);
      b.tri(v00, v11, v10);
    }
}

/** The square planters' granite coping: a 13 cm wide, 10 cm high frame on the planter's top edge (bevelled top). */
function coping(b: GeoBuilder, cx: number, cz: number): void {
  const { outer: O, inner: I, bottom: y0, top: y1 } = COPING;
  const bev = 0.012;
  // each side as a ring of faces: outer wall, bevel, top, bevel, inner wall
  const ring: Array<[number, number, Vec3]> = [
    [O, y0, [1, 0, 0]],
    [O, y1 - bev, [1, 0, 0]],
    [O - bev, y1, [0.5, 1, 0]],
    [I + bev, y1, [-0.5, 1, 0]],
    [I, y1 - bev, [-1, 0, 0]],
    [I, y0 + 0.02, [-1, 0, 0]],
  ];
  const corners: Array<[number, number]> = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (let side = 0; side < 4; side++) {
    // side: from corner k to corner k+1, the profile's "outward" along that side's normal
    const [ax, az] = corners[side]!;
    const [bx, bz] = corners[(side + 1) % 4]!;
    const nx = ax === bx ? ax : 0;
    const nz = az === bz ? az : 0;
    const rows: number[][] = [];
    for (const [r, y, pn] of ring) {
      const row: number[] = [];
      for (const [kx, kz] of [
        [ax, az],
        [bx, bz],
      ] as const) {
        // the corner point at this profile radius (mitred)
        const px = cx + kx * r;
        const pz = cz + kz * r;
        const n: Vec3 = [nx * pn[0], pn[1], nz * pn[0]];
        const along = nx !== 0 ? pz : px;
        const up = y;
        // uv: along the side and up the stone (or across the top), 1.6 m a tile as the planter's own stone
        const u = along / 1.6;
        const v = (pn[1] > 0.4 ? (nx !== 0 ? px : pz) : up) / 1.6;
        b.tangent = nx !== 0 ? [0, 0, 1] : [1, 0, 0];
        row.push(b.v([px, y, pz], n, [0.78, 0.78, 0.78, 1], [u, v], 0, pn[1] > 0.4 ? 1 : 0.84));
      }
      rows.push(row);
    }
    for (let k = 0; k + 1 < rows.length; k++) {
      const [p0, p1] = rows[k]!;
      const [q0, q1] = rows[k + 1]!;
      b.tri(p0!, q0!, q1!);
      b.tri(p0!, q1!, p1!);
    }
  }
}

export interface Soil {
  /** The soil meshes (one per area of beds) and the coping of the square planters. */
  soil: Array<{ geo: BufferGeometry; centre: Vec3; radius: number }>;
  coping: BufferGeometry | null;
  /** The soil's height at (x, z) for a plant there (null: no soil under it). */
  heightAt(p: Plant): number | null;
  /** Soil triangles and beds (stats). */
  tris: number;
  beds: number;
}

/** Every bed's soil from the placed plants (pure: tested). */
export function buildSoil(plants: readonly Plant[]): Soil {
  const bedPlants = plants.filter(isBedPlant);
  const onPlaza = new Map<Bed, Plant[]>();
  const rest: Plant[] = [];
  for (const p of bedPlants) {
    const bed = plazaBedOf(p);
    if (bed) {
      const l = onPlaza.get(bed);
      if (l) l.push(p);
      else onPlaza.set(bed, [p]);
    } else rest.push(p);
  }
  const shapes: Array<{ s: SoilShape; centre: [number, number] | null }> = [];
  for (const bed of PLAZA_BEDS) {
    const ps = onPlaza.get(bed);
    if (!ps || !ps.length) continue;
    shapes.push({ s: plazaShape(bed, ps), centre: bed.kind === "fountain" || bed.kind === "box" ? null : [bed.x, bed.z] });
  }
  for (const s of clumps(rest)) shapes.push({ s, centre: null });
  // merge the beds' meshes per 16 m area (few draw calls, culled by area)
  const areas = new Map<string, { b: GeoBuilder; x0: number; x1: number; z0: number; z1: number; y: number }>();
  for (const { s, centre } of shapes) {
    const cx = (s.bbox[0] + s.bbox[1]) / 2;
    const cz = (s.bbox[2] + s.bbox[3]) / 2;
    const k = `${Math.floor(cx / 16)},${Math.floor(cz / 16)}`;
    let a = areas.get(k);
    if (!a) {
      const b = new GeoBuilder();
      b.surface = true;
      areas.set(k, (a = { b, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y: s.floor }));
    }
    soilMesh(a.b, s, centre);
    a.x0 = Math.min(a.x0, s.bbox[0]);
    a.x1 = Math.max(a.x1, s.bbox[1]);
    a.z0 = Math.min(a.z0, s.bbox[2]);
    a.z1 = Math.max(a.z1, s.bbox[3]);
  }
  let tris = 0;
  const soil: Soil["soil"] = [];
  for (const a of areas.values()) {
    if (!a.b.triangleCount) continue;
    tris += a.b.triangleCount;
    soil.push({ geo: a.b.build(), centre: [(a.x0 + a.x1) / 2, a.y, (a.z0 + a.z1) / 2], radius: Math.hypot(a.x1 - a.x0, a.z1 - a.z0) / 2 + 1 });
  }
  let copingGeo: BufferGeometry | null = null;
  const squares = PLAZA_BEDS.filter((b): b is Extract<Bed, { kind: "square" }> => b.kind === "square");
  if (squares.length) {
    const b = new GeoBuilder();
    b.surface = true;
    for (const sq of squares) coping(b, sq.x, sq.z);
    tris += b.triangleCount;
    copingGeo = b.build();
  }
  const heightAt = (p: Plant): number | null => {
    for (const { s } of shapes) {
      const [x0, x1, z0, z1] = s.bbox;
      if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1 || Math.abs(p.y - s.floor) > 0.2) continue;
      const d = s.sd(p.x, p.z);
      if (d < 0) continue;
      return s.floor + s.edge + s.mound * smooth(0, 0.35, d);
    }
    return null;
  };
  return { soil, coping: copingGeo, heightAt, tris, beds: shapes.length };
}

/** The soil tile and its normal map (async; `onLoad` once both are in). Nothing where there is no DOM (tests). */
export function soilTextures(low: boolean, onLoad: (map: Texture, normal: Texture) => void, name: "soil" | "stone" = "soil"): void {
  if (typeof document === "undefined") return;
  const loader = new TextureLoader();
  let map: Texture | null = null;
  let normal: Texture | null = null;
  const setup = (t: Texture, srgb: boolean) => {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 8;
    return t;
  };
  const done = () => map && normal && onLoad(map, normal);
  loader.load(versionedUrl(`/models/village/veg/${name}_c${low ? 512 : 1024}.jpg`), (t) => ((map = setup(t, true)), done()));
  loader.load(versionedUrl(`/models/village/veg/${name}_n${low ? 256 : 512}.jpg`), (t) => ((normal = setup(t, false)), done()));
}
