import type { MeshStandardMaterial, WebGLProgramParametersWithUniforms } from "three";

/**
 * The coaster's track seen from far away (owner 2026-11-19, riding the 하늘 등불 바퀴: "급행 레일을 따라서 회색 선들이 막 지나가는게 보여").
 * The rails are 13 cm tubes, the ties 7 cm: at the wheel's 170-300 m they are a fraction of a pixel wide. The post chain draws the scene
 * without multisampling (postChain.ts: FXAA only), so a sub-pixel line is hit or missed by the pixel centres and the light-grey rails, their
 * seats and the glossy hex tubes' glints crawl along the track as the gondola moves. Two cures, both a function of the distance only:
 *  - a line never gets thinner than FAR_STEEL.minPx on the screen: every vertex is pushed out along its normal by the part of that width the
 *    real geometry lacks (a rail stays a continuous line; a 40 cm pillar, which is already wider, is not touched);
 *  - the light rails melt into the spine's deep indigo (the colour key below) and every steel part goes matte (no metal, no gloss variation)
 *    between FAR_STEEL.fadeFrom and fadeTo metres, so what is left is a calm dark band, not a bright dashed line.
 * Near the track (the station, the queue, the cars' own view) the material is exactly what it was.
 */
export const FAR_STEEL = {
  /** The least a part's width gets on the screen (px) once it is thinner than that. */
  minPx: 1.1,
  /** The offset never exceeds this much per side (m): a lattice's thin struts do not grow into slabs at the far end of the park. */
  maxOffsetM: 0.3,
  fadeFrom: 70,
  fadeTo: 190,
  /** The track's rail colour (coasterGeometry COLORS.rail) and how close a vertex colour must be to count as a rail. */
  rail: [0.78, 0.8, 0.84] as const,
  railTolerance: 0.03,
  /** What the rails melt to: the spine's indigo, a little lighter (linear, as the vertex colours are). */
  melt: [0.12, 0.14, 0.4] as const,
} as const;

/** The offset (m) a vertex is pushed out by, for a screen whose pixel is `pxM` metres at its distance (the shader does the same sum). */
export function farOffset(pxM: number, realHalfWidthM: number): number {
  const wantHalf = 0.5 * FAR_STEEL.minPx * pxM;
  return Math.min(FAR_STEEL.maxOffsetM, Math.max(0, wantHalf - realHalfWidthM));
}

/** How far into the fade a part at `distM` is (0 near .. 1 far; smoothstep). */
export function farFade(distM: number): number {
  const t = Math.min(1, Math.max(0, (distM - FAR_STEEL.fadeFrom) / (FAR_STEEL.fadeTo - FAR_STEEL.fadeFrom)));
  return t * t * (3 - 2 * t);
}

/** The uniform the shader reads: the size of one screen pixel at one metre of depth (2 / drawing-buffer height; the projection adds the fov). */
export const farSteelUniform = { value: 2 / 800 };

const f = (n: number): string => n.toFixed(4);

/** Patch a steel material (vertex-coloured MeshStandardMaterial, no skinning, no instancing) with the far-distance rules above. */
export function applyFarSteel(m: MeshStandardMaterial): void {
  const R = FAR_STEEL.rail;
  const M = FAR_STEEL.melt;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uFarPx = farSteelUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uFarPx;\nvarying float vFarDist;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vec4 farMv = modelViewMatrix * vec4( transformed, 1.0 );
float farD = max( -farMv.z, 0.0 );
vFarDist = farD;
// the width one screen pixel has at this depth; the half of FAR minPx of it, less what the part has itself (taken as a 6.5 cm radius)
float farPxM = farD * uFarPx / projectionMatrix[ 1 ][ 1 ];
transformed += normalize( objectNormal ) * min( ${f(FAR_STEEL.maxOffsetM)}, max( 0.0, ${f(0.5 * FAR_STEEL.minPx)} * farPxM - 0.065 ) );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vFarDist;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float farK = smoothstep( ${f(FAR_STEEL.fadeFrom)}, ${f(FAR_STEEL.fadeTo)}, vFarDist );
#ifdef USE_COLOR
if ( abs( vColor.r - ${f(R[0])} ) < ${f(FAR_STEEL.railTolerance)} && abs( vColor.g - ${f(R[1])} ) < ${f(FAR_STEEL.railTolerance)} && abs( vColor.b - ${f(R[2])} ) < ${f(FAR_STEEL.railTolerance)} )
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( ${f(M[0])}, ${f(M[1])}, ${f(M[2])} ), farK );
#endif`,
      )
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 1.0, farK );`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - farK;`);
  };
  m.customProgramCacheKey = () => "coasterFarSteel_v1";
  m.needsUpdate = true;
}
