import { Vector3, type MeshBasicMaterial } from "three";
import { BUS_SKY } from "../villageBusPrep";

/**
 * Clear window glass (owner 2026-11-21: "모든 유리창을 투명하게 … 투명한 유리창으로 밖이 잘 보이게"; of the old village glass
 * "유리창이 뭔가 사실적이지 않아": a milky sheet with a painted diagonal white streak).
 *
 * Real float glass passes ~92 % of the light head-on and reflects ~4 % (Schlick F0 0.04), climbing to a mirror at a grazing angle;
 * what it reflects is the scene in the mirrored direction — the sky above the horizon, the street and the opposite houses below
 * (research, Aside 2026-11-21: by day a house window reads 0–50 % room behind a sky / tree reflection, stronger as the angle
 * flattens; from inside by day the glass all but disappears). So: a nearly clear pane (alpha `clear`), the analytic sky and ground
 * of the village's glass (the bus's BUS_SKY colours) mirrored by the reflected ray, weighted by the Fresnel term — no texture, no
 * painted streaks. The reflection follows the time of day (`strength`: the sky light, dark at night, when the lit room inside wins).
 *
 * Lit materials (the houses', the lots', the bus's: MeshStandard) take it through villageBusPrep.addBusSky(…, "clear"); the village's
 * unlit glass (village.glb M_glass: the memorial's shop front, the lanterns, the kiosk) through `clearUnlitGlass` here.
 */

export const CLEAR_GLASS = {
  /** Head-on: how much the pane's own tint covers what is behind (the rest passes). */
  clear: 0.06,
  /** Schlick F0 of a clean pane. */
  f0: 0.04,
  /** The pane's faint tint (linear): float glass is a hair green-blue. */
  tint: [0.86, 0.93, 0.92] as const,
} as const;

/** The reflection's strength, shared by every unlit clear pane (applyClearGlassDayNight writes it). */
export const clearGlassSky = { value: 1 };

const sky = {
  uClearZenith: { value: new Vector3(...BUS_SKY.zenith) },
  uClearHorizon: { value: new Vector3(...BUS_SKY.horizon) },
  uClearGround: { value: new Vector3(...BUS_SKY.ground) },
  uClearGroundFar: { value: new Vector3(...BUS_SKY.groundFar) },
  uClearTint: { value: new Vector3(...CLEAR_GLASS.tint) },
  uClearAlpha: { value: CLEAR_GLASS.clear as number },
  uClearF0: { value: CLEAR_GLASS.f0 as number },
  uClearSky: clearGlassSky,
};

const VERT_PARS = /* glsl */ `varying vec3 vClearWorld;
void main() {`;
const VERT_WORLD = /* glsl */ `#include <project_vertex>
	vec4 clearWorld = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		clearWorld = instanceMatrix * clearWorld;
	#endif
	vClearWorld = ( modelMatrix * clearWorld ).xyz;`;

/** The mirrored sky and ground (world direction r), as the bus's glass and paint see them. */
export const CLEAR_SKY_GLSL = /* glsl */ `
vec3 clearSky( vec3 r ) {
	vec3 s = mix( uClearHorizon, uClearZenith, smoothstep( 0.0, 0.7, r.y ) );
	vec3 g = mix( uClearGroundFar, uClearGround, smoothstep( 0.0, 0.5, - r.y ) );
	return mix( g, s, smoothstep( - 0.25, 0.25, r.y ) );
}`;

const FRAG_PARS = /* glsl */ `varying vec3 vClearWorld;
uniform vec3 uClearZenith;
uniform vec3 uClearHorizon;
uniform vec3 uClearGround;
uniform vec3 uClearGroundFar;
uniform vec3 uClearTint;
uniform float uClearAlpha;
uniform float uClearF0;
uniform float uClearSky;
${CLEAR_SKY_GLSL}
void main() {`;

/** The pane: the face's normal from the world position's derivatives, the Fresnel term, the mirrored sky over a faint tint. */
const FRAG_OUT = /* glsl */ `#include <opaque_fragment>
	{
		vec3 V = normalize( cameraPosition - vClearWorld );
		vec3 N = normalize( cross( dFdx( vClearWorld ), dFdy( vClearWorld ) ) );
		if ( dot( N, V ) < 0.0 ) N = - N;
		float F = uClearF0 + ( 1.0 - uClearF0 ) * pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), 5.0 );
		vec3 R = reflect( - V, N );
		float a = mix( uClearAlpha, 1.0, F * uClearSky );
		vec3 col = ( clearSky( R ) * uClearSky * F + uClearTint * uClearAlpha * ( 1.0 - F ) * max( uClearSky, 0.15 ) ) / max( a, 1e-3 );
		gl_FragColor = vec4( col, clamp( a, 0.0, 0.9 ) );
	}`;

/** Turn an unlit glass material into clear glass, in place (its map, the painted streak, is dropped). */
export function clearUnlitGlass(m: MeshBasicMaterial): void {
  m.map = null;
  m.alphaMap = null;
  m.color.set(0xffffff);
  m.transparent = true;
  m.depthWrite = false;
  m.vertexColors = false;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sky);
    shader.vertexShader = shader.vertexShader.replace("void main() {", VERT_PARS).replace("#include <project_vertex>", VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", FRAG_PARS).replace("#include <opaque_fragment>", FRAG_OUT);
  };
  m.customProgramCacheKey = () => "village-clear-glass";
  m.needsUpdate = true;
}

/** Per frame: the reflection's strength (the bus's `busEnvScale`: the sky light, dim at night). */
export function applyClearGlassDayNight(env: number): void {
  clearGlassSky.value = env;
}
