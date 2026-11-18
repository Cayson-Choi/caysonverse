import { DoubleSide, MeshStandardMaterial, ShaderMaterial, UniformsLib, UniformsUtils, Vector2, Vector3, type Texture } from "three";
import { pbrNormalScaleY, pbrSetInfo, type PbrSet } from "../pbr/pbrLibrary";
import { CASCADES, CREEK_LEVELS, FEEDER_X } from "./creekMap";

/**
 * The creek's materials: the bank and bed dressing laid over the carved ground (mud, wet pebbles, gravel), the river rock
 * (a photo-scan rock set projected from three sides, darker and glossier where the water wets it, a green band at the
 * waterline), the reeds (a sway) and the cascade's falling sheet. The first three are three's own standard material
 * (the scene's day and night light, fog and tone mapping come with it); only the wet band, the projection and the shore
 * blend are patched in.
 */

export const LEVEL_GLSL = /* glsl */ `
float ckLevel( vec2 p ) {
  if ( p.x < ${FEEDER_X.toFixed(1)} && p.y < 66.0 ) return -0.3 - 0.13 * clamp( ( p.y + 58.0 ) / 124.0, 0.0, 1.0 );
  return p.x < ${CASCADES[0].x.toFixed(2)} ? ${CREEK_LEVELS[0].toFixed(3)} : ( p.x < ${CASCADES[1].x.toFixed(2)} ? ${CREEK_LEVELS[1].toFixed(3)} : ${CREEK_LEVELS[2].toFixed(3)} );
}
`;

const WORLD_POS_VERT = (s: string): string =>
  s.replace("#include <common>", "#include <common>\nvarying vec3 vCkWPos;\nvarying vec3 vCkWNorm;").replace(
    "#include <begin_vertex>",
    "#include <begin_vertex>\nvCkWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvCkWNorm = normalize( mat3( modelMatrix ) * objectNormal );",
  );

// ───────────────────────────── bank and bed ─────────────────────────────

export interface CreekUniformsShared {
  /** The village's grain noise (groundDetail.ts), a mean-grey tiling texture. */
  noise: Texture;
}

/**
 * The bank and the bed over the baked ground: where the grass would run down into the water, wet earth, then pebbles at the
 * waterline and gravel below it. Drawn over the ground triangles (same positions, 1 cm up) with an alpha that fades into the grass
 * on the bank's upper part, so no straight line separates the lawn from the water.
 */
export function bankMaterial(gravel: PbrSet, dirt: PbrSet, shared: CreekUniformsShared, tierLow: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    name: "creek_bank",
    map: gravel.map,
    normalMap: gravel.normalMap,
    aoMap: gravel.orm,
    roughnessMap: gravel.orm,
    roughness: 1,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.normalScale = new Vector2(1, pbrNormalScaleY(false));
  const gTile = pbrSetInfo(gravel.id).tileMeters;
  const dTile = pbrSetInfo(dirt.id).tileMeters;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCkDirt = { value: dirt.map };
    shader.uniforms.uCkNoise = { value: shared.noise };
    shader.uniforms.uCkGravelTile = { value: gTile };
    shader.uniforms.uCkDirtTile = { value: dTile };
    shader.vertexShader = WORLD_POS_VERT(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vCkWPos;
varying vec3 vCkWNorm;
uniform sampler2D uCkDirt;
uniform sampler2D uCkNoise;
uniform float uCkGravelTile;
uniform float uCkDirtTile;
${LEVEL_GLSL}
float ckWet;
float ckAlpha;`,
      )
      .replace(
        "#include <map_fragment>",
        `{
  vec2 wp = vCkWPos.xz;
  vec3 gr = texture2D( map, wp / uCkGravelTile ).rgb;
  vec3 dr = texture2D( uCkDirt, wp / uCkDirtTile ).rgb;
  float n1 = texture2D( uCkNoise, wp * 0.21 ).r;
  float n2 = texture2D( uCkNoise, wp * 0.9 + 0.37 ).r;
  float t = vCkWPos.y - ckLevel( vCkWPos.xz ) + ( n1 - 0.5 ) * 0.2 + ( n2 - 0.5 ) * 0.07;
  float gravelW = 1.0 - smoothstep( 0.03, 0.2, t );
  vec3 alb = mix( dr * vec3( 0.78, 0.74, 0.68 ), gr * vec3( 1.05, 1.03, 1.0 ), gravelW );
  ckWet = 1.0 - smoothstep( -0.02, 0.2, t );
  alb *= mix( 1.0, 0.55, ckWet );
  // algae-green film at the waterline
  alb = mix( alb, alb * vec3( 0.7, 0.95, 0.5 ), ( 1.0 - smoothstep( 0.0, 0.12, abs( t + 0.03 ) ) ) * 0.45 );
  ckAlpha = 1.0 - smoothstep( 0.2, 0.36, t );
  ckAlpha *= smoothstep( -0.01, -0.1, vCkWPos.y );
  diffuseColor = vec4( alb, ckAlpha );
}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.5, ckWet * 0.8 );");
  };
  m.customProgramCacheKey = () => `creek-bank${tierLow ? "-low" : ""}`;
  return m;
}

// ───────────────────────────── river rock ─────────────────────────────

/**
 * The creek's stones: the rock scan projected along the three axes (no UVs on a procedural lump), its normal map blended the
 * same way. Below the water level and in the splash band above it the stone is darker and glossier; a green film of algae
 * sits on the waterline; vertex colour carries each stone's tone.
 */
export function rockMaterial(rock: PbrSet, shared: CreekUniformsShared): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    name: "creek_rock",
    map: rock.map,
    normalMap: rock.normalMap,
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
  });
  const tile = pbrSetInfo(rock.id).tileMeters;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCkNoise = { value: shared.noise };
    shader.uniforms.uCkTile = { value: tile };
    shader.vertexShader = WORLD_POS_VERT(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vCkWPos;
varying vec3 vCkWNorm;
uniform sampler2D uCkNoise;
uniform float uCkTile;
${LEVEL_GLSL}
float ckWet;
vec3 ckBlend;`,
      )
      .replace(
        "#include <map_fragment>",
        `{
  vec3 bw = pow( abs( vCkWNorm ), vec3( 4.0 ) );
  ckBlend = bw / ( bw.x + bw.y + bw.z );
  vec3 q = vCkWPos / uCkTile;
  vec3 a = texture2D( map, q.zy ).rgb * ckBlend.x + texture2D( map, q.xz + 0.31 ).rgb * ckBlend.y + texture2D( map, q.xy + 0.57 ).rgb * ckBlend.z;
  diffuseColor.rgb *= a;
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float t = vCkWPos.y - ckLevel( vCkWPos.xz );
  float n = texture2D( uCkNoise, vCkWPos.xz * 1.3 + vCkWPos.y ).r;
  ckWet = 1.0 - smoothstep( 0.0, 0.17 + ( n - 0.5 ) * 0.12, t );
  diffuseColor.rgb *= mix( 1.0, 0.5, ckWet );
  float film = ( 1.0 - smoothstep( 0.0, 0.1, abs( t + 0.01 + ( n - 0.5 ) * 0.05 ) ) ) * 0.6;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.9, 0.42 ), film );
  // a pale dry crown: the sun-bleached top of a stone that stands out of the water
  diffuseColor.rgb *= 1.0 + 0.18 * smoothstep( 0.2, 0.5, t ) * ckBlend.y;
}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.42, ckWet * 0.85 );")
      .replace(
        "#include <normal_fragment_maps>",
        `{
  vec3 nW = normalize( vCkWNorm );
  vec3 q = vCkWPos / uCkTile;
  vec3 tx = texture2D( normalMap, q.zy ).xyz * 2.0 - 1.0;
  vec3 ty = texture2D( normalMap, q.xz + 0.31 ).xyz * 2.0 - 1.0;
  vec3 tz = texture2D( normalMap, q.xy + 0.57 ).xyz * 2.0 - 1.0;
  tx = vec3( tx.xy + nW.zy, abs( tx.z ) * nW.x );
  ty = vec3( ty.xy + nW.xz, abs( ty.z ) * nW.y );
  tz = vec3( tz.xy + nW.xy, abs( tz.z ) * nW.z );
  vec3 wn = normalize( tx.zyx * ckBlend.x + ty.xzy * ckBlend.y + tz.xyz * ckBlend.z );
  normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
}`,
      );
  };
  m.customProgramCacheKey = () => "creek-rock";
  return m;
}

// ───────────────────────────── reeds ─────────────────────────────

export const reedUniforms = { uCkTime: { value: 0 } };

export function reedMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ name: "creek_reeds", vertexColors: true, side: DoubleSide, roughness: 0.7, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCkTime = reedUniforms.uCkTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway;\nuniform float uCkTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  vec3 wp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  transformed.x += sin( uCkTime * 1.6 + wp.x * 0.9 + wp.z * 0.7 ) * 0.05 * aSway;
  transformed.z += cos( uCkTime * 1.25 + wp.x * 0.6 - wp.z * 0.8 ) * 0.04 * aSway;
}`,
      );
  };
  m.customProgramCacheKey = () => "creek-reeds";
  return m;
}

// ───────────────────────────── the cascade's falling sheet ─────────────────────────────

const SHEET_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SHEET_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uTint;
uniform float uWidth;
#include <common>
#include <fog_pars_fragment>
varying vec2 vUv;
void main() {
  // vUv.x: metres across the sheet; vUv.y: 0 at the lip .. 1 at the foot
  float s1 = texture2D( uNoise, vec2( vUv.x * 0.8, vUv.y * 0.9 - uTime * 1.1 ) ).r;
  float s2 = texture2D( uNoise, vec2( vUv.x * 2.3 + 0.4, vUv.y * 1.4 - uTime * 1.6 ) ).g;
  float streak = clamp( ( s1 * 0.6 + s2 * 0.5 - 0.3 ) * 1.6, 0.0, 1.0 );
  // glassy and clear over the lip, whiter and thicker as it falls and breaks on the pool
  float white = clamp( vUv.y * 0.9 + streak * 0.55, 0.0, 1.0 );
  vec3 col = mix( vec3( 0.2, 0.34, 0.3 ), vec3( 0.88, 0.93, 0.93 ), white * white );
  float a = mix( 0.28, 0.9, white ) * ( 0.55 + 0.5 * streak );
  a *= smoothstep( 0.0, 0.35, vUv.x ) * smoothstep( 0.0, 0.35, uWidth - vUv.x );
  gl_FragColor = vec4( col * uTint, clamp( a, 0.0, 0.95 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function sheetMaterial(noise: Texture): ShaderMaterial {
  return new ShaderMaterial({
    name: "creek_sheet",
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uNoise: { value: noise }, uTime: { value: 0 }, uTint: { value: new Vector3(1, 1, 1) }, uWidth: { value: 5.5 } }]),
    vertexShader: SHEET_VERT,
    fragmentShader: SHEET_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
}

