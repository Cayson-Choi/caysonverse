import { Camera, DepthTexture, LessEqualCompare, LinearFilter, Matrix4, Scene, UnsignedIntType, Vector3, Vector4, WebGLRenderTarget, type Texture } from "three";
import type { Vec3 } from "./dayNightBlend";

/**
 * The real sun's light and live shadows on 케이슨 마을's unlit, light-mapped model (2026-11-16, docs/designs/sun-shadows)
 * — the pure part: the constants, the shared uniforms every patched material reads, the GLSL, and the shadow boxes'
 * math (unit-tested, sunShadows.test.ts). `LiveSunShadows.tsx` renders the maps and writes the uniforms every frame;
 * `bakedSunMask.ts` builds the baked sun's visibility in the light map's UV space once.
 *
 * The light (light-map units, L / 2 as the map stores it) on a day texel `d`:
 *
 *     d' = max(d - Kb * max(0, n.lb) * B, FLOOR * d) + K * c * max(0, n.l) * S
 *
 *  - the baked sun's direct light taken out (`Kb`, its direction `lb`, `B` its visibility from the UV-space mask) — only
 *    while the shipped day map still has it (before the next bake: the GLB's `asset.extras.cvLightmapSun` is not "live");
 *  - the real sun's direct light put back (`K * c`, its direction `l`), shadowed by the live maps (`S`: the near
 *    cascade round the player, the far one over the whole village);
 *  - `n` the surface's normal: the mesh's own when it has one (the next bake exports normals), else the face's from
 *    the screen derivatives of the world position (exact on the village's flat walls and ground).
 */

/** The bake's sun (art/village/tools/look.json): compass azimuth and elevation (°), the colour (sRGB hex). */
export const BAKE_SUN = { azimuthDeg: 70, elevationDeg: 20, colour: "#FFD6A8" } as const;

/**
 * The baked sun's direct light for n.l = 1, light-map units, × its linear colour (1, 0.67, 0.39). Measured from the sun
 * alone baked on the village (`bake_village.py --sunonly`): flat sunlit ground 0.36 L luminance at sin 20°, sunward
 * walls 0.96 L, luminance 1.05 L per n.l → red 1.46 L → 0.73 in the map's L / 2.
 */
export const SUN_DIRECT_K = 0.73;

/**
 * The sunny day's contrast. The bake's sky (an HDRI at 2.2 against a 4.8 sun) lit the pale plaza almost as much as
 * the sun did, so a shadow on it read only ~1.3× darker, where a clear noon in life is 2-4×: by full sun the sky's and
 * the bounce's share of the day map is taken to `SKY_SHARE` and the live sun is `SUN_GAIN` × the baked one's strength
 * (the exposure's adaptation, dayNightBlend `sunAdaptation`, keeps the lit ground's brightness). Both ease back to 1
 * as the sun sets: dusk and night keep the bake's soft light.
 */
export const SKY_SHARE = 0.68;
/**
 * The live sun's n.l is softened to this power: a low sun's light on the ground (n.l 0.1 at 6°) stays strong enough for
 * the long evening shadows to read, as they do in life against the dimming sky; a high sun's is barely changed.
 */
export const NL_POWER = 0.65;
export const SUN_GAIN = 1.45;

/** Never take the baked sun's light below this share of the texel (no black seam where the mask and the bake differ). */
export const BAKE_SUBTRACT_FLOOR = 0.3;

/** The GLB's mark of a day light map without the sun's direct light (bake_village.py SUN_SPLIT). */
export const LIGHTMAP_SUN_LIVE = "live";

/** Whether the crescent's probe (villageModelPrep MOON_PROBE) was fitted to a day map WITH the sun (re-fit at the next bake). */
export const MOON_PROBE_HAS_SUN = false; // vrb2: re-fitted for the sun-split bake (villageModelPrep MOON_PROBE.day)

/** The shadow direction's lowest elevation (°): lower and the live shadows stretch across the whole village. */
export const SHADOW_MIN_ELEVATION = 2;
/** How far toward the sun the shadow boxes reach (m): a low sun's casters far away still land in them. */
export const SHADOW_REACH = 400;
/** The tallest caster (m) a box must hold above the ground (the hall's roof, the zelkova, the trees). */
export const CASTER_TOP = 26;

/**
 * Per tier. `near`: the scene's key light is the near cascade (every frame, `nearHalf` m round the camera's spot,
 * `nearSize`²); without it the far cascade is all there is. The far cascade (`farSize`², the whole village) is redrawn
 * when the sun has moved `reaimDeg`, into a second map, `farChunks` slices of the casters a frame (no hitch), and swapped
 * in when done. Measured (docs/designs/sun-shadows): a cached near cascade redrawn as the player walked cost a phone
 * 50-80 ms frames at 4x throttle, so the light tier has none.
 */
export const SHADOW_TIER = {
  high: { near: true, nearStatic: true, nearHalf: 32, nearSize: 2048, farSize: 2048, farChunks: 2, reaimDeg: 0.15 },
  /**
   * The rich tier on a phone (chosen by hand: a touch device starts on the light one): the near cascade holds only what
   * moves (the players, the bus), the village's own shadows come from the far one. With the village in it every frame
   * it cost +7 ms at 4x throttle.
   */
  highTouch: { near: true, nearStatic: false, nearHalf: 24, nearSize: 1024, farSize: 2048, farChunks: 8, reaimDeg: 0.25 },
  low: { near: false, nearStatic: false, nearHalf: 32, nearSize: 2048, farSize: 2048, farChunks: 8, reaimDeg: 0.25 },
} as const;
export type ShadowTier = keyof typeof SHADOW_TIER;

/** The shadows' tier for a graphics tier on a device. */
export function shadowTierFor(tier: "high" | "low", touch: boolean): ShadowTier {
  return tier === "low" ? "low" : touch ? "highTouch" : "high";
}
/** The first of the layers the far cascade's slices are drawn by (one per slice, `farChunks` at most 8). */
export const CHUNK_LAYER = 6;

/** The layer the static casters (the village, its trees) are on as well as 0: the cached maps draw only it. */
export const STATIC_CASTER_LAYER = 5;

/** The baked sun mask's build: the village is cut into tiles this big (m), each lit by a depth map this size. */
export const MASK_TILE = 64;
export const MASK_MAP_SIZE = 2048;

/**
 * DEV only: `?sun=off` leaves the live sun and shadows out (the look and the cost from before them, for comparing);
 * production builds always have them.
 */
export function liveSunEnabled(): boolean {
  if (!import.meta.env.DEV || typeof location === "undefined") return true;
  return new URLSearchParams(location.search).get("sun") !== "off";
}

// ---------------------------------------------------------------------------------------------------------------
// The shared uniforms (one object each: one write reaches every patched material).

export const sunShadowUniforms = {
  /** The near cascade: depth map (compare), world → shadow texture matrix. */
  uSsNearMap: { value: null as Texture | null },
  uSsNearMat: { value: new Matrix4() },
  /** The far cascade. */
  uSsFarMap: { value: null as Texture | null },
  uSsFarMat: { value: new Matrix4() },
  /** The baked sun's visibility in the light map's UV space (R; G = coverage), or null. */
  uSsBakeMask: { value: null as Texture | null },
  /** x: near on, y: far on, z: take the baked sun out (fallback), w: the live sun's direct light on. */
  uSsOn: { value: new Vector4(0, 0, 0, 0) },
  /** x: near texel (m), y: far texel (m), z: near depth bias (depth units), w: far depth bias. */
  uSsTexel: { value: new Vector4(0.03, 0.2, 0.0005, 0.0005) },
  /** x: near PCF tap offset (texture units), y: far's. */
  uSsUv: { value: new Vector4(1 / 2048, 1 / 2048, 0, 0) },
  /** Toward the live shadow light (unit): the sun by day, the moon at night. */
  uSsSunDir: { value: new Vector3(0, 1, 0) },
  /** The live sun's direct light per n.l (light-map units, linear RGB). */
  uSsSun: { value: new Vector3(0, 0, 0) },
  /** Toward the baked sun (unit), and its direct light per n.l (light-map units). */
  uSsBakeDir: { value: new Vector3(0, 1, 0) },
  uSsBakeSun: { value: new Vector3(0, 0, 0) },
  /** x: how much the live shadows darken the night (the moon's), y: the old foliage cards' shade in shadow, z: DEV debug view, w: the runtime vegetation's sun share taken in shadow. */
  uSsShade: { value: new Vector4(0, 0.7, 0, 0) },
  /** × the day map's sky and bounce (SKY_SHARE by full sun, 1 without it). */
  uSsSky: { value: 1 },
  /**
   * × the light of a model with its own bake (`SS_FOREIGN_BAKE`: the fishing lake, the waterfall): `DayNightState.exposureKeep`,
   * the sun's exposure adaptation taken back, since the live sun that adaptation answers is not in their light (release 2).
   */
  uSsKeep: { value: 1 },
};
export type SunShadowUniforms = typeof sunShadowUniforms;

// ---------------------------------------------------------------------------------------------------------------
// The shadow boxes' math.

const RAD = Math.PI / 180;

/** The live shadow light's direction (unit, toward it): the given one with its elevation held at `min` degrees. */
export function shadowDirection(dir: Vec3, minElevationDeg = SHADOW_MIN_ELEVATION): Vec3 {
  const h = Math.hypot(dir[0], dir[2]);
  const el = Math.atan2(dir[1], h);
  const minEl = minElevationDeg * RAD;
  if (el >= minEl || h < 1e-9) {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return [dir[0] / len, dir[1] / len, dir[2] / len];
  }
  const c = Math.cos(minEl);
  return [(dir[0] / h) * c, Math.sin(minEl), (dir[2] / h) * c];
}

/** The angle between two unit vectors (°). */
export function angleDeg(a: Vec3, b: Vec3): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, d))) / RAD;
}

/**
 * The shadow camera's axes for a light direction `dir` (toward the light): the same as three's `lookAt` from the light
 * to its target with up +y (camera z = dir, x = up × z, y = z × x).
 */
export function lightBasis(dir: Vec3): { right: Vec3; up: Vec3 } {
  let rx = dir[2]; // (0,1,0) × dir = (dir.z, 0, -dir.x)
  let rz = -dir[0];
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const right: Vec3 = [rx, 0, rz];
  // up = dir × right
  const up: Vec3 = [dir[1] * rz - dir[2] * 0, dir[2] * rx - dir[0] * rz, dir[0] * 0 - dir[1] * rx];
  return { right, up };
}

/**
 * Move `centre` (in place) to the nearest point whose light-space x and y are whole multiples of `texelX`/`texelY`:
 * a box that slides with the player then moves by whole texels and its shadows never crawl.
 */
export function snapToTexels(centre: Vec3, dir: Vec3, texelX: number, texelY: number): Vec3 {
  const { right, up } = lightBasis(dir);
  const u = centre[0] * right[0] + centre[1] * right[1] + centre[2] * right[2];
  const v = centre[0] * up[0] + centre[1] * up[1] + centre[2] * up[2];
  const du = Math.round(u / texelX) * texelX - u;
  const dv = Math.round(v / texelY) * texelY - v;
  centre[0] += right[0] * du + up[0] * dv;
  centre[1] += right[1] * du + up[1] * dv;
  centre[2] += right[2] * du + up[2] * dv;
  return centre;
}

export interface OrthoBox {
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
}

/**
 * The orthographic shadow box for a world box `[minX, maxX] × [0, top] × [minZ, maxZ]` lit from `dir`, the light
 * standing `reach` metres from `centre` toward the light: the box's eight corners in the light's frame, the near plane
 * 1 m from the light (everything toward the sun within `reach` casts into it).
 */
export function orthoBoxFor(
  dir: Vec3,
  centre: Vec3,
  box: { minX: number; maxX: number; minZ: number; maxZ: number; top: number },
  reach = SHADOW_REACH,
): OrthoBox {
  const { right, up } = lightBasis(dir);
  let l = Infinity;
  let r = -Infinity;
  let b = Infinity;
  let t = -Infinity;
  let far = 0;
  for (const x of [box.minX, box.maxX]) {
    for (const y of [0, box.top]) {
      for (const z of [box.minZ, box.maxZ]) {
        const px = x - centre[0];
        const py = y - centre[1];
        const pz = z - centre[2];
        const u = px * right[0] + py * right[1] + pz * right[2];
        const v = px * up[0] + py * up[1] + pz * up[2];
        const d = reach - (px * dir[0] + py * dir[1] + pz * dir[2]); // distance from the light along its view
        l = Math.min(l, u);
        r = Math.max(r, u);
        b = Math.min(b, v);
        t = Math.max(t, v);
        far = Math.max(far, d);
      }
    }
  }
  return { left: l, right: r, bottom: b, top: t, near: 1, far: far + 1 };
}

/**
 * The fixed-size box of a near cascade (half `half` m on the ground round its centre): sized once per direction, so a
 * box that moves keeps its texel size (and its snapped shadows).
 */
export function nearBoxFor(dir: Vec3, half: number, top = CASTER_TOP, reach = SHADOW_REACH): OrthoBox {
  return orthoBoxFor(dir, [0, 0, 0], { minX: -half, maxX: half, minZ: -half, maxZ: half, top }, reach);
}

// ---------------------------------------------------------------------------------------------------------------
// GLSL.

/** Vertex: the world position (and the mesh's normal, when it has one) for the fragment's shadow lookups. */
export const SS_VERTEX_PARS = /* glsl */ `varying vec3 vSsWorld;
#ifdef SS_GEO_NORMAL
varying vec3 vSsNormal;
#endif
void main() {`;

export const SS_VERTEX_WORLD = /* glsl */ `#include <project_vertex>
	{
		vec4 ssW = vec4( transformed, 1.0 );
		mat3 ssN = mat3( modelMatrix );
#ifdef USE_INSTANCING
		ssW = instanceMatrix * ssW;
		ssN = ssN * mat3( instanceMatrix );
#endif
		vSsWorld = ( modelMatrix * ssW ).xyz;
#ifdef SS_GEO_NORMAL
		vSsNormal = ssN * normal;
#endif
	}`;

/**
 * Fragment: the uniforms and the lookups. `ssNormal()` faces the camera; `ssLive(p, n)` is the live shadow (1 lit,
 * 0 shadowed) toward `uSsSunDir`, the near cascade fading into the far one at its edge; `ssBaked(uv)` the baked sun's
 * visibility from the UV-space mask; `ssDay(d, uv, n, nl)` the day texel with the baked sun swapped for the live one.
 */
export const SS_FRAGMENT_PARS = /* glsl */ `uniform sampler2DShadow uSsNearMap;
uniform mat4 uSsNearMat;
uniform sampler2DShadow uSsFarMap;
uniform mat4 uSsFarMat;
uniform sampler2D uSsBakeMask;
uniform vec4 uSsOn;
uniform vec4 uSsTexel;
uniform vec4 uSsUv;
uniform vec3 uSsSunDir;
uniform vec3 uSsSun;
uniform vec3 uSsBakeDir;
uniform vec3 uSsBakeSun;
uniform vec4 uSsShade;
uniform float uSsSky;
uniform float uSsKeep;
varying vec3 vSsWorld;
#ifdef SS_GEO_NORMAL
varying vec3 vSsNormal;
#endif
// five taps of hardware 2x2 PCF: a soft edge about two texels wide
float ssPcf( sampler2DShadow map, vec3 c, float t ) {
#ifdef SS_ONE_TAP
	return textureLod( map, c, 0.0 );
#endif
	float s = textureLod( map, c, 0.0 ) * 0.2;
	s += textureLod( map, c + vec3( t * 0.96, t * 0.28, 0.0 ), 0.0 ) * 0.2;
	s += textureLod( map, c + vec3( - t * 0.28, t * 0.96, 0.0 ), 0.0 ) * 0.2;
	s += textureLod( map, c + vec3( - t * 0.96, - t * 0.28, 0.0 ), 0.0 ) * 0.2;
	s += textureLod( map, c + vec3( t * 0.28, - t * 0.96, 0.0 ), 0.0 ) * 0.2;
	return s;
}
// how far inside a cascade's texture a point is (0 at the edge .. 1 a margin in)
float ssInside( vec3 c, float margin ) {
	vec2 e = min( c.xy, 1.0 - c.xy );
	float z = step( 0.0, c.z ) * step( c.z, 1.0 );
	return smoothstep( 0.0, margin, min( e.x, e.y ) ) * z;
}
vec3 ssNormal() {
	vec3 n = normalize( cross( dFdx( vSsWorld ), dFdy( vSsWorld ) ) );
#ifdef SS_GEO_NORMAL
	if ( dot( vSsNormal, vSsNormal ) > 1e-6 ) n = normalize( vSsNormal );
#endif
	return dot( n, cameraPosition - vSsWorld ) < 0.0 ? - n : n;
}
float ssLive( vec3 n, float nl ) {
	// normal offset (more at grazing light) and a little toward the light: no acne, no peter-panning to speak of
	float slope = 1.0 - nl;
	float s = 1.0;
	float wNear = 0.0;
	if ( uSsOn.x > 0.5 ) {
		vec3 p = vSsWorld + n * uSsTexel.x * ( 0.6 + 1.6 * slope ) + uSsSunDir * uSsTexel.x * 0.5;
		vec4 c = uSsNearMat * vec4( p, 1.0 );
		wNear = ssInside( c.xyz, 0.06 );
		if ( wNear > 0.0 ) s = ssPcf( uSsNearMap, vec3( c.xy, c.z - uSsTexel.z ), uSsUv.x );
	}
	if ( wNear < 1.0 && uSsOn.y > 0.5 ) {
		vec3 p = vSsWorld + n * uSsTexel.y * ( 0.6 + 1.6 * slope ) + uSsSunDir * uSsTexel.y * 0.5;
		vec4 c = uSsFarMat * vec4( p, 1.0 );
		float wFar = ssInside( c.xyz, 0.01 );
		float sf = wFar > 0.0 ? mix( 1.0, ssPcf( uSsFarMap, vec3( c.xy, c.z - uSsTexel.w ), uSsUv.y ), wFar ) : 1.0;
		s = mix( sf, s, wNear );
	}
	return s;
}
`;

/** The day texel with the baked sun swapped for the live one (`ssDayN`, `ssDayNl`, `ssDayLit` set by `SS_MAIN_TOP`). */
export const SS_DAY_FUNCTION = /* glsl */ `vec3 ssDayN;
float ssDayNl;
float ssDayLit;
#ifdef SS_FOREIGN_BAKE
// a model with its OWN light map (the fishing lake, the waterfall; release 2): the village's UV-space mask knows none of its
// texels and its baked sun stays — the live shadows (the players', the village's casters) only take a share of the light, as
// the old shadow floor did, and the exposure's sun adaptation is taken back (uSsKeep)
vec3 ssDay( vec3 d, vec2 uv ) {
	return d * uSsKeep * ( 1.0 - uSsShade.y * ( 1.0 - ssDayLit ) * step( 1e-4, ssDayNl ) );
}
#else
vec3 ssDay( vec3 d, vec2 uv ) {
	vec3 live = uSsSun * ( ssDayNl * ssDayLit );
	vec3 outLight = d * uSsSky + live;
	if ( uSsOn.z > 0.5 ) {
		// the baked sun taken out where the mask knows the texel (the bake as it is elsewhere: far outside the village)
		vec2 m = texture2D( uSsBakeMask, uv ).rg;
		float known = smoothstep( 0.3, 0.7, m.g );
		float nlb = max( dot( ssDayN, uSsBakeDir ), 0.0 );
		vec3 swapped = max( d - uSsBakeSun * ( nlb * m.r ), d * ${BAKE_SUBTRACT_FLOOR.toFixed(2)} ) * uSsSky + live;
		outLight = mix( d, swapped, known );
	}
	if ( uSsShade.z > 0.5 ) {
		// DEV debug (LiveSunShadows __cvSunDiag.debug): 1 the live shadow, 2 the near cascade's coordinates, 3 the normal
		if ( uSsShade.z < 1.5 ) return vec3( ssDayLit );
		if ( uSsShade.z < 2.5 ) { vec4 c = uSsNearMat * vec4( vSsWorld, 1.0 ); return vec3( fract( c.xy * 10.0 ), c.z ); }
		if ( uSsShade.z < 3.5 ) return ssDayN * 0.5 + 0.5;
		if ( uSsShade.z < 4.5 ) return vec3( texture2D( uSsBakeMask, uv ).rg, 0.0 );
		if ( uSsShade.z < 5.5 ) return d;
		return outLight * 0.5;
	}
	return outLight;
}
#endif
// the crescent's probe (no light map: no mask; its baked sun is smooth over the normal)
vec3 ssProbeDay( vec3 d, vec3 n, float lit ) {
#if ${MOON_PROBE_HAS_SUN ? 1 : 0}
	if ( uSsOn.w > 0.0 ) d = max( d - uSsBakeSun * max( dot( n, uSsBakeDir ), 0.0 ), d * ${BAKE_SUBTRACT_FLOOR.toFixed(2)} );
#endif
	return d * uSsSky + uSsSun * ( pow( max( dot( n, uSsSunDir ), 0.0 ), ${NL_POWER.toFixed(2)} ) * lit );
}
// the live shadows at night (the moon's): a gentle darkening of the night map
float ssNightShade() {
	return 1.0 - uSsShade.x * ( 1.0 - ssDayLit ) * step( 1e-4, ssDayNl );
}
`;

/** Top of main: the normal, n.l and the live shadow (once per fragment; sampled only where the sun can reach). */
export const SS_MAIN_TOP = /* glsl */ `	ssDayN = ssNormal();
	ssDayNl = pow( max( dot( ssDayN, uSsSunDir ), 0.0 ), ${NL_POWER.toFixed(2)} );
	ssDayLit = 1.0;
	if ( uSsOn.w > 0.0 ) ssDayLit = ssLive( ssDayN, ssDayNl );`;

/** The slice of a renderer `inRenderPass` uses. */
interface Renderer {
  autoClear: boolean;
  render(scene: Scene, camera: Camera): void;
}
const kicker = new Scene();
const kickCamera = new Camera();

/**
 * Run `fn` inside a renderer pass: three's `WebGLShadowMap.render` and `renderBufferDirect` need the renderer's current
 * render state, which only exists while `render` runs. An empty scene is rendered (nothing drawn, nothing cleared) and
 * `fn` runs in its `onAfterRender`. An error in `fn` is thrown after the pass has closed.
 */
export function inRenderPass(gl: Renderer, fn: () => void): void {
  let error: unknown = null;
  kicker.onAfterRender = () => {
    try {
      fn();
    } catch (e) {
      error = e;
    }
  };
  const autoClear = gl.autoClear;
  gl.autoClear = false;
  try {
    gl.render(kicker, kickCamera);
  } finally {
    gl.autoClear = autoClear;
    kicker.onAfterRender = () => {};
  }
  if (error) throw error;
}

/** The slice of a renderer `ensureShadowPlaceholder` uses. */
interface TargetRenderer extends Renderer {
  getRenderTarget(): WebGLRenderTarget | null;
  setRenderTarget(t: WebGLRenderTarget | null): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
}
let placeholder: { gl: unknown; target: WebGLRenderTarget } | null = null;

/**
 * A 1×1 comparison depth texture (cleared to the far plane: "lit"), bound to the shadow samplers while a cascade has no
 * map yet or the live sun is off. three's own empty shadow texture is not a comparison texture on every driver
 * (Chrome/ANGLE: "Mismatch between texture format and sampler type"), and the village's shaders bind the samplers on
 * every draw. Made once per renderer, before the village's first frame (VillageModel).
 */
export function ensureShadowPlaceholder(gl: TargetRenderer): Texture {
  if (placeholder && placeholder.gl === gl) return placeholder.target.depthTexture!;
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: true });
  const depth = new DepthTexture(1, 1, UnsignedIntType);
  depth.compareFunction = LessEqualCompare;
  depth.minFilter = LinearFilter;
  depth.magFilter = LinearFilter;
  target.depthTexture = depth;
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(target);
  gl.clear(true, true, false);
  gl.setRenderTarget(prev);
  placeholder?.target.dispose();
  placeholder = { gl, target };
  if (!sunShadowUniforms.uSsNearMap.value) sunShadowUniforms.uSsNearMap.value = depth;
  if (!sunShadowUniforms.uSsFarMap.value) sunShadowUniforms.uSsFarMap.value = depth;
  return depth;
}

/** The placeholder (see `ensureShadowPlaceholder`), or null before it is made. */
export function shadowPlaceholder(): Texture | null {
  return placeholder?.target.depthTexture ?? null;
}

/** Every `sunShadowUniforms` entry onto a shader's uniforms (the same objects). */
export function bindSunShadowUniforms(target: Record<string, { value: unknown }>): void {
  Object.assign(target, sunShadowUniforms);
}
