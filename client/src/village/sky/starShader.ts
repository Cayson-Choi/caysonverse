/**
 * The star layer's look: the colour of a star from its B−V index and brightness, and the one `ShaderMaterial` that puts
 * the catalogue's stars and the planets on the sky (the GPU does every star's math; the CPU sends one matrix a frame).
 *
 * Per star (vertex shader): J2000 unit vector (`position`) × the sky matrix -> the scene direction -> raised by the
 * refraction -> dimmed by the air mass (extinction, a little redder low down) -> faded against the twilight's limiting
 * magnitude -> placed on a sphere of `uRadius` around the dome's centre, along the ray from the CAMERA (so a star sits
 * where it should from anywhere on the map, just inside the dome, and the hills, houses and trees in front of it hide it
 * by depth). Size and gain follow the magnitude; a gentle twinkle, stronger near the horizon, none for the planets.
 * Additive, unlit, no fog, no tone mapping on the light tier (the rich tier's final pass tone-maps the whole frame).
 */

import { AdditiveBlending, Matrix3, ShaderMaterial, Vector3 } from "three";

/** B−V -> colour points (sRGB hex), the project's own table: blue-white (Rigel) ... red-orange (Antares, Betelgeuse). */
export const BV_COLOURS: readonly (readonly [number, string])[] = [
  [-0.3, "#a9c0ff"],
  [0.0, "#e4ebff"],
  [0.3, "#f8f6f0"],
  [0.6, "#fff1d6"],
  [1.0, "#ffddb0"],
  [1.5, "#ffc68c"],
  [2.0, "#ffad70"],
];
/** A star the catalogue gives no B−V: drawn as this one (pale yellow-white). */
export const BV_MISSING = 0.6;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}
const TABLE = BV_COLOURS.map(([bv, hex]) => [bv, hexToLinear(hex)] as const);

/**
 * How much of its colour a star of magnitude `mag` shows: the eye sees little colour in faint light, so a star fainter
 * than 3 is nearly white (0.35) and one brighter than 1 is full (0.85).
 */
export function colourSaturation(mag: number): number {
  const t = Math.min(1, Math.max(0, (3 - mag) / 2));
  return 0.35 + 0.5 * t;
}

/** A star's linear colour (max channel 1) from its B−V (NaN = none) and magnitude, into `out`. */
export function starColour(bv: number, mag: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const b = Number.isFinite(bv) ? bv : BV_MISSING;
  let c: readonly number[] = TABLE[TABLE.length - 1]![1];
  if (b <= TABLE[0]![0]) c = TABLE[0]![1];
  else
    for (let i = 0; i < TABLE.length - 1; i++) {
      const [b0, c0] = TABLE[i]!;
      const [b1, c1] = TABLE[i + 1]!;
      if (b >= b0 && b <= b1) {
        const t = (b - b0) / (b1 - b0);
        c = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
        break;
      }
    }
  const s = colourSaturation(mag);
  const peak = Math.max(c[0]!, c[1]!, c[2]!) || 1;
  for (let k = 0; k < 3; k++) out[k] = 1 + (c[k]! / peak - 1) * s;
  return out;
}

/** On-screen size (CSS px) of a star of magnitude `mag` (the shader's formula). */
export function starSizePx(mag: number): number {
  return Math.min(6.5, Math.max(1.5, 2.2 * 1.25 ** (3 - mag)));
}

/** Brightness gain of a star of magnitude `mag` (the shader's formula; above 1 the rich tier's bloom may catch it). */
export function starGain(mag: number): number {
  return Math.min(2.5, Math.max(0.2, 10 ** (-0.2 * (mag - 2))));
}

/** The planets' colours (linear) and that they never twinkle. */
export const PLANET_COLOURS: Readonly<Record<"venus" | "mars" | "jupiter" | "saturn", string>> = {
  venus: "#fffaf0",
  mars: "#ffb48a",
  jupiter: "#fff4e0",
  saturn: "#ffeccc",
};
export function planetColour(id: keyof typeof PLANET_COLOURS): [number, number, number] {
  return hexToLinear(PLANET_COLOURS[id]);
}

const VERTEX = /* glsl */ `
uniform mat3 uSky;
uniform vec3 uCentre;
uniform float uRadius;
uniform float uLimit;
uniform float uFade;
uniform float uTime;
uniform float uPixel;
uniform float uTwinkle;
uniform float uGain;
uniform float uSize;
attribute float aMag;
attribute vec3 aColor;
attribute float aSeed;
attribute float aGlow;
varying vec3 vColor;

const float TO_DEG = 57.29577951308232;

void main() {
  vec3 d = normalize(uSky * position);
  float hTrue = asin(clamp(d.y, -1.0, 1.0)) * TO_DEG;
  if (hTrue < -1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  // Saemundsson's refraction (arcmin -> deg), then the direction rebuilt at the apparent altitude.
  float hApp = hTrue + 1.02 / tan((hTrue + 10.3 / (hTrue + 5.11)) / TO_DEG) / 60.0;
  vec2 hz = d.xz;
  float hl = length(hz);
  hz = hl > 1e-6 ? hz / hl : vec2(0.0, -1.0);
  float sh = sin(hApp / TO_DEG);
  float ch = cos(hApp / TO_DEG);
  vec3 dir = vec3(hz.x * ch, sh, hz.y * ch);

  // Extinction (air mass), the twilight's limit.
  float s = max(sh, 0.0);
  float airmass = 1.0 / (s + 0.025 * exp(-11.0 * s));
  float mag = aMag + 0.25 * (airmass - 1.0);
  float vis = 1.0 - smoothstep(uLimit - 0.25, uLimit + 0.25, mag);

  float twinkle = 0.0;
  vec3 col = aColor;
  if (aSeed >= 0.0) {
    float amp = (0.06 + 0.30 * pow(1.0 - s, 3.0)) * uTwinkle;
    float f = 0.7 + 1.6 * aSeed;
    float ph = aSeed * 43.0;
    twinkle = amp * (0.6 * sin(6.2831853 * f * uTime + ph) + 0.4 * sin(6.2831853 * 1.73 * f * uTime + ph * 1.3));
    // a bright star low in the sky flickers in colour too (Sirius on a winter evening)
    if (aMag < 1.5) {
      float c = (1.0 - smoothstep(5.0, 25.0, hApp)) * uTwinkle * 0.22;
      col *= 1.0 + c * vec3(sin(uTime * 9.1 + ph), sin(uTime * 11.3 + ph * 2.0), sin(uTime * 7.7 + ph * 3.0));
    }
  }
  // redder through the thick air near the horizon
  col *= mix(vec3(1.0), vec3(1.0, 0.8, 0.6), (1.0 - smoothstep(2.0, 16.0, hApp)) * 0.6);

  float gain = clamp(pow(10.0, -0.2 * (mag - 2.0)), 0.2, 2.5) * uGain;
  float size = clamp(2.2 * pow(1.25, 3.0 - mag), 1.5, 6.5) * uSize;
  float w = vis * uFade;
  vColor = col * gain * (1.0 + twinkle) * w * aGlow;

  // On the sphere around the dome's centre, along the ray from the camera.
  vec3 o = cameraPosition - uCentre;
  float b = dot(o, dir);
  float c2 = dot(o, o) - uRadius * uRadius;
  float t = -b + sqrt(max(b * b - c2, 0.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + dir * t, 1.0);
  // The sprite is twice the star's size: its Gaussian is half-bright at the star's size, faint at the sprite's edge.
  gl_PointSize = w > 0.002 ? 2.0 * size * uPixel * mix(1.0, aGlow, 0.6) : 0.0;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-2.77 * r2), 1.0);
  #include <colorspace_fragment>
}
`;

/** The sphere the stars sit on: the dome's centre (60 m under the plaza) and a radius just inside the dome (1.4 km). */
export const STAR_SPHERE = { centre: [0, -60, 0] as const, radius: 1385 };

export interface StarUniforms {
  uSky: { value: Matrix3 };
  uCentre: { value: Vector3 };
  uRadius: { value: number };
  uLimit: { value: number };
  uFade: { value: number };
  uTime: { value: number };
  uPixel: { value: number };
  uTwinkle: { value: number };
  uGain: { value: number };
  uSize: { value: number };
}

/** The material of the star layer (stars and planets share it). */
export function makeStarMaterial(): ShaderMaterial & { uniforms: StarUniforms } {
  const uniforms: StarUniforms = {
    uSky: { value: new Matrix3() },
    uCentre: { value: new Vector3(...STAR_SPHERE.centre) },
    uRadius: { value: STAR_SPHERE.radius },
    uLimit: { value: 5.5 },
    uFade: { value: 0 },
    uTime: { value: 0 },
    uPixel: { value: 1 },
    uTwinkle: { value: 1 },
    uGain: { value: 1 },
    uSize: { value: 1 },
  };
  const m = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  m.name = "village_star_sky";
  return m as ShaderMaterial & { uniforms: StarUniforms };
}
