import { MeshBasicMaterial, SRGBColorSpace, TextureLoader, type Material, type Texture } from "three";
import { configureLightmap } from "../game/hub/hubModelPrep";

/**
 * The memorial hall at night (2026-11-13 rebuild; design.md 1-4): the hall's baked light changes with the village's clock.
 *
 *  - Every `LM_*` material blends the DAY light map with the NIGHT light map (`memorial_lm_night.webp`, baked on the same second UV
 *    set by bake_memorial.py --night: the sun and the skylight off, the cove and the downlights lower, the LED rows, the niche's
 *    spot and the lamp on, warm lamps in the garden) by `hallNightWeight`: the village's own night weight (`dayNight.outdoor.night`).
 *  - The garden card outside the window (`M_garden`) blends the day park with the night park (`memorial_garden_night.webp`: a
 *    starry sky, a crescent, warm garden lamps).
 *  - The skylight's diffuser (`M_skylight`) goes dark blue.
 *
 * The night maps load only when night is near (`useNightMapWanted`, nightLightmap.ts), like the village's, and are freed when the
 * hall is left (`disposeHallNight`). Until a night map is in, the weight stays 0: the hall is never dark for want of a file.
 */

export const HALL_NIGHT_LIGHTMAP_URL = { high: "/models/village/memorial_lm_night.webp", low: "/models/village/memorial_lm_night_1k.webp" } as const;
export const HALL_GARDEN_NIGHT_URL = "/models/village/memorial_garden_night.webp";

/** The weight of the night (0 day .. 1 night), shared by every patched material (a uniform object: one write per frame). */
export const hallNightUniform = { value: 0 };
/** The night light map (the same UV set as the day one), or null until it is loaded. */
export const hallNightMapUniform: { value: Texture | null } = { value: null };
/** The night park, or null until it is loaded. */
export const hallGardenNightUniform: { value: Texture | null } = { value: null };

const patched = new WeakSet<Material>();

const PARS = /* glsl */ `uniform float uHallNight;
uniform sampler2D uHallNightMap;
void main() {`;
const TEXEL_FROM = "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );";
// Both maps are always read (no branch around a texture fetch: D3D warns about derivatives in divergent flow); the night map is
// a 1 x 1 black placeholder until its file is in, and the weight is 0 then.
const TEXEL_TO = /* glsl */ `vec4 lightMapTexel = vec4( texture2D( lightMap, vLightMapUv ).rgb * ( 1.0 - uHallNight ) + texture2D( uHallNightMap, vLightMapUv ).rgb * uHallNight, 1.0 );`;

/** Let a light-mapped material blend the night map in (idempotent). The weight and the map are the shared uniforms above. */
export function patchHallLightmapMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHallNight = hallNightUniform;
    shader.uniforms.uHallNightMap = hallNightMapUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", PARS).replace(TEXEL_FROM, TEXEL_TO);
  };
  material.customProgramCacheKey = () => "hall-lightmap-night";
  material.needsUpdate = true;
}

const GARDEN_PARS = /* glsl */ `uniform float uHallNight;
uniform sampler2D uHallGardenNight;
void main() {`;
const GARDEN_MAP = /* glsl */ `#include <map_fragment>
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * texture2D( uHallGardenNight, vMapUv ).rgb, uHallNight );`;

/** Let the garden card blend the night park in (idempotent). */
export function patchHallGardenMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHallNight = hallNightUniform;
    shader.uniforms.uHallGardenNight = hallGardenNightUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", GARDEN_PARS).replace("#include <map_fragment>", GARDEN_MAP);
  };
  material.customProgramCacheKey = () => "hall-garden-night";
  material.needsUpdate = true;
}

/** The white lacquer cubby interiors' material (round 6): unlit, one shared light texture, day in its left half, night in its right. */
export const HALL_CUBBY_MATERIAL = "M_cubby_in";

const CUBBY_PARS = /* glsl */ `uniform float uHallNight;
void main() {`;
// The model's UVs address the day half (u 0..0.5); the night bake sits 0.5 to the right in the same texture (bake_cubby.py).
const CUBBY_MAP = /* glsl */ `#ifdef USE_MAP
	diffuseColor *= mix( texture2D( map, vMapUv ), texture2D( map, vMapUv + vec2( 0.5, 0.0 ) ), uHallNight );
#endif`;

/**
 * Let the cubby interiors blend their night half in (idempotent). Round 6 review: in the hall's light map the 368 white cubbies
 * had five tiny islands each and showed brown blotches and blur in the close-up; they now share one baked texture (day | night).
 */
export function patchHallCubbyMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHallNight = hallNightUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", CUBBY_PARS).replace("#include <map_fragment>", CUBBY_MAP);
  };
  material.customProgramCacheKey = () => "hall-cubby-night";
  material.needsUpdate = true;
}

/** The skylight diffuser's colour at a night weight: the day's cool white to a deep blue. */
export function skylightColour(night: number): [number, number, number] {
  const n = Math.min(1, Math.max(0, night));
  const day: [number, number, number] = [0.96, 0.98, 1.0];
  const dark: [number, number, number] = [0.012, 0.02, 0.05];
  return [day[0] + (dark[0] - day[0]) * n, day[1] + (dark[1] - day[1]) * n, day[2] + (dark[2] - day[2]) * n];
}

/**
 * The weight to draw with: the village's night weight once the night map and the night park are in, else 0 (the hall never goes
 * dark for want of a file).
 */
export function hallNightWeight(outdoorNight: number, mapReady: boolean): number {
  if (!mapReady) return 0;
  return Math.min(1, Math.max(0, outdoorNight));
}

let loading: Promise<void> | null = null;
/** The tier the load in flight is for. */
let loadingTier: "high" | "low" | null = null;
/** Bumped by every dispose: a load that started before it must not hang its textures on the uniforms. */
let generation = 0;
/** The tier the night map in the uniform was loaded for. */
let loadedTier: "high" | "low" | null = null;
/** The tier asked for last: a load queued behind another tier's loads THIS one when it runs, whatever it was queued for. */
let wantedTier: "high" | "low" | null = null;

/** Load the night map and the night park (once per tier; configured like the day map). Resolves when both are in. */
export function loadHallNight(tier: "high" | "low", loader: Pick<TextureLoader, "loadAsync"> = new TextureLoader()): Promise<void> {
  wantedTier = tier;
  if (hallNightMapUniform.value && hallGardenNightUniform.value && loadedTier === tier) return Promise.resolve();
  if (loading) {
    if (loadingTier === tier) return loading;
    // another tier is in flight (the graphics tier changed meanwhile): load this one after it, so the map that stays is the one
    // the CURRENT tier wants (review 2026-11-14: a phone kept the 2048 px night map after a high → low switch). It loads the tier
    // asked for LAST, not the one it was queued for: high → low → high must end on high (review 2026-11-15).
    const after = loading;
    const gen = generation;
    return after.then(() => (gen === generation && wantedTier ? loadHallNight(wantedTier, loader) : undefined));
  }
  const mine = generation;
  const p: Promise<void> = Promise.all([loader.loadAsync(HALL_NIGHT_LIGHTMAP_URL[tier]), loader.loadAsync(HALL_GARDEN_NIGHT_URL)])
    .then(([lm, garden]) => {
      if (mine !== generation) {
        // the hall was left while this loaded: nobody wants the files
        lm.dispose();
        garden.dispose();
        return;
      }
      configureLightmap(lm);
      garden.colorSpace = SRGBColorSpace;
      garden.flipY = false;
      garden.needsUpdate = true;
      // a tier change swaps the map: the old one goes
      if (hallNightMapUniform.value && hallNightMapUniform.value !== lm) hallNightMapUniform.value.dispose();
      if (hallGardenNightUniform.value && hallGardenNightUniform.value !== garden) hallGardenNightUniform.value.dispose();
      hallNightMapUniform.value = lm;
      hallGardenNightUniform.value = garden;
      loadedTier = tier;
    })
    .catch(() => {
      // the night is an enhancement: a failed fetch leaves the day look (the next visit tries again)
    })
    .finally(() => {
      if (loading === p) {
        loading = null;
        loadingTier = null;
      }
    });
  loading = p;
  loadingTier = tier;
  return p;
}

/** Whether both night files are in. */
export function hallNightReady(): boolean {
  return hallNightMapUniform.value !== null && hallGardenNightUniform.value !== null;
}

/** Free the night files (the hall is left) and put the weight back to the day. */
export function disposeHallNight(): void {
  generation++;
  loading = null;
  loadingTier = null;
  loadedTier = null;
  wantedTier = null;
  hallNightMapUniform.value?.dispose();
  hallGardenNightUniform.value?.dispose();
  hallNightMapUniform.value = null;
  hallGardenNightUniform.value = null;
  hallNightUniform.value = 0;
}

/** The skylight diffuser material, when `m` is one (a flat unlit material named `M_skylight`). */
export function isSkylight(m: Material): m is MeshBasicMaterial {
  return m.name === "M_skylight" && (m as MeshBasicMaterial).isMeshBasicMaterial === true;
}
