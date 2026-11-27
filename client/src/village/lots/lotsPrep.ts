/**
 * 마을 부지 건물 (village lots, L5 2026-11-17): the six lot buildings' own models (`models/village/lots/<lot>.glb`, L1–L4 kits;
 * docs/designs/village-lots/contract.md) dressed for the game. The pure part; VillageLots.tsx loads the files and drives it.
 *
 *  - Surfaces: the GLBs carry no images. Each `LM_*` material gets its photo-real set by name from the four texture manifests
 *    (`lots/{market,shops,civic,martgate}/lot_*_textures.json`: albedo sRGB, normal, roughness, metalness for steel; flipY false,
 *    repeat, `normalScale (1, -1)` — glTF tangent space without tangents, as the look-dev pages bind them). LIT materials
 *    (MeshStandard: the scene's sun and sky light), so the normal and roughness maps show; the vertex colours (COLOR_0) multiply in.
 *  - Sun and shadow: the scene's key light IS the live sun (LiveSunShadows); its direct light on the lots is shadowed by the
 *    village's live cascades (sunShadows.ts `ssLive`), the X3 houses' way (housesPrep.ts on feat/exterior-x3), and the lots cast
 *    into the same cascades (their materials are named `LM_…`: LiveSunShadows LOT_CASTS).
 *  - Night: the `lotnight__` glow meshes (COLOR_0 = the glow colour, L6 hand-over) fade in with the day/night blend's `lights`;
 *    the lamps of the lots and the street lanterns near them light the walls (a cheap point term, the houses' recipe).
 *  - Draw calls: the six shells are merged into one mesh per material (always drawn); each lot keeps its detail (`lotdetail__<lot>_mesh`
 *    + the rest of `lotdetail__<lot>`) and its goods (`lotgoods__<lot>`: goods meshes and GPU instances) as groups the LOD shows.
 *  - Doors: the automatic sliding doors whose kit measured their run (`asset.extras.slides`, L3: the hall's and the post office's)
 *    slide their leaves along the door frame's x; every other door stays shut (phase 2+: "준비 중").
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Raycaster,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
import { LOT_DETAIL_LOD, VILLAGE_LOTS, lotDoorPoint, lotFootprint, lotRoomOfDoor, type LotId } from "@caysonverse/shared/village/villageLots";
import { versionedUrl } from "../modelUrl";
import { pbrSetInfo } from "../pbr/pbrLibrary";
import { FLAT_NORMAL, FLAT_ORM, type LotMatSpec, type LotTextureBank } from "./lotTextures";
import type { LotDoorExtras } from "./lotsLoader";
import { litUniform } from "../villageModelPrep";
import { SS_FRAGMENT_PARS, SS_VERTEX_PARS, SS_VERTEX_WORLD, bindSunShadowUniforms } from "../sunShadows";
import { lanternPositions } from "../street/streetLayout";
import { clearGlassMaterial, type ClearGlass } from "../portal/clearGlass";
import type { DayNightState } from "../dayNightBlend";

/** DEV `?lots=off`: the village without the lot buildings (the before sheets). Production: always on. */
export function lotsMode(): "on" | "off" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "on";
  return new URLSearchParams(location.search).get("lots") === "off" ? "off" : "on";
}

export const LOTS_DIR = "/models/village/lots/";
export function lotModelUrl(id: LotId): string {
  return versionedUrl(`${LOTS_DIR}${id}.glb`);
}
/** The look's numbers. */
export const LOT_LOOK = {
  /** Roughness where the light tier has no map (per family prefix). */
  roughness: 0.82,
  /** Steel's metalness factor (its map says where): the game has no environment map, so full metal would read black. */
  metalness: 0.35,
  /** The dancheong atlas's gold leaf (its ORM's metal channel says where; contract B3 note). */
  goldLeaf: 0.6,
  /** The lamp lenses (M_lamp) by day and at night. */
  lampDay: 0.25,
  lampNight: 2.2,
  /** The emissive sign letters (M_sign_emit): their own strength by day, brighter at night. */
  signDay: 0.6,
  signNight: 1.6,
  /** The night glow meshes' strength. */
  glow: 1.0,
  /** Warm lamp light on the walls near a lot's lamp or a street lantern (linear RGB × strength). */
  lampLight: [1.0, 0.62, 0.32] as const,
  lampStrength: 2.2,
  nightDesaturate: 0.4,
  /** A street lantern lights a lot within this much of its footprint (m). */
  lanternReach: 10,
  /** At most this many lamp points in the shader. */
  maxLamps: 40,
} as const;

// ───────────────────────────────────────── materials ─────────────────────────────────────────

const lampUniform = { value: [new Vector3(0, -100, 0)] as Vector3[] };
const nightUniform = { value: 0 };
let lampCount = 1;

const FRAG_PARS = (count: number) => /* glsl */ `
#define LOT_LAMP_COUNT ${count}
uniform vec3 uLotLamps[ LOT_LAMP_COUNT ];
uniform float uVillageLit;
uniform vec3 uLotLampColor;
uniform float uLotNight;
void main() {`;

const NIGHT_COLOUR = /* glsl */ `#include <color_fragment>
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uLotNight );`;

const LIGHTS_BEGIN = (): string =>
  /* glsl */ `float lotSunLit = 1.0;
if ( uSsOn.w > 0.0 ) {
	vec3 lsN = ssNormal();
	lotSunLit = ssLive( lsN, max( dot( lsN, uSsSunDir ), 0.0 ) );
}
` + ShaderChunk.lights_fragment_begin.replace("getDirectionalLightInfo( directionalLight, directLight );", "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= lotSunLit;");

const LAMP_LIGHT = /* glsl */ `#include <lights_fragment_end>
if ( uVillageLit > 0.001 ) {
	vec3 llN = normalize( vSsNormal );
	vec3 llSum = vec3( 0.0 );
	for ( int i = 0; i < LOT_LAMP_COUNT; i ++ ) {
		vec3 L = uLotLamps[ i ] - vSsWorld;
		float d2 = dot( L, L );
		float fall = smoothstep( 90.0, 3.0, d2 ) / ( 1.0 + d2 * 0.5 );
		float ndl = dot( llN, L * inversesqrt( d2 + 1e-4 ) );
		llSum += ( max( ndl, 0.0 ) * 0.85 + 0.15 ) * fall;
	}
	reflectedLight.directDiffuse += uVillageLit * uLotLampColor * llSum * diffuseColor.rgb;
}`;

const lampColour = new Vector3(...LOT_LOOK.lampLight).multiplyScalar(LOT_LOOK.lampStrength);

/** The exterior lightmaps' night: how far the lamps are on (applyLotsDayNight). */
const lmNightUniform = { value: 0 };
/** How much of the sky light the baked occlusion takes away (1: all of it in a fully occluded corner). */
export const LOT_AO_STRENGTH = 0.6;
/** The baked night glow's gain on the walls (over the bake's own scale). */
export const LOT_LM_NIGHT_GAIN = 0.7;

/**
 * A lot surface with its exterior lightmaps (L6): the baked sky occlusion multiplies the sky and ambient light (the live
 * sun keeps its own shadows), the baked night glow is added as the lamps come on. Both read TEXCOORD_1 through three's
 * lightmap slot (its own term replaced): one program by day and by night.
 */
export function patchLotLightmap(m: MeshStandardMaterial, lm: { ao: Texture; night: Texture; scale: number }): void {
  if (m.userData.lotLightmap) return;
  m.userData.lotLightmap = true;
  m.lightMap = lm.ao;
  m.userData.lmNight = lm.night;
  const scale = { value: lm.scale * LOT_LM_NIGHT_GAIN };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uLotLmNight = { value: lm.night };
    shader.uniforms.uLotLmScale = scale;
    shader.uniforms.uLotLmNightMix = lmNightUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform sampler2D uLotLmNight;\nuniform float uLotLmScale;\nuniform float uLotLmNightMix;\nvoid main() {")
      .replace(
        "#include <lights_fragment_maps>",
        `#if defined( RE_IndirectDiffuse ) && defined( USE_LIGHTMAP )
  irradiance *= mix( 1.0, texture2D( lightMap, vLightMapUv ).r, ${LOT_AO_STRENGTH.toFixed(2)} );
  irradiance += texture2D( uLotLmNight, vLightMapUv ).rgb * uLotLmScale * uLotLmNightMix;
#endif
#undef USE_LIGHTMAP
#include <lights_fragment_maps>`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|lotlm`;
  m.needsUpdate = true;
}

/** A lit lot material: the live sun's shadows, the night lamps and the night's colour fade (idempotent per material). */
export function patchLotLight(m: MeshStandardMaterial, key: string): void {
  m.onBeforeCompile = (shader) => {
    bindSunShadowUniforms(shader.uniforms);
    shader.uniforms.uLotLamps = lampUniform;
    shader.uniforms.uVillageLit = litUniform;
    shader.uniforms.uLotLampColor = { value: lampColour };
    shader.uniforms.uLotNight = nightUniform;
    shader.vertexShader = "#define SS_GEO_NORMAL\n" + shader.vertexShader.replace("void main() {", SS_VERTEX_PARS).replace("#include <project_vertex>", SS_VERTEX_WORLD);
    shader.fragmentShader =
      "#define SS_GEO_NORMAL\n" +
      shader.fragmentShader
        .replace("void main() {", SS_FRAGMENT_PARS + FRAG_PARS(lampCount))
        .replace("#include <lights_fragment_begin>", LIGHTS_BEGIN())
        .replace("#include <color_fragment>", NIGHT_COLOUR)
        .replace("#include <lights_fragment_end>", LAMP_LIGHT);
  };
  m.customProgramCacheKey = () => `village-lot-${key}-${lampCount}`;
  m.needsUpdate = true;
}

/**
 * A lot surface (`LM_*`): lit (MeshStandard, the scene's sun and sky), its library set's maps from the bank (`applyLotTextures`: the far
 * albedo with neutral normal / ORM stand-ins, or the full set), the file's vertex colours tinting it. The map slots are always filled, so
 * the far → near swap never changes its program.
 */
export function lotSurfaceMaterial(source: MeshStandardMaterial, spec: LotMatSpec | undefined, patch = true): MeshStandardMaterial {
  const ns = spec?.normalScale ?? 1;
  const m = new MeshStandardMaterial({
    name: source.name,
    color: new Color(1, 1, 1),
    vertexColors: source.vertexColors,
    metalness: 0,
    roughness: spec?.roughnessScale ?? LOT_LOOK.roughness,
    side: source.side,
  });
  if (spec?.albedoGain) m.color.setRGB(spec.albedoGain[0], spec.albedoGain[1], spec.albedoGain[2]);
  if (spec?.pbr) {
    m.map = FLAT_ORM; // replaced by the bank's albedo before the first draw (applyLotTextures)
    m.normalMap = FLAT_NORMAL;
    m.normalScale = new Vector2(ns, -ns); // glTF tangent space without tangents (pbrNormalScaleY)
    m.aoMap = FLAT_ORM;
    m.roughnessMap = FLAT_ORM;
    m.metalnessMap = FLAT_ORM;
    m.userData.lotSet = spec.pbr;
    m.userData.lotSpec = spec;
  } else m.color.copy(source.color);
  if (patch) patchLotLight(m, spec?.pbr ? "pbr" : "flat");
  return m;
}

/** Point a surface's maps at what the bank holds for its set now (number and reference writes: no recompile). */
export function applyLotTextures(m: MeshStandardMaterial, bank: LotTextureBank): void {
  const id = m.userData.lotSet as string | undefined;
  if (!id) return;
  const spec = m.userData.lotSpec as LotMatSpec;
  const t = bank.textures(id);
  if (!t) return;
  m.map = t.map;
  m.normalMap = t.normalMap;
  m.aoMap = t.orm;
  m.roughnessMap = t.orm;
  m.metalnessMap = t.orm;
  const info = pbrSetInfo(id);
  const scale = spec.roughnessScale ?? 1;
  // far: no ORM, so the set's mean roughness (and its mean metal where it is a metal) stands in
  m.roughness = t.near ? scale : Math.min(1, (info.meanOrm?.[1] ?? 0.8) * scale);
  const metal = spec.metal ? LOT_LOOK.metalness : id === "dancheong_wood" ? LOT_LOOK.goldLeaf : 0;
  m.metalness = t.near ? metal : spec.metal ? metal * (info.meanOrm?.[2] ?? 1) : 0;
}

export interface LotGlow {
  /** Every lot's panes: clear over a room drawn behind them (portal/RoomShowcase.tsx), a dark reflective pane elsewhere. */
  glass: ClearGlass | null;
  lamps: MeshStandardMaterial[];
  signs: Array<{ m: MeshStandardMaterial; base: number }>;
  night: MeshBasicMaterial;
}


// ───────────────────────────────────────── level of detail ─────────────────────────────────────────

/** Distance (m) from a point to a box on the ground (0 inside). */
export function gapToBox(x: number, z: number, b: AABB): number {
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
}

export type LotDevice = "pc" | "phone";
/** 0 = the shell only, 1 = + the structure (`lotdetail__<lot>_mesh` and the rest of the detail), 2 = + the goods (`lotgoods__`). */
export type LotLevel = 0 | 1 | 2;

/** The phone draws a lot's goods only this near (m, contract 11–13: "15 m 안이면 lotgoods까지") or standing in its footprint. */
export const PHONE_GOODS_REACH = 15;

/**
 * Each lot's level (contract 6 / 11–13, LOT_DETAIL_LOD), nearest first in one shared pool:
 *  - PC: within 35 m (+4 m before it goes again) everything; the nearest lot always, the next ones while the detail pool
 *    (30k triangles, `detailTris`) has room — the market alone is ~50k (contract 11), so in front of it the others wait.
 *  - phone: within 25 m (+4) the structure, within 15 m (or inside) the goods as well; at most 2 lots detailed, the
 *    nearest always, the second while the 14k pool has room.
 * `refs` are the player and the camera; `shown` the levels now (for the hysteresis). `poolUsed` is detail other buildings (the
 * houses, when theirs join) hold already.
 */
export function pickLotLevels(
  shown: ReadonlyMap<LotId, LotLevel>,
  refs: ReadonlyArray<{ x: number; z: number }>,
  lots: ReadonlyArray<{ id: LotId; box: AABB; detailTris: number; goodsTris: number }>,
  device: LotDevice,
  poolUsed = 0,
): Map<LotId, LotLevel> {
  const L = LOT_DETAIL_LOD;
  const reach = device === "pc" ? L.pc : L.phone;
  const pool = device === "pc" ? L.poolPc : L.poolPhone;
  const most = device === "pc" ? Infinity : L.phoneMaxDetailed;
  const near: Array<{ id: LotId; d: number; detailTris: number; goodsTris: number }> = [];
  for (const l of lots) {
    let d = Infinity;
    for (const r of refs) d = Math.min(d, gapToBox(r.x, r.z, l.box));
    const was = shown.get(l.id) ?? 0;
    if (d <= reach + (was > 0 ? L.hysteresis : 0)) near.push({ id: l.id, d, detailTris: l.detailTris, goodsTris: l.goodsTris });
  }
  near.sort((a, b) => a.d - b.d);
  const out = new Map<LotId, LotLevel>();
  for (const l of lots) out.set(l.id, 0);
  let used = poolUsed;
  let count = 0;
  for (const n of near) {
    if (count >= most) break;
    const goodsWanted = device === "pc" || n.d <= PHONE_GOODS_REACH + ((shown.get(n.id) ?? 0) === 2 ? L.hysteresis : 0);
    const cost = n.detailTris + (goodsWanted ? n.goodsTris : 0);
    if (count > 0 && used + cost > pool) continue;
    out.set(n.id, goodsWanted ? 2 : 1);
    used += cost;
    count++;
  }
  return out;
}

/**
 * How far (m, from the lot's box) a lot's landmark dressing (`nodes.far`) stays drawn: the village's front door is seen from the whole
 * square, and its lamps' glow sprites never hide — the posts, the fountain and the topiary used to pop in only within 25 / 35 m (owner
 * 2026-11-20). Past it the fog has swallowed them. A hysteresis keeps the edge from flickering.
 */
export const FAR_DRESS_REACH = Object.freeze({ pc: 220, phone: 180, hysteresis: 8 });
export function farDressShown(gap: number, was: boolean, device: LotDevice): boolean {
  return gap <= (device === "pc" ? FAR_DRESS_REACH.pc : FAR_DRESS_REACH.phone) + (was ? FAR_DRESS_REACH.hysteresis : 0);
}

// ───────────────────────────────────────── the model ─────────────────────────────────────────

export interface LotDoorLeaf {
  node: Object3D;
  baseX: number;
  /** A sliding leaf's run (m, along the frame's x; v1). */
  slide: number;
  baseYaw: number;
  /** A swing leaf's turn when fully open (rad about its hinge's y; v2: ±90°, inward). */
  swing: number;
}

export interface LotDoorRig {
  id: string;
  lot: LotId;
  leaves: LotDoorLeaf[];
}

export interface LotNodes {
  root: Group;
  shells: Mesh[];
  /** Per lot: the structure group (level >= 1) and the goods group (level 2). */
  detail: Map<LotId, Object3D>;
  goods: Map<LotId, Object3D>;
  /** Per lot: the landmark dressing drawn far beyond the detail's reach (the gate: fountain, lamps, topiary, pennants, urns). */
  far: Map<LotId, Object3D>;
  night: Object3D[];
  doors: LotDoorRig[];
  boxes: Array<{ id: LotId; box: AABB; detailTris: number; goodsTris: number }>;
  glow: LotGlow;
  /** The `LM_*` surfaces (their maps follow the bank: far albedo / the full set). */
  surfaces: MeshStandardMaterial[];
  /** Per lot: the library sets its surfaces use. */
  lotSets: Map<LotId, Set<string>>;
  own: { materials: Material[]; geometries: BufferGeometry[] };
  stats: {
    lots: LotId[];
    shellTriangles: number;
    shellDraws: number;
    detailTriangles: Record<string, number>;
    goodsTriangles: Record<string, number>;
    detailDraws: Record<string, number>;
    goodsDraws: Record<string, number>;
    nightTriangles: number;
    lamps: number;
    /** The doors whose vestibule got L5v2's floor (the kit has none there). */
    vestibuleFloors: string[];
  };
}

const isMeshObj = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;
const matsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material]);
/** Drawn triangles of a mesh (an instanced mesh: × its count). */
export function drawnTris(m: Mesh): number {
  const g = m.geometry;
  const t = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  return (m as InstancedMesh).isInstancedMesh ? t * (m as InstancedMesh).count : t;
}
const noRaycast = () => {};

function lotOfNode(name: string, prefix: string): LotId | null {
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  for (const l of VILLAGE_LOTS) if (rest === l.id || rest.startsWith(`${l.id}_`)) return l.id;
  return null;
}

/** The lamps of the lots' night meshes (downlights, lamps, bulbs): one point per connected bunch, at most `max`. */
function nightLampPoints(meshes: readonly Mesh[], max: number): Vector3[] {
  const pts: Vector3[] = [];
  const v = new Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) continue;
    const clusters: Array<{ sum: Vector3; n: number; c: Vector3 }> = [];
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      let cl = clusters.find((q) => q.c.distanceToSquared(v) < 2.25);
      if (!cl) {
        cl = { sum: new Vector3(), n: 0, c: v.clone() };
        clusters.push(cl);
      }
      cl.sum.add(v);
      cl.n++;
    }
    for (const q of clusters) pts.push(q.sum.divideScalar(q.n));
  }
  return pts.slice(0, max);
}

/**
 * A geometry with exactly the attributes the shell merge joins (position, normal, uv, color as Float32, colour RGB; white where a
 * part has none, so every shell material reads vertex colours) and an index: the kits' primitives differ (Draco's normalised
 * colours, RGBA, a part without UVs) and `mergeGeometries` refuses unlike sets.
 */
export function mergeReady(g: BufferGeometry, keepUv1 = false): BufferGeometry {
  const pos = g.getAttribute("position");
  const n = pos.count;
  // (uv1: a baked lot's lightmap UVs, kept for its own surfaces' merge: all of one lot)
  const keep = keepUv1 && g.getAttribute("uv1") ? ["position", "normal", "uv", "color", "uv1"] : ["position", "normal", "uv", "color"];
  for (const a of Object.keys(g.attributes)) if (!keep.includes(a)) g.deleteAttribute(a);
  const f32 = (name: string, size: number, fill: number) => {
    const src = g.getAttribute(name);
    const out = new Float32Array(n * size).fill(fill);
    if (src) for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = k < src.itemSize ? src.getComponent(i, k) : fill;
    g.setAttribute(name, new Float32BufferAttribute(out, size));
  };
  f32("position", 3, 0);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  else f32("normal", 3, 0);
  f32("uv", 2, 0);
  if (g.getAttribute("uv1")) f32("uv1", 2, 0);
  f32("color", 3, 1);
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  g.morphAttributes = {};
  return g;
}

/**
 * Leaves a hair taller than their opening (world y they must stay within while swinging): the 대웅전's 꽃살문 (0.94–4.04 m) overlapped
 * the 문지방 sill behind it (top 0.96) and the head beam's inner face (underside 4.02) by 2 cm, so swinging inward they cut through both —
 * the door check (lotDoorCheck.ts) found it. Fitted into 0.965–4.015 m (3 mm short of each); shut, the sill and the beam still lap it.
 */
export const LEAF_FIT: Readonly<Record<string, { lo: number; hi: number }>> = { lot_temple_main: { lo: 0.965, hi: 4.015 } };

/** The vestibule floor's lowest height (m): over village.glb's plot lawn (2 cm up, under every lot until vrb2 rebuilds the ground). */
export const VESTIBULE_FLOOR_MIN_Y = 0.03;

/** Scale a leaf in y (about its own frame, the world being y-up) so its geometry spans exactly lo..hi. */
function fitLeafHeight(leaf: Object3D, lo: number, hi: number): void {
  leaf.updateMatrixWorld(true);
  let y0 = Infinity;
  let y1 = -Infinity;
  const v = new Vector3();
  leaf.traverse((o) => {
    if (!isMeshObj(o)) return;
    const pos = o.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
  });
  const top = Math.min(hi, y1);
  if (!(y1 > y0) || (y0 >= lo && y1 <= top)) return;
  const k = (top - lo) / (y1 - y0);
  // world y = py + s·k·ly: keep the leaf's frame, rescale about its origin and move it so its bottom lands on lo
  const base = leaf.parent ? new Vector3().setFromMatrixPosition(leaf.parent.matrixWorld).y : 0;
  const origin = new Vector3().setFromMatrixPosition(leaf.matrixWorld).y;
  leaf.scale.y *= k;
  leaf.position.y = lo - (y0 - origin) * k - base;
}

/**
 * A swing leaf turned about its INNER face's hinge corner, as a real butt hinge does (the kits pivot it on its mid-plane: swung inward,
 * the stile's inner half cut 2–3 cm into the jamb's reveal — the door check's finding, owner 2026-11-17 "자동문이 주위의 물체와 겹치잖아").
 * The leaf (`door__<id>_l|r`, origin on its hinge line, the room on its −z side) goes into a pivot group at (0, 0, its inner face z): shut,
 * it stands exactly where the kit put it; opening, its whole thickness stays on the room's side of the reveal plane.
 */
export function innerHingePivot(leaf: Object3D, inward: boolean): Object3D {
  const parent = leaf.parent;
  if (!parent) return leaf;
  leaf.updateMatrixWorld(true);
  const inv = new Matrix4().copy(leaf.matrixWorld).invert();
  let face = inward ? Infinity : -Infinity;
  const v = new Vector3();
  leaf.traverse((o) => {
    if (!isMeshObj(o)) return;
    const pos = o.geometry.getAttribute("position");
    const m = new Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      face = inward ? Math.min(face, v.z) : Math.max(face, v.z);
    }
  });
  if (!Number.isFinite(face) || Math.abs(face) < 1e-4) return leaf;
  const pivot = new Group();
  pivot.name = `${leaf.name}__pivot`;
  // the pivot at the leaf's inner face on its hinge line, in the leaf's own frame
  pivot.position.copy(new Vector3(0, 0, face).multiply(leaf.scale).applyQuaternion(leaf.quaternion).add(leaf.position));
  pivot.quaternion.copy(leaf.quaternion);
  parent.add(pivot);
  parent.remove(leaf);
  pivot.add(leaf);
  leaf.position.set(0, 0, -face * leaf.scale.z);
  leaf.quaternion.identity();
  return pivot;
}

/**
 * A vestibule's floor where the kit has none: from the door's line inward to the inner wall (rays at 1.4 m: the inner door, the back
 * wall), across between the side walls, 1.5 cm up, metre UVs (the lot's granite or floor set). Null where an upward floor is already there
 * (the 대웅전's 마루) or nothing bounds the space.
 */
export function vestibuleFloor(root: Object3D, l: (typeof VILLAGE_LOTS)[number], d: (typeof VILLAGE_LOTS)[number]["doors"][number], fallback: MeshStandardMaterial | null): Mesh | null {
  let surface = fallback;
  const p = lotDoorPoint(l, d);
  // inward: from the pad toward the door's centre and on
  const inX = p.centre.x - p.pad.x;
  const inZ = p.centre.z - p.pad.z;
  const n = Math.hypot(inX, inZ);
  const ix = inX / n;
  const iz = inZ / n;
  const ray = new Raycaster();
  const inDoor = (o: Object3D | null): boolean => {
    for (let q = o; q; q = q.parent) if (q.name.startsWith("door__")) return true;
    return false;
  };
  const hitDist = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number): number => {
    ray.set(new Vector3(ox, oy, oz), new Vector3(dx, dy, dz));
    ray.far = far;
    const h = ray.intersectObject(root, true).find((x) => (x.object as Mesh).renderOrder !== 3 && !inDoor(x.object));
    return h ? h.distance : Infinity;
  };
  // already floored: rays down 0.6 m and 1.2 m in
  // a kit floor at the ground's own height (0 m) fights the village lawn under it (seen: grass through the open door), and the lot's own
  // lawn (`LM_*_green`) runs on under some buildings: the vestibule gets a floor 1.2 cm over whatever is there, in the kit floor's own
  // material where it has one. A raised floor (the 대웅전's 마루 on its 기단, 0.9 m) needs nothing.
  const isLawn = (o: Object3D) => [(o as Mesh).material].flat().some((m) => /_green$/.test((m as Material | undefined)?.name ?? ""));
  let top = -Infinity;
  let own: Material | null = null;
  // a probe with no kit floor under it (nothing of the lot there, or only its lawn): the village's own grass shows through the doorway
  let bare = false;
  for (const k of [0.6, 1.2]) {
    const x = p.centre.x + ix * k;
    const z = p.centre.z + iz * k;
    ray.set(new Vector3(x, 1.2, z), new Vector3(0, -1, 0));
    ray.far = 1.3;
    const hit = ray.intersectObject(root, true).find((h) => Math.abs(h.face?.normal.y ?? 0) > 0.5 && !inDoor(h.object) && (h.object as Mesh).renderOrder !== 3);
    if (!hit || isLawn(hit.object)) bare = true;
    if (!hit) continue;
    top = Math.max(top, hit.point.y);
    if (!isLawn(hit.object)) own = [(hit.object as Mesh).material].flat()[hit.face?.materialIndex ?? 0] ?? own;
  }
  // A raised kit floor all the way in (the 대웅전's 마루, 0.9 m) needs nothing. A step at the door line with the village lawn beyond it
  // (the chapel's 12 cm granite threshold; owner 2026-11-19: "성당에 문이 열렸는데 왜 건물안에 잔디처럼 녹색이 깔려있는거냐") is no floor:
  // the vestibule is laid at the ground behind it and the step stays a step.
  if (top > 0.06 && !bare) return null;
  if (own && own.name.startsWith("LM_")) surface = own as MeshStandardMaterial;
  const depth = Math.min(4, hitDist(p.centre.x + ix * 0.05, 1.4, p.centre.z + iz * 0.05, ix, 0, iz, 4));
  if (!Number.isFinite(depth) || depth < 0.3) return null;
  const mx = p.centre.x + ix * depth * 0.5;
  const mz = p.centre.z + iz * depth * 0.5;
  // across: the right-hand side of the inward direction
  const ax = -iz;
  const az = ix;
  const half = d.width / 2 + 1.2;
  const right = Math.min(half, hitDist(mx, 1.4, mz, ax, 0, az, half));
  const left = Math.min(half, hitDist(mx, 1.4, mz, -ax, 0, -az, half));
  const y = top > 0.06 ? VESTIBULE_FLOOR_MIN_Y : Math.max(VESTIBULE_FLOOR_MIN_Y, top + 0.012);
  const pos: number[] = [];
  const uv: number[] = [];
  const corner = (along: number, across: number) => {
    const x = p.centre.x + ix * along + ax * across;
    const z = p.centre.z + iz * along + az * across;
    pos.push(x, y, z);
    uv.push(x, z); // metres
  };
  corner(-0.05, -left);
  corner(-0.05, right);
  corner(depth, right);
  corner(depth, -left);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute([0.92, 0.9, 0.86, 0.92, 0.9, 0.86, 0.92, 0.9, 0.86, 0.92, 0.9, 0.86], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  if (g.getAttribute("normal").getY(0) < 0) {
    g.setIndex([0, 2, 1, 0, 3, 2]);
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  const mat = surface ?? new MeshStandardMaterial({ color: "#b9b2a6", roughness: 0.8 });
  const m = new Mesh(g, mat);
  m.name = `lotfloor__${d.id}`;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/**
 * The gate lot's file carries cut-off silhouettes of Caysonland's coaster and wheel on the grass behind the gate (z >= 108 on the
 * village plan; the gate itself ends at z ~ 102). They stood in the open, sliced at their feet: the park is its own area, so they are
 * taken out of the lot's detail (the gate building is untouched).
 */
export const LOT_GATE_BACK_Z = 104;

/** Remove the triangles of every mesh under `node` whose centre is past `zMax` (world); returns the geometries made and the count. */
export function cullBeyondZ(node: Object3D, zMax: number): { made: BufferGeometry[]; removed: number } {
  node.updateWorldMatrix(true, true);
  const made: BufferGeometry[] = [];
  let removed = 0;
  const v = new Vector3();
  node.traverse((o) => {
    if (!isMeshObj(o)) return;
    const g = o.geometry;
    const pos = g.getAttribute("position");
    if (!pos) return;
    const idx = g.index;
    const total = idx ? idx.count : pos.count;
    const keep: number[] = [];
    for (let t = 0; t + 2 < total; t += 3) {
      let cz = 0;
      for (let k = 0; k < 3; k++) cz += v.fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld).z / 3;
      if (cz > zMax) {
        removed++;
        continue;
      }
      for (let k = 0; k < 3; k++) keep.push(idx ? idx.getX(t + k) : t + k);
    }
    if (keep.length === total) return;
    const out = new BufferGeometry();
    for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.getAttribute(name));
    out.setIndex(keep);
    out.computeBoundingSphere();
    out.computeBoundingBox();
    o.geometry = out;
    made.push(out);
  });
  return { made, removed };
}

/** Shell materials drawn from both sides: the roofs (seen from under the market's roof; L3's hall roof faces down in its file). */
const SHELL_DOUBLE_SIDED = new Set<string>([]);

/** The name of a night mesh that is a lamp lighting its surroundings (not a sign, a window, a screen). */
const LAMP_NIGHT = /(downlights|_lamp$|_lamps$|bulbs|awning_light|lanterns?$|uplights|notice_light|_porch$|_eaves$|_fountain$|_notice$)/;

/**
 * Dress the lots' models for the game: materials made here (the loaders' stay as they are), the shells merged per material
 * into new geometry, each lot's detail and goods reparented as groups the LOD shows (their geometry stays the loader's).
 */
/** A lot's exterior lightmaps as prepareLots takes them (lotsLoader's LotLightmap). */
export interface LotLightmapMaps {
  ao: Texture;
  night: Texture;
  scale: number;
}

export function prepareLots(
  scenes: ReadonlyArray<{ id: LotId; scene: Object3D; slides: Record<string, Record<string, number>>; doors?: LotDoorExtras; lightmap?: LotLightmapMaps | null }>,
  specs: Record<string, LotMatSpec>,
  ownMaps: Record<string, Texture> = {},
): LotNodes {
  const own = { materials: [] as Material[], geometries: [] as BufferGeometry[] };
  const made = new Map<string, Material>();
  const surfaces: MeshStandardMaterial[] = [];
  const glow: LotGlow = {
    glass: null,
    lamps: [],
    signs: [],
    night: new MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, opacity: 0 }),
  };
  own.materials.push(glow.night);
  /** A material per source name and per "has vertex colours" (a missing COLOR_0 under vertexColors would read black). */
  const material = (src: Material, colours = (src as MeshStandardMaterial).vertexColors === true, lm: LotLightmapMaps | null = null): Material => {
    const key = `${src.name}|${colours ? "c" : "-"}|${lm && src.name.startsWith("LM_") ? "lm" : "-"}`;
    const hit = made.get(key);
    if (hit) return hit;
    const s = src as MeshStandardMaterial;
    let m: Material;
    const spec = specs[src.name];
    if (src.name.startsWith("LM_")) {
      m = lotSurfaceMaterial(s, spec);
      (m as MeshStandardMaterial).vertexColors = colours;
      if (lm) patchLotLightmap(m as MeshStandardMaterial, lm);
      // both faces: the buildings are shells (their rooms are drawn elsewhere), so through a rose window, a transom or an
      // open door one looked through the far walls' backs at the sky and the grass behind (L5v2 release-4 sheet)
      m.side = DoubleSide;
      surfaces.push(m as MeshStandardMaterial);
    } else if (src.name === "M_glass") {
      // clear glass (owner 2026-11-21: "모든 유리창을 투명하게"): one material for every lot's panes
      glow.glass ??= clearGlassMaterial("M_glass", 1);
      m = glow.glass.material;
    }
    else if (spec?.kind === "screen") m = new MeshBasicMaterial({ name: src.name, vertexColors: colours, toneMapped: true });
    else if (spec?.kind === "own" && ownMaps[src.name]) {
      const c = new MeshStandardMaterial({ name: src.name, map: ownMaps[src.name]!, roughness: 0.6, vertexColors: colours, side: s.side });
      patchLotLight(c, "own");
      m = c;
    }
    else if (src.name === "M_lamp") {
      const c = s.clone();
      c.emissive = new Color("#FFE7C4");
      c.emissiveIntensity = LOT_LOOK.lampDay;
      glow.lamps.push(c);
      m = c;
    } else {
      // M_sign_emit and anything a later kit adds: the file's own material, lit; an emissive one brightens at night
      const c = s.clone();
      if (c.emissive && (c.emissive.r > 0 || c.emissive.g > 0 || c.emissive.b > 0)) glow.signs.push({ m: c, base: c.emissiveIntensity || 1 });
      if (c.alphaTest > 0) {
        c.side = DoubleSide;
        c.transparent = false;
      }
      m = c;
    }
    made.set(key, m);
    own.materials.push(m);
    return m;
  };

  const root = new Group();
  root.name = "village_lots";
  root.userData.cvLots = true;
  const shellParts = new Map<string, BufferGeometry[]>();
  const shellSource = new Map<string, Material>();
  const shellLightmap = new Map<string, LotLightmapMaps>();
  const detail = new Map<LotId, Object3D>();
  const goods = new Map<LotId, Object3D>();
  const night: Object3D[] = [];
  const lampSources: Mesh[] = [];
  const doors: LotDoorRig[] = [];
  const stats: LotNodes["stats"] = { lots: [], shellTriangles: 0, shellDraws: 0, detailTriangles: {}, goodsTriangles: {}, detailDraws: {}, goodsDraws: {}, nightTriangles: 0, lamps: 0, vestibuleFloors: [] };
  const tmp = new Matrix4();
  const dress = (o: Object3D, lm: LotLightmapMaps | null = null) => {
    o.traverse((c) => {
      if (!isMeshObj(c)) return;
      const colours = !!c.geometry.getAttribute("color");
      const baked = lm && c.geometry.getAttribute("uv1") ? lm : null;
      const ms = matsOf(c).map((m) => material(m, colours, baked));
      c.material = ms.length > 1 ? ms : ms[0]!;
    });
  };

  const lotSets = new Map<LotId, Set<string>>();
  for (const { id, scene, slides, doors: doorsX, lightmap } of scenes) {
    scene.updateWorldMatrix(true, true);
    stats.lots.push(id);
    // the library sets this lot's surfaces use (the bank loads them in full while the lot is detailed)
    const sets = new Set<string>();
    scene.traverse((o) => {
      if (isMeshObj(o)) for (const m of matsOf(o)) if (specs[m.name]?.pbr) sets.add(specs[m.name]!.pbr!);
    });
    lotSets.set(id, sets);
    for (const node of [...scene.children]) {
      const n = node.name;
      if (n.startsWith("col__") || n.startsWith("seat__") || n.startsWith("slot__")) continue;
      if (lotOfNode(n, "lotshell__") === id) {
        node.traverse((o) => {
          if (!isMeshObj(o)) return;
          const key = matsOf(o)[0]!.name;
          const world = mergeReady(o.geometry.clone().applyMatrix4(tmp.copy(o.matrixWorld)), !!lightmap && key.startsWith("LM_"));
          shellParts.set(key, [...(shellParts.get(key) ?? []), world]);
          shellSource.set(key, matsOf(o)[0]!);
          if (lightmap && key.startsWith("LM_") && world.getAttribute("uv1")) shellLightmap.set(key, lightmap);
        });
        continue;
      }
      if (lotOfNode(n, "lotdetail__") === id || lotOfNode(n, "lotnight__") === id || n.startsWith("door__")) {
        // reparent into our root, keeping the world placement
        const copy = node; // the loader's own object: each GLB is read once (VillageLots keeps its own parse per visit)
        scene.remove(copy);
        root.add(copy);
        if (id === "lot_gate" && n.startsWith("lotdetail__")) own.geometries.push(...cullBeyondZ(copy, LOT_GATE_BACK_Z).made);
        if (n.startsWith("lotnight__")) {
          copy.traverse((o) => {
            if (!isMeshObj(o)) return;
            o.material = glow.night;
            o.raycast = noRaycast;
            o.renderOrder = 3;
            stats.nightTriangles += drawnTris(o);
            if (LAMP_NIGHT.test(n)) lampSources.push(o);
          });
          copy.visible = false;
          night.push(copy);
          continue;
        }
        dress(copy, n.startsWith("door__") ? null : lightmap ?? null);
        if (n.startsWith("door__")) {
          const doorId = n.slice("door__".length);
          const ds = slides[doorId];
          const sw = doorsX?.[doorId];
          const leaves: LotDoorLeaf[] = [];
          for (const child of [...copy.children]) {
            const k = child.name.slice(n.length + 1); // leaf_l / leaf_r (v1 slides), l / r (v2 swings)
            if (ds && typeof ds[k] === "number") leaves.push({ node: child, baseX: child.position.x, slide: ds[k]!, baseYaw: child.rotation.y, swing: 0 });
            else if (sw?.[k] && typeof sw[k]!.openDeg === "number") {
              // every room door's leaves clear the vestibule floor (vestibuleFloor: over the old plot's lawn, 2 cm up in village.glb)
              const fit = LEAF_FIT[doorId];
              fitLeafHeight(child, Math.max(fit?.lo ?? 0, VESTIBULE_FLOOR_MIN_Y + 0.005), fit?.hi ?? Infinity);
              const pivot = innerHingePivot(child, sw[k]!.inward !== false);
              leaves.push({ node: pivot, baseX: pivot.position.x, slide: 0, baseYaw: pivot.rotation.y, swing: (sw[k]!.openDeg! * Math.PI) / 180 });
            }
          }
          doors.push({ id: doorId, lot: id, leaves });
          continue;
        }
        // lotdetail__<lot>: its goods child is its own group for the LOD
        let dt = 0;
        let dd = 0;
        let gt = 0;
        let gd = 0;
        const g = copy.children.find((c) => c.name === `lotgoods__${id}`);
        copy.traverse((o) => {
          if (!isMeshObj(o)) return;
          let inGoods = false;
          for (let p: Object3D | null = o; p && p !== copy; p = p.parent) if (p === g) inGoods = true;
          if (inGoods) {
            gt += drawnTris(o);
            gd++;
            o.raycast = noRaycast; // decoration: never a click's or the camera's target
          } else {
            dt += drawnTris(o);
            dd++;
          }
        });
        stats.detailTriangles[id] = dt;
        stats.detailDraws[id] = dd;
        stats.goodsTriangles[id] = gt;
        stats.goodsDraws[id] = gd;
        copy.visible = false;
        detail.set(id, copy);
        if (g) goods.set(id, g);
      }
    }
  }

  const shells: Mesh[] = [];
  for (const [name, parts] of shellParts) {
    const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
    if (parts.length > 1) for (const p of parts) p.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    own.geometries.push(merged);
    let mat = material(shellSource.get(name)!, true, shellLightmap.get(name) ?? null);
    if (SHELL_DOUBLE_SIDED.has(name) && mat instanceof MeshStandardMaterial) {
      // a roof seen from under it (the market's open hall) and L3's hall roof, whose faces point down (L3 hand-back): both sides
      const d = mat.clone();
      d.side = DoubleSide;
      patchLotLight(d, `roof2-${name}`);
      own.materials.push(d);
      mat = d;
    }
    const mesh = new Mesh(merged, mat);
    mesh.name = `lotshells_${name}`;
    mesh.matrixAutoUpdate = false;
    shells.push(mesh);
    root.add(mesh);
    stats.shellTriangles += drawnTris(mesh);
  }
  stats.shellDraws = shells.length;

  // the rooms' doors open onto a vestibule: where a kit left it floorless (the lawn showed through), lay one (vestibuleFloor)
  root.updateMatrixWorld(true);
  for (const { id } of scenes) {
    const l = VILLAGE_LOTS.find((x) => x.id === id)!;
    for (const d of l.doors) {
      if (!lotRoomOfDoor(d.id)) continue;
      const surface = [...made.values()].find((m) => /^LM_.*_(granite|floor)$/.test(m.name) && (m as MeshStandardMaterial).userData.lotSet) as MeshStandardMaterial | undefined;
      const f = vestibuleFloor(root, l, d, surface ?? null);
      if (!f) continue;
      own.geometries.push(f.geometry);
      root.add(f);
      stats.vestibuleFloors.push(d.id);
    }
  }

  // the lit materials cast the live sun's shadow (LiveSunShadows marks them by name); the glass, the glow and the lenses do not
  root.traverse((o) => {
    if (!isMeshObj(o)) return;
    const m = matsOf(o)[0]!;
    o.castShadow = m.name.startsWith("LM_");
    o.receiveShadow = false; // the live cascades shade them (patchLotLight)
  });

  const boxes = scenes.map(({ id }) => {
    const l = VILLAGE_LOTS.find((x) => x.id === id)!;
    return { id, box: lotFootprint(l), detailTris: stats.detailTriangles[id] ?? 0, goodsTris: stats.goodsTriangles[id] ?? 0 };
  });

  // the night lamps: the lots' own (downlights, lamps, bulb strings) and the street lanterns near a lot
  const points = nightLampPoints(lampSources, LOT_LOOK.maxLamps - 8);
  for (const [x, y, z] of lanternPositions()) {
    if (points.length >= LOT_LOOK.maxLamps) break;
    if (boxes.some((b) => gapToBox(x, z, b.box) <= LOT_LOOK.lanternReach)) points.push(new Vector3(x, y, z));
  }
  lampUniform.value = points.length ? points : [new Vector3(0, -100, 0)];
  lampCount = lampUniform.value.length;
  stats.lamps = points.length;

  return { root, shells, detail, goods, far: new Map(), night, doors, boxes, glow, surfaces, lotSets, own, stats };
}
/**
 * Put out the lots' lamp points within `r` m of (x, z) and under `belowY` (moved far below the ground: the count, and so the
 * compiled programs, stay as they are). The gate lot's old fountain glow (a light in its water) lit the new fountain's stone
 * like a floodlight (fix/gate-fountain-park).
 */
export function muteLotLampsNear(x: number, z: number, r: number, belowY: number): number {
  let n = 0;
  for (const p of lampUniform.value)
    if (Math.hypot(p.x - x, p.z - z) < r && p.y < belowY) {
      p.set(0, -100, 0);
      n++;
    }
  return n;
}

/**
 * Move the lots' lamp points by (dx, dz) - the gate standing in the park (land/ParkGateLot.tsx) takes its lamps' light with it.
 * Returns the way back.
 */
export function shiftLotLamps(dx: number, dz: number): () => void {
  const moved = lampUniform.value;
  for (const p of moved) {
    p.x += dx;
    p.z += dz;
  }
  return () => {
    for (const p of moved) {
      p.x -= dx;
      p.z -= dz;
    }
  };
}

/** Per frame (number writes only): the night's glow, lamps, signs and glass. */
export function applyLotsDayNight(nodes: LotNodes, s: Pick<DayNightState, "lights" | "night" | "hemiIntensity" | "hemiSky">): void {
  nightUniform.value = s.night * LOT_LOOK.nightDesaturate;
  lmNightUniform.value = s.lights;
  const g = nodes.glow;
  g.night.opacity = s.lights * LOT_LOOK.glow;
  const on = s.lights > 0.01;
  for (const n of nodes.night) if (n.visible !== on) n.visible = on;
  for (const m of g.lamps) m.emissiveIntensity = LOT_LOOK.lampDay + (LOT_LOOK.lampNight - LOT_LOOK.lampDay) * s.lights;
  for (const { m, base } of g.signs) m.emissiveIntensity = base * (LOT_LOOK.signDay + (LOT_LOOK.signNight - LOT_LOOK.signDay) * s.lights);
}

/** Show each lot's detail at its level. */
export function showLotLevels(nodes: LotNodes, levels: ReadonlyMap<LotId, LotLevel>): void {
  for (const [id, d] of nodes.detail) {
    const lv = levels.get(id) ?? 0;
    d.visible = lv >= 1;
    const g = nodes.goods.get(id);
    if (g) g.visible = lv >= 2;
  }
}

/** Slide every rigged door's leaves to `amount` (0 shut .. 1 open) of their run. */
export function setLotDoor(rig: LotDoorRig, amount: number): void {
  for (const l of rig.leaves) {
    if (l.slide) l.node.position.x = l.baseX + l.slide * amount;
    if (l.swing) l.node.rotation.y = l.baseYaw + l.swing * amount;
  }
}

/** Free what `prepareLots` made (the loaders' geometry and textures go with their own release). */
export function disposeLots(nodes: LotNodes): void {
  for (const m of nodes.own.materials) m.dispose();
  for (const g of nodes.own.geometries) g.dispose();
}

/** Drawn triangles and draw calls of what is visible under `root` now (DEV, the budget sheet). */
export function visibleLoad(root: Object3D): { triangles: number; draws: number } {
  let triangles = 0;
  let draws = 0;
  const walk = (o: Object3D) => {
    if (!o.visible) return;
    if (isMeshObj(o)) {
      triangles += drawnTris(o);
      draws += Array.isArray(o.material) ? o.material.length : 1;
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return { triangles, draws };
}
