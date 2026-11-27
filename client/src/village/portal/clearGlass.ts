import { DoubleSide, ShaderMaterial, Vector3, Vector4, type Material } from "three";
import { PICK_SOLID_KEY } from "../../game/clickPick";
import type { DayNightState } from "../dayNightBlend";

/**
 * Clear window glass for every building (owner 2026-11-21: "모든 유리창을 투명하게 만들어 건물 밖에서도 유리창을 통해서 안이 보이게
 * … 건물안에서 밖을 볼때 투명한 유리창으로 밖이 잘 보이게"; of the old glass "유리창이 뭔가 사실적이지 않아": a milky sheet with a painted
 * streak). The café's facade glass (cafe/CafeShowcase.tsx `facadeGlassMaterial`, feat/cafe-real) generalised: one material for any
 * building's panes, where the room behind is drawn for real (RoomShowcase.tsx) only near the camera.
 *
 *  - Over a building whose room is drawn (its box is one of `uShown`): float glass — 4 % reflective head-on (Schlick F0 0.04), a mirror
 *    at a grazing angle, reflecting the sky above the horizon and the street and houses opposite just below it (research, Aside
 *    2026-11-21: a house window by day reads 0–50 % room behind a sky / tree reflection, more reflection as the angle flattens).
 *  - Elsewhere (farther, or no room drawn): the same reflection over a dark room — a dark reflective pane — and at night the warm glow
 *    of a lit room (no window is ever a hole into an empty shell).
 *  - No texture, no painted streak; one ShaderMaterial (no lights: a pane's own light is what it reflects).
 */

/** DEV `?rooms=off`: no room drawn behind any glass (the before / after measurements of e2e/glass-shots.mjs). Production: on. */
export function showcaseRooms(): boolean {
  if (!import.meta.env.DEV || typeof location === "undefined") return true;
  return new URLSearchParams(location.search).get("rooms") !== "off";
}

/** How many building boxes a pane material can test (the lots: 5, the houses: 10, with a few to spare). */
export const CLEAR_GLASS_BOXES = 12;

/** The sky, street and ground the panes reflect, and the night's glow: shared by every clear pane (applyClearGlassDayNight). */
const shared = {
  uSkyTop: { value: new Vector3(0.35, 0.55, 0.85) },
  uSkyHorizon: { value: new Vector3(0.8, 0.85, 0.9) },
  uGround: { value: new Vector3(0.22, 0.24, 0.2) },
  uGlow: { value: new Vector3(1.0, 0.62, 0.32) },
  uNight: { value: 0 },
};

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
	vec4 w = modelMatrix * vec4( position, 1.0 );
	vWorld = w.xyz;
	vNormalW = mat3( modelMatrix ) * normal;
	gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform float uNight;
uniform float uDarkAlpha;
uniform float uWarmVeil;
uniform vec4 uShown[ ${CLEAR_GLASS_BOXES} ];
uniform int uShownCount;
varying vec3 vWorld;
varying vec3 vNormalW;
float glassShown( vec2 p ) {
	for ( int i = 0; i < ${CLEAR_GLASS_BOXES}; i++ ) {
		if ( i >= uShownCount ) break;
		vec4 b = uShown[ i ];
		if ( p.x >= b.x && p.x <= b.z && p.y >= b.y && p.y <= b.w ) return 1.0;
	}
	return 0.0;
}
void main() {
	vec3 V = normalize( cameraPosition - vWorld );
	vec3 N = vNormalW;
	// a pane exported without normals: the face's own normal from the position's derivatives
	N = dot( N, N ) < 0.25 ? cross( dFdx( vWorld ), dFdy( vWorld ) ) : N;
	N = normalize( N );
	if ( dot( N, V ) < 0.0 ) N = - N;
	float c = clamp( dot( N, V ), 0.0, 1.0 );
	float F = 0.04 + 0.96 * pow( 1.0 - c, 5.0 );
	vec3 R = reflect( - V, N );
	// what the pane mirrors: the sky above the horizon, the street and the houses opposite a little below it, the ground under them
	float h = R.y;
	vec3 sky = mix( uSkyHorizon, uSkyTop, smoothstep( 0.0, 0.6, h ) );
	float band = smoothstep( - 0.02, 0.06, h ) * ( 1.0 - smoothstep( 0.06, 0.22, h ) );
	vec3 street = mix( uGround, uSkyHorizon * 0.55, 0.35 + 0.3 * sin( atan( R.z, R.x ) * 9.0 ) );
	vec3 env = h > 0.0 ? mix( sky, street, band * 0.8 ) : mix( street, uGround, smoothstep( 0.0, - 0.3, h ) );
	// over a drawn room: clear (alpha = its reflectance); else a dark pane with a lit room's warm glow at night
	float opaque = 1.0 - glassShown( vWorld.xz );
	vec3 inside = mix( vec3( 0.03, 0.03, 0.032 ), uGlow * 0.55, uNight );
	float a = mix( F, mix( uDarkAlpha, 1.0, F ), opaque );
	vec3 col = env * F + inside * opaque * ( 1.0 - F ) * uDarkAlpha;
	// a clear pane at night: the warm haze of the lit room on the glass itself
	col += uGlow * 0.04 * uNight * ( 1.0 - opaque );
	a = max( a, 0.04 * uNight * ( 1.0 - opaque ) );
	// (uWarmVeil, the houses) and the lamplight in the room's air and lace seen from the dark street: a warm veil over the room
	float veil = uWarmVeil * uNight * ( 1.0 - opaque );
	col += uGlow * 0.6 * veil;
	a += veil * ( 1.0 - a );
	gl_FragColor = vec4( col / max( a, 1e-3 ), a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export type GlassBox = readonly [number, number, number, number];

export interface ClearGlass {
  material: ShaderMaterial;
  /** Set the boxes (village x0, z0, x1, z1) whose rooms are drawn now: their panes are clear. */
  setShown(boxes: ReadonlyArray<GlassBox>): void;
}

/**
 * A clear-glass material (replaces a model's `M_glass`). `darkAlpha`: how much the far pane hides what is behind it (the lots' shells are
 * hollow: nearly all). `warmVeil`: at night, how much of a drawn room is seen through a warm lamplit haze (the houses, 2026-11-27: their
 * real rooms behind clear glass read darker and greyer from the street than the old lit cards).
 */
export function clearGlassMaterial(name = "M_glass", darkAlpha = 0.94, warmVeil = 0): ClearGlass {
  const shown = Array.from({ length: CLEAR_GLASS_BOXES }, () => new Vector4(0, 0, -1, -1));
  const count = { value: 0 };
  const material = new ShaderMaterial({
    name,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { ...shared, uShown: { value: shown }, uShownCount: count, uDarkAlpha: { value: darkAlpha }, uWarmVeil: { value: warmVeil } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  // a see-through material is never picked by the click ray; the glass is a wall's face for a tap (as the model's glass was)
  material.userData[PICK_SOLID_KEY] = true;
  return {
    material,
    setShown(boxes) {
      const n = Math.min(CLEAR_GLASS_BOXES, boxes.length);
      for (let i = 0; i < n; i++) shown[i]!.set(...boxes[i]!);
      count.value = n;
    },
  };
}

/** Per frame (number writes only): the sky and the night, from the village's day / night state. */
export function applyClearGlassDayNight(o: Pick<DayNightState, "night" | "lights" | "golden">): void {
  const day = Math.max(0, Math.min(1, 1 - o.night));
  shared.uSkyTop.value.set(0.3 * day + 0.02, 0.5 * day + 0.03, 0.85 * day + 0.06);
  shared.uSkyHorizon.value.set(0.85 * day + 0.04 + 0.3 * o.golden, 0.85 * day + 0.04 + 0.12 * o.golden, 0.9 * day + 0.07);
  shared.uGround.value.set(0.2 * day + 0.02, 0.22 * day + 0.02, 0.18 * day + 0.02);
  shared.uNight.value = Math.max(o.lights, o.night);
}

/** The houses' window cards step aside where a house's rooms are drawn (portal/HouseShowcase.tsx sets the box: x0, z0, x1, z1). */
export const houseCardHide = { uCardHide: { value: new Vector4(0, 0, -1, -1) } };
/** The cards behind the memorial's shop front step aside while the hall is drawn there (portal/MemorialShowcase.tsx). */
export const memorialCardHide = { uCardHide: { value: new Vector4(0, 0, -1, -1) } };

/**
 * Discard a card material's fragments inside the box `hide` (village x0, z0, x1, z1), in place, chained after its own patch: the lit window
 * cards (a curtain, a painted room) stand where the real room is drawn now.
 */
export function patchCardHide(m: Material, hide: { value: Vector4 }): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uCardHide = hide;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vCardXZ;\nvoid main() {")
      .replace("#include <project_vertex>", "#include <project_vertex>\n\tvCardXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;");
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      "uniform vec4 uCardHide;\nvarying vec2 vCardXZ;\nvoid main() {\n\tif ( vCardXZ.x > uCardHide.x && vCardXZ.x < uCardHide.z && vCardXZ.y > uCardHide.y && vCardXZ.y < uCardHide.w ) discard;",
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|cards`;
  m.needsUpdate = true;
}

/** The houses' window cards (housesPrep.ts). */
export function patchWindowCards(m: Material): void {
  patchCardHide(m, houseCardHide.uCardHide);
}
