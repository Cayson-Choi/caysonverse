import { LinearFilter, LinearMipmapLinearFilter, ShaderChunk, type Material, type Texture } from "three";

/**
 * Text that is part of the 3D scene (fix/pine-text, owner 2026-11-27: the signs, plates and labels stay soft on a phone).
 *
 * A phone draws the scene at dpr 1 (renderProfile.ts / quality.ts) and the browser stretches it ~3x; a sign's lettering is then
 * sampled into few framebuffer pixels. What still helps there, for the cost of nothing but a few shader instructions:
 *  - trilinear mipmaps (no shimmer while the eye moves) with the highest anisotropy the GPU has (three clamps it to the
 *    device's maximum): a sign seen at a slant keeps its strokes instead of smearing along the slant;
 *  - a small negative mip bias on the material's map (`TEXT_MIP_BIAS`): the mip chosen for the minified text is half a
 *    level sharper — the letters' edges stay crisp a little longer before they blur, at the price of a little more aliasing,
 *    which text on a flat board does not show.
 * Text that is read up close and works like UI is drawn on the label overlay at the device's pixel ratio instead
 * (labelOverlay.ts `planarLabels`: the focused cubby's name plate).
 */
export const TEXT_MIP_BIAS = -0.6;

/** The anisotropy a text texture asks for (three clamps it to the GPU's maximum, 16 on most). */
export const TEXT_ANISOTROPY = 16;

/** Mipmapped, trilinear, the GPU's highest anisotropy. Returns `t`. */
export function crispTextTexture<T extends Texture>(t: T): T {
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = TEXT_ANISOTROPY;
  t.needsUpdate = true;
  return t;
}

/** The map chunk with the text's mip bias (texture(sampler, uv, bias): fragment shaders only, as here). */
export function biasedMapChunk(bias: number = TEXT_MIP_BIAS): string {
  return ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", `texture2D( map, vMapUv, ${bias.toFixed(2)} )`);
}

/**
 * Sample `m`'s map with the text's mip bias. Chains onto the material's own onBeforeCompile and program key (the houses'
 * boards have their light patch). Idempotent. Returns `m`.
 */
export function sharpenTextMaterial<M extends Material>(m: M, bias: number = TEXT_MIP_BIAS): M {
  if (m.userData.textBias !== undefined) return m;
  m.userData.textBias = bias;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const chunk = biasedMapChunk(bias);
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", chunk);
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|text-bias${bias}`;
  m.needsUpdate = true;
  return m;
}

/**
 * Hide some of a merged mesh's lettering (inkLabels.ts: the label overlay draws those crisp): its vertices carry `aInk`, the
 * index of the board they letter (-1: not lettering), and a board whose `hidden[index]` is 1 is not drawn. Chains onto the
 * material's onBeforeCompile and program key, as `sharpenTextMaterial` does. Returns the flags (set them, no recompile).
 */
export function inkMaskMaterial<M extends Material>(m: M, count: number): Float32Array {
  const n = Math.max(1, count);
  const hidden = new Float32Array(n);
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.uniforms.uInkHide = { value: hidden };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aInk;\nuniform float uInkHide[${n}];\nvarying float vInkHide;`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvInkHide = aInk >= 0.0 ? uInkHide[int(aInk + 0.5)] : 0.0;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vInkHide;")
      .replace("#include <clipping_planes_fragment>", "if (vInkHide > 0.5) discard;\n#include <clipping_planes_fragment>");
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|ink-mask${n}`;
  m.needsUpdate = true;
  return hidden;
}
