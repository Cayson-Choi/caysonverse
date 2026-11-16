import type { Material, Texture } from "three";

/**
 * A house at night (집 실내 G): the baked light of a house changes with the village's clock, like the memorial hall's (hallNight.ts).
 *
 *  - Every `LM_*` material blends the DAY light map (`house_N_lm.webp`) with the NIGHT light map (`house_N_lm_night.webp`, the same UV
 *    set) by the village's night weight;
 *  - the window panorama (`M_view`, houseModelPrep.ts) shows the top half of `house_N_view.webp` by day and the bottom half at night.
 *
 * The weight is one shared uniform object and the night map another, written once per frame / when its file is in, so every patched
 * material of the house follows without a per-material write. Until a night map is in the weight stays 0: a house is never dark for
 * want of a file. A house with no light bake (the blockout) never touches any of this.
 */

/** The weight of the night (0 day .. 1 night), shared by every patched material. */
export const houseNightUniform = { value: 0 };
/** The night light map (the day map's UV set), or null until it is loaded. */
export const houseNightMapUniform: { value: Texture | null } = { value: null };

const patched = new WeakSet<Material>();

const PARS = /* glsl */ `uniform float uHouseNight;
uniform sampler2D uHouseNightMap;
void main() {`;
const TEXEL_FROM = "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );";
// Both maps are always read (no branch around a texture fetch); the night map is a 1 x 1 black placeholder until its file is in and the
// weight is 0 then.
const TEXEL_TO = /* glsl */ `vec4 lightMapTexel = vec4( texture2D( lightMap, vLightMapUv ).rgb * ( 1.0 - uHouseNight ) + texture2D( uHouseNightMap, vLightMapUv ).rgb * uHouseNight, 1.0 );`;

/** Let a light-mapped material blend the night map in (idempotent). */
export function patchHouseLightmapMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.uniforms.uHouseNightMap = houseNightMapUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", PARS).replace(TEXEL_FROM, TEXEL_TO);
  };
  material.customProgramCacheKey = () => "house-lightmap-night";
  material.needsUpdate = true;
}

const VIEW_PARS = /* glsl */ `uniform float uHouseNight;
void main() {`;
// the panorama image: day on its top half, night on its bottom half (v up: the top half is v 0.5..1)
const VIEW_MAP = /* glsl */ `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vec2( vMapUv.x, vMapUv.y * 0.5 + 0.5 * ( 1.0 - uHouseNight ) ) );
	diffuseColor *= sampledDiffuseColor;
#endif`;

/** Let the window-view material show the panorama by day and by night (idempotent). The material needs its `map` set by the caller. */
export function patchHouseViewMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", VIEW_PARS).replace("#include <map_fragment>", VIEW_MAP);
  };
  material.customProgramCacheKey = () => "house-view-night";
  material.needsUpdate = true;
}

/** Back to day with no night map (a house was left). */
export function resetHouseNight(): void {
  houseNightUniform.value = 0;
  houseNightMapUniform.value = null;
}
