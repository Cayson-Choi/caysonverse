import type { Material, Texture } from "three";
import { FLAME_GLSL, houseEmberY, houseFireLight, houseFireTime, houseHearthMax, houseHearthMin } from "./houseFire";

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
uniform vec4 uHouseFire;
varying vec3 vHouseFireW;
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

/**
 * The fireplace's flickering light on the room (houses-real pass 2026-11-21): a warm fake point light (houseFire.ts houseFireLight, w = 0
 * in a house without a fire) added to the light map's texel, so it is multiplied by the albedo like the baked light. The model has no
 * normals (unlit, light-mapped): distance only, a smooth ~2.6 m falloff.
 */
const FIRE_LIGHT = /* glsl */ `
	float houseFireD = length( vHouseFireW - uHouseFire.xyz );
	float houseFireK = uHouseFire.w * pow( max( 0.0, 1.0 - houseFireD / 2.6 ), 2.2 );
	lightMapTexel.rgb += vec3( 1.0, 0.5, 0.18 ) * houseFireK * 0.4;`;

const FIRE_WORLD = /* glsl */ `#include <project_vertex>
	vec4 houseFireP = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	houseFireP = instanceMatrix * houseFireP;
#endif
	vHouseFireW = ( modelMatrix * houseFireP ).xyz;`;

export function patchHouseLightmapMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const drape = material.name === "LM_drape" || material.name === "E_H_drape";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.uniforms.uHouseNightMap = houseNightMapUniform;
    shader.uniforms.uHouseFire = houseFireLight;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHouseFireW;")
      .replace("#include <project_vertex>", FIRE_WORLD);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", PARS).replace(TEXEL_FROM, (drape ? DRAPE_TEXEL_TO : TEXEL_TO) + FIRE_LIGHT);
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
uniform float uEmberY;
uniform float uHouseFireTime;
varying vec3 vHouseWorld;
void main() {`;
const GLOW_COLOR = /* glsl */ `#include <color_fragment>
	diffuseColor.rgb *= mix( ${GLOW_DAY.toFixed(3)}, 1.0, uHouseNight );${FLAME_GLSL}`;
/**
 * A lamp's bulb at night: a warm white that is over 1 (the PC post chain's bloom makes it glow; the phone just sees it bright).
 * By day it is the plain dimmed bulb.
 */
const BULB_COLOR = /* glsl */ `#include <color_fragment>
	diffuseColor.rgb *= mix( ${GLOW_DAY.toFixed(3)}, 1.0, uHouseNight );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.5, 1.15, 0.7 ), uHouseNight );${FLAME_GLSL}`;
/**
 * A lamp shade at night (owner 2026-11-21: the house-5 floor lamp read as flat cream paint, not switched on): lit fabric — a warm
 * glow, brightest at the bottom rim where the bulb shines down through (vGlowT 0 at the rim .. 1 at the top, a vertex attribute
 * houseLampGlow.ts adds), a faint weave so it reads as cloth. By day it stays as it was.
 */
const SHADE_COLOR = /* glsl */ `#include <color_fragment>
	vec3 shadeDay = diffuseColor.rgb * ${GLOW_DAY.toFixed(3)};
	float shadeWeave = 1.0 + 0.035 * sin( ( vHouseWorld.x + vHouseWorld.z ) * 310.0 ) * sin( vHouseWorld.y * 290.0 );
	vec3 shadeNight = diffuseColor.rgb * mix( vec3( 1.85, 1.45, 0.95 ), vec3( 0.98, 0.66, 0.34 ), smoothstep( 0.0, 0.85, vGlowT ) ) * shadeWeave;
	diffuseColor.rgb = mix( shadeDay, shadeNight, uHouseNight );${FLAME_GLSL}`;

/** Let a bulb / lamp-shade material glow at night and calm down by day (idempotent). */
export function patchHouseGlowMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const legacy = import.meta.env.DEV && (globalThis as { __cvLampOld?: boolean }).__cvLampOld; // dev: the old flat lamp look (before shots)
  const shade = !legacy && material.name.endsWith("shade");
  const bulb = !legacy && !shade && material.name.endsWith("lamp");
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHouseNight = houseNightUniform;
    shader.uniforms.uHearthMin = houseHearthMin;
    shader.uniforms.uHearthMax = houseHearthMax;
    shader.uniforms.uEmberY = houseEmberY;
    shader.uniforms.uHouseFireTime = houseFireTime;
    // Locate the model's ember bed and old flame cards inside the exported hearth.
    const NL = "\n";
    const vPars = "varying vec3 vHouseWorld;" + (shade ? NL + "attribute float glowT;" + NL + "varying float vGlowTv;" : "");
    const vSet = "vHouseWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;" + (shade ? NL + "vGlowTv = glowT;" : "");
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>" + NL + vPars)
      .replace("#include <project_vertex>", "#include <project_vertex>" + NL + vSet);
    const fPars = shade ? GLOW_PARS.replace("varying vec3 vHouseWorld;", "varying vec3 vHouseWorld;" + NL + "varying float vGlowTv;" + NL + "#define vGlowT vGlowTv") : GLOW_PARS;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", fPars)
      .replace("#include <color_fragment>", shade ? SHADE_COLOR : bulb ? BULB_COLOR : GLOW_COLOR);
  };
  material.customProgramCacheKey = () => (shade ? "house-glow-shade" : bulb ? "house-glow-bulb" : "house-glow-night-fire");
  material.needsUpdate = true;
}

/** Back to day with no night map (a house was left). */
export function resetHouseNight(): void {
  houseNightUniform.value = 0;
  houseNightMapUniform.value = null;
}
