/**
 * M1 PBR material library: the loader API (케이슨 마을 실사화, art-director PLAN.md section 3).
 *
 * Every set is three KTX2 textures built by scripts/build-materials.mjs from CC0 scans (Poly Haven, ambientCG):
 *   albedo  sRGB, ETC1S        -> material.map
 *   normal  linear, UASTC      -> material.normalMap (OpenGL convention, +Y up)
 *   orm     linear, UASTC      -> material.aoMap (R) + material.roughnessMap (G) + material.metalnessMap (B): ONE texture
 * Two tiers: "2k" (PC, 화려하게) and "1k" (phone, 가볍게: all maps 1024). The PC tier uses the 2048 albedo, the 2048 normal
 * where the set has one (close-up surfaces, density >= 1024 px/m) and the 1024 file otherwise, and the 1024 ORM
 * (roughness/AO read fine at half resolution). `pbrTierFor(quality)` maps the game's QualityTier onto them.
 *
 * Nothing loads until a set is asked for: no set and not the transcoder is in the first download. The textures follow the
 * glTF UV convention (flipY = false, v down), so they drop straight onto meshes from our GLBs; for three's built-in
 * geometries (PlaneGeometry etc., v up) call `flipGeometryV(geometry)` once or the image is mirrored vertically.
 *
 *   const set = await getPbrSet("plaza_granite", pbrTierFor(tier), gl);
 *   const mat = createPbrMaterial(set, { repeatMeters: [20, 20] });   // a 20 m x 20 m UV-unit surface
 *
 * Textures are cached per (set, tier) and shared: `createPbrMaterial` / `pbrTextures` with a repeat return clones that
 * share the GPU upload (three keys uploads by `texture.source`). `releasePbrSet` frees the GPU memory of a set.
 */
import {
  LinearMipmapLinearFilter,
  LinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type BufferGeometry,
  type ColorSpace,
  type MeshStandardMaterialParameters,
  type Texture,
  type WebGLRenderer,
} from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { QualityTier } from "../../game/quality";
import { PBR_SETS } from "./pbrManifest.generated";
import type { PbrMapKind, PbrSetInfo, PbrTier } from "./pbrTypes";

export type { PbrMapKind, PbrSetInfo, PbrTier } from "./pbrTypes";

export const PBR_BASE_URL = "/textures/pbr";
export const PBR_TRANSCODER_PATH = `${PBR_BASE_URL}/basis/`;
export const PBR_MAP_KINDS: readonly PbrMapKind[] = ["albedo", "normal", "orm"];

/** Which file a map of a set uses at a tier: the tier's own when it was built, else the 1K one (see the header). */
export function pbrFileTier(info: PbrSetInfo, tier: PbrTier, kind: PbrMapKind): PbrTier {
  return info.tiers[tier]?.[kind] ? tier : "1k";
}

/** Colour space per map: only the albedo is colour; normal and ORM are data and must not be sRGB-decoded. */
export const PBR_COLOR_SPACE: Record<PbrMapKind, ColorSpace> = {
  albedo: SRGBColorSpace,
  normal: NoColorSpace,
  orm: NoColorSpace,
};

/** Anisotropic filtering per tier (clamped to what the GPU offers): grazing ground views stay sharp. */
export const PBR_ANISOTROPY: Record<PbrTier, number> = { "2k": 16, "1k": 8 };

export const PBR_IDS: readonly string[] = PBR_SETS.map((s) => s.id);

export function pbrTierFor(quality: QualityTier): PbrTier {
  return quality === "high" ? "2k" : "1k";
}

export function pbrSetInfo(id: string): PbrSetInfo {
  const info = PBR_SETS.find((s) => s.id === id);
  if (!info) throw new Error(`unknown PBR set "${id}" (have: ${PBR_IDS.join(", ")})`);
  return info;
}

/** URL of one map of a set at a tier, with its content hash as ?v= (a rebuilt texture is fetched at once). */
export function pbrUrl(id: string, tier: PbrTier, kind: PbrMapKind): string {
  const info = pbrSetInfo(id);
  const fileTier = pbrFileTier(info, tier, kind);
  const file = info.tiers[fileTier]?.[kind];
  if (!file) throw new Error(`PBR set "${id}" has no ${fileTier} ${kind} map — run scripts/build-materials.mjs`);
  return `${PBR_BASE_URL}/${fileTier}/${id}_${kind}.ktx2?v=${file.hash}`;
}

/** Bytes a set downloads at a tier (the three files it actually fetches). */
export function pbrDownloadBytes(id: string, tier: PbrTier): number {
  const info = pbrSetInfo(id);
  return PBR_MAP_KINDS.reduce((sum, kind) => sum + (info.tiers[pbrFileTier(info, tier, kind)]?.[kind]?.bytes ?? 0), 0);
}

const TIER_SIZE: Record<PbrTier, number> = { "2k": 2048, "1k": 1024 };

/**
 * Estimated GPU memory of a set at a tier, full mip chain (x 4/3). `device`: "desktop" transcodes everything to BC7
 * (1 byte/texel); "mobile" (ASTC + ETC2, iPhone) gets ETC1S albedo as ETC2 RGB (0.5 byte/texel) and UASTC as
 * ASTC 4x4 (1 byte/texel). These follow KTX2Loader's format priorities.
 */
export function pbrGpuBytes(id: string, tier: PbrTier, device: "desktop" | "mobile" = tier === "2k" ? "desktop" : "mobile"): number {
  const info = pbrSetInfo(id);
  let sum = 0;
  for (const kind of PBR_MAP_KINDS) {
    const size = TIER_SIZE[pbrFileTier(info, tier, kind)];
    const bpp = kind === "albedo" && device === "mobile" ? 0.5 : 1;
    sum += size * size * bpp * (4 / 3);
  }
  return Math.round(sum);
}

/** Repeat for a surface whose UVs span `meters` (u, v) of world space at one UV unit, given the set's tile size. */
export function pbrRepeatFor(id: string, meters: readonly [number, number]): [number, number] {
  const t = pbrSetInfo(id).tileMeters;
  return [meters[0] / t, meters[1] / t];
}

// ───────────────────────── loading ─────────────────────────

export interface PbrSet {
  readonly id: string;
  readonly tier: PbrTier;
  readonly info: PbrSetInfo;
  readonly map: Texture;
  readonly normalMap: Texture;
  /** ao (R), roughness (G), metalness (B): use it as aoMap, roughnessMap AND metalnessMap. */
  readonly orm: Texture;
}

let loader: KTX2Loader | null = null;
let loaderRenderer: WebGLRenderer | null = null;

/** The shared KTX2Loader (one Basis transcoder for the whole app). Exported so other KTX2 users can reuse it. */
export function getPbrKtx2Loader(renderer: WebGLRenderer): KTX2Loader {
  if (!loader || loaderRenderer !== renderer) {
    loader?.dispose();
    loader = new KTX2Loader().setTranscoderPath(PBR_TRANSCODER_PATH).setWorkerLimit(2);
    loader.detectSupport(renderer);
    loaderRenderer = renderer;
  }
  return loader;
}

const cache = new Map<string, Promise<PbrSet>>();

function configure(tex: Texture, kind: PbrMapKind, tier: PbrTier, renderer: WebGLRenderer): Texture {
  tex.colorSpace = PBR_COLOR_SPACE[kind];
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = Math.min(PBR_ANISOTROPY[tier], renderer.capabilities.getMaxAnisotropy());
  tex.channel = 0; // all three maps read the mesh's first UV set (aoMap included)
  tex.name = `pbr_${kind}`;
  tex.needsUpdate = true;
  return tex;
}

/** Load (once) and return a set's three textures for a tier. Concurrent calls share one load. */
export function getPbrSet(id: string, tier: PbrTier, renderer: WebGLRenderer): Promise<PbrSet> {
  const key = `${id}@${tier}`;
  let p = cache.get(key);
  if (!p) {
    const info = pbrSetInfo(id);
    const ktx = getPbrKtx2Loader(renderer);
    p = Promise.all(PBR_MAP_KINDS.map((kind) => ktx.loadAsync(pbrUrl(id, tier, kind)))).then(([a, n, o]) => ({
      id,
      tier,
      info,
      map: configure(a!, "albedo", tier, renderer),
      normalMap: configure(n!, "normal", tier, renderer),
      orm: configure(o!, "orm", tier, renderer),
    }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Free a set's GPU memory and forget it (materials still using it re-upload on their next draw). */
export async function releasePbrSet(id: string, tier: PbrTier): Promise<void> {
  const key = `${id}@${tier}`;
  const p = cache.get(key);
  if (!p) return;
  cache.delete(key);
  const set = await p;
  set.map.dispose();
  set.normalMap.dispose();
  set.orm.dispose();
}

export interface PbrTextureOptions {
  /** Texture repeat (u, v). Takes precedence over repeatMeters. */
  repeat?: readonly [number, number];
  /** World metres covered by one UV unit (u, v): the repeat comes from the set's real tile size. */
  repeatMeters?: readonly [number, number];
  /** Texture rotation, radians (around the UV origin). */
  rotation?: number;
}

/** The set's textures with a repeat applied: clones sharing the GPU upload when a repeat is asked for. */
export function pbrTextures(set: PbrSet, opt: PbrTextureOptions = {}): { map: Texture; normalMap: Texture; orm: Texture } {
  const rep = opt.repeat ?? (opt.repeatMeters ? pbrRepeatFor(set.id, opt.repeatMeters) : null);
  if (!rep && !opt.rotation) return { map: set.map, normalMap: set.normalMap, orm: set.orm };
  const clone = (t: Texture) => {
    const c = t.clone();
    if (rep) c.repeat.set(rep[0], rep[1]);
    if (opt.rotation) c.rotation = opt.rotation;
    c.needsUpdate = true;
    return c;
  };
  return { map: clone(set.map), normalMap: clone(set.normalMap), orm: clone(set.orm) };
}

export interface PbrMaterialOptions extends PbrTextureOptions {
  /** Extra MeshStandardMaterial parameters (color tints the albedo). */
  params?: MeshStandardMaterialParameters;
  /** Relief strength (1 = the scan's own). */
  normalStrength?: number;
  /** The mesh carries a `tangent` attribute (rare for us). Default false: derivative tangents, see pbrNormalScaleY. */
  meshHasTangents?: boolean;
}

/**
 * normalScale.y for an OpenGL (+Y up) normal map on a v-down (glTF-convention) mesh. Without a tangent attribute three
 * builds the tangent frame from the UV derivatives, whose bitangent points toward +v = DOWN the image, so green must be
 * negated — exactly what GLTFLoader does for every glTF material without tangents (three issue #11438).
 */
export function pbrNormalScaleY(meshHasTangents = false): number {
  return meshHasTangents ? 1 : -1;
}

/**
 * A MeshStandardMaterial wired to the set: map, normalMap, and the ORM texture in aoMap/roughnessMap/metalnessMap with
 * roughness = metalness = 1 (three MULTIPLIES the scalars with the maps, so 1 lets the scan's own values through).
 */
export function createPbrMaterial(set: PbrSet, opt: PbrMaterialOptions = {}): MeshStandardMaterial {
  const t = pbrTextures(set, opt);
  const s = opt.normalStrength ?? 1;
  const mat = new MeshStandardMaterial({
    normalScale: new Vector2(s, s * pbrNormalScaleY(opt.meshHasTangents)),
    map: t.map,
    normalMap: t.normalMap,
    aoMap: t.orm,
    roughnessMap: t.orm,
    metalnessMap: t.orm,
    roughness: 1,
    metalness: 1,
    aoMapIntensity: 1,
    ...opt.params,
  });
  mat.name = `PBR_${set.id}`;
  return mat;
}

/** Flip a geometry's first UV set's v (three's built-in geometries are v-up; the library follows glTF's v-down). */
export function flipGeometryV(geometry: BufferGeometry): BufferGeometry {
  const uv = geometry.getAttribute("uv");
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
  return geometry;
}

/** For tests: forget every cached set without touching the GPU. */
export function _resetPbrCacheForTests(): void {
  cache.clear();
  loader = null;
  loaderRenderer = null;
}
