import { GRASS_VARIATION_PARS } from "./grassVariation";
import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType, type Texture } from "three";

/**
 * Close-up ground sharpness (feat/fpground, VILLAGE-TODO B8).
 *
 * The village's ground is baked: the plaza, the ring road and the lawn corners live in ONE 2048 px atlas that spans 80 m
 * (3.9 cm a texel); the tiled ground materials (stone, wood, concrete, lawn) are 512-1024 px. Looking down in first
 * person a screen pixel is 3-7 mm on the ground, so a texel covers 6-12 pixels: the stones are smeared, the lane
 * lines show bilinear stair-steps. Nothing on the GPU side was missing (the textures already have mipmaps and the
 * maximum anisotropy, villageModelPrep `configureModelTextureFiltering`); the image simply does not hold that much.
 *
 * Two additions, both only where a texel is magnified (derivative-driven, so they fade out by themselves with
 * distance, and cost nothing on the far ground), both in the material's own shader (no extra pass, no resolution change):
 *  1. the plaza atlas is sampled with a Catmull-Rom filter clamped to the four texels it lies between: round, crisp
 *     edges instead of stair-steps, no ringing;
 *  2. a small tiling grain texture (mean grey, so the average colour is unchanged) modulates the albedo at a finer
 *     scale than the base texture (stone pores, asphalt aggregate, grass blades).
 */

/** The grain texture's side in texels (tiles seamlessly). */
export const GRAIN_SIZE = 256;
/** One grain tile spans this many base-texture texels (~1.25 m on the plaza atlas); a second, finer octave tiles 2.9x denser. */
export const GRAIN_TILE_TEXELS = 32;
/** The materials that get the grain (the ground ones), and the one that also gets the smooth-tap filter (the unique-mapped atlas). */
export const GROUND_GRAIN_MATERIALS: readonly string[] = ["LM_plaza", "LM_grass", "LM_lawn", "LM_stone", "LM_concrete", "LM_wood"];
/** The lawns: they also get the anti-tiling (grassVariation.ts). */
export const GRASS_MATERIALS: readonly string[] = ["LM_grass", "LM_lawn"];
export const GROUND_SMOOTH_MATERIAL = "LM_plaza";

/** A seamless value noise (4 octaves) as RGBA bytes, mean 0.5. Deterministic. */
export function grainBytes(size = GRAIN_SIZE): Uint8Array {
  let seed = 1234567;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const octaves = [8, 16, 32, 64].map((cells) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return { cells, g };
  });
  const out = new Uint8Array(size * size * 4);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const amps = [0.34, 0.3, 0.22, 0.14];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      octaves.forEach(({ cells, g }, k) => {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const at = (ix: number, iy: number) => g[(iy % cells) * cells + (ix % cells)]!;
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty - 0.5) * amps[k]! * 2;
      });
      const byte = Math.max(0, Math.min(255, Math.round(128 + v * 255 * 0.9)));
      const o = (y * size + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = byte;
      out[o + 3] = 255;
    }
  }
  return out;
}

let grain: Texture | null = null;
/** The shared grain texture (built once; mipmapped, repeating, max anisotropy). */
export function groundGrainTexture(): Texture {
  if (grain) return grain;
  const t = new DataTexture(grainBytes(), GRAIN_SIZE, GRAIN_SIZE, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 16; // the renderer clamps it to the GPU's maximum
  t.needsUpdate = true;
  grain = t;
  return t;
}

export const GROUND_PARS = /* glsl */ `${GRASS_VARIATION_PARS}
uniform sampler2D uVillageGrain;
uniform float uVillageGrainAmount;
// A Catmull-Rom filter (nine bilinear fetches), clamped to the range of the four texels it interpolates between: a magnified
// edge is a smooth, crisp curve instead of a bilinear stair-step, and the clamp takes away the dark fringe an unclamped
// Catmull-Rom rings round the white lane lines. Only used where a texel covers more than a pixel.
vec4 villageSmoothTap( sampler2D tex, vec2 uv, vec2 gx, vec2 gy ) {
  ivec2 size = textureSize( tex, 0 );
  vec2 texSize = vec2( size );
  vec2 pos = uv * texSize;
  vec2 c = floor( pos - 0.5 ) + 0.5;
  vec2 f = pos - c;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = f2 - 0.5 * ( f3 + f );
  vec2 w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
  vec2 w3 = 0.5 * ( f3 - f2 );
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 w12 = w1 + w2;
  vec2 t0 = ( c - 1.0 ) / texSize;
  vec2 t3 = ( c + 2.0 ) / texSize;
  vec2 t12 = ( c + w2 / w12 ) / texSize;
  vec4 r = textureGrad( tex, vec2( t0.x, t0.y ), gx, gy ) * ( w0.x * w0.y );
  r += textureGrad( tex, vec2( t12.x, t0.y ), gx, gy ) * ( w12.x * w0.y );
  r += textureGrad( tex, vec2( t3.x, t0.y ), gx, gy ) * ( w3.x * w0.y );
  r += textureGrad( tex, vec2( t0.x, t12.y ), gx, gy ) * ( w0.x * w12.y );
  r += textureGrad( tex, vec2( t12.x, t12.y ), gx, gy ) * ( w12.x * w12.y );
  r += textureGrad( tex, vec2( t3.x, t12.y ), gx, gy ) * ( w3.x * w12.y );
  r += textureGrad( tex, vec2( t0.x, t3.y ), gx, gy ) * ( w0.x * w3.y );
  r += textureGrad( tex, vec2( t12.x, t3.y ), gx, gy ) * ( w12.x * w3.y );
  r += textureGrad( tex, vec2( t3.x, t3.y ), gx, gy ) * ( w3.x * w3.y );
  ivec2 i0 = clamp( ivec2( c - 0.5 ), ivec2( 0 ), size - 1 );
  ivec2 i1 = clamp( i0 + 1, ivec2( 0 ), size - 1 );
  vec4 a = texelFetch( tex, i0, 0 );
  vec4 b = texelFetch( tex, ivec2( i1.x, i0.y ), 0 );
  vec4 d = texelFetch( tex, ivec2( i0.x, i1.y ), 0 );
  vec4 e = texelFetch( tex, i1, 0 );
  return clamp( r, min( min( a, b ), min( d, e ) ), max( max( a, b ), max( d, e ) ) );
}
void main() {`;

/**
 * The west hill's upper slopes show bare earth and stone patches through the grass, broken up by noise (by height: the baked hill is
 * large flat triangles, so a slope-driven blend would show their facets).
 */
const ROCK_BLEND = /* glsl */ `{
  float gHigh = smoothstep( 6.0, 26.0, vSsWorld.y ) * smoothstep( -60.0, -90.0, vSsWorld.x );
  float gRock = gHigh * smoothstep( 0.38, 0.62, gvNoise( vSsWorld.xz * 0.21 + 2.0 ) * 0.65 + gvNoise( vSsWorld.xz * 0.9 ) * 0.35 );
  vec3 gEarth = vec3( 0.38, 0.32, 0.23 ) * ( 0.65 + 0.7 * gvNoise( vSsWorld.xz * 2.3 ) );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, gEarth, gRock * 0.7 );
}`;

/** The lake lawn's vertex tint dims toward its south / east edge (0.75-0.8): divided out there so it meets the village lawn with no strip. */
const LAKE_VERTEX_FLATTEN = /* glsl */ `#ifdef USE_COLOR
  {
    float lakeVcW = 1.0 - smoothstep( 184.0, 198.0, vSsWorld.x );
    sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.97 ) / max( vColor.rgb, vec3( 0.5 ) ), lakeVcW );
  }
#endif
  // and its west edge (x 98, where the village lawn takes over) is 5 % greener than the village lawn: eased in over 30 m
  sampledDiffuseColor.rgb *= mix( vec3( 0.975, 0.86, 1.0 ), vec3( 1.0 ), smoothstep( 98.0, 128.0, vSsWorld.x ) );
`;

/** `#include <map_fragment>` for a ground material: optional smooth-tap where magnified, then the grain. */
export const groundMapFragment = (catmull: boolean, vary = false, rock = false, lake = false): string => /* glsl */ `#ifdef USE_MAP
{
  vec2 gdx = dFdx( vMapUv );
  vec2 gdy = dFdy( vMapUv );
  vec2 gTexSize = vec2( textureSize( map, 0 ) );
  float texelsPerPixel = max( length( gdx * gTexSize ), length( gdy * gTexSize ) );
  float magnified = 1.0 - smoothstep( 0.45, 1.2, texelsPerPixel );
  vec4 sampledDiffuseColor = textureGrad( map, vMapUv, gdx, gdy );
  ${catmull ? "if ( texelsPerPixel < 1.0 ) sampledDiffuseColor = villageSmoothTap( map, vMapUv, gdx, gdy );" : ""}
  if ( magnified > 0.0 ) {
    vec2 gUv = vMapUv * gTexSize / ${GRAIN_TILE_TEXELS.toFixed(1)};
    vec2 gUx = gdx * gTexSize / ${GRAIN_TILE_TEXELS.toFixed(1)};
    vec2 gUy = gdy * gTexSize / ${GRAIN_TILE_TEXELS.toFixed(1)};
    float g = textureGrad( uVillageGrain, gUv, gUx, gUy ).r + textureGrad( uVillageGrain, gUv * 2.9 + 0.31, gUx * 2.9, gUy * 2.9 ).r - 1.0;
    sampledDiffuseColor.rgb *= 1.0 + g * uVillageGrainAmount * magnified;
  }
  ${vary ? "sampledDiffuseColor = gvVary( map, vMapUv, vSsWorld, sampledDiffuseColor );" : ""}
  ${rock ? ROCK_BLEND : ""}
  ${lake ? LAKE_VERTEX_FLATTEN : ""}
  diffuseColor *= sampledDiffuseColor;
}
#endif`;
