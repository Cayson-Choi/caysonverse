import { DoubleSide, MeshBasicMaterial, Vector3, Vector4, type Texture } from "three";
import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import { cherryTintUniform, foliageTintUniform, liftUniform, litUniform, vegNightUniform } from "../villageModelPrep";

/**
 * The runtime vegetation's material (veg3d): the village's unlit look (MeshBasicMaterial, the light baked in, the
 * time of day's lift and tint) with what flat cards never had:
 *  - per-vertex shading from the baked sun's direction (the afternoon the village was baked in): a petal facing the
 *    sun is brighter than one facing away, so every leaf and flower shows its shape; thin parts let light through
 *    from behind (`back`);
 *  - the light where the plant stands (`aLight`: the old card's baked COLOR_0 for flowers, the crown depth for
 *    blossoms) and the instance's colour on the petals only (`color.a` is the tint mask);
 *  - wind: each vertex sways by its `aWind` weight, the phase from the plant's position (no two plants in step), the
 *    sway fading out with distance;
 *  - sprites (`sprite`): the far blossom bunches turn to the camera, each rolled its own way;
 *  - alpha-tested pictures (`map` + `alphaTest`) keep their outline at a distance (the alpha is raised with the mip
 *    level, Golus' fix), so far blossoms do not thin out.
 * Day and night: `(albedo x light + albedo x lift) x tint`, the same as the old foliage (villageModelPrep.liftMaterial),
 * with the same shared uniforms: the foliage tint, or the cherry blossoms' darker one. At night:
 *  - the blossoms lose most of their pink (`vegNightUniform`): petals under the moon read white-grey, as in photos of
 *    cherries at night, not violet (a blue moonlight on pink);
 *  - the street lamps light what stands near them, warm (`vegLampsUniform`, their places read from the village file:
 *    `setVegLamps`), as they light the ground in the night light map, once they are on (`litUniform`).
 */

/** The street lamps the vegetation is lit by at night (at most `VEG_LAMPS`): xyz, w the strength (0: none). */
export const VEG_LAMPS = 32;
export const vegLampsUniform = { value: Array.from({ length: VEG_LAMPS }, () => new Vector4(0, -1000, 0, 0)) };
/** The lamps' places (world, the light's height) into `vegLampsUniform`, the nearest `VEG_LAMPS` to `centre` first. */
export function setVegLamps(lamps: ReadonlyArray<readonly [number, number, number]>, centre: readonly [number, number, number] = [0, 0, 0]): number {
  const sorted = [...lamps].sort((a, b) => Math.hypot(a[0] - centre[0], a[2] - centre[2]) - Math.hypot(b[0] - centre[0], b[2] - centre[2]));
  vegLampsUniform.value.forEach((v, i) => {
    const l = sorted[i];
    if (l) v.set(l[0], l[1], l[2], 1);
    else v.set(0, -1000, 0, 0);
  });
  return Math.min(sorted.length, VEG_LAMPS);
}
/** The lamps' warm light (linear) on the vegetation: the lamp glass's own colour. */
const LAMP_COLOUR = "vec3( 1.0, 0.78, 0.5 )";

/** The vegetation clock (s) and wind strength (1 = a light breeze), shared by every vegetation material. */
export const vegTimeUniform = { value: 0 };
export const vegWindUniform = { value: 1 };

export interface VegMaterialOptions {
  name: string;
  map?: Texture | null;
  alphaTest?: number;
  sprite?: boolean;
  /** The cherry blossoms take `cherryTintUniform` (darker at night), the rest `foliageTintUniform`. */
  cherry?: boolean;
  /** Sway (m) at weight 1. */
  wind: number;
  /** Distance (m) where the sway has faded out. */
  windFar: number;
  /** Shading: ambient + sky x (0.5 + 0.5 n.y) + sun x max(n.s, -n.s x back). */
  ambient: number;
  sky: number;
  sun: number;
  back: number;
}

const VERT_PARS = /* glsl */ `uniform float uVegTime;
uniform float uVegWind;
uniform float uVegWindAmp;
uniform float uVegWindFar;
uniform vec3 uVegSun;
uniform vec4 uVegShade;
attribute float aWind;
attribute float aLight;
varying vec3 vVegLight;
varying vec3 vVegTint;
uniform vec4 uVegLamps[ ${VEG_LAMPS} ];
uniform float uVegLit;
varying float vVegLamp;
varying vec3 vVegWorld;
void main() {`;

const VERT_COLOR = /* glsl */ `vColor = color;
vVegTint = vec3( 1.0 );
#ifdef USE_INSTANCING_COLOR
	vVegTint = instanceColor;
#endif`;

const VERT_PROJECT = /* glsl */ `#ifdef USE_INSTANCING
	mat4 vegM = modelMatrix * instanceMatrix;
#else
	mat4 vegM = modelMatrix;
#endif
	vec3 vegOrigin = vegM[3].xyz;
#ifdef VEG_SPRITE
	float vegScale = length( vegM[0].xyz );
	float vegRoll = fract( sin( dot( vegOrigin.xz, vec2( 12.9898, 78.233 ) ) + vegOrigin.y ) * 43758.5453 ) * 6.2831853;
	vec2 vegCs = vec2( cos( vegRoll ), sin( vegRoll ) );
	vec2 vegQ = vec2( transformed.x * vegCs.x - transformed.y * vegCs.y, transformed.x * vegCs.y + transformed.y * vegCs.x ) * vegScale;
	vec3 vegRight = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
	vec3 vegUp = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
	vec3 vegWorld = vegOrigin + vegRight * vegQ.x + vegUp * vegQ.y;
	float vegShadeK = 1.0;
#ifdef USE_MAP
	// half the bunches show the atlas's other bunch picture (the next cell to the right)
	vMapUv.x += step( 0.5, fract( vegRoll * 7.31 ) ) * 0.25;
#endif
#else
	vec3 vegWorld = ( vegM * vec4( transformed, 1.0 ) ).xyz;
	vec3 vegN = normalize( mat3( vegM ) * normal );
	float vegNdl = dot( vegN, uVegSun );
	float vegDiff = vegNdl > 0.0 ? vegNdl : -vegNdl * uVegShade.w;
	float vegShadeK = uVegShade.x + uVegShade.y * ( 0.5 + 0.5 * vegN.y ) + uVegShade.z * vegDiff;
#endif
	float vegDist = distance( cameraPosition, vegOrigin );
	float vegSwayK = aWind * uVegWind * uVegWindAmp * ( 1.0 - smoothstep( uVegWindFar * 0.5, uVegWindFar, vegDist ) );
	float vegPhase = dot( vegOrigin.xz, vec2( 0.71, 0.53 ) ) * 3.0;
	vegWorld.x += vegSwayK * ( sin( uVegTime * 1.7 + vegPhase ) * 0.65 + sin( uVegTime * 3.3 + vegPhase * 1.9 ) * 0.35 );
	vegWorld.z += vegSwayK * ( sin( uVegTime * 1.3 + vegPhase * 1.3 ) * 0.5 + sin( uVegTime * 2.7 + vegPhase * 0.7 ) * 0.25 );
	vVegLight = vec3( aLight * vegShadeK );
	// the street lamps nearby, once they are on: full within a metre and a half, gone by eight
	float vegLampK = 0.0;
	if ( uVegLit > 0.0 ) {
		for ( int i = 0; i < ${VEG_LAMPS}; i ++ ) {
			vec4 vegL = uVegLamps[ i ];
			float vegD = distance( vegWorld, vegL.xyz );
			vegLampK += vegL.w * ( 1.0 - smoothstep( 1.5, 8.0, vegD ) ) / ( 1.0 + 0.06 * vegD * vegD );
		}
	}
	vVegLamp = min( vegLampK, 1.5 ) * uVegLit;
	vVegWorld = vegWorld;
	vec4 mvPosition = viewMatrix * vec4( vegWorld, 1.0 );
	gl_Position = projectionMatrix * mvPosition;`;

const FRAG_PARS = /* glsl */ `uniform float uVegLift;
uniform vec3 uVegTint;
uniform float uVegNight;
varying vec3 vVegLight;
varying vec3 vVegTint;
varying float vVegLamp;
varying vec3 vVegWorld;
void main() {
	// a twig, leaf or limb right at the camera (inside a young tree's crown) dissolves instead of being cut flat by the
	// near plane, which showed sawn-off stubs (review r1, 2026-11-13): gone within 22 cm, a dithered fade out to 45 cm
	float vegNear = distance( vVegWorld, cameraPosition );
	if ( vegNear < 0.45 ) {
		float vegDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		if ( ( vegNear - 0.22 ) / 0.23 < vegDither ) discard;
	}`;

/** Keep cut-out foliage alpha stable without derivative instructions that trigger ANGLE warnings on mobile GPUs. */
const FRAG_MAP = /* glsl */ `#include <map_fragment>
#if defined( USE_MAP ) && defined( USE_ALPHATEST )
	// A fixed lift avoids dFdx/dFdy inside the cut-out path, which ANGLE reports as a varying-gradient warning.
	diffuseColor.a *= 1.12;
#endif`;

const FRAG_COLOR = /* glsl */ `vec3 vegAlbedo = vColor.rgb * mix( vec3( 1.0 ), vVegTint, vColor.a );
#ifdef VEG_CHERRY
	// petals under the moon: their pink mostly gone (white-grey), a little brighter than their pink's luminance
	vec3 vegPale = vec3( dot( vegAlbedo, vec3( 0.2126, 0.7152, 0.0722 ) ) * 1.18 );
	vegAlbedo = mix( vegAlbedo, vegPale, uVegNight * 0.75 );
#endif
diffuseColor.rgb *= vegAlbedo * ( ( vVegLight + uVegLift ) * uVegTint + vVegLamp * ${LAMP_COLOUR} * 0.55 );`;

const SUN = new Vector3(...DAY_SUN_DIRECTION).normalize();

/** A vegetation material (see the file header). Double-sided, no shadows, fog as the village's foliage. */
export function vegMaterial(o: VegMaterialOptions): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    name: o.name,
    vertexColors: true,
    side: DoubleSide,
    map: o.map ?? null,
    alphaTest: o.alphaTest ?? 0,
  });
  const uniforms = {
    uVegTime: vegTimeUniform,
    uVegWind: vegWindUniform,
    uVegWindAmp: { value: o.wind },
    uVegWindFar: { value: o.windFar },
    uVegSun: { value: SUN },
    uVegShade: { value: [o.ambient, o.sky, o.sun, o.back] },
    uVegLift: liftUniform,
    uVegTint: o.cherry ? cherryTintUniform : foliageTintUniform,
    uVegNight: vegNightUniform,
    uVegLamps: vegLampsUniform,
    uVegLit: litUniform,
  };
  m.userData.vegUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = (o.sprite ? "#define VEG_SPRITE\n" : "") + shader.vertexShader
      .replace("void main() {", VERT_PARS)
      .replace("#include <color_vertex>", VERT_COLOR)
      .replace("#include <project_vertex>", VERT_PROJECT);
    shader.fragmentShader = (o.cherry ? "#define VEG_CHERRY\n" : "") + shader.fragmentShader
      .replace("void main() {", FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <color_fragment>", FRAG_COLOR);
  };
  m.customProgramCacheKey = () => `village-veg-${o.sprite ? "sprite" : "mesh"}-${o.cherry ? "cherry" : "foliage"}`;
  return m;
}
