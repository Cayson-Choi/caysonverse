import type { Material } from "three";

/**
 * Screen-door crossfade between a full avatar and its far stand-in (crowdImpostor.ts): both are drawn for a quarter of a second,
 * each through the complementary half of the same dither pattern, so the swap is a dissolve, not a pop.
 *   - a full avatar's materials discard the fragments whose dither value is BELOW `userData.fadeCut.value` (0 = draw everything);
 *   - the stand-in draws only the fragments whose dither value is below its alpha.
 * One program serves every avatar (the cut is a per-material uniform), so nothing extra is compiled per avatar.
 */
export const FADE_GLSL = `float cvDither( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }`;

/** A material's own cut uniform (created on first call). */
export function fadeCutOf(material: Material): { value: number } {
  const u = material.userData as { fadeCut?: { value: number } };
  return (u.fadeCut ??= { value: 0 });
}

const INSTALLED = "avatar_fade_v1";

/** Make a material discard its dithered share (see above). Chains an existing onBeforeCompile; safe to call twice. */
export function installFade(material: Material): void {
  if (material.userData[INSTALLED]) return;
  material.userData[INSTALLED] = true;
  const cut = fadeCutOf(material);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uFadeCut = cut;
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `uniform float uFadeCut;\n${FADE_GLSL}\nvoid main() {\n  if ( uFadeCut > 0.0 && cvDither( gl_FragCoord.xy ) < uFadeCut ) discard;`,
    );
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${INSTALLED}`;
  material.needsUpdate = true;
}

/** Set the cut of all of an avatar's materials. */
export function setFadeCut(materials: readonly Material[], v: number): void {
  for (const m of materials) fadeCutOf(m).value = v;
}
