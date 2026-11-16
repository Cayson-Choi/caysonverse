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
uniform float uHouseNightGain;
uniform sampler2D uHouseNightMap;
void main() {`;
const TEXEL_FROM = "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );";
// Both maps are always read (no branch around a texture fetch); the night map is a 1 x 1 black placeholder until its file is in and the
// weight is 0 then.
const TEXEL_TO = /* glsl */ `vec4 lightMapTexel = vec4( texture2D( lightMap, vLightMapUv ).rgb * ( 1.0 - uHouseNight ) + texture2D( uHouseNightMap, vLightMapUv ).rgb * uHouseNightGain * uHouseNight, 1.0 );`;

/**
 * The light a pale wall's BACK face gets (day, night; the light map's encoding): the builders' outer walls show the room their outward
 * face (the inner face's winding is reversed), which the bake lit from OUTSIDE — clipped white by day, the night sky's navy at night
 * (G round 3: the walls round every window). Seen from inside, such a face gets a plain room light instead, warm at night.
 */
export const WALL_BACK_DAY: readonly [number, number, number] = [0.92, 0.88, 0.82];
export const WALL_BACK_NIGHT: readonly [number, number, number] = [0.5, 0.41, 0.3];
const v3 = (c: readonly [number, number, number]) => `vec3( ${c.map((x) => x.toFixed(3)).join(", ")} )`;
const TEXEL_TO_PALE = /* glsl */ `${TEXEL_TO}
	if ( ! gl_FrontFacing ) lightMapTexel.rgb = mix( ${v3(WALL_BACK_DAY)}, ${v3(WALL_BACK_NIGHT)}, uHouseNight );`;

/** Let a light-mapped material blend the night map in (idempotent). `pale`: a wall / ceiling / trim material (its back faces: WALL_BACK_*). */
export function patchHouseLightmapMaterial(material: Material, pale = false): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.uniforms.uHouseNightMap = houseNightMapUniform;
    shader.uniforms.uHouseNightGain = houseNightGainUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", PARS).replace(TEXEL_FROM, pale ? TEXEL_TO_PALE : TEXEL_TO);
  };
  material.customProgramCacheKey = () => (pale ? "house-lightmap-night-pale" : "house-lightmap-night");
  material.needsUpdate = true;
}

/** Day brightness of the window panorama (1 at night). */
export const VIEW_DAY = 0.86;

const VIEW_PARS = /* glsl */ `uniform float uHouseNight;
void main() {`;
// The panorama image: day on its top half, night on its bottom half. The texture is not flipped (glTF), so v = 0 is the image's top row;
// the band's v runs 0 (its top) .. 1 (its bottom) after the map's transform (houseModelPrep.ts houseViewMapping): the day half is 0..0.5,
// the night half 0.5..1, cross-faded by the night weight (the v kept a texel off the halves' seam so the day never bleeds into the night).
// By day the view is dimmed a little (VIEW_DAY): an unlit sunny panorama beside the baked room read as a blown-out window.
const VIEW_MAP = /* glsl */ `#ifdef USE_MAP
	float houseViewV = clamp( vMapUv.y, 0.003, 0.997 ) * 0.5;
	vec4 sampledDiffuseColor = mix( texture2D( map, vec2( vMapUv.x, houseViewV ) ) * ${VIEW_DAY.toFixed(3)}, texture2D( map, vec2( vMapUv.x, houseViewV + 0.5 ) ), uHouseNight );
	diffuseColor *= vec4( sampledDiffuseColor.rgb, 1.0 );
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

/** Day brightness of a lamp's bulb and shade (1 at night): by day a shade is lit paper, not a lantern. */
export const GLOW_DAY = 0.72;

const GLOW_PARS = /* glsl */ `uniform float uHouseNight;
void main() {`;
const GLOW_COLOR = /* glsl */ `#include <color_fragment>
	diffuseColor.rgb *= mix( ${GLOW_DAY.toFixed(3)}, 1.0, uHouseNight );`;

/** Let a bulb / lamp-shade material glow at night and calm down by day (idempotent). */
export function patchHouseGlowMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", GLOW_PARS).replace("#include <color_fragment>", GLOW_COLOR);
  };
  material.customProgramCacheKey = () => "house-glow-night";
  material.needsUpdate = true;
}

/** Back to day with no night map (a house was left). */
export function resetHouseNight(): void {
  houseNightUniform.value = 0;
  houseNightMapUniform.value = null;
  houseNightGainUniform.value = 1;
}

/** The night map's strength (1 = as baked), per house (HOUSE_NIGHT_GAIN): set while that house is drawn. */
export const houseNightGainUniform = { value: 1 };
/**
 * Houses whose night bake came out too dark to see the room by (review 2026-11-16: house 8's 대청마루 at night was a black hall with a
 * lantern's pools of light): their night map is lifted this much in the game until the bake is redone.
 */
export const HOUSE_NIGHT_GAIN: Readonly<Partial<Record<number, number>>> = { 8: 2.2 };
