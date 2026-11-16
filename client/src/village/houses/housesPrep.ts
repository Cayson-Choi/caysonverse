/**
 * 집 외관 A8 (X3): the ten houses' own model in the game — `village_houses.glb` (X1 body kit + X2 porches; contract
 * docs/designs/house-exteriors/contract.md ch. 5, 6, 10) dressed for a graphics tier. The pure part; VillageHouses.tsx loads the
 * files and drives it.
 *
 *  - Surfaces: the GLB carries no images. Each LM_ material gets its photo-real tiling set by name from
 *    `houses/house_textures.json` (albedo sRGB, normal, roughness; flipY false, repeat; `normalScale (1, -1)`: glTF tangent
 *    space without tangents). The houses' pastel and grime are the vertex colours (COLOR_0, linear), multiplied in. The
 *    materials are LIT (MeshStandard: the scene's sun and sky light, like the bus and the avatars), never unlit — an unlit
 *    material would drop the normal and roughness maps (X1 hand-over). The light tier takes the albedo at full size (the
 *    512 px/m first-person rule holds) and a 512 px normal map, and no roughness map (a per-surface constant).
 *  - Sun and shadow, until the X4 light map: the scene's key light IS the live sun (LiveSunShadows aims it at the real KST sun,
 *    the moon at night) and the sky light the day-and-night blend's hemisphere. Its direct light is shadowed by the village's
 *    live cascades (sunShadows.ts `ssLive`: the near one round the camera, the far cached one over the village), on both tiers,
 *    so a house is shaded by its own eaves and porch and by the trees exactly as the ground beside it is. The houses cast
 *    into the same cascades (`userData.cvHouses`, LiveSunShadows).
 *  - Night: the room behind each window glows (M_window's emissive, warm, with the village's `litUniform`), the porch lamps
 *    glow, and the lamps near a wall light it (a cheap point term per fragment: the porch lamps and the street lanterns
 *    within reach, as the street furniture does).
 *  - Draw calls: the ten shells are merged into one mesh per material (contract: <= 8 draws, always drawn); each house's
 *    detail stays its own group (<= 6 draws), shown only near the player or the camera (`pickDetail`: PC 35 m / 4 houses,
 *    phone 25 m / the 2 nearest, +4 m before hiding again).
 *  - The old houses: village.glb's A7 houses are baked into its per-cell meshes; `oldHouseFootprints` finds their triangles by
 *    place (streetTrim.ts's way: all three corners inside, standing above 0.1 m) and they are cut out of the clone only once
 *    the new shells are drawn — a failed or slow houses' model leaves the old houses standing (the fallback). Once village.glb
 *    is rebuilt with the A8 houses (X4: `modelHasA8Houses`), nothing is cut and its stand-in boxes (`houseproxy__`) are hidden.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  ShaderChunk,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AABB } from "@caysonverse/shared/collision";
import {
  HOUSE_DETAIL_LOD,
  houseDetailNode,
  houseLocalToWorld,
  houseProxyNode,
  houseShellNode,
  porchSlabLocal,
  localBox,
} from "@caysonverse/shared/village/houseExterior";
import { A7_MODEL_HOUSE_BOXES, A8_TREE_MOVES, modelHasA8Houses } from "@caysonverse/shared/village/a8Staging";
import { houseGardenCollider } from "@caysonverse/shared/village/houseExterior";
import { VILLAGE_LAYOUT, type SceneryHouse } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_COLLIDERS } from "@caysonverse/shared/village/generated/villageColliders";
import { versionedUrl } from "../modelUrl";
import { LIT, litUniform } from "../villageModelPrep";
import { SS_FRAGMENT_PARS, SS_VERTEX_PARS, SS_VERTEX_WORLD, bindSunShadowUniforms } from "../sunShadows";
import { lanternPositions } from "../street/streetLayout";
import { trimMesh } from "../street/streetTrim";
import { addBusSky, busEnvScale } from "../villageBusPrep";
import type { DayNightState } from "../dayNightBlend";
import type { VillageTier } from "../villageModelPrep";

/** The DEV address flag `?houses=old`: the old houses baked into village.glb, for the before sheets. Production: always the new. */
export function housesMode(): "new" | "old" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "new";
  return new URLSearchParams(location.search).get("houses") === "old" ? "old" : "new";
}

export const VILLAGE_HOUSES_URL = versionedUrl("/models/village/village_houses.glb");
export const HOUSE_TEXTURES_DIR = "/models/village/houses/";
export const HOUSE_TEXTURES_URL = versionedUrl(`${HOUSE_TEXTURES_DIR}house_textures.json`);

/** `houses/house_textures.json` (X1 make_house_textures.py): the maps of each material, by its name. */
export interface HouseTextureMeta {
  format: "caysonverse-house-textures";
  materials: Record<string, { maps: { albedo: string; normal: string; rough: string } }>;
}

export type HouseMapKind = "albedo" | "normal" | "rough";

/** The light tier's smaller normal map beside the full one: `house_render_normal.webp` -> `house_render_normal_512.webp`. */
export function lightVariant(file: string): string {
  return file.replace(/\.webp$/, "_512.webp");
}

/**
 * The texture files a tier loads, in a fixed order (material, kind): the rich tier every map at 1024; the light tier the albedo at
 * 1024 (the texel density the first-person rule asks for), the normal at 512, no roughness map.
 */
export function houseTextureFiles(meta: HouseTextureMeta, tier: VillageTier): Array<{ material: string; kind: HouseMapKind; url: string }> {
  const out: Array<{ material: string; kind: HouseMapKind; url: string }> = [];
  for (const name of Object.keys(meta.materials).sort()) {
    const m = meta.materials[name]!.maps;
    out.push({ material: name, kind: "albedo", url: versionedUrl(HOUSE_TEXTURES_DIR + m.albedo) });
    out.push({ material: name, kind: "normal", url: versionedUrl(HOUSE_TEXTURES_DIR + (tier === "high" ? m.normal : lightVariant(m.normal))) });
    if (tier === "high") out.push({ material: name, kind: "rough", url: versionedUrl(HOUSE_TEXTURES_DIR + m.rough) });
  }
  return out;
}

/** The look's numbers. */
export const HOUSE_LOOK = {
  /** Roughness where the light tier has no map (per surface family). */
  roughness: { LM_render: 0.93, LM_stone: 0.82, LM_roof: 0.9, LM_wood: 0.72, LM_metal: 0.55 } as Record<string, number>,
  /** The normal maps' strength (x, y: glTF without tangents flips y). */
  normalScale: 1,
  /** The window glass: the bus's even sky reflection by its Fresnel, its tint by day, clearer by night (lit rooms show). */
  glassOpacity: 0.55,
  glassNightOpacity: 0.3,
  glassEnv: 0.9,
  /** The rooms behind the windows at night: LIT.window's warm colour, this bright (× the village's lit weight). */
  windowGlow: 1.35,
  /** The porch lamps' lens: a faint glow by day (frosted glass), lit at night. */
  lampDay: 0.0,
  lampNight: 2.4,
  /** The warm lamp light on the walls near a porch lamp or a street lantern at night (linear RGB x strength). */
  lampLight: [1.0, 0.6, 0.3] as const,
  lampStrength: 1.4,
  /** A street lantern lights a house within this much of its body (m). */
  lanternReach: 12,
} as const;

// ───────────────────────────────────────── materials ─────────────────────────────────────────

/** The lamps lighting the houses at night (world), shared by every house material (set by `prepareHouses`). */
const lampUniform = { value: [new Vector3(0, -100, 0)] as Vector3[] };
let lampCount = 1;

const HOUSE_FRAG_PARS = (count: number) => /* glsl */ `
#define HOUSE_LAMP_COUNT ${count}
uniform vec3 uHouseLamps[ HOUSE_LAMP_COUNT ];
uniform float uVillageLit;
uniform vec3 uHouseLampColor;
void main() {`;

/** The live sun's shadow on the scene's key light (the sun by day, the moon at night): three's own shadow is off. */
const HOUSE_LIGHTS_BEGIN = (): string =>
  /* glsl */ `float houseSunLit = 1.0;
if ( uSsOn.w > 0.0 ) {
	vec3 hsN = ssNormal();
	houseSunLit = ssLive( hsN, max( dot( hsN, uSsSunDir ), 0.0 ) );
}
` + ShaderChunk.lights_fragment_begin.replace("getDirectionalLightInfo( directionalLight, directLight );", "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= houseSunLit;");

const HOUSE_LAMP_LIGHT = /* glsl */ `#include <lights_fragment_end>
if ( uVillageLit > 0.001 ) {
	vec3 hlN = normalize( vSsNormal );
	vec3 hlSum = vec3( 0.0 );
	for ( int i = 0; i < HOUSE_LAMP_COUNT; i ++ ) {
		vec3 L = uHouseLamps[ i ] - vSsWorld;
		float d2 = dot( L, L );
		float fall = smoothstep( 120.0, 4.0, d2 ) / ( 1.0 + d2 * 0.45 );
		float ndl = dot( hlN, L * inversesqrt( d2 + 1e-4 ) );
		hlSum += ( max( ndl, 0.0 ) * 0.85 + 0.15 ) * fall;
	}
	reflectedLight.directDiffuse += uVillageLit * uHouseLampColor * hlSum * diffuseColor.rgb;
}`;

const lampColour = new Vector3(...HOUSE_LOOK.lampLight).multiplyScalar(HOUSE_LOOK.lampStrength);

/** Give a lit house material the live sun's shadows and the night lamps (idempotent per material). */
export function patchHouseLight(m: MeshStandardMaterial, key: string): void {
  m.onBeforeCompile = (shader) => {
    bindSunShadowUniforms(shader.uniforms);
    shader.uniforms.uHouseLamps = lampUniform;
    shader.uniforms.uVillageLit = litUniform;
    shader.uniforms.uHouseLampColor = { value: lampColour };
    shader.vertexShader = "#define SS_GEO_NORMAL\n" + shader.vertexShader.replace("void main() {", SS_VERTEX_PARS).replace("#include <project_vertex>", SS_VERTEX_WORLD);
    shader.fragmentShader =
      "#define SS_GEO_NORMAL\n" +
      shader.fragmentShader
        .replace("void main() {", SS_FRAGMENT_PARS + HOUSE_FRAG_PARS(lampCount))
        .replace("#include <lights_fragment_begin>", HOUSE_LIGHTS_BEGIN())
        .replace("#include <lights_fragment_end>", HOUSE_LAMP_LIGHT);
  };
  m.customProgramCacheKey = () => `village-house-${key}-${lampCount}`;
  m.needsUpdate = true;
}

export interface HouseMaps {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture | null;
}

/** A house surface (LM_*): its tiling set, the vertex colour, lit. */
export function houseSurfaceMaterial(source: MeshStandardMaterial, maps: HouseMaps | null): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    name: source.name,
    color: new Color(1, 1, 1),
    vertexColors: true,
    metalness: 0,
    roughness: maps?.roughnessMap ? 1 : HOUSE_LOOK.roughness[source.name] ?? 0.85,
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
    side: source.side,
  });
  if (maps) m.normalScale = new Vector2(HOUSE_LOOK.normalScale, -HOUSE_LOOK.normalScale);
  patchHouseLight(m, `${maps ? "pbr" : "flat"}${maps?.roughnessMap ? "-r" : ""}`);
  return m;
}

export interface HouseGlow {
  window: MeshStandardMaterial | null;
  lamp: MeshStandardMaterial | null;
  glass: MeshStandardMaterial | null;
  glassSky: { value: number };
}

function windowMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.emissive = new Color(...LIT.window.color);
  m.emissiveIntensity = 0;
  patchHouseLight(m, "window");
  return m;
}

function lampMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.emissive = new Color(...LIT.lamp.color);
  m.emissiveIntensity = HOUSE_LOOK.lampDay;
  return m;
}

function glassMaterial(source: MeshStandardMaterial, strength: { value: number }): MeshStandardMaterial {
  const m = source.clone();
  m.transparent = true;
  m.depthWrite = false;
  m.opacity = HOUSE_LOOK.glassOpacity;
  m.roughness = 0.05;
  m.metalness = 0;
  m.vertexColors = false;
  m.forceSinglePass = true;
  addBusSky(m, strength, "glass");
  return m;
}

function screenMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.forceSinglePass = true;
  return m;
}

// ───────────────────────────────────────── the old houses ─────────────────────────────────────────

/** A place of the old model (streetTrim.ts's footprint shape). */
export interface TrimFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  /** A triangle goes only when its top is above this (m). */
  minTop: number;
  inside: (x: number, y: number, z: number) => boolean;
}

/** Around an old house body: its eaves, gutters, downpipes, plinth and the beds along its walls (m). */
export const OLD_HOUSE_EAVES = 1.0;
/** Past the old footprint's front edge (m): as far as the new steps reach (2 x 0.34), which cover the cut. */
export const OLD_PORCH_STEPS = 0.68;
/**
 * The lowest top (m) the porch's and the garden's cut takes: the old porch's tiles (3 cm), its beds' kerbs and soil; not the
 * lane's paving that runs up to the steps (2 cm), nor the lawn.
 */
export const OLD_PORCH_MIN_TOP = 0.025;

const boxFoot = (b: AABB, pad: number, maxY: number, minTop = 0.1): TrimFootprint => {
  const f = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad, maxY, minTop };
  return { ...f, inside: (x, y, z) => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ && y > -0.05 && y < maxY };
};

/**
 * The A7 houses as village.glb holds them (a8Staging.ts's exact boxes): each body with its eaves, its porch from the body to
 * past the old steps (the whole footprint front), and its garden. Only what stands up is taken (trimMesh: above 0.1 m), never
 * the lawn or the path's paving under it.
 */
export function oldHouseFootprints(houses: readonly SceneryHouse[] = VILLAGE_LAYOUT.sceneryHouses): TrimFootprint[] {
  const out: TrimFootprint[] = [];
  const box = (id: string) => A7_MODEL_HOUSE_BOXES.find((b) => b.id === id)?.box;
  for (const h of houses.filter((x) => x.kind === "house")) {
    const body = box(h.id);
    if (!body) continue;
    out.push(boxFoot(body, OLD_HOUSE_EAVES, 14));
    // the porch: the footprint's front strip (from the body to the edge) and the steps out past it
    const fp = { minX: h.centre.x - h.size.x / 2, maxX: h.centre.x + h.size.x / 2, minZ: h.centre.z - h.size.z / 2, maxZ: h.centre.z + h.size.z / 2 };
    const porch: AABB = { ...fp };
    switch (h.doorSide) {
      case "s": porch.minZ = body.maxZ; porch.maxZ = fp.maxZ + OLD_PORCH_STEPS; break;
      case "n": porch.maxZ = body.minZ; porch.minZ = fp.minZ - OLD_PORCH_STEPS; break;
      case "e": porch.minX = body.maxX; porch.maxX = fp.maxX + OLD_PORCH_STEPS; break;
      case "w": porch.maxX = body.minX; porch.minX = fp.minX - OLD_PORCH_STEPS; break;
    }
    out.push(boxFoot(porch, 0.25, 4.5, OLD_PORCH_MIN_TOP));
    const garden = box(`garden_${h.id}`);
    if (garden) out.push(boxFoot(garden, 0.3, 2.5, OLD_PORCH_MIN_TOP));
  }
  return out;
}

/**
 * The ground the houses take (the vegetation plants no flowers or bed soil there, villageVegetation.ts): the old houses' cut
 * (their porch beds' cards are cut with them) and the new houses' footprints and gardens (X2's porches bring their own beds).
 */
export function makeHouseGrounds(houses: readonly SceneryHouse[] = VILLAGE_LAYOUT.sceneryHouses): (x: number, z: number) => boolean {
  const boxes: AABB[] = oldHouseFootprints(houses).map((f) => ({ minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ }));
  for (const h of houses.filter((x) => x.kind === "house")) {
    boxes.push({ minX: h.centre.x - h.size.x / 2 - 0.3, maxX: h.centre.x + h.size.x / 2 + 0.3, minZ: h.centre.z - h.size.z / 2 - 0.3, maxZ: h.centre.z + h.size.z / 2 + 0.3 });
    const g = houseGardenCollider(h);
    if (g) boxes.push(g.box);
  }
  return (x, z) => boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}

/**
 * The trees the A8 houses displace (a8Staging.ts A8_TREE_MOVES: their crowns would reach into the deeper or turned houses):
 * the shift (m, game x / z) of the tree whose trunk stands at (x, z) in village.glb, or null. The runtime vegetation grows
 * them at their new spots (villageVegetation.ts) until X4 rebuilds village.glb with them moved (then nothing matches here).
 */
export function a8TreeShift(x: number, z: number): { dx: number; dz: number } | null {
  if (modelHasA8Houses(VILLAGE_COLLIDERS, VILLAGE_LAYOUT.sceneryHouses)) return null;
  for (const m of A8_TREE_MOVES) {
    const old = A7_MODEL_HOUSE_BOXES.find((b) => b.id === m.id)?.box;
    if (!old || !m.id.startsWith("tree_")) continue;
    const cx = (old.minX + old.maxX) / 2;
    const cz = (old.minZ + old.maxZ) / 2;
    if (Math.abs(cx - x) < 0.05 && Math.abs(cz - z) < 0.05) return { dx: m.to.x - cx, dz: m.to.z - cz };
  }
  return null;
}

/** Names of village.glb meshes the trim never touches (streetTrim.ts KEEP, plus the leaf chunks' far cards). */
const KEEP = /^(village_sky|village_water|village_backdrop|fountain_moon|col__|light__|seat__|inst__|houseproxy__)/;

export interface OldHouseCut {
  meshes: number;
  trianglesRemoved: number;
  proxiesHidden: number;
  restore(): void;
}

/**
 * Take the old houses out of a village clone (or, once village.glb has the A8 houses, hide its `houseproxy__` stand-ins).
 * `restore` puts everything back (the houses' model went away).
 */
export function cutOldHouses(root: Object3D, a8Model = modelHasA8Houses(VILLAGE_COLLIDERS, VILLAGE_LAYOUT.sceneryHouses)): OldHouseCut {
  const undo: Array<() => void> = [];
  const stats = { meshes: 0, trianglesRemoved: 0, proxiesHidden: 0 };
  root.updateWorldMatrix(true, true);
  const feet = a8Model ? [] : oldHouseFootprints();
  root.traverse((o) => {
    if (o.name.startsWith("houseproxy__") && o.visible) {
      o.visible = false;
      stats.proxiesHidden++;
      undo.push(() => {
        o.visible = true;
      });
      return;
    }
    const mesh = o as Mesh;
    if (feet.length === 0 || !mesh.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || KEEP.test(mesh.name)) return;
    const t = trimMesh(mesh, feet);
    if (!t) return;
    const original = mesh.geometry;
    mesh.geometry = t.geometry;
    stats.meshes++;
    stats.trianglesRemoved += t.removed;
    undo.push(() => {
      if (mesh.geometry !== t.geometry) return; // another patch layered its own copy since: it puts ours back itself
      mesh.geometry = original;
      t.geometry.dispose();
    });
  });
  return {
    ...stats,
    restore() {
      for (const u of undo.reverse()) u();
      undo.length = 0;
    },
  };
}

// ───────────────────────────────────────── level of detail ─────────────────────────────────────────

/** Distance (m) from a point to a box on the ground (0 inside). */
export function gapToBox(x: number, z: number, b: AABB): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

export type DetailDevice = "pc" | "phone";

/**
 * Which houses draw their detail (contract ch. 5, HOUSE_DETAIL_LOD): within `pc` m (PC) or `phone` m (phone) of any reference
 * point (the player, the camera), a shown one until `hysteresis` m farther; at most `pcMaxNear` (PC) or `phoneNearest` (phone),
 * the nearest first.
 */
export function pickDetail(
  shown: ReadonlySet<string>,
  refs: ReadonlyArray<{ x: number; z: number }>,
  houses: ReadonlyArray<{ id: string; box: AABB }>,
  device: DetailDevice,
): Set<string> {
  const L = HOUSE_DETAIL_LOD;
  const reach = device === "pc" ? L.pc : L.phone;
  const most = device === "pc" ? L.pcMaxNear : L.phoneNearest;
  const near: Array<{ id: string; d: number }> = [];
  for (const h of houses) {
    let d = Infinity;
    for (const r of refs) d = Math.min(d, gapToBox(r.x, r.z, h.box));
    if (d <= reach + (shown.has(h.id) ? L.hysteresis : 0)) near.push({ id: h.id, d });
  }
  near.sort((a, b) => a.d - b.d || (shown.has(a.id) ? -1 : 0));
  return new Set(near.slice(0, most).map((n) => n.id));
}

// ───────────────────────────────────────── the model ─────────────────────────────────────────

export interface HouseNodes {
  root: Group;
  /** The ten shells merged per material (always drawn). */
  shells: Mesh[];
  /** Each house's detail (shown near). */
  details: Map<string, Object3D>;
  /** Each house's footprint (world), for the detail's distance. */
  boxes: Array<{ id: string; box: AABB }>;
  /** The houses whose model has a porch slab at +0.30 (their lift zones may lift). */
  porches: string[];
  glow: HouseGlow;
  /** Materials and geometries this call made: freed by `disposeHouses`. */
  own: { materials: Material[]; geometries: BufferGeometry[] };
  stats: { shellTriangles: number; detailTriangles: Record<string, number>; shellDraws: number; detailDraws: Record<string, number>; lamps: number };
}

const isMeshObj = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;
const matsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material]);
const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

/** The house id of a model node (`houseshell__house_3` -> house_3), and which part. */
export function houseNodePart(name: string): { part: "shell" | "detail"; id: string } | null {
  const m = /^house(shell|detail)__(house_\d+)$/.exec(name);
  return m ? { part: m[1] as "shell" | "detail", id: m[2]! } : null;
}

/** Whether a house's geometry has an upward face at the porch's height over its slab (X2's porch is in the model). */
export function hasPorchSlab(meshes: readonly Mesh[], h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): boolean {
  const slab = localBox(h, porchSlabLocal(h.id));
  const inner = { minX: slab.minX + 0.3, maxX: slab.maxX - 0.3, minZ: slab.minZ + 0.3, maxZ: slab.maxZ - 0.3 };
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const e = new Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.getAttribute("position");
    if (!pos) continue;
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i + 2 < count; i += 3) {
      const at = (k: number) => (idx ? idx.getX(i + k) : i + k);
      a.fromBufferAttribute(pos, at(0)).applyMatrix4(mesh.matrixWorld);
      if (a.y < 0.27 || a.y > 0.33) continue;
      b.fromBufferAttribute(pos, at(1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, at(2)).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(b.y - a.y) > 0.02 || Math.abs(c.y - a.y) > 0.02) continue;
      n.subVectors(b, a).cross(e.subVectors(c, a));
      if (n.y <= 0) continue;
      const x = (a.x + b.x + c.x) / 3;
      const z = (a.z + b.z + c.z) / 3;
      if (x >= inner.minX && x <= inner.maxX && z >= inner.minZ && z <= inner.maxZ) return true;
    }
  }
  return false;
}

/** The porch lamps' lenses (M_lamp) of the model, one point per lamp (world: each connected bunch of its triangles' corners). */
function lampPoints(meshes: readonly Mesh[]): Vector3[] {
  const pts: Vector3[] = [];
  const v = new Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) continue;
    const clusters: Array<{ sum: Vector3; n: number; c: Vector3 }> = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      let cl = clusters.find((q) => q.c.distanceToSquared(v) < 0.25);
      if (!cl) {
        cl = { sum: new Vector3(), n: 0, c: v.clone() };
        clusters.push(cl);
      }
      cl.sum.add(v);
      cl.n++;
    }
    for (const q of clusters) pts.push(q.sum.divideScalar(q.n));
  }
  return pts;
}

const A8_HOUSES = (): SceneryHouse[] => VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house");

/**
 * Dress a CLONE-free copy of the houses' model for a tier: materials made here (the loader's stay as they are), the shells
 * merged per material into new geometry, the details reparented (their geometry stays the loader's).
 */
export function prepareHouses(scene: Object3D, maps: Record<string, HouseMaps>): HouseNodes {
  scene.updateWorldMatrix(true, true);
  const own = { materials: [] as Material[], geometries: [] as BufferGeometry[] };
  const made = new Map<string, Material>();
  const glow: HouseGlow = { window: null, lamp: null, glass: null, glassSky: { value: HOUSE_LOOK.glassEnv } };
  const lamps: Mesh[] = [];
  const material = (src: Material): Material => {
    const hit = made.get(src.name);
    if (hit) return hit;
    const s = src as MeshStandardMaterial;
    let m: Material;
    if (src.name.startsWith("LM_")) m = houseSurfaceMaterial(s, maps[src.name] ?? null);
    else if (src.name === "M_window") m = glow.window = windowMaterial(s);
    else if (src.name === "M_lamp") m = glow.lamp = lampMaterial(s);
    else if (src.name === "M_glass") m = glow.glass = glassMaterial(s, glow.glassSky);
    else if (src.name === "M_screen") m = screenMaterial(s);
    else {
      // what a later kit adds (X2's M_leaf_flora: flower cards): the file's own material, lit, cut out
      const c = s.clone();
      if (c.alphaTest > 0 || c.name === "M_leaf_flora") {
        c.alphaTest = Math.max(c.alphaTest, 0.5);
        c.side = DoubleSide;
        c.transparent = false;
      }
      m = c;
    }
    made.set(src.name, m);
    own.materials.push(m);
    return m;
  };

  const root = new Group();
  root.name = "village_houses";
  root.userData.cvHouses = true;
  const shellParts = new Map<string, BufferGeometry[]>();
  const details = new Map<string, Object3D>();
  const detailTriangles: Record<string, number> = {};
  const detailDraws: Record<string, number> = {};
  const byHouse = new Map<string, Mesh[]>();
  const unknown: Object3D[] = [];
  const tmp = new Matrix4();

  for (const node of [...scene.children]) {
    const part = houseNodePart(node.name);
    if (!part) {
      if (!node.name.startsWith("slot__") && (isMeshObj(node) || node.children.length > 0)) unknown.push(node);
      continue;
    }
    const meshes: Mesh[] = [];
    node.traverse((o) => {
      if (isMeshObj(o)) meshes.push(o);
    });
    byHouse.set(part.id, [...(byHouse.get(part.id) ?? []), ...meshes]);
    if (part.part === "shell") {
      for (const mesh of meshes) {
        const src = matsOf(mesh);
        const g = mesh.geometry;
        // one primitive per mesh (GLTFLoader): the whole geometry in the world, under its material's name
        const world = g.clone().applyMatrix4(tmp.copy(mesh.matrixWorld));
        const key = src[0]!.name;
        if (src[0]!.name === "M_lamp") lamps.push(mesh);
        shellParts.set(key, [...(shellParts.get(key) ?? []), world]);
        if (!made.has(key)) material(src[0]!);
      }
    } else {
      const group = new Group();
      group.name = node.name;
      let t = 0;
      let d = 0;
      for (const mesh of meshes) {
        const m = new Mesh(mesh.geometry, matsOf(mesh).map(material)[0]!);
        m.name = mesh.name;
        mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        if (matsOf(mesh)[0]!.name === "M_lamp") lamps.push(mesh);
        group.add(m);
        t += tris(mesh.geometry);
        d++;
      }
      group.visible = false;
      details.set(part.id, group);
      detailTriangles[part.id] = t;
      detailDraws[part.id] = d;
      root.add(group);
    }
  }

  const shells: Mesh[] = [];
  let shellTriangles = 0;
  for (const [name, parts] of shellParts) {
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    own.geometries.push(merged);
    const mesh = new Mesh(merged, made.get(name)!);
    mesh.name = `houseshells_${name}`;
    mesh.matrixAutoUpdate = false;
    shells.push(mesh);
    root.add(mesh);
    shellTriangles += tris(merged);
  }
  for (const u of unknown) {
    // drawn as it is (always): a node a later kit adds that this file does not know by name
    const copy = u.clone();
    copy.traverse((o) => {
      if (!isMeshObj(o)) return;
      const ms = matsOf(o).map(material);
      o.material = ms.length > 1 ? ms : ms[0]!;
    });
    root.add(copy);
  }
  // every solid part casts the live sun's shadow; the transparent glass, screens and the lamps' lenses do not
  root.traverse((o) => {
    if (!isMeshObj(o)) return;
    const m = matsOf(o)[0]!;
    o.castShadow = m.name.startsWith("LM_") || m.name === "M_leaf_flora" || m.name === "M_window";
    o.receiveShadow = false; // the live cascades shade them (patchHouseLight)
  });

  const houses = A8_HOUSES();
  const boxes = houses.map((h) => ({ id: h.id, box: { minX: h.centre.x - h.size.x / 2, maxX: h.centre.x + h.size.x / 2, minZ: h.centre.z - h.size.z / 2, maxZ: h.centre.z + h.size.z / 2 } }));
  const porches = houses.filter((h) => hasPorchSlab(byHouse.get(h.id) ?? [], h)).map((h) => h.id);

  // the night lamps: the porch lamps and the street lanterns within reach of a house
  const points = lampPoints(lamps);
  for (const [x, y, z] of lanternPositions()) {
    if (boxes.some((b) => gapToBox(x, z, b.box) <= HOUSE_LOOK.lanternReach)) points.push(new Vector3(x, y, z));
  }
  lampUniform.value = points.length ? points : [new Vector3(0, -100, 0)];
  lampCount = lampUniform.value.length;

  return {
    root,
    shells,
    details,
    boxes,
    porches,
    glow,
    own,
    stats: { shellTriangles, detailTriangles, shellDraws: shells.length, detailDraws, lamps: points.length },
  };
}

/** Per frame (number writes only): the night's windows, lamps and glass. */
export function applyHousesDayNight(nodes: HouseNodes, s: Pick<DayNightState, "lights" | "hemiIntensity" | "hemiSky">): void {
  const g = nodes.glow;
  if (g.window) g.window.emissiveIntensity = s.lights * HOUSE_LOOK.windowGlow;
  if (g.lamp) g.lamp.emissiveIntensity = HOUSE_LOOK.lampDay + (HOUSE_LOOK.lampNight - HOUSE_LOOK.lampDay) * s.lights;
  if (g.glass) g.glass.opacity = HOUSE_LOOK.glassOpacity + (HOUSE_LOOK.glassNightOpacity - HOUSE_LOOK.glassOpacity) * s.lights;
  g.glassSky.value = HOUSE_LOOK.glassEnv * busEnvScale(s);
}

/** Show the detail of exactly `ids`. */
export function showDetail(nodes: HouseNodes, ids: ReadonlySet<string>): void {
  for (const [id, g] of nodes.details) g.visible = ids.has(id);
}

/** Free what `prepareHouses` made (the loader's geometry and textures stay with its cache). */
export function disposeHouses(nodes: HouseNodes): void {
  for (const m of nodes.own.materials) m.dispose();
  for (const g of nodes.own.geometries) g.dispose();
}

/** The houses' contract node names (for the dev hook's checks). */
export function houseNodeNames(id: string): { shell: string; detail: string; proxy: string } {
  return { shell: houseShellNode(id), detail: houseDetailNode(id), proxy: houseProxyNode(id) };
}

/** A house's local point in the world, as a Vector3 at height y. */
export function houseLocalPoint(h: Pick<SceneryHouse, "centre" | "doorSide">, lx: number, y: number, lz: number): Vector3 {
  const p = houseLocalToWorld(h, lx, lz);
  return new Vector3(p.x, y, p.z);
}
