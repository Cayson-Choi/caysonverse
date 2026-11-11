import { DEFAULT_DECAL_Y, type GroundDecal } from "./groundDecal";

/**
 * How the destination ring (ClickMarker.tsx) sits on the ground — pure, so the numbers are tested.
 *
 * It used to lie at a fixed y = 0.02 with no polygon offset. The village's ground is thin layers 1-3 cm apart that
 * carry slope-scaled polygon offsets (plaza and road -1/-1, lanes -1/-2, plot lawns -1/-1, forecourt -1/-2,
 * villageModelPrep.ts GROUND_LAYER_OFFSET): at the grazing angles of a click 8 m or more away the offset outweighed
 * the ring's 1 cm lead and the paving won the depth test — the ring was set and drawn every frame and never reached
 * the screen (owner 2026-11-10: "간혹 안 나타나거나 제대로 표시가 안 된다"), and the forecourt (3 cm) lay over it
 * outright. The same hid it on the escape hall's rugs (3.6 cm) and the legacy rugs (2.2 cm).
 *
 * Now it lies on the surface that was clicked (the target's `y`, clickPick.ts) plus the scene's decal lift (5 cm in
 * the village, 3 cm elsewhere — groundDecal.ts), with a polygon offset stronger than every ground layer's on both terms
 * (the recipe of the blob shadows and the shadow floor), in every scene, drawn after the shadow floor and the blob
 * shadows. And it sees over the ground right around it (round 2 review: beside the ring road's 11 cm curb a third of
 * the ring was under the curb): its depth is taken RING_SEE_OVER up its view ray (ringDepthBias), so ground, a curb or a
 * step edge lower than that in front of it is drawn under it, while anything taller — a bench, a wall, an avatar —
 * still hides it as it should (the depth test stays on).
 *
 * Far away or seen edge-on (first person) it grows on the screen (ringScreenScale): a fixed 0.84 m ring 22 m ahead in
 * first person was a 2 px line.
 */

/** factor / units: more negative than every ground layer (-1 / -2 at most) and equal to the village's decals. */
export const RING_POLYGON_OFFSET = { factor: -2, units: -8 } as const;

/**
 * Drawn after the shadow floor and the decals (renderOrder 2) and after every see-through effect of the world — the
 * escape hall's sun shafts (3: an additive cone sorted after the ring by its distance washed half the ring out, round 2
 * review), the candles' halos and flames (3, 4), the gate's glow (4), the sparkles and the progress board (5) — but
 * before the name tags, bubbles and emoji (999+). The depth test still hides it behind anything solid.
 */
export const RING_RENDER_ORDER = 6;

/** The ring's radii (m) at scale 1 (ClickMarker's ring geometry). */
export const RING_INNER = 0.3;
export const RING_OUTER = 0.42;

/** How far above the ring's plane the ground around it may rise and still be drawn under the ring (m): a curb (5-11 cm). */
export const RING_SEE_OVER = 0.15;

/** The view ray's elevation is taken as at least this (sin) — level rays would make the bias infinite. */
const MIN_SIN_ELEV = 0.02;

/** How far above the clicked surface the ring lies (m): the scene's decal height, else the default 3 cm. */
export function ringLift(decal: GroundDecal | null | undefined): number {
  return decal ? decal.y : DEFAULT_DECAL_Y;
}

/** The ring's height for a target on a surface at `surfaceY`. */
export function ringY(surfaceY: number, decal: GroundDecal | null | undefined): number {
  return surfaceY + ringLift(decal);
}

/**
 * How much nearer the camera (m, along the view ray) a point of the ring takes its depth: where that ray is
 * RING_SEE_OVER above the ring's plane — so whatever lies lower than that in front of the point is behind the depth it
 * is tested at — but no more than the ring's own width (`scale` × its diameter: what is farther in front at a grazing
 * view is a real occluder) and never nearer the camera than 1.5 × its near plane. `dist`: the point's distance from
 * the camera; `sinElev`: the sine of the view ray's elevation at the point.
 */
export function ringDepthBias(dist: number, sinElev: number, scale: number, near: number): number {
  const bias = Math.min(RING_SEE_OVER / Math.max(sinElev, MIN_SIN_ELEV), 2 * RING_OUTER * scale);
  return Math.max(0, Math.min(bias, dist - 1.5 * near));
}

/**
 * ringDepthBias in the ring's vertex shader (after three's `project_vertex`): the depth of the point `bias` nearer the
 * camera along its view ray (the camera is the view space's origin), the screen position unchanged.
 */
export const RING_VERTEX_BIAS = /* glsl */ `#include <project_vertex>
{
  float ringDist = max(length(mvPosition.xyz), 1e-4);
  vec3 ringWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float ringSin = max((cameraPosition.y - ringWorld.y) / ringDist, ${MIN_SIN_ELEV.toFixed(2)});
  float ringBias = min(uRingSeeOver / ringSin, uRingBiasCap);
  ringBias = max(0.0, min(ringBias, ringDist - 1.5 * uRingNear));
  vec4 ringBiased = projectionMatrix * vec4(mvPosition.xyz * (1.0 - ringBias / ringDist), 1.0);
  gl_Position.z = ringBiased.z / ringBiased.w * gl_Position.w;
}`;

/** The uniforms RING_VERTEX_BIAS reads (prepended to the vertex shader). */
export const RING_VERTEX_PARS = /* glsl */ `uniform float uRingSeeOver;
uniform float uRingBiasCap;
uniform float uRingNear;
`;

/** On the screen the ring is at least this wide and this tall (CSS px), by growing up to RING_MAX_SCALE. */
export const RING_MIN_WIDTH_PX = 40;
export const RING_MIN_HEIGHT_PX = 8;
export const RING_MAX_SCALE = 4;

/**
 * How much larger than its 0.84 m the ring is drawn so it reads on the screen: its projected width (`viewportPx` the
 * canvas's height in CSS px, `fovDeg` the camera's vertical field of view) and its height (the width × the view's
 * sin elevation — a far ring is a thin ellipse) brought up to RING_MIN_WIDTH_PX / RING_MIN_HEIGHT_PX, at most
 * RING_MAX_SCALE. 1 near the avatar.
 */
export function ringScreenScale(dist: number, sinElev: number, fovDeg: number, viewportPx: number): number {
  const pxPerM = viewportPx / (2 * Math.max(dist, 1e-3) * Math.tan((fovDeg * Math.PI) / 360));
  const wide = 2 * RING_OUTER * pxPerM;
  const tall = wide * Math.max(sinElev, MIN_SIN_ELEV);
  return Math.min(RING_MAX_SCALE, Math.max(1, RING_MIN_WIDTH_PX / wide, RING_MIN_HEIGHT_PX / tall));
}

/**
 * The part of the ring something nearer covers (ClickMarker's see-through pass) is drawn as a dashed, thinner, fainter
 * ring: it reads as "a ring on the ground behind that", not as part of what covers it (round 5 review: drawn whole at
 * 0.7 through the player's own body, the ring sat on the head like a hair ornament). RING_GHOST_DASHES dashes round it,
 * each RING_GHOST_DUTY of its share of the round; the band from RING_GHOST_INNER to RING_GHOST_OUTER (the ring itself:
 * RING_INNER..RING_OUTER); no centre dot.
 */
export const RING_GHOST_OPACITY = 0.45;
export const RING_GHOST_DASHES = 16;
export const RING_GHOST_DUTY = 0.55;
export const RING_GHOST_INNER = 0.33;
export const RING_GHOST_OUTER = 0.39;

/** The see-through pass's vertex additions: the ring's own plane coordinates (its geometry lies in local x / y). */
export const RING_GHOST_VERTEX_PARS = /* glsl */ `varying vec2 vRingLocal;
`;
export const RING_GHOST_VERTEX = /* glsl */ `#include <begin_vertex>
vRingLocal = position.xy;
`;

/**
 * The see-through pass's fragment cut (after three's `alphamap_fragment`): only the dashes of the thinner band stay,
 * their edges smoothed over a pixel (the derivatives of the plane coordinates — the angle's own jump at its seam never
 * enters them), the rest discarded.
 */
export const RING_GHOST_FRAGMENT_PARS = /* glsl */ `varying vec2 vRingLocal;
`;
export const RING_GHOST_FRAGMENT = /* glsl */ `#include <alphamap_fragment>
{
  float ringR = length(vRingLocal);
  vec2 ringPx = fwidth(vRingLocal);
  float ringW = max(length(ringPx), 1e-5);
  float ringBand = smoothstep(${RING_GHOST_INNER.toFixed(3)} - ringW, ${RING_GHOST_INNER.toFixed(3)} + ringW, ringR)
    * (1.0 - smoothstep(${RING_GHOST_OUTER.toFixed(3)} - ringW, ${RING_GHOST_OUTER.toFixed(3)} + ringW, ringR));
  float ringTurn = atan(vRingLocal.y, vRingLocal.x) / 6.28318531 + 0.5;
  float ringDash = fract(ringTurn * ${RING_GHOST_DASHES.toFixed(1)});
  float ringDashW = ringW / max(ringR, 1e-4) * ${(RING_GHOST_DASHES / (2 * Math.PI)).toFixed(5)};
  float ringOn = smoothstep(0.0, ringDashW, ringDash) * (1.0 - smoothstep(${RING_GHOST_DUTY.toFixed(3)} - ringDashW, ${RING_GHOST_DUTY.toFixed(3)} + ringDashW, ringDash));
  diffuseColor.a *= ringBand * ringOn;
  if (diffuseColor.a < 0.004) discard;
}
`;
