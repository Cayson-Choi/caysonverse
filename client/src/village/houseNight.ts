import type { Material, Texture } from "three";
import { FLAME_GLSL, houseFireTime, houseHearthMax, houseHearthMin } from "./houseFire";

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
/**
 * Curtains (`LM_drape` / `E_H_drape`) read as thin cloth with the day behind them: by day the light map's texel is lifted a little
 * (daylight comes through the weave), at night not. A cheap stand-in for translucency in an unlit-under-light-map house.
 */
const DRAPE_TEXEL_TO = TEXEL_TO.replace("* uHouseNight, 1.0 );", "* uHouseNight, 1.0 ) * vec4( vec3( 1.0 + 0.3 * ( 1.0 - uHouseNight ) ), 1.0 );");

export function patchHouseLightmapMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const drape = material.name === "LM_drape" || material.name === "E_H_drape";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.uniforms.uHouseNightMap = houseNightMapUniform;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", PARS).replace(TEXEL_FROM, drape ? DRAPE_TEXEL_TO : TEXEL_TO);
  };
  material.customProgramCacheKey = () => (drape ? "house-lightmap-night-drape" : "house-lightmap-night");
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
uniform vec3 uHearthMin;
uniform vec3 uHearthMax;
uniform float uHouseFireTime;
varying vec3 vHouseWorld;
void main() {`;
const GLOW_COLOR = /* glsl */ `#include <color_fragment>
	diffuseColor.rgb *= mix( ${GLOW_DAY.toFixed(3)}, 1.0, uHouseNight );${FLAME_GLSL}`;

/** Let a bulb / lamp-shade material glow at night and calm down by day (idempotent). */
export function patchHouseGlowMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.uniforms.uHearthMin = houseHearthMin;
    shader.uniforms.uHearthMax = houseHearthMax;
    shader.uniforms.uHouseFireTime = houseFireTime;
    // the world position of the fragment: the fireplace's flame cones are coloured as a fire (houseFire.ts)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHouseWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvHouseWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", GLOW_PARS).replace("#include <color_fragment>", GLOW_COLOR);
  };
  material.customProgramCacheKey = () => "house-glow-night-fire";
  material.needsUpdate = true;
}

/** Back to day with no night map (a house was left). */
export function resetHouseNight(): void {
  houseNightUniform.value = 0;
  houseNightMapUniform.value = null;
}
