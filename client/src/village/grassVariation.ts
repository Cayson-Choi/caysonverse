/**
 * One grass look everywhere (village lawns, the fishing lake's lawn, 케이슨랜드's lawn): a tiling albedo repeats every few metres and
 * shows as stripes / a grid on wide fields. Two things hide it, both cheap (one extra fetch, a few noise taps):
 *  1. the same tile sampled a second time, rotated and at an irrational scale, blended in by a broad world-space noise;
 *  2. a macro tint (world-space noise at 90 m and 23 m: lush and dry stands) on the albedo.
 * `gvVary(tex, uv, world, base)` takes the first sample and returns the varied colour.
 */
export const GRASS_VARIATION_PARS = /* glsl */ `
float gvHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float gvNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gvHash( i ), gvHash( i + vec2( 1, 0 ) ), f.x ), mix( gvHash( i + vec2( 0, 1 ) ), gvHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
vec4 gvVary( sampler2D tex, vec2 uv, vec3 w, vec4 base ) {
  vec2 uv2 = mat2( 0.8, -0.6, 0.6, 0.8 ) * uv * 0.613 + vec2( 0.37, 0.11 );
  vec4 other = texture2D( tex, uv2 );
  float blend = smoothstep( 0.3, 0.7, gvNoise( w.xz * 0.045 + 3.7 ) );
  // never less than a third of the second sample: a tile edge (a faint line every tile) is halved and its twin lies elsewhere
  vec4 c = mix( base, other, 0.35 + blend * 0.4 );
  float m = gvNoise( w.xz * 0.011 ) * 0.6 + gvNoise( w.xz * 0.043 + 9.0 ) * 0.4;
  c.rgb *= vec3( 0.86 + 0.28 * m, 0.88 + 0.24 * m, 0.85 + 0.26 * m );
  return c;
}
`;
