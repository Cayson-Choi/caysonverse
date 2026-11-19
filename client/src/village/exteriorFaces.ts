/**
 * 외관 마감 (exterior dress, 2026-11-18 audit): village.glb bakes some buildings' parts as flat colour swatches (the memorial's black
 * plant-room and plinth, its grey roof slab and white parapet, the cafe's parasols, the pavilion's black roof, the plaza trees' plastic
 * brown seats). This module finds those faces by material, place and swatch, takes them out of the village clone and gives them a real
 * surface: a CC0 library set (pbr/pbrLibrary.ts) on a lit material with the live sun's shadows (the houses' recipe, housesPrep.ts
 * `patchHouseLight`), UVs in metres so nothing stretches. The pure part (selection, splitting, UVs, materials' numbers) is here and
 * unit-tested; ExteriorDress.tsx loads the sets and drives it.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, Mesh, Vector3, type Object3D } from "three";

/** A triangle as a rule's test sees it (world space; uv, colour and normal of the first corner). */
export interface TriView {
  cx: number;
  cy: number;
  cz: number;
  /** Unit face normal (world). */
  nx: number;
  ny: number;
  nz: number;
  area: number;
  u: number;
  v: number;
  /** Vertex colour of the first corner (linear), or null when the mesh has none. */
  color: readonly [number, number, number] | null;
}

export type DressBox = readonly [number, number, number, number, number, number];

/** How the faces' UVs are made: the file's own UVs scaled (`keep`, `unit` = metres per UV unit), or planar from the face's own plane (`box`). */
export type UvMode = { mode: "keep"; unit: number } | { mode: "box" };

export interface FaceRule {
  id: string;
  /** Source material name in village.glb (`LM_atlas`). */
  material: string;
  /** Only meshes whose name matches (a village cell). */
  mesh?: RegExp;
  /** World box: the face's centroid must be inside (minX, minY, minZ, maxX, maxY, maxZ). */
  box: DressBox;
  test?: (t: TriView) => boolean;
  surface: string;
}

export interface SurfaceSpec {
  /** Library set id (pbr/pbrLibrary.ts); null for a canvas-made one. */
  pbr: string | null;
  uv: UvMode;
  /** Albedo multiplier (linear; below 1 keeps white from blowing out under the bloom). */
  tint: readonly [number, number, number];
  normalStrength: number;
  /** Multiplies the set's roughness (the ORM's G). */
  roughness: number;
  metalness: number;
  doubleSided?: boolean;
}

const near = (a: number, b: number, e = 0.006): boolean => Math.abs(a - b) <= e;

/** The atlas swatch of a flat black (windows' frames, plinths, plant rooms): the cell of `T_atlas` at (0.352, 0.508). */
export const SWATCH_BLACK = { u: 0.352, v: 0.508 } as const;

/** The memorial's footprint on the village plan (x, z) with its roof's height: the faces of the building and its roof deck. */
export const MEMORIAL_BOX: DressBox = [-14, -0.2, -70, 14, 12, -44];

/** The faces to re-skin, by place. Each is selected from the village clone's own meshes; the rest of each mesh is untouched. */
export const DRESS_RULES: readonly FaceRule[] = Object.freeze([
  // the memorial's roof deck: two huge triangles of flat grey -> real ballast gravel
  { id: "memorial-roof-deck", material: "LM_concrete", box: [-14, 5.2, -70, 14, 5.9, -44], test: (t) => t.ny > 0.9, surface: "ballast" },
  // the plant room on the roof (black swatch above the deck) -> standing-seam metal cladding
  { id: "memorial-plant-room", material: "LM_atlas", box: [-14, 5.9, -70, 14, 9, -44], test: (t) => near(t.u, SWATCH_BLACK.u) && near(t.v, SWATCH_BLACK.v), surface: "seam" },
  // the black slab at the foot of the east slats -> dark flamed granite plinth
  { id: "memorial-plinth", material: "LM_atlas", box: [3, -0.1, -52.8, 10.6, 1.7, -50.4], test: (t) => near(t.u, SWATCH_BLACK.u) && near(t.v, SWATCH_BLACK.v), surface: "granite" },
  // the walls, the canopy and the parapet cap: white render that bloomed -> lit lime render at a calmer albedo
  { id: "memorial-render", material: "LM_render", box: MEMORIAL_BOX, surface: "render" },
  // the cafe's parasols: the red and white atlas cells of the baked canopy
  { id: "cafe-parasols", material: "LM_atlas", mesh: /^village_lm_/, box: [36, 2.4, -24, 46, 4.6, -6], test: (t) => near(t.v, 0.363) && (near(t.u, 0.794) || near(t.u, 0.856)), surface: "parasol" },
  // the Korean pavilion's black roof (vertex colour 0.1): the hanok's dark grey tiles
  { id: "pavilion-roof", material: "LM_roof", box: [-24, 2, 54, -10, 6.4, 67], surface: "giwa" },
  // the plaza trees' seats: saturated brown plastic -> natural oak boards
  { id: "plaza-tree-seats", material: "LM_wood", box: [-40, -0.1, -40, 40, 1.0, 40], test: (t) => !!t.color && t.color[0] > 0.42 && t.color[0] < 0.68 && t.color[1] > 0.22 && t.color[1] < 0.38 && t.color[2] < 0.26, surface: "oak" },
]);

export const SURFACES: Readonly<Record<string, SurfaceSpec>> = Object.freeze({
  ballast: { pbr: "gravel", uv: { mode: "box" }, tint: [1.7, 1.68, 1.62], normalStrength: 1, roughness: 1, metalness: 0 },
  seam: { pbr: "metal_roof_seam", uv: { mode: "box" }, tint: [3.4, 3.6, 3.9], normalStrength: 1, roughness: 1, metalness: 0.3 },
  granite: { pbr: "granite_flamed", uv: { mode: "box" }, tint: [0.3, 0.31, 0.34], normalStrength: 1, roughness: 1, metalness: 0 },
  render: { pbr: "stucco_white", uv: { mode: "keep", unit: 1 }, tint: [1.02, 0.98, 0.92], normalStrength: 1.2, roughness: 1, metalness: 0 },
  parasol: { pbr: null, uv: { mode: "box" }, tint: [0.88, 0.88, 0.88], normalStrength: 1, roughness: 0.9, metalness: 0, doubleSided: true },
  giwa: { pbr: "roof_giwa", uv: { mode: "keep", unit: 2 }, tint: [4.6, 4.6, 4.8], normalStrength: 1.2, roughness: 1, metalness: 0, doubleSided: true },
  oak: { pbr: "wood_oak", uv: { mode: "box" }, tint: [1.05, 0.9, 0.7], normalStrength: 1, roughness: 1, metalness: 0 },
});

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();

/** The triangle indices (first-corner index offsets into the index, or the vertex order when unindexed) a rule picks in a mesh. */
export function selectFaces(mesh: Mesh, rule: FaceRule): number[] {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  if (!pos) return [];
  const idx = g.index;
  const uv = g.getAttribute("uv");
  const col = g.getAttribute("color");
  const m = mesh.matrixWorld;
  const total = idx ? idx.count : pos.count;
  const out: number[] = [];
  const [x0, y0, z0, x1, y1, z1] = rule.box;
  for (let t = 0; t + 2 < total; t += 3) {
    const ia = idx ? idx.getX(t) : t;
    const ib = idx ? idx.getX(t + 1) : t + 1;
    const ic = idx ? idx.getX(t + 2) : t + 2;
    _a.fromBufferAttribute(pos, ia).applyMatrix4(m);
    _b.fromBufferAttribute(pos, ib).applyMatrix4(m);
    _c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    const cx = (_a.x + _b.x + _c.x) / 3;
    const cy = (_a.y + _b.y + _c.y) / 3;
    const cz = (_a.z + _b.z + _c.z) / 3;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1 || cz < z0 || cz > z1) continue;
    if (rule.test) {
      _n.subVectors(_b, _a).cross(_c.clone().sub(_a));
      const len = _n.length() || 1;
      const tri: TriView = {
        cx,
        cy,
        cz,
        nx: _n.x / len,
        ny: _n.y / len,
        nz: _n.z / len,
        area: len / 2,
        u: uv ? uv.getX(ia) : 0,
        v: uv ? uv.getY(ia) : 0,
        color: col ? [col.getX(ia), col.getY(ia), col.getZ(ia)] : null,
      };
      if (!rule.test(tri)) continue;
    }
    out.push(t);
  }
  return out;
}

/** A mesh's geometry without the triangles at `taken` (an index buffer rebuilt; the attributes are shared). */
export function geometryWithout(geometry: BufferGeometry, taken: ReadonlySet<number>): BufferGeometry {
  const idx = geometry.index;
  const pos = geometry.getAttribute("position");
  const total = idx ? idx.count : pos.count;
  const keep: number[] = [];
  for (let t = 0; t + 2 < total; t += 3) {
    if (taken.has(t)) continue;
    keep.push(idx ? idx.getX(t) : t, idx ? idx.getX(t + 1) : t + 1, idx ? idx.getX(t + 2) : t + 2);
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) out.setAttribute(name, geometry.getAttribute(name));
  out.setIndex(keep);
  out.boundingBox = geometry.boundingBox?.clone() ?? null;
  out.boundingSphere = geometry.boundingSphere?.clone() ?? null;
  return out;
}

/** Planar UV (metres / tile) of a world point and normal: the dominant axis' plane. */
export function boxUv(x: number, y: number, z: number, nx: number, ny: number, nz: number, tile: number): [number, number] {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [x / tile, z / tile];
  if (ax >= az) return [z / tile, y / tile];
  return [x / tile, y / tile];
}

export interface TakenFaces {
  /** Unindexed, world-space geometry of the triangles (position, normal, uv). */
  geometry: BufferGeometry;
  triangles: number;
}

/** The faces at `taken` in world space with the surface's UVs. `tile` is the set's tile size in metres. */
export function takeFaces(mesh: Mesh, taken: readonly number[], uvMode: UvMode, tile: number): TakenFaces {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  const idx = g.index;
  const m = mesh.matrixWorld;
  const nm = new Matrix3().getNormalMatrix(m as Matrix4);
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const v3 = [new Vector3(), new Vector3(), new Vector3()];
  const n3 = [new Vector3(), new Vector3(), new Vector3()];
  for (const t of taken) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
    ids.forEach((i, k) => {
      v3[k]!.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (nor) n3[k]!.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    });
    const face = new Vector3().subVectors(v3[1]!, v3[0]!).cross(new Vector3().subVectors(v3[2]!, v3[0]!)).normalize();
    for (let k = 0; k < 3; k++) {
      const p = v3[k]!;
      const n = nor ? n3[k]! : face;
      P.push(p.x, p.y, p.z);
      N.push(n.x, n.y, n.z);
      if (uvMode.mode === "keep") {
        const s = uvMode.unit / tile;
        U.push((uv ? uv.getX(ids[k]!) : 0) * s, (uv ? uv.getY(ids[k]!) : 0) * s);
      } else {
        const [u, v] = boxUv(p.x, p.y, p.z, face.x, face.y, face.z, tile);
        U.push(u, v);
      }
    }
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(P, 3));
  out.setAttribute("normal", new Float32BufferAttribute(N, 3));
  out.setAttribute("uv", new Float32BufferAttribute(U, 2));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return { geometry: out, triangles: taken.length };
}

export interface FaceSplit {
  rule: FaceRule;
  mesh: Mesh;
  original: BufferGeometry;
  trimmed: BufferGeometry;
  taken: number[];
}

/** Every (mesh, rule) pair of the root with at least one face to take. Only meshes whose first material is the rule's. */
export function findSplits(root: Object3D, rules: readonly FaceRule[] = DRESS_RULES): FaceSplit[] {
  root.updateWorldMatrix(true, true);
  const out: FaceSplit[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat) return;
    for (const rule of rules) {
      if (mat.name !== rule.material) continue;
      if (rule.mesh && !rule.mesh.test(mesh.name)) continue;
      const taken = selectFaces(mesh, rule);
      if (taken.length) out.push({ rule, mesh, original: mesh.geometry, trimmed: mesh.geometry, taken });
    }
  });
  return out;
}
