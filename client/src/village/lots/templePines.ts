import { BufferGeometry, BufferAttribute, ClampToEdgeWrapping, Group, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, NoColorSpace, Quaternion, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Material, type Mesh, type Object3D, type Texture } from "three";
import { flatNormal } from "../veg/barkGeometry";
import { PINE_FILES, pineGeo } from "../veg/pineKit";
import { vegMaterial } from "../veg/vegMaterial";
import { versionedUrl } from "../modelUrl";

/**
 * The temple yard's four Korean red pines (소나무). The art file's pines were a trunk (in the `LM_temple_rock` mesh) with 1300
 * triangles of flat green plates each (the whole `LM_temple_green` detail mesh above 3.4 m is pine foliage). `cutOldPines` drops them
 * from the loader's geometry (a copy with a new index: the cached file is not touched) and `makeTemplePines` stands real pines in their
 * place (veg/pineKit.ts, owner 2026-11-21 "실제같은 느낌이 나도록"): leaning, bending trunks with the grey fissured foot and the orange
 * flaky upper bark, few irregular limbs, the needles in flat layered pads, three shapes, each pine leaning toward the yard (or the pond).
 */

/** Where the art file stood them (x, z; the boxes `col__lot_temple_pine_N`), their height (m) and shape (pineKit's variant). */
export const TEMPLE_PINES: ReadonlyArray<{ x: number; z: number; H: number; shape: number }> = [
  { x: -44.2, z: -27.0, H: 8.4, shape: 0 },
  { x: -53.2, z: -27.5, H: 7.8, shape: 2 },
  { x: -56.9, z: -47.0, H: 8.8, shape: 0 },
  { x: -41.1, z: -45.6, H: 8.0, shape: 1 },
];
/**
 * Where each pine leans (x, z): the yard's middle, the pond's pine over its pond. A pine model leans toward its own +x; turning it by
 * `atan2(-dz, dx)` aims it. The trunk's foot stays at the pine's place (its collision box).
 */
export const PINE_LEAN_TO: ReadonlyArray<readonly [number, number]> = [
  [-49.5, -36.5],
  [-48.5, -37.5],
  [-49.0, -38.5],
  [-46.0, -44.0],
];
/** World directions (x, z) a pine's crown keeps out of: the main hall and the bell pavilion are west of the two west pines. */
export const PINE_AVOID: ReadonlyArray<readonly [number, number] | null> = [null, [-1, 0], [-1, 0], null];
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
  // every pine its own tree (its own shape, seed, crown kept off the roofs beside it): no two alike
  TEMPLE_PINES.forEach((t, i) => {
    const yaw = pineYaw(i);
    const av = PINE_AVOID[i];
    // the avoided direction in the tree's own frame (the instance turns +x to (cos yaw, -sin yaw))
    const avoid = av ? { x: av[0] * Math.cos(yaw) - av[1] * Math.sin(yaw), z: av[0] * Math.sin(yaw) + av[1] * Math.cos(yaw), cos: 0.25 } : undefined;
    const geo = pineGeo(t.shape, 11 + i * 7, { low, avoid });
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
