import { DoubleSide, MeshBasicMaterial, Vector3, type Texture } from "three";
import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import { cherryTintUniform, foliageTintUniform, liftUniform } from "../villageModelPrep";

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
 * with the same shared uniforms: the foliage tint, or the cherry blossoms' darker one.
 */

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
	vec4 mvPosition = viewMatrix * vec4( vegWorld, 1.0 );
	gl_Position = projectionMatrix * mvPosition;`;

const FRAG_PARS = /* glsl */ `uniform float uVegLift;
uniform vec3 uVegTint;
varying vec3 vVegLight;
varying vec3 vVegTint;
void main() {`;

/** Keep cut-out foliage alpha stable without derivative instructions that trigger ANGLE warnings on mobile GPUs. */
const FRAG_MAP = /* glsl */ `#include <map_fragment>
#if defined( USE_MAP ) && defined( USE_ALPHATEST )
	// A fixed lift avoids dFdx/dFdy inside the cut-out path, which ANGLE reports as a varying-gradient warning.
	diffuseColor.a *= 1.12;
#endif`;

const FRAG_COLOR = /* glsl */ `vec3 vegAlbedo = vColor.rgb * mix( vec3( 1.0 ), vVegTint, vColor.a );
diffuseColor.rgb *= vegAlbedo * ( vVegLight + uVegLift ) * uVegTint;`;

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
  };
  m.userData.vegUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = (o.sprite ? "#define VEG_SPRITE\n" : "") + shader.vertexShader
      .replace("void main() {", VERT_PARS)
      .replace("#include <color_vertex>", VERT_COLOR)
      .replace("#include <project_vertex>", VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <color_fragment>", FRAG_COLOR);
  };
  m.customProgramCacheKey = () => `village-veg-${o.sprite ? "sprite" : "mesh"}-${o.cherry ? "cherry" : "foliage"}`;
  return m;
}
