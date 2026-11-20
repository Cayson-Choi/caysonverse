import {
  AddEquation,
  Color,
  CustomBlending,
  DstColorFactor,
  SrcColorFactor,
  CylinderGeometry,
  DataTexture,
  InstancedMesh,
  MeshBasicMaterial,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Material,
} from "three";

/**
 * How a lit memorial candle looks (owner 2026-11-20: "촛불이 더 실감나게 밝혀진 것처럼 보이게"). The hall is unlit (baked light, MeshBasic),
 * so a candle's light is drawn, not computed — four instanced cards per lit candle and one wick per candle, five draw calls for
 * every candle in the hall together (64 at most), whatever the number of players:
 *
 *  - FLAME: an upright card with its own shader — a teardrop that sways and stretches (a few sines per instance, phase from
 *    gl_InstanceID), a white-hot core low in the flame, yellow → orange towards the rim, a faint blue base with the dark wick
 *    showing through it, and a soft edge; drawn past tone mapping so it reads as a light.
 *  - HALO: a soft warm glow round the flame (normal alpha: an additive one vanishes on the bright cream cubbies), breathing with
 *    the flame.
 *  - WASH: the candle's light on its cubby — a card on the cubby's opening, drawn as a 2x multiply (dst · 2·src: mid grey leaves
 *    what is behind it as it is, a warm src turns it warmer and a little brighter — the white back panel, the photo frame, the
 *    photo and the flowers take the candle's colour), strongest at the candle and falling off across the cubby; its strength
 *    flickers with the flame (instance colour).
 *  - WAX: a small amber glow just under the flame (the top of the wax lit through, the pool round the wick).
 *  - WICK: a short dark wick on EVERY candle, lit or not — an unlit candle shows just that, no glow.
 */

/** Flame card (m): a real votive flame is ~1.4 cm wide, ~3 cm tall; the card's soft edge needs a little more. */
export const FLAME_CARD = { w: 0.022, h: 0.05 } as const;
/** The flame card's base sits this far above the wax top (the wick stands in its lower part). */
export const FLAME_BASE_LIFT = 0.002;
export const HALO_SIZE = 0.17;
export const WAX_GLOW = { w: 0.062, h: 0.036 } as const;
/** The wick: 0.9 mm thick, 9 mm tall above the wax. */
export const WICK = { r: 0.00085, h: 0.009 } as const;

/** The wash card covers one cubby opening plus its boards (cell 0.4 + 2 x 0.025, m); the light's centre is the candle. */
export const WASH_SIZE = 0.45;

/** A texture from a per-texel function (u, v in 0..1, v up) returning [r, g, b, a] in 0..1. */
export function paintTexture(size: number, texel: (u: number, v: number) => [number, number, number, number]): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = texel((x + 0.5) / size, (y + 0.5) / size);
      const i = (y * size + x) * 4;
      data[i] = Math.round(Math.max(0, Math.min(1, r)) * 255);
      data[i + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
      data[i + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * The flame and the wash are MeshBasicMaterials with their shading injected (onBeforeCompile), not ShaderMaterials: the page's
 * program warm-up logs "glGetProgramiv: Program object expected" for a raw ShaderMaterial (houseMirror.ts, 2026-11-20).
 */
const FLAME_VERT_HEAD = /* glsl */ `
uniform float uTime;
uniform float uHalfH;
varying vec2 vFlameUv;
varying float vSeed;
`;

/** Replaces <begin_vertex>: the card sways and stretches from its base. */
const FLAME_VERT_BODY = /* glsl */ `
vFlameUv = uv;
float seed = float(gl_InstanceID) * 1.7319;
vSeed = seed;
vec3 transformed = vec3(position);
float sway = sin(uTime * 2.3 + seed) * 0.6 + sin(uTime * 5.9 + seed * 2.1) * 0.3 + sin(uTime * 13.7 + seed * 3.7) * 0.12;
float stretch = 1.0 + 0.07 * sin(uTime * 7.3 + seed * 1.3) + 0.04 * sin(uTime * 17.9 + seed) + 0.03 * sin(uTime * 31.0 + seed * 4.1);
transformed.y = (transformed.y + uHalfH) * stretch - uHalfH;
transformed.x += sway * 0.0016 * uv.y * uv.y;
`;

const FLAME_FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform float uBoost;
varying vec2 vFlameUv;
varying float vSeed;
`;

/** Replaces <opaque_fragment>: the flame's colour and shape (the colour-space step after it still runs). */
const FLAME_FRAG_BODY = /* glsl */ `
float fx = (vFlameUv.x - 0.5) * 2.0;
float fy = vFlameUv.y;
// the teardrop: round below (y about 0.24), drawn to a point at the top
float yb = 0.24;
float hw = fy < yb ? sqrt(max(0.0, 1.0 - pow((yb - fy) / yb, 2.0))) : pow(max(0.0, 1.0 - (fy - yb) / (1.0 - yb)), 1.3);
hw *= 0.8;
float d = abs(fx) / max(hw, 0.001);
float shape = (1.0 - smoothstep(0.55, 1.0, d)) * smoothstep(0.0, 0.05, fy);
// the white-hot core, low in the flame; yellow, then orange towards the rim
float core = 1.0 - smoothstep(0.0, 0.8, length(vec2(fx / 0.38, (fy - 0.34) / 0.3)));
vec3 col = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.68, 0.22), smoothstep(0.0, 0.65, 1.0 - d));
col = mix(col, vec3(1.0, 0.96, 0.82), core);
// a faint blue base, half see-through
float blue = (1.0 - smoothstep(0.04, 0.17, fy)) * (1.0 - smoothstep(0.35, 1.0, d));
col = mix(col, vec3(0.32, 0.42, 1.0), blue * 0.55);
float alpha = shape * (1.0 - blue * 0.5);
// the wick, dark, standing in the base of the flame (its tip glows)
float wick = (1.0 - smoothstep(0.0, 0.09, abs(fx))) * (1.0 - smoothstep(0.17, 0.24, fy));
vec3 wickCol = mix(vec3(0.07, 0.045, 0.03), vec3(0.9, 0.35, 0.08), smoothstep(0.14, 0.22, fy));
col = mix(col, wickCol, wick * 0.9);
alpha = max(alpha, wick * 0.92);
float flicker = 0.93 + 0.07 * sin(uTime * 11.0 + vSeed * 5.0) * sin(uTime * 3.1 + vSeed);
gl_FragColor = vec4(col * flicker * uBoost, alpha);
`;

export interface CandleLook {
  flame: InstancedMesh;
  halo: InstancedMesh;
  wash: InstancedMesh;
  wax: InstancedMesh;
  /** The flame's shader time (s). */
  setTime(t: number): void;
  own: Array<{ dispose(): void }>;
}

/** The candle's light, as instanced cards for up to `max` lit candles. */
export function makeCandleLook(max: number): CandleLook {
  const own: Array<{ dispose(): void }> = [];
  const inst = (name: string, geometry: PlaneGeometry, material: Material, order: number) => {
    const mesh = new InstancedMesh(geometry, material, max);
    mesh.name = `inst__${name}`;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    own.push(mesh, geometry, material);
    return mesh;
  };

  const flameUniforms = { uTime: { value: 0 }, uHalfH: { value: FLAME_CARD.h / 2 }, uBoost: { value: 1.0 } };
  const flameMat = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false });
  flameMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flameUniforms);
    shader.vertexShader = FLAME_VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", FLAME_VERT_BODY);
    shader.fragmentShader = FLAME_FRAG_HEAD + shader.fragmentShader.replace("#include <opaque_fragment>", FLAME_FRAG_BODY);
  };
  flameMat.customProgramCacheKey = () => "candle_flame";
  flameMat.name = "candle_flame";
  const flame = inst("candle_flame", new PlaneGeometry(FLAME_CARD.w, FLAME_CARD.h), flameMat, 5);

  // the halo: warm, soft, its strength breathing with the flame (instance colour)
  const haloMap = paintTexture(64, (u, v) => {
    const r = Math.min(1, Math.hypot(u - 0.5, (v - 0.5) * 0.92) * 2);
    return [1, 0.72, 0.4, 0.92 * Math.pow(1 - r, 2.2)];
  });
  const haloMat = new MeshBasicMaterial({ map: haloMap, color: "#ffffff", transparent: true, depthWrite: false, toneMapped: false, fog: false });
  haloMat.name = "candle_halo";
  own.push(haloMap);
  const halo = inst("candle_halo", new PlaneGeometry(HALO_SIZE, HALO_SIZE), haloMat, 4);

  // the wash: brightest at the candle (front right of the cubby, low), across the cubby and onto its boards
  const cu = 0.5 + 0.135 / WASH_SIZE;
  const cv = 0.5 - 0.105 / WASH_SIZE;
  const washMap = paintTexture(64, (u, v) => {
    const r = Math.min(1, Math.hypot(u - cu, v - cv) / 0.78);
    const edge = Math.min(1, Math.min(u, 1 - u, v, 1 - v) / 0.05); // fade at the card's border (no square edge)
    const k = Math.pow(1 - r, 1.6) * edge;
    return [k, k, k, 1];
  });
  const warm = { value: new Color(0.78, 0.59, 0.38) };
  const washMat = new MeshBasicMaterial({
    map: washMap,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: DstColorFactor,
    blendDst: SrcColorFactor,
  });
  // the weight (map x instance colour) picks between 0.5 ("no change" under the 2x multiply) and the candle's warm colour; no
  // colour-space step: the result is a factor, not a colour
  washMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWarm = warm;
    shader.fragmentShader =
      "uniform vec3 uWarm;\n" +
      shader.fragmentShader
        .replace("#include <opaque_fragment>", "gl_FragColor = vec4(mix(vec3(0.5), uWarm, clamp(diffuseColor.r, 0.0, 1.0)), 1.0);")
        .replace("#include <colorspace_fragment>", "");
  };
  washMat.customProgramCacheKey = () => "candle_wash";
  washMat.name = "candle_wash";
  washMap.colorSpace = NoColorSpace; // a weight, not a colour
  own.push(washMap);
  const wash = inst("candle_wash", new PlaneGeometry(WASH_SIZE, WASH_SIZE), washMat, 2);

  // the wax lit through: an amber pool just under the flame
  const waxMap = paintTexture(32, (u, v) => {
    const r = Math.min(1, Math.hypot((u - 0.5) * 2, (v - 0.55) * 2.4));
    return [1, 0.6, 0.24, 0.85 * Math.pow(1 - r, 1.6)];
  });
  const waxMat = new MeshBasicMaterial({ map: waxMap, transparent: true, depthWrite: false, toneMapped: false, fog: false });
  waxMat.name = "candle_wax_glow";
  own.push(waxMap);
  const wax = inst("candle_wax_glow", new PlaneGeometry(WAX_GLOW.w, WAX_GLOW.h), waxMat, 3);

  for (const m of [halo, wash]) {
    m.setColorAt(0, new Color(1, 1, 1));
    m.instanceColor!.needsUpdate = true;
  }
  return {
    flame,
    halo,
    wash,
    wax,
    setTime: (t) => {
      flameUniforms.uTime.value = t;
    },
    own,
  };
}

/** A short dark wick for `max` candles (every filled cubby's candle, lit or not). */
export function makeWicks(max: number): { mesh: InstancedMesh; own: Array<{ dispose(): void }> } {
  const g = new CylinderGeometry(WICK.r * 0.8, WICK.r, WICK.h, 6, 1);
  g.translate(0, WICK.h / 2, 0); // its foot at the origin (the wax top)
  g.rotateZ(0.12); // wicks lean a little
  const m = new MeshBasicMaterial({ color: "#2a2019" });
  m.name = "candle_wick";
  const mesh = new InstancedMesh(g, m, Math.max(1, max));
  mesh.name = "inst__candle_wick";
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, own: [mesh, g, m] };
}
