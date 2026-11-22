import type { Material } from "three";
import type { BackBand } from "@caysonverse/shared/village/seatBack";

/**
 * Flatten a seated avatar's back against its seat's backrest (shared/village/seatBack.ts says why). Every avatar material carries
 * three uniforms, and after skinning the vertex shader pushes whatever sticks out behind `uBackFace` (m behind the root, avatar
 * frame) forward onto it — `flattenedZ` in seatBack.ts is the same arithmetic. `uBackMix` 0 = off (a standing avatar, a backless
 * seat); the program is the one every avatar already uses (like installFade), nothing is compiled per avatar. The shadow pass
 * (a separate depth material) is not flattened: a few centimetres of shadow, never seen.
 */

const INSTALLED = "avatar_back_v1";

interface BackUniforms {
  uBackFace: { value: number };
  uBackBand: { value: [number, number, number, number] };
  uBackMix: { value: number };
}

function uniformsOf(material: Material): BackUniforms {
  const u = material.userData as { back?: BackUniforms };
  return (u.back ??= { uBackFace: { value: 0.72 }, uBackBand: { value: [0.15, 0.3, 1.3, 1.45] }, uBackMix: { value: 0 } });
}

/** The vertex-shader lines (after skinning) that do the flattening. */
export const BACK_SQUASH_GLSL = `#include <skinning_vertex>
  if ( uBackMix > 0.0 ) {
    float cvBehind = - transformed.z - uBackFace;
    if ( cvBehind > 0.0 ) transformed.z += cvBehind * uBackMix * smoothstep( uBackBand.x, uBackBand.y, transformed.y ) * ( 1.0 - smoothstep( uBackBand.z, uBackBand.w, transformed.y ) );
  }`;

/** Chains an existing onBeforeCompile; safe to call twice. */
export function installBackSquash(material: Material): void {
  if (material.userData[INSTALLED]) return;
  material.userData[INSTALLED] = true;
  const uni = uniformsOf(material);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uBackFace = uni.uBackFace;
    shader.uniforms.uBackBand = uni.uBackBand;
    shader.uniforms.uBackMix = uni.uBackMix;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float uBackFace;\nuniform vec4 uBackBand;\nuniform float uBackMix;\nvoid main() {")
      .replace("#include <skinning_vertex>", BACK_SQUASH_GLSL);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${INSTALLED}`;
}

/** How fast the flattening eases in / out (1/s): the sitter settles into the backrest over a third of a second. */
export const BACK_SQUASH_RATE = 3;

const state = new WeakMap<object, { face: number; mix: number }>();

/**
 * Per frame, for one avatar (`key` = its root, `materials` = its materials): ease toward flattened at `face` (0 = not on a backed
 * seat). Returns the share applied now.
 */
export function stepBackSquash(key: object, materials: readonly Material[], face: number, band: BackBand, delta: number): number {
  // DEV only (e2e/seat-clip-shots.mjs): `window.__cvNoBackSquash = true` shows the avatar as it was, for the before shots.
  if (import.meta.env.DEV && (globalThis as { __cvNoBackSquash?: boolean }).__cvNoBackSquash) face = 0;
  let st = state.get(key);
  if (!st) {
    if (!(face > 0)) return 0;
    st = { face, mix: 0 };
    state.set(key, st);
  }
  if (face > 0) st.face = face;
  const target = face > 0 ? 1 : 0;
  const step = BACK_SQUASH_RATE * Math.max(0, delta);
  st.mix = st.mix < target ? Math.min(target, st.mix + step) : Math.max(target, st.mix - step);
  for (const m of materials) {
    const u = uniformsOf(m);
    u.uBackFace.value = st.face;
    u.uBackMix.value = st.mix;
    const b = u.uBackBand.value;
    b[0] = band.riseLo;
    b[1] = band.riseHi;
    b[2] = band.fallLo;
    b[3] = band.fallHi;
  }
  return st.mix;
}
