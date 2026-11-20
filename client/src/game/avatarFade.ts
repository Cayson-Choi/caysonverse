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

/**
 * A material's own near-lens fade uniform (created on first call): `[from, to]` in metres from the camera. A fragment nearer than
 * `from` is not drawn, one beyond `to` is drawn, in between a dithered share (screen door, like the cut above). `from` <= 0 = off.
 * Only the part of a body the lens is in or right against goes, never the whole body (owner 2026-11-20, on the bus: "카메라뷰를 위로
 * 올리면 상대가 아예 안보여" — a rider whose head came near the lens used to be hidden whole, so tilting the view up lost them).
 */
export function nearFadeOf(material: Material): { value: [number, number] } {
  const u = material.userData as { nearFade?: { value: [number, number] } };
  return (u.nearFade ??= { value: [0, 0] });
}

/** The near-lens fade (after the dither cut). Needs the lit materials' `vViewPosition` (minus the view-space position). */
export const NEAR_FADE_GLSL = `  if ( uNearFade.x > 0.0 && cvDither( gl_FragCoord.yx ) >= smoothstep( uNearFade.x, uNearFade.y, length( vViewPosition ) ) ) discard;`;

const INSTALLED = "avatar_fade_v2";
const HAS_VIEW_POSITION = /varying\s+vec3\s+vViewPosition\s*;/;

/** Make a material discard its dithered share (see above). Chains an existing onBeforeCompile; safe to call twice. */
export function installFade(material: Material): void {
  if (material.userData[INSTALLED]) return;
  material.userData[INSTALLED] = true;
  const cut = fadeCutOf(material);
  const near = nearFadeOf(material);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uFadeCut = cut;
    // the near-lens fade only where the program has the view position (every lit material; not an unlit one)
    const hasView = HAS_VIEW_POSITION.test(shader.fragmentShader);
    if (hasView) shader.uniforms.uNearFade = near;
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `uniform float uFadeCut;\n${hasView ? "uniform vec2 uNearFade;\n" : ""}${FADE_GLSL}\nvoid main() {\n  if ( uFadeCut > 0.0 && cvDither( gl_FragCoord.xy ) < uFadeCut ) discard;${hasView ? `\n${NEAR_FADE_GLSL}` : ""}`,
    );
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${INSTALLED}`;
}

/** Set the near-lens fade of all of an avatar's materials (`from` <= 0: off). */
export function setNearFade(materials: readonly Material[], from: number, to: number): void {
  for (const m of materials) {
    const v = nearFadeOf(m).value;
    v[0] = from;
    v[1] = to;
  }
}

/** Set the cut of all of an avatar's materials. */
export function setFadeCut(materials: readonly Material[], v: number): void {
  for (const m of materials) fadeCutOf(m).value = v;
}
