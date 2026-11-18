import { BufferGeometry, BufferAttribute, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type Material, type Mesh, type Object3D } from "three";
import { BARK_SURFACE, barkPhotos, barkTexture, flatNormal } from "../veg/barkGeometry";
import { makeCrownAtlas } from "../veg/leafAtlas";
import { treeGeo } from "../veg/treeKit";
import { vegMaterial } from "../veg/vegMaterial";

/**
 * The temple yard's four Korean red pines (소나무; owner audit 2026-11-18: "stacked flat untextured green plates"). The art file's
 * pines were a trunk (in the `LM_temple_rock` mesh) with 1300 triangles of flat green plates each (the whole `LM_temple_green`
 * detail mesh above 3.4 m is pine foliage). `cutOldPines` drops them from the loader's geometry (a copy with a new index: the cached
 * file is not touched) and `makeTemplePines` stands real pines in their place: a twisted red-brown scaly trunk (the village's bark
 * photo, `plates`, dyed red-brown), limbs with needle clouds (alpha cards, leafAtlas.ts) on every branch tip.
 */

/** Where the art file stood them (x, z; the boxes `col__lot_temple_pine_N`), their height (m) and turn. */
export const TEMPLE_PINES: ReadonlyArray<{ x: number; z: number; H: number; yaw: number; shape: number }> = [
  { x: -44.2, z: -27.0, H: 8.4, yaw: 0.4, shape: 0 },
  { x: -53.2, z: -27.5, H: 7.8, yaw: 2.1, shape: 1 },
  { x: -56.9, z: -47.0, H: 8.8, yaw: 4.0, shape: 1 },
  { x: -41.1, z: -45.6, H: 8.0, yaw: 5.2, shape: 0 },
];
/** The pine foliage and trunk are found within this distance (m) of a pine's place. */
const CUT_R = 2.7;
/** Foliage above this height (m) in the green mesh is pine (the rest of that material is the yard's low plants). */
const FOLIAGE_Y = 3.4;

function wasPine(material: string, x: number, y: number, z: number): boolean {
  if (material === "LM_temple_green") return y > FOLIAGE_Y;
  if (material === "LM_temple_rock") return TEMPLE_PINES.some((p) => Math.hypot(p.x - x, p.z - z) < CUT_R);
  return false;
}

/**
 * A copy of `mesh`'s geometry (the same attributes, a new index) without the triangles that were pine. Returns the new geometry
 * (the caller disposes it), or null when nothing was cut. World coordinates (the lots' meshes are placed in the world).
 */
export function cutOldPines(mesh: Mesh): BufferGeometry | null {
  const mat = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
  if (mat.name !== "LM_temple_green" && mat.name !== "LM_temple_rock") return null;
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const idx = g.index;
  if (!idx) return null;
  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements;
  const v = new Vector3();
  const keep: number[] = [];
  const a = idx.array;
  for (let t = 0; t + 2 < idx.count; t += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, a[t + k]!);
      cx += e[0]! * v.x + e[4]! * v.y + e[8]! * v.z + e[12]!;
      cy += e[1]! * v.x + e[5]! * v.y + e[9]! * v.z + e[13]!;
      cz += e[2]! * v.x + e[6]! * v.y + e[10]! * v.z + e[14]!;
    }
    if (!wasPine(mat.name, cx / 3, cy / 3, cz / 3)) keep.push(a[t]!, a[t + 1]!, a[t + 2]!);
  }
  if (keep.length === idx.count) return null;
  const out = new BufferGeometry();
  for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.getAttribute(name));
  out.setIndex(new BufferAttribute(pos.count > 65535 ? new Uint32Array(keep) : new Uint16Array(keep), 1));
  out.computeBoundingSphere();
  return out;
}

export interface TemplePines {
  group: Group;
  geometries: BufferGeometry[];
  /** Materials and textures made here (all with `dispose`). */
  disposables: Array<{ dispose(): void }>;
}

/** Four pines standing on y = `groundY` at the yard's pine places. Null where there is no DOM (tests). */
export function makeTemplePines(groundY: number, low: boolean): TemplePines | null {
  const crown = makeCrownAtlas();
  if (!crown) return null;
  const group = new Group();
  group.name = "temple_pines";
  const geometries: BufferGeometry[] = [];
  const disposables: Array<{ dispose(): void }> = [crown];
  const map = barkTexture("plates");
  const normal = flatNormal();
  const surf = BARK_SURFACE.plates;
  const bark: Material = vegMaterial({ name: "M_temple_pine_bark", map, normalMap: normal, normalScale: surf.normal + 0.2, gloss: surf.gloss, moss: false, wind: 0, windFar: 1, ambient: 0.55, sky: 0.2, sun: 0.45, back: 0.2 });
  const needles: Material = vegMaterial({ name: "M_temple_pine_needles", map: crown, alphaTest: 0.5, push: true, wind: 0.035, windFar: low ? 12 : 30, ambient: 0.46, sky: 0.2, sun: 0.4, back: 0.4 });
  disposables.push(map, normal, bark, needles);
  barkPhotos("plates", low, (photo, photoNormal) => {
    (bark as unknown as { map: unknown }).map = photo;
    (bark.userData.vegUniforms as { uVegNormal: { value: unknown } }).uVegNormal.value = photoNormal;
    bark.needsUpdate = true;
    disposables.push(photo, photoNormal);
  });
  const nominal = 9;
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  for (let shape = 0; shape < 2; shape++) {
    const spots = TEMPLE_PINES.filter((t) => t.shape === shape);
    if (!spots.length) continue;
    const geo = treeGeo("pine", 11 + shape * 5, { lod: 0, low });
    geometries.push(geo.bark, geo.leaves);
    for (const [g, m, name] of [
      [geo.bark, bark, "bark"],
      [geo.leaves, needles, "needles"],
    ] as const) {
      const mesh = new InstancedMesh(g, m, spots.length);
      mesh.name = `temple_pine_${shape}_${name}`;
      mesh.matrixAutoUpdate = false;
      spots.forEach((t, i) => {
        const k = t.H / nominal;
        p.set(t.x, groundY, t.z);
        q.setFromAxisAngle(new Vector3(0, 1, 0), t.yaw);
        s.set(k, k, k);
        mesh.setMatrixAt(i, new Matrix4().compose(p, q, s));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return { group, geometries, disposables };
}

/** Where the old pines' trunks touched the ground: the lowest vertices of `LM_temple_rock` near a pine place (else `fallback`). */
export function pineGroundY(root: Object3D, fallback = 0): number {
  let y = Infinity;
  const v = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (mat?.name !== "LM_temple_rock") return;
    const pos = mesh.geometry.getAttribute("position");
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (TEMPLE_PINES.some((t) => Math.hypot(t.x - v.x, t.z - v.z) < 0.6)) y = Math.min(y, v.y);
    }
  });
  return Number.isFinite(y) ? Math.max(-0.2, Math.min(0.4, y)) : fallback;
}
