import { BufferGeometry, BufferAttribute, ClampToEdgeWrapping, Group, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, NoColorSpace, Quaternion, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Material, type Mesh, type Object3D, type Texture } from "three";
import { flatNormal } from "../veg/barkGeometry";
import { PINE_FILES, PINE_VARIANTS, pineGeo, type PineOptions } from "../veg/pineKit";
import { vegMaterial } from "../veg/vegMaterial";
import { versionedUrl } from "../modelUrl";

/**
 * The temple yard's four Korean red pines (소나무). The art file's pines were a trunk (in the `LM_temple_rock` mesh) with 1300
 * triangles of flat green plates each (the whole `LM_temple_green` detail mesh above 3.4 m is pine foliage). `cutOldPines` drops them
 * from the loader's geometry (a copy with a new index: the cached file is not touched) and `makeTemplePines` stands real pines in their
 * place (veg/pineKit.ts, owner 2026-11-21 "실제같은 느낌이 나도록"): leaning, bending trunks with the grey fissured foot and the orange
 * flaky upper bark, few irregular limbs, the needles in flat layered pads, three shapes, each pine leaning toward the yard (or the pond).
 */

/**
 * Where the art file stood them (x, z; the boxes `col__lot_temple_pine_N`), their height (m) and shape (pineKit's variant; the
 * upright compact one by the hall's corner, where the roof leaves the least room).
 */
export const TEMPLE_PINES: ReadonlyArray<{ x: number; z: number; H: number; shape: number }> = [
  { x: -44.2, z: -27.0, H: 8.4, shape: 0 },
  { x: -53.2, z: -27.5, H: 7.8, shape: 0 },
  { x: -56.9, z: -47.0, H: 8.8, shape: 2 },
  { x: -41.1, z: -45.6, H: 8.0, shape: 1 },
];
/**
 * Where each pine's trunk leans (x, z): the yard's middle, the pond's pine over its pond, the pine at the hall's south-east corner
 * along the south wall (away from the hall's eaves, 2026-11-27). A pine model leans toward its own +x; turning it by `atan2(-dz, dx)`
 * aims it. The trunk's foot stays at the pine's place (its collision box); the crown sits over the foot whatever the lean (pineKit).
 */
export const PINE_LEAN_TO: ReadonlyArray<readonly [number, number]> = [
  [-49.5, -36.5],
  [-48.5, -37.5],
  [-49.0, -48.0],
  [-46.0, -44.0],
];
/**
 * The roofs beside the pines (world x, z box; the eaves' height and the ridge's; how fast the roof rises inward, m per m), measured
 * from the art file's roof tiles (`LM_temple_giwa`, raycast down on a 0.5 m grid, 2026-11-27): the main hall west of the two west
 * pines, the bell pavilion north of it, the small roof (x -40) by the east side. A pine's limb whose wood or pad would come within
 * `ROOF_CLEAR` of one is shortened (pineKit `blocked`): only that limb, the crown stays full round (owner 2026-11-27).
 */
export const TEMPLE_ROOFS: ReadonlyArray<{ x0: number; x1: number; z0: number; z1: number; eave: number; ridge: number; rise: number }> = [
  { x0: -64.75, x1: -55.25, z0: -44.75, z1: -29.75, eave: 5.8, ridge: 10.9, rise: 1.2 },
  { x0: -62.75, x1: -58.25, z0: -29.75, z1: -25.25, eave: 4.0, ridge: 7.0, rise: 1.5 },
  { x0: -40.75, x1: -39.25, z0: -40.75, z1: -33.25, eave: 5.4, ridge: 7.2, rise: 2.5 },
];
const ROOF_CLEAR = 0.5;
/** Is the world point (x, y, z) in a roof or within `ROOF_CLEAR` of it (the roof taken as solid down to the ground)? */
export function inTempleRoof(x: number, y: number, z: number): boolean {
  for (const r of TEMPLE_ROOFS) {
    const dx = Math.max(r.x0 - x, x - r.x1);
    const dz = Math.max(r.z0 - z, z - r.z1);
    if (dx > ROOF_CLEAR || dz > ROOF_CLEAR) continue;
    // the roof's height here: the eaves at its edge, rising inward to the ridge (just outside the edge: the eaves')
    const inward = Math.max(0, -Math.max(dx, dz));
    if (y < Math.min(r.ridge, r.eave + r.rise * inward) + ROOF_CLEAR) return true;
  }
  return false;
}
/** Pine `i`'s generator options: its crown kept out of the roofs beside it (the test in the tree's own nominal frame). */
export function pineOptions(i: number, low: boolean, groundY = 0): PineOptions {
  const t = TEMPLE_PINES[i]!;
  const yaw = pineYaw(i);
  const sc = t.H / PINE_VARIANTS[t.shape % PINE_VARIANTS.length]!.H;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  // the instance's turn about y: local (x, z) to world (x c + z s, -x s + z c), then scaled and placed
  return { low, blocked: ([x, y, z]) => inTempleRoof(t.x + sc * (x * c + z * sn), groundY + sc * y, t.z + sc * (-x * sn + z * c)) };
}
/** Pine `i`'s seed (pineGeo). */
export const PINE_SEED = (i: number) => 11 + i * 7;
export function pineYaw(i: number): number {
  const t = TEMPLE_PINES[i]!;
  const [x, z] = PINE_LEAN_TO[i]!;
  return Math.atan2(-(z - t.z), x - t.x);
}
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
  /** Triangles of the four pines (instances counted), draws, texture bytes once loaded. */
  stats: { tris: number; draws: number; textureBytes: number };
}

function setupTex(t: Texture, colour: boolean, name: string): Texture {
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.name = name;
  return t;
}

/** Four pines standing on y = `groundY` at the yard's pine places. Null where there is no DOM (tests). */
export function makeTemplePines(groundY: number, low: boolean): TemplePines | null {
  if (typeof document === "undefined") return null;
  const group = new Group();
  group.name = "temple_pines";
  const geometries: BufferGeometry[] = [];
  const loader = new TextureLoader();
  const stats = { tris: 0, draws: 0, textureBytes: 0 };
  const load = (url: string, colour: boolean, name: string) =>
    setupTex(
      loader.load(versionedUrl(url), (t) => {
        const img = t.image as { width?: number; height?: number };
        stats.textureBytes += Math.round((img.width ?? 0) * (img.height ?? 0) * 4 * (4 / 3));
      }),
      colour,
      name,
    );
  const [barkC, barkN] = PINE_FILES.bark(low);
  const [baseC, baseN] = PINE_FILES.base(low);
  const map = load(barkC, false, "T_pine_bark");
  const normal = load(barkN, false, "T_pine_bark_n");
  const baseMap = load(baseC, false, "T_pine_base");
  const baseNormal = load(baseN, false, "T_pine_base_n");
  const crown = load(PINE_FILES.needles(low), true, "T_pine_needles");
  crown.wrapS = crown.wrapT = ClampToEdgeWrapping; // an atlas
  const flat = flatNormal();
  const bark: Material = vegMaterial({ name: "M_temple_pine_bark", map, normalMap: normal, normalScale: 1.25, gloss: 0.04, moss: false, wind: 0, windFar: 1, ambient: 0.55, sky: 0.2, sun: 0.45, back: 0.2, blend: { map: baseMap, normalMap: baseNormal } });
  const needles: Material = vegMaterial({ name: "M_temple_pine_needles", map: crown, alphaTest: 0.42, push: true, wind: 0.05, windFar: low ? 12 : 30, ambient: 0.5, sky: 0.22, sun: 0.42, back: 0.45 });
  const disposables: Array<{ dispose(): void }> = [map, normal, baseMap, baseNormal, crown, flat, bark, needles];
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);
  // every pine its own tree (its own shape, seed, limbs kept out of the roofs beside it): no two alike
  TEMPLE_PINES.forEach((t, i) => {
    const yaw = pineYaw(i);
    const geo = pineGeo(t.shape, PINE_SEED(i), pineOptions(i, low, groundY));
    geometries.push(geo.bark, geo.needles);
    const sc = t.H / geo.H;
    p.set(t.x, groundY, t.z);
    q.setFromAxisAngle(up, yaw);
    s.set(sc, sc, sc);
    const m4 = new Matrix4().compose(p, q, s);
    for (const [g, m, name] of [
      [geo.bark, bark, "bark"],
      [geo.needles, needles, "needles"],
    ] as const) {
      const mesh = new InstancedMesh(g, m, 1);
      mesh.name = `temple_pine_${i}_${name}`;
      mesh.matrixAutoUpdate = false;
      mesh.setMatrixAt(0, m4);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      stats.draws += 1;
      stats.tris += (g.index?.count ?? 0) / 3;
    }
  });
  return { group, geometries, disposables, stats };
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
