/**
 * The castle wall's cut stone (owner 2026-11-20: "성벽이 실제 느낌과 같은 질감이 나야해"). The scan under it is Poly Haven's
 * sandstone_blocks_08 (the PBR library's stone_ashlar, 3 m a tile): real honey sandstone, but its joints are hairlines and every block has
 * the same tone, so from a few metres off the wall read as one flat, evenly tiled beige sheet.
 *
 * This shader patch works on the SAME blocks the scan has (their joints were measured on the 1k albedo: five 0.6 m courses a tile, the
 * vertical joints below) and gives each block what a real ashlar wall has:
 *  - its own tone (a per-block hash, seeded per wall module / tower so the 6 m module never repeats) and a slow world-space mottling
 *    over tens of metres (quarry beds differ),
 *  - a recessed mortar joint: a lime-mortar line a little lighter and rougher than the stone, the block arrises darkened into it (ambient
 *    occlusion of the groove) and BEVELLED (the normal tilts toward the joint over the last 3 cm, so each edge catches the light),
 *  - a darker footing course and ground-contact occlusion at the foot of the wall.
 * All of it is analytic (no extra texture: nothing more to download or keep on the GPU) and filtered by the pixel's footprint
 * (fwidth), so it stays crisp up close and averages out cleanly far away. The joints follow the uv in metres the kit writes (u along a
 * face, v down it), so the blocks curve round the round towers with the shaft.
 */
import type { MeshStandardMaterial } from "three";

/** The scan's vertical joints per course (fractions of a tile), measured on sandstone_blocks_08_diff_1k (columns of 1024). */
export const ASHLAR_JOINTS: readonly (readonly number[])[] = Object.freeze([
  [197, 501, 806],
  [42, 348, 648],
  [175, 273, 581, 887],
  [116, 353, 476, 738],
  [0, 299, 604],
].map((c) => Object.freeze(c.map((x) => x / 1024))));
/** Courses per tile (the scan's horizontal joints sit at 0.198 / 0.399 / 0.599 / 0.798 of it). */
export const ASHLAR_COURSES = 5;

const f = (x: number) => x.toFixed(5);
const jointVec = (c: readonly number[]) => `vec4(${[0, 1, 2, 3].map((i) => f(c[i] ?? 2)).join(", ")})`;

const VERT_HEAD = /* glsl */ `
varying vec2 cwUv;
varying float cwLocalY;
varying float cwSeed;
varying vec3 cwWorld;
`;
const VERT_BODY = /* glsl */ `
cwUv = uv;
cwLocalY = position.y;
vec4 cwP = vec4( position, 1.0 );
#ifdef USE_INSTANCING
  cwP = instanceMatrix * cwP;
  cwSeed = fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
#else
  cwSeed = 0.37;
#endif
cwWorld = ( modelMatrix * cwP ).xyz;
`;

function fragHead(tile: number): string {
  return /* glsl */ `
varying vec2 cwUv;
varying float cwLocalY;
varying float cwSeed;
varying vec3 cwWorld;
float cwHash( vec4 p ) {
  p = fract( p * vec4( 0.1031, 0.1030, 0.0973, 0.1099 ) );
  p += dot( p, p.wzxy + 33.33 );
  return fract( ( p.x + p.y ) * ( p.z + p.w ) );
}
float cwNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 u = fract( p ); u = u * u * ( 3.0 - 2.0 * u );
  float a = cwHash( vec4( i, 1.0, 7.0 ) ), b = cwHash( vec4( i + vec2( 1.0, 0.0 ), 1.0, 7.0 ) );
  float c = cwHash( vec4( i + vec2( 0.0, 1.0 ), 1.0, 7.0 ) ), d = cwHash( vec4( i + vec2( 1.0, 1.0 ), 1.0, 7.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// The block under uv (metres): its id, and the distances (m) to its left / right / top / bottom joints.
void cwBlock( vec2 m, out float id, out vec4 d ) {
  const float T = ${f(tile)};
  vec2 t = m / T;
  vec2 ti = floor( t );
  vec2 fr = t - ti;
  float k = min( floor( fr.y * ${ASHLAR_COURSES.toFixed(1)} ), ${(ASHLAR_COURSES - 1).toFixed(1)} );
  vec4 J; float n;
  if ( k < 0.5 ) { J = ${jointVec(ASHLAR_JOINTS[0]!)}; n = ${ASHLAR_JOINTS[0]!.length}.0; }
  else if ( k < 1.5 ) { J = ${jointVec(ASHLAR_JOINTS[1]!)}; n = ${ASHLAR_JOINTS[1]!.length}.0; }
  else if ( k < 2.5 ) { J = ${jointVec(ASHLAR_JOINTS[2]!)}; n = ${ASHLAR_JOINTS[2]!.length}.0; }
  else if ( k < 3.5 ) { J = ${jointVec(ASHLAR_JOINTS[3]!)}; n = ${ASHLAR_JOINTS[3]!.length}.0; }
  else { J = ${jointVec(ASHLAR_JOINTS[4]!)}; n = ${ASHLAR_JOINTS[4]!.length}.0; }
  float last = n > 3.5 ? J.w : ( n > 2.5 ? J.z : J.y );
  float jl = last - 1.0; float jr = J.x; float seg = 0.0;
  if ( fr.x >= J.x ) { jl = J.x; jr = n > 1.5 ? J.y : J.x + 1.0; seg = 1.0; }
  if ( n > 1.5 && fr.x >= J.y ) { jl = J.y; jr = n > 2.5 ? J.z : J.x + 1.0; seg = 2.0; }
  if ( n > 2.5 && fr.x >= J.z ) { jl = J.z; jr = n > 3.5 ? J.w : J.x + 1.0; seg = 3.0; }
  if ( n > 3.5 && fr.x >= J.w ) { jl = J.w; jr = J.x + 1.0; seg = 4.0; }
  // a block across the tile's edge is one block: the part before the first joint belongs to the previous tile's last block
  float tx = ti.x;
  if ( seg < 0.5 ) { tx -= 1.0; seg = n; }
  id = cwHash( vec4( tx, ti.y, k + seg * 7.0, cwSeed * 97.0 ) );
  float c0 = k / ${ASHLAR_COURSES.toFixed(1)};
  d = vec4( fr.x - jl, jr - fr.x, fr.y - c0, c0 + ${(1 / ASHLAR_COURSES).toFixed(5)} - fr.y ) * T;
}
`;
}

const FRAG_COLOUR = /* glsl */ `
float cwId; vec4 cwD;
cwBlock( cwUv, cwId, cwD );
// the pixel's footprint (m): every line and bevel is filtered by it
float cwPx = max( max( fwidth( cwUv.x ), fwidth( cwUv.y ) ), 1e-4 );
float cwEdge = min( min( cwD.x, cwD.y ), min( cwD.z, cwD.w ) );
// the mortar line (5 mm each side of the joint) and the groove's occlusion over the arris (4 cm)
float cwMortar = 1.0 - smoothstep( 0.005 - cwPx, 0.005 + cwPx, cwEdge );
float cwGroove = 1.0 - smoothstep( 0.0, 0.04 + cwPx, cwEdge );
// each block its own tone: lightness and a warm / cool shift; quarry-bed mottling over ~15 m
float cwTone = 0.84 + 0.26 * cwId;
float cwWarm = ( cwHash( vec4( cwId * 31.0, 3.0, 5.0, 11.0 ) ) - 0.5 ) * 0.14;
float cwMacro = cwNoise( vec2( cwWorld.x + cwWorld.z, cwWorld.y * 1.6 ) / 15.0 ) * 0.7 + cwNoise( vec2( cwWorld.x - cwWorld.z, cwWorld.y ) / 5.0 ) * 0.3;
vec3 cwStone = diffuseColor.rgb * cwTone * vec3( 1.0 + cwWarm, 1.0, 1.0 - cwWarm * 1.2 ) * ( 0.9 + 0.2 * cwMacro );
vec3 cwLime = vec3( dot( diffuseColor.rgb, vec3( 0.333 ) ) ) * vec3( 1.06, 1.03, 0.96 ) * 0.92;
diffuseColor.rgb = mix( cwStone * ( 1.0 - 0.38 * cwGroove ), cwLime * 0.62, cwMortar );
// the footing course a shade darker, and the ground's occlusion at the wall's foot
diffuseColor.rgb *= ( cwLocalY < 0.9 ? 0.86 : 1.0 ) * mix( 0.62, 1.0, smoothstep( -0.1, 1.4, cwLocalY ) );
// bevelled arrises: the normal leans toward the nearest joint over the last 3 cm (faded once a pixel is wider than the bevel)
float cwBev = 0.03;
float cwFade = clamp( cwBev / ( 3.0 * cwPx ), 0.0, 1.0 );
vec2 cwTilt = vec2(
  smoothstep( cwBev, 0.0, cwD.y ) - smoothstep( cwBev, 0.0, cwD.x ),
  smoothstep( cwBev, 0.0, cwD.w ) - smoothstep( cwBev, 0.0, cwD.z )
) * 0.85 * cwFade * ( 1.0 - cwMortar );
`;

/** Patch a MeshStandardMaterial (the PBR library's stone_ashlar, metre uvs) into the castle's cut stone. */
export function patchCastleStone(m: MeshStandardMaterial, tileMeters = 3): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
      .replace("#include <uv_vertex>", `#include <uv_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${fragHead(tileMeters)}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAG_COLOUR}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.97, cwMortar );")
      .replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale;\n\tmapN.xy += cwTilt;");
  };
  m.customProgramCacheKey = () => `castle-stone-${tileMeters}`;
}
