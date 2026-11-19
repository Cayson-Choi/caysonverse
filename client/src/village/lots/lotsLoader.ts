import { LoadingManager, type Object3D, type Texture, type WebGLRenderer } from "three";
import { DRACOLoader, GLTFLoader } from "three-stdlib";
import { DRACO_PATH } from "../../game/hub/hubModelPrep";
import type { LotId } from "@caysonverse/shared/village/villageLots";
import { getPbrKtx2Loader } from "../pbr/pbrLibrary";
import { lotModelUrl } from "./lotsPrep";
import { isTouchDevice } from "../../device";
import { capMips, fetchLotManifest, loadLotOwnMap, manifestPaths, type LotManifest, type LotMatSpec, type LotTextureBank } from "./lotTextures";

/**
 * Loading the lot buildings off the village's critical path (L5, lots v2): imperative, with their OWN loading manager and Draco
 * decoder (one worker, let go when done) and the PBR library's KTX2 transcoder, so the "불러오는 중…" overlay (the default manager's
 * progress) never waits for them and a slow or failed lot file is simply not drawn (the village stands as before). Each model names
 * its texture manifest (`asset.extras.textures`); its sets come from the PBR library through the bank (`LotTextureBank`: the far albedo
 * now, the full set when the lot is near).
 */
const manager = new LoadingManager();

/** A lot's swing door leaves as the model's extras give them: `door__<id>_l` / `_r`, turned about y by `openDeg` when open. */
export type LotDoorExtras = Record<string, Record<string, { axis?: string; openDeg?: number; inward?: boolean }>>;

export interface LotVegetationSpot {
  kind: string;
  x: number;
  z: number;
  H: number;
  R: number;
  seed: number;
}

export interface LoadedLot {
  id: LotId;
  scene: Object3D;
  /** Sliding doors' runs (v1 kits, `asset.extras.slides`); v2's doors swing (`doors`). */
  slides: Record<string, Record<string, number>>;
  doors: LotDoorExtras;
  vegetation: LotVegetationSpot[];
  /** The exterior's baked light (L6, bake_lots.bake_lot): sky occlusion and night glow on TEXCOORD_1, or null. */
  lightmap: LotLightmap | null;
}

/** A lot's exterior lightmaps: `ao` multiplies the sky/ambient light, `night` adds the lamps' glow (x `scale` x the night). */
export interface LotLightmap {
  ao: Texture;
  night: Texture;
  scale: number;
}
/** The exterior lightmaps' size on a phone (texels a side: their top mips dropped, capMips). */
export const LOT_LIGHTMAP_PHONE_MAX = 512;

export interface LoadedLots {
  lots: LoadedLot[];
  failed: LotId[];
  /** Material name → its manifest entry (the first manifest that names it). */
  specs: Record<string, LotMatSpec>;
  /** A lot's own maps by material name (`own` atlases, light pools). */
  own: Record<string, Texture>;
  textures: Texture[];
}

/** A GLTF loader with Draco (its own decoder, one worker) and the PBR library's KTX2 transcoder. */
export function lotGltfLoader(gl: WebGLRenderer, mgr: LoadingManager = manager): { loader: GLTFLoader; draco: DRACOLoader } {
  const draco = new DRACOLoader(mgr);
  draco.setDecoderPath(DRACO_PATH);
  draco.setWorkerLimit(1);
  const loader = new GLTFLoader(mgr);
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(getPbrKtx2Loader(gl) as never);
  return { loader, draco };
}

/** Read every lot's model, its manifest's specs and own maps, and the far albedo of every set it names. Never throws for a lot. */
export async function loadLots(ids: readonly LotId[], gl: WebGLRenderer, bank: LotTextureBank, signal: AbortSignal): Promise<LoadedLots> {
  const { loader, draco } = lotGltfLoader(gl);
  try {
    const settled = await Promise.allSettled(
      ids.map(async (id) => {
        const gltf = await loader.loadAsync(lotModelUrl(id));
        const extras = (gltf.parser.json as { asset?: { extras?: { slides?: LoadedLot["slides"]; doors?: LotDoorExtras; vegetation?: LotVegetationSpot[]; textures?: unknown; sharedTextures?: unknown; lightmap?: { ao: string; night: string; scale: number; channel?: number } } } }).asset?.extras;
        let lightmap: LotLightmap | null = null;
        const lm = extras?.lightmap;
        if (lm) {
          try {
            const [ao, night] = await Promise.all([lm.ao, lm.night].map((p) => loadLotOwnMap(gl, `/models/village/${p}`)));
            for (const t of [ao!, night!]) {
              t.channel = lm.channel ?? 1;
              t.anisotropy = 1;
              if (isTouchDevice) capMips(t, LOT_LIGHTMAP_PHONE_MAX);
            }
            lightmap = { ao: ao!, night: night!, scale: lm.scale };
          } catch (e) {
            console.error(`[lots] ${id} lightmap`, e);
          }
        }
        return {
          lot: { id, scene: gltf.scene, slides: extras?.slides ?? {}, doors: extras?.doors ?? {}, vegetation: extras?.vegetation ?? [], lightmap } satisfies LoadedLot,
          manifests: [...manifestPaths(extras?.textures), ...manifestPaths(extras?.sharedTextures)],
        };
      }),
    );
    const paths = [...new Set(settled.flatMap((s) => (s.status === "fulfilled" ? s.value.manifests : [])))];
    const manifests = (await Promise.allSettled(paths.map((p) => fetchLotManifest(p, signal)))).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const { specs, own, textures } = await loadManifestMaps(manifests, gl, bank);
    const lots: LoadedLot[] = [];
    const failed: LotId[] = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") lots.push(s.value.lot);
      else {
        failed.push(ids[i]!);
        console.error(`[lots] ${ids[i]} failed`, s.reason);
      }
    });
    return { lots, failed, specs, own, textures };
  } finally {
    draco.dispose();
  }
}

/**
 * The specs of `manifests` (a name keeps its first entry), their own maps loaded, and every PBR set's far albedo in the bank (waited
 * for: a lot never shows untextured). A failed map leaves its material flat.
 */
export async function loadManifestMaps(
  manifests: readonly LotManifest[],
  gl: WebGLRenderer,
  bank: LotTextureBank,
  /** true: every set in full at the bank's tier; a function: per set (a room's texture plan, LotRoom.tsx). */
  near: boolean | ((set: string) => boolean) = false,
): Promise<{ specs: Record<string, LotMatSpec>; own: Record<string, Texture>; textures: Texture[] }> {
  const specs: Record<string, LotMatSpec> = {};
  const dirOf: Record<string, string> = {};
  for (const m of manifests)
    for (const [name, spec] of Object.entries(m.materials)) {
      if (specs[name]) continue;
      specs[name] = spec;
      dirOf[name] = m.dir;
    }
  const own: Record<string, Texture> = {};
  const textures: Texture[] = [];
  const sets = new Set(Object.values(specs).flatMap((s) => (s.pbr ? [s.pbr] : [])));
  await Promise.all([
    ...[...sets].map((id) => ((typeof near === "function" ? near(id) : near) ? bank.loadNear(id) : bank.loadFar(id)).catch((e: unknown) => console.error(`[lots] set ${id}`, e))),
    ...Object.entries(specs)
      .filter(([, s]) => s.maps?.albedo)
      .map(async ([name, s]) => {
        try {
          const t = await loadLotOwnMap(gl, dirOf[name]! + s.maps!.albedo);
          own[name] = t;
          textures.push(t);
        } catch (e) {
          console.error(`[lots] ${name} map`, e);
        }
      }),
  ]);
  return { specs, own, textures };
}

/** Free a load's own textures (the bank's sets go with the bank, the scenes' geometry with `disposeLots`). */
export function disposeLoadedLots(l: Pick<LoadedLots, "textures">): void {
  for (const t of l.textures) t.dispose();
}
