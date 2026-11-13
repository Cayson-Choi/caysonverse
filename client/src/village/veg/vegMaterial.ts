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
/** The drawing buffer's height (px): the size of a pixel at a distance (the twigs never thinner than a pixel). */
export const vegViewHeightUniform = { value: 1080 };

/**
 * The camera's room in the foliage (review r2, 2026-11-13: the dithered fade of what came within 45 cm of the eye showed
 * a regular mesh over the sky and see-through blossoms). Leaves, blossoms, flowers and twigs give way round the eye
 * instead, as real ones are pushed aside: a point `d` from the camera is moved out to `d + NEAR_ROOM x (1 - d / NEAR_PUSH)^2`
 * (within `NEAR_PUSH`; smooth, never folding over), so nothing comes nearer than `NEAR_ROOM`, well past the near plane
 * (0.2 m): no cut faces and no pattern. The bark of the trunks and limbs keeps its shape: the camera is kept out of it
 * (villageVegetation sets the follow camera's keep-out, cameraCollision.setCameraKeepOut).
 */
export const NEAR_ROOM = 0.38;
export const NEAR_PUSH = 0.9;
/**
 * And a whole leaf spray or blossom bunch (an instance) draws back into its own centre as the camera comes: full size
 * from `NEAR_SHRINK` (m, the eye to its centre), gone at `NEAR_GONE` (the push alone moves a near leaf along its own
 * line of sight, so it still covered the view).
 */
export const NEAR_SHRINK = 0.9;
export const NEAR_GONE = 0.3;
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
  /**
   * `push`: gives way round the camera (VEG_PUSH: leaves, blossoms, flowers, twigs; not the bark of trunks and limbs,
   * nor the far sprites). `twig`: never thinner than a pixel (VEG_TWIG, the twigs' bark).
   */
  push?: boolean;
  twig?: boolean;
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
uniform float uVegViewH;
varying float vVegLamp;
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
#if defined( VEG_PUSH ) && defined( USE_INSTANCING )
	// a leaf spray or blossom bunch right at the eye draws back into its twig as the camera comes (whole: no pattern,
	// no see-through), instead of filling the view with a leaf a hand's breadth away
	vegWorld = vegOrigin + ( vegWorld - vegOrigin ) * smoothstep( ${NEAR_GONE.toFixed(3)}, ${NEAR_SHRINK.toFixed(3)}, distance( cameraPosition, vegOrigin ) );
#endif
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
	// the street lamps nearby, once they are on: what is within a metre of the glass, fading out by five (the ground
	// under a lamp has no pool of its own in the night light map, so the leaves round it only catch a little of it)
	float vegLampK = 0.0;
	if ( uVegLit > 0.0 ) {
		for ( int i = 0; i < ${VEG_LAMPS}; i ++ ) {
			vec4 vegL = uVegLamps[ i ];
			float vegD = distance( vegWorld, vegL.xyz );
			vegLampK += vegL.w * ( 1.0 - smoothstep( 1.0, 5.0, vegD ) ) / ( 1.0 + 0.15 * vegD * vegD );
		}
	}
	vVegLamp = min( vegLampK, 0.9 ) * uVegLit;
#ifdef VEG_TWIG
	// a twig is never thinner than a pixel (thinner, it broke into dots against the sky): half a pixel more round
	float vegPx = 2.0 * distance( cameraPosition, vegWorld ) / ( projectionMatrix[ 1 ][ 1 ] * uVegViewH );
	vegWorld += vegN * vegPx * 0.5;
#endif
#ifdef VEG_PUSH
	// the camera's room: what comes within NEAR_PUSH of the eye gives way, out to NEAR_ROOM at least (see NEAR_ROOM)
	vec3 vegFromEye = vegWorld - cameraPosition;
	float vegEye = length( vegFromEye );
	if ( vegEye < ${NEAR_PUSH.toFixed(3)} ) {
		float vegK = 1.0 - vegEye / ${NEAR_PUSH.toFixed(3)};
		vec3 vegDir = vegEye > 1e-4 ? vegFromEye / vegEye : vec3( 0.0, 1.0, 0.0 );
		vegWorld = cameraPosition + vegDir * ( vegEye + ${NEAR_ROOM.toFixed(3)} * vegK * vegK );
	}
#endif
	vec4 mvPosition = viewMatrix * vec4( vegWorld, 1.0 );
	gl_Position = projectionMatrix * mvPosition;`;

const FRAG_PARS = /* glsl */ `uniform float uVegLift;
uniform vec3 uVegTint;
uniform float uVegNight;
varying vec3 vVegLight;
varying vec3 vVegTint;
varying float vVegLamp;
void main() {`;

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
diffuseColor.rgb *= vegAlbedo * ( ( vVegLight + uVegLift ) * uVegTint + vVegLamp * ${LAMP_COLOUR} * 0.32 );`;

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
    uVegViewH: vegViewHeightUniform,
  };
  m.userData.vegUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const defines = (o.sprite ? "#define VEG_SPRITE\n" : "") + (o.push && !o.sprite ? "#define VEG_PUSH\n" : "") + (o.twig && !o.sprite ? "#define VEG_TWIG\n" : "");
    shader.vertexShader = defines + shader.vertexShader
      .replace("void main() {", VERT_PARS)
      .replace("#include <color_vertex>", VERT_COLOR)
      .replace("#include <project_vertex>", VERT_PROJECT);
    shader.fragmentShader = (o.cherry ? "#define VEG_CHERRY\n" : "") + shader.fragmentShader
      .replace("void main() {", FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <color_fragment>", FRAG_COLOR);
  };
  m.customProgramCacheKey = () => `village-veg-${o.sprite ? "sprite" : "mesh"}-${o.cherry ? "cherry" : "foliage"}-${o.push ? "push" : "fixed"}-${o.twig ? "twig" : "solid"}`;
  return m;
}
