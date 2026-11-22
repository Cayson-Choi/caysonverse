import { BufferGeometry, CustomBlending, Float32BufferAttribute, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector3, Vector4 } from "three";

/**
 * The house fireplaces' live fire (houses 1, 2, 7, 10). Houses-real pass (owner 2026-11-21: "is this supposed to be realistic? are you
 * kidding?" — five orange cones on box logs, a checkered ember patch). Built after real wood fires (firebrick firebox, cast-iron grate,
 * split logs, glowing coals, layered translucent flames, a flickering warm light on the room):
 *
 *  - the model (houses-interior kit `stone_fireplace`) has the firebrick firebox, the grate, the barked logs and a bed of ember chunks
 *    drawn with the lamp material; FLAME_GLSL turns those chunks into glowing coals (a slow-crawling hot/crust noise, pulsing);
 *  - `hearthFlames` is ONE mesh, one draw call: seven flame sheets (camera-facing about the vertical, each a domain-warped noise flame
 *    that licks upward, white-yellow at its root to deep red at its tips, additive), a soft glow on the firebox's back bricks and a
 *    dozen rising sparks;
 *  - `houseFireLight` is a fake warm point light the light-mapped room materials add (houseNight.ts): it flickers with the flames and
 *    falls off over ~2.6 m; it carries only the flicker round the light maps' baked fire light, so the hearth, the floor and the sofa
 *    front breathe with the fire without washing out.
 */

/** Isolates the coals and original flame cards from other fixtures sharing the baked room's lamp material. */
export interface HearthBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export const HOUSE_HEARTHS: Readonly<Record<number, HearthBox>> = {
  1: { min: [361.52, 0.05, -7.75], max: [363.28, 1.05, -7.0] },
  2: { min: [392.42, 0.05, -7.75], max: [394.18, 1.05, -7.0] },
  7: { min: [504.04, 0.05, -3.08], max: [505.0, 1.05, -1.32] },
  10: { min: [576.0, 0.05, -6.93], max: [577.25, 1.05, -4.87] },
};

/** The hearth box uniforms shared by every patched lamp material: an empty box (min > max) when the house has no fireplace. */
export const houseHearthMin = { value: new Vector3(1, 1, 1) };
export const houseHearthMax = { value: new Vector3(0, 0, 0) };
export const houseFireTime = { value: 0 };
/** Centre of the glowing ember bed and the direction its fireplace faces (local +z = into the room) in the four rooms. */
const EMBERS: Readonly<Record<number, readonly [number, number, number, number]>> = {
  // houses-real pass: the bed's centre of the rebuilt firebox (kit stone_fireplace: back wall z 0.06 in a 0.30 / 0.36 m breast, 0.1 in h10's)
  1: [362.40, 0.18, -7.57, 0], 2: [393.30, 0.18, -7.54, 0],
  7: [504.25, 0.18, -2.20, Math.PI / 2], 10: [576.325, 0.26, -5.90, Math.PI / 2],
};
export const houseEmberY = { value: 0 };
/** The fake fire light: xyz its world position, w its strength (0 = no fire in this house). Written by setHouseHearth / updateHouseFire. */
export const houseFireLight = { value: new Vector4(0, 0, 0, 0) };

export function setHouseHearth(n: number): void {
  const b = HOUSE_HEARTHS[n];
  const e = EMBERS[n];
  if (b && e) {
    houseEmberY.value = e[1];
    houseHearthMin.value.set(...b.min);
    houseHearthMax.value.set(...b.max);
    // the light sits just above the logs, a little out of the firebox (so the floor in front gets it, the chimney breast's sides less)
    houseFireLight.value.set(e[0] + Math.sin(e[3]) * 0.22, e[1] + 0.22, e[2] + Math.cos(e[3]) * 0.22, 0);
  } else {
    houseHearthMin.value.set(1, 1, 1);
    houseHearthMax.value.set(0, 0, 0);
    houseFireLight.value.set(0, 0, 0, 0);
  }
}

/** The fire's flicker at time t (s): a few incommensurate waves and a quick crackle, about 0.8 .. 1.2. Pure, for the light and the tests. */
export function fireFlicker(t: number): number {
  const slow = 0.5 * Math.sin(t * 1.7) + 0.32 * Math.sin(t * 2.9 + 1.3) + 0.18 * Math.sin(t * 5.3 + 0.4);
  const crackle = Math.max(0, Math.sin(t * 13.1) * Math.sin(t * 7.7 + 2.0)) ** 3;
  return 0.93 + 0.13 * slow + 0.14 * crackle;
}

/** Per frame: the time, and the fire light's flicker (signed: brighter and dimmer round the baked mean), a little stronger at night. */
export function updateHouseFire(t: number, night: number, onFloorWithFire: boolean): void {
  houseFireTime.value = t;
  const on = onFloorWithFire && houseHearthMin.value.x <= houseHearthMax.value.x;
  // the light maps already hold the fire's steady light (the bake's 60 W fire lamp): only its flicker round that mean is added
  houseFireLight.value.w = on ? (fireFlicker(t) - 0.93) * (0.9 + 0.6 * night) : 0;
  houseFireGlow.value = 0.6 + 0.4 * night;
}

/**
 * The glowing coals: the lamp material's faces inside the hearth box below the ember line (the kit's ember chunks). A value noise
 * crawls slowly over them — bright orange-yellow cracks between darker crust — and the bed breathes.
 */
export const FLAME_GLSL = /* glsl */ `
	if ( all( greaterThanEqual( vHouseWorld, uHearthMin ) ) && all( lessThanEqual( vHouseWorld, uHearthMax ) ) ) {
		if (vHouseWorld.y > uEmberY + 0.01) discard; // nothing of the lamp material above the coals (old flame cards)
		vec3 hfq = vHouseWorld * 38.0 + vec3( 0.0, uHouseFireTime * 0.35, uHouseFireTime * 0.21 );
		vec3 hfi = floor( hfq ); vec3 hff = fract( hfq ); hff = hff * hff * ( 3.0 - 2.0 * hff );
		#define HF_H(o) fract( sin( dot( hfi + o, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 )
		float hfn = mix( mix( mix( HF_H(vec3(0,0,0)), HF_H(vec3(1,0,0)), hff.x ), mix( HF_H(vec3(0,1,0)), HF_H(vec3(1,1,0)), hff.x ), hff.y ),
		                 mix( mix( HF_H(vec3(0,0,1)), HF_H(vec3(1,0,1)), hff.x ), mix( HF_H(vec3(0,1,1)), HF_H(vec3(1,1,1)), hff.x ), hff.y ), hff.z );
		#undef HF_H
		float hfp = 0.82 + 0.18 * sin( uHouseFireTime * 3.1 + vHouseWorld.x * 9.0 ) * sin( uHouseFireTime * 1.7 + vHouseWorld.z * 7.0 );
		float hfh = smoothstep( 0.5, 0.85, hfn ) * hfp;
		float hfl = smoothstep( uEmberY - 0.05, uEmberY + 0.005, vHouseWorld.y );
		diffuseColor.rgb = mix( vec3( 0.07, 0.02, 0.008 ), mix( vec3( 1.5, 0.3, 0.02 ), vec3( 2.3, 1.05, 0.25 ), hfh * hfh ), clamp( hfh * ( 0.8 + 0.6 * hfl ) + 0.12, 0.0, 1.0 ) );
	}`;

const FIRE_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aCenter;     // the sheet's root (local)
attribute vec4 aShape;      // corner x (-0.5..0.5), corner y (0..1), width, height
attribute vec2 aSeed;       // seed, kind (0 flame, 1 back glow, 2 spark)
varying vec2 vUv;
varying float vSeed;
varying float vKind;
varying float vLife;
void main() {
  vSeed = aSeed.x;
  vKind = aSeed.y;
  vUv = aShape.xy;
  vec3 c = aCenter;
  float w = aShape.z, h = aShape.w;
  vLife = 0.0;
  if (vKind > 1.5) {          // a spark: rises, drifts, fades, starts again
    float life = fract(uTime * (0.45 + 0.3 * fract(vSeed * 7.3)) + vSeed);
    vLife = life;
    c.y += life * (0.55 + 0.35 * fract(vSeed * 3.1));
    c.x += 0.05 * sin(life * 9.0 + vSeed * 20.0);
    c.z += 0.03 * sin(life * 7.0 + vSeed * 11.0);
  }
  vec4 wc = modelMatrix * vec4(c, 1.0);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 toCam = cameraPosition - wc.xyz;
  toCam.y = 0.0;
  vec3 right = normalize(cross(up, normalize(toCam + vec3(1e-4, 0.0, 0.0))));
  if (vKind > 0.5 && vKind < 1.5) right = (modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;   // the glow lies flat on the back bricks
  float sway = vKind < 0.5 ? (0.05 * sin(uTime * 3.3 + vSeed * 6.0) + 0.025 * sin(uTime * 7.1 + vSeed * 3.0)) * vUv.y * vUv.y : 0.0;
  vec3 p = wc.xyz + right * (vUv.x * w + sway) + up * (vUv.y * h);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
varying float vSeed;
varying float vKind;
varying float vLife;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 1.7) + 0.15 * vnoise(p * 4.01 + 3.1); }
void main() {
  vec3 col;
  float a;
  if (vKind < 0.5) {
    // a flame: noise rising through a teardrop; the warp makes it lick and split, the top breaks into loose tongues
    float y = vUv.y;
    vec2 q = vec2(vUv.x * 2.6 + vSeed * 13.0, y * 1.9 - uTime * (1.9 + 0.5 * fract(vSeed * 5.0)));
    float warp = fbm(q * 1.3) - 0.5;
    float n = fbm(q + vec2(warp * 1.4, 0.0));
    float x = vUv.x + warp * 0.38 * y;
    float width = 0.5 * pow(1.0 - y, 0.75) * (0.55 + 1.2 * sqrt(y) * (1.0 - y));
    float body = 1.0 - smoothstep(width * 0.35, width, abs(x));
    float tongues = smoothstep(0.15, 0.75, n + 0.55 - y * 1.05);
    float base = smoothstep(0.0, 0.08, y);
    float i = body * tongues * base;
    float core = smoothstep(0.35, 0.95, i) * (1.0 - smoothstep(0.25, 0.7, y));
    col = mix(vec3(0.75, 0.1, 0.0), vec3(1.0, 0.34, 0.0), smoothstep(0.06, 0.5, i));
    col = mix(col, vec3(1.0, 0.66, 0.16), core);
    col *= 1.6;
    a = clamp(i * 1.5, 0.0, 1.0) * (0.85 + 0.15 * sin(uTime * 11.0 + vSeed * 30.0));
  } else if (vKind < 1.5) {
    // the warm light on the back bricks behind the flames
    vec2 d = vec2(vUv.x * 1.6, (vUv.y - 0.25) * 1.3);
    col = vec3(1.0, 0.42, 0.1);
    a = exp(-dot(d, d) * 3.2) * 0.22 * uGlow;
  } else {
    // a spark: a tiny hot dot that cools and fades as it rises
    vec2 d = vUv - vec2(0.0, 0.5);
    col = mix(vec3(1.4, 0.85, 0.35), vec3(1.0, 0.25, 0.03), vLife);
    a = exp(-dot(d, d) * 18.0) * (1.0 - vLife) * smoothstep(0.0, 0.08, vLife);
  }
  // premultiplied: the flame body covers the bricks behind it (alpha), its hot colour over 1 adds light; the glow and sparks only add
  gl_FragColor = vec4(col * a, vKind < 0.5 ? a * 0.7 : 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The back glow's strength (stronger at night), shared with the frame loop. */
export const houseFireGlow = { value: 1 };

/**
 * The fire over a house's ember bed (floor 1 of houses 1, 2, 7, 10), or null for a house without a fireplace: flame sheets, the back
 * glow and the sparks in one mesh. The positions are the unbillboarded quads (facing the room, local +z); the vertex shader turns each
 * round its own root to face the camera.
 */
export function hearthFlames(n: number) {
  const bed = EMBERS[n];
  if (!bed) return null;
  const pos: number[] = [], center: number[] = [], shape: number[] = [], seed: number[] = [], idx: number[] = [];
  const quad = (cx: number, cy: number, cz: number, w: number, h: number, s: number, kind: number) => {
    const k = pos.length / 3;
    for (const [u, v] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]] as const) {
      pos.push(cx + u * w, cy + v * h, cz);
      center.push(cx, cy, cz);
      shape.push(u, v, w, h);
      seed.push(s, kind);
    }
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  // flames: [x, z, width, height] — a tall pair over the middle where the logs cross, smaller licks along the logs
  const sheets = [
    // (refs: real log fires — thin licking tongues 2-3x the log stack's height, several overlapping)
    [-0.03, -0.02, 0.24, 0.62], [0.09, 0.02, 0.21, 0.55], [-0.13, 0.0, 0.2, 0.46], [0.18, -0.03, 0.16, 0.36],
    [-0.21, 0.03, 0.15, 0.3], [0.03, 0.06, 0.28, 0.4], [-0.07, -0.05, 0.17, 0.58], [0.13, 0.05, 0.14, 0.44],
  ] as const;
  for (const [i, [x, z, w, h]] of sheets.entries()) quad(x, 0.07, z, w, h, 0.137 * (i + 1), 0);
  quad(0, 0.0, -0.11, 0.62, 0.6, 0.5, 1);                    // the back-brick glow, just off the firebox's back wall
  for (let i = 0; i < 12; i++) quad(-0.18 + 0.36 * ((i * 0.618) % 1), 0.16, -0.05 + 0.1 * ((i * 0.37) % 1), 0.012, 0.012, (i * 0.381) % 1, 2);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geometry.setAttribute("aCenter", new Float32BufferAttribute(center, 3));
  geometry.setAttribute("aShape", new Float32BufferAttribute(shape, 4));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seed, 2));
  geometry.setIndex(idx);
  const mat = new ShaderMaterial({
    uniforms: { uTime: houseFireTime, uGlow: houseFireGlow },
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  const mesh = new Mesh(geometry, mat);
  mesh.name = "hearth_flames";
  mesh.position.set(bed[0], bed[1], bed[2]);
  mesh.rotation.y = bed[3];
  mesh.frustumCulled = false; // the billboarding moves the quads off their bounding sphere
  mesh.renderOrder = 2;
  mesh.raycast = () => {};
  return mesh;
}
