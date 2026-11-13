/**
 * 케이슨 마을's day and night (Task 7A) — the pure part: from the sun's place on real Korean time to every number the
 * scene's look is made of, and the easing that moves the scene toward them. Unit-tested (dayNightBlend.test.ts); the
 * scene's parts that apply it are `DayNight.tsx` (lights, fog, clear colour, exposure) and `villageModelPrep.ts`
 * `applyDayNight` (the model's materials).
 *
 * The clock: `dayNightAt(utcMs)` asks `sunAt` (shared/village/sunClock.ts, NOAA formulas at 36.5° N, 127.8° E) where
 * the sun is, turns its elevation into weights with `phaseAt` (day above +8°, night below -8°, a smooth ramp between:
 * dawn and dusk; the golden-hour tint between -2° and +12°) and blends three looks:
 *   - DAY: the baked afternoon (Task 7's preset: haze `#C4CDD4`, warm key light, exposure 1.4), the day light map;
 *   - GOLDEN: the day look with a warm tint and a low orange sun;
 *   - NIGHT: the night light map (a cool moon from the SSE, the lamps' and windows' pools), a dark blue sky and
 *     fog, a moonlit ambient, a higher exposure; the lamps, windows and fountain lights ON.
 *
 * Colours are LINEAR light (what three's uniforms and `Color.setRGB` take). The live key light is the sun and the
 * moon summed into one directional light: its direction follows the sum of the two (a low sun is held at 14° so its
 * shadows stay on the ground in the shadow box), its intensity fades with the sun's height. The night's moon is the
 * one the night light map was baked with (art/village/tools/bake_village.py `NIGHT`), so the players' live shadows
 * fall like the baked ones.
 *
 * Inside the memorial hall it is always the same warm indoor light (`indoorState`): the hall never gets the outdoor
 * night blend.
 *
 * The baked day shadows are a FIXED AFTERNOON: the day light map was baked once with the sun at azimuth 70°, 28° up
 * (`DAY_SUN_DIRECTION`), while the live key light follows the real sun. By day the baked shadows of buildings and
 * trees and the avatars' live shadows therefore point the same way only near the baked hour (at a June noon the
 * live sun is almost overhead); the golden tint hides most of the difference at dusk. That is by design (one day
 * bake), not a bug (Task 7A review m-a).
 */

import { phaseAt, smoothstep, sunAt } from "@caysonverse/shared/village/sunClock";

export type Rgb = [number, number, number];
export type Vec3 = [number, number, number];

/** Everything that changes with the time of day. Colours linear; `keyDir` is a unit vector toward the light. */
export interface DayNightState {
  /** The sun's apparent elevation (°). Informational (the weights below carry it). */
  sunElevationDeg: number;
  /** 1 in daylight, 0 at night (`phaseAt`). */
  day: number;
  /** 1 - day: the weight of the night light map. */
  night: number;
  /** The warm tint of sunrise and sunset. */
  golden: number;
  /** The lamps, windows and fountain lights: 0 until `night` passes 0.3, 1 from 0.5. */
  lights: number;
  /** Stars on the sky dome: 0 by day, 1 deep in the night. */
  stars: number;
  /** The scene's tone-mapping exposure (× the player's brightness). */
  exposure: number;
  /** The clear colour and the fog's (the dome's horizon haze by day, a dark blue at night). */
  sky: Rgb;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  keyColor: Rgb;
  keyIntensity: number;
  keyDir: Vec3;
  /** The bake's ambient lift raised at runtime (`LIGHT_LIFT` by day) and the colour it carries. */
  lift: number;
  liftTint: Rgb;
  /** × the day light map's light (the warm cast of the golden hour; white otherwise: the night map takes over by weight). */
  dayTint: Rgb;
  /** × the foliage's vertex light, which has no light map to blend (warm at dusk, dark blue at night). */
  foliageTint: Rgb;
  /** The same for the cherry blossoms (`M_leaf_cherry`): darker at night, or their pale pink reads bright lavender. */
  cherryTint: Rgb;
  /** × the sky dome, the far hills and forest, the waterfall. */
  domeTint: Rgb;
  hazeTint: Rgb;
  /** × the water's surface. */
  waterTint: Rgb;
}

// ---------------------------------------------------------------------------------------------------------------
// Colours.

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** "#RRGGBB" (sRGB) as linear light. */
export function linearHex(hex: string): Rgb {
  const v = (i: number) => srgbToLinear(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255);
  return [v(0), v(1), v(2)];
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ---------------------------------------------------------------------------------------------------------------
// The three looks. `DAY` is Task 7's preset (sceneLighting.ts `LIGHTING.village`) and stays the single source of it
// through `dayLook`; the others are this task's.

/** The look of the afternoon the village was baked in (what `LIGHTING.village` always was). */
export interface Look {
  sky: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  keyColor: string;
  keyIntensity: number;
  exposure: number;
}

export const DAY_LOOK: Look = {
  sky: "#C4CDD4",
  hemiSky: "#FFFFFF",
  hemiGround: "#D3E2B4",
  hemiIntensity: 1.7,
  keyColor: "#FFD6A8",
  keyIntensity: 2.4,
  exposure: 1.4,
};

/** Sunrise and sunset: a low orange sun, a warm haze. */
export const GOLDEN_LOOK = {
  sky: "#EDB48A",
  hemiSky: "#FFD9B8",
  hemiGround: "#C9B08A",
  keyColor: "#FF9A55",
  /** × the day key's intensity. */
  keyScale: 0.85,
  /** The warm cast on the day light map and the foliage (× linear), at full golden hour. */
  dayTint: [1.16, 0.82, 0.6] as Rgb,
  domeTint: [1.0, 0.84, 0.68] as Rgb,
  hazeTint: [1.0, 0.78, 0.6] as Rgb,
  waterTint: [1.0, 0.8, 0.62] as Rgb,
};

/** Deep night: a dark blue sky and haze, a moonlit ambient, the moon. */
export const NIGHT_LOOK = {
  sky: "#101B38",
  hemiSky: "#5C72B8",
  hemiGround: "#232D52",
  hemiIntensity: 1.15,
  moonColor: "#A6BBFF",
  moonIntensity: 1.1,
  exposure: 1.95,
  /** The runtime ambient on the light-mapped materials at night, and its colour (the bake has no lift at night). */
  lift: 0.14,
  liftTint: [0.5, 0.68, 1.0] as Rgb,
  /** × the foliage's day vertex light (the trees at night) — no light map has them. */
  foliageTint: [0.075, 0.1, 0.2] as Rgb,
  /**
   * × the cherry blossoms' day vertex light at night. A pale grey-blue moonlight: the runtime blossoms also lose most
   * of their pink at night (veg/vegMaterial.ts, `vegNightUniform`), so they read white-grey under the moon as real ones
   * do, not the deep violet a blue tint on pink made (review r1, 2026-11-13).
   */
  cherryTint: [0.07, 0.08, 0.115] as Rgb,
  domeTint: [0.03, 0.05, 0.12] as Rgb,
  hazeTint: [0.075, 0.1, 0.19] as Rgb,
  waterTint: [0.12, 0.2, 0.42] as Rgb,
};

/** The bake's day lift (villageModelPrep.ts `LIGHT_LIFT`), copied to keep this file free of the model's code. */
export const DAY_LIFT = 0.2;

/** The night's moon: where the night light map was baked from (azimuth clockwise from north, elevation, °). */
export const NIGHT_MOON = { azimuthDeg: 150, elevationDeg: 42 } as const;

/** The live sun is never lower than this for its direction (°): lower and its shadows would run off the shadow box. */
export const SUN_MIN_ELEVATION = 14;

/** The key light sits this far from the player (m): the direction is what matters; the shadow box is sized for it. */
export const KEY_DISTANCE = 50;

/** Lamps, windows and the fountain's lights come on once the night weight passes this. */
export const LIGHTS_ON_ABOVE = 0.3;
/** ... and are fully on from here. */
export const LIGHTS_FULL_AT = 0.5;

/** The lamps / windows / fountain lights for a night weight: 0 up to `LIGHTS_ON_ABOVE`, then a quick ease up to 1. */
export function lightsAt(night: number): number {
  return smoothstep(LIGHTS_ON_ABOVE, LIGHTS_FULL_AT, night);
}

/** World direction (unit, toward the light) of a compass azimuth (° clockwise from north) and elevation (°). North is -z. */
export function directionFrom(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** The baked afternoon sun's direction (azimuth 70°, 28° up: sceneLighting.ts's key light). */
export const DAY_SUN_DIRECTION: Vec3 = directionFrom(70, 28);

const DAY = {
  sky: linearHex(DAY_LOOK.sky),
  hemiSky: linearHex(DAY_LOOK.hemiSky),
  hemiGround: linearHex(DAY_LOOK.hemiGround),
  keyColor: linearHex(DAY_LOOK.keyColor),
  noonKey: linearHex("#FFF0DC"),
};
const GOLD = {
  sky: linearHex(GOLDEN_LOOK.sky),
  hemiSky: linearHex(GOLDEN_LOOK.hemiSky),
  hemiGround: linearHex(GOLDEN_LOOK.hemiGround),
  keyColor: linearHex(GOLDEN_LOOK.keyColor),
};
const NIGHT = {
  sky: linearHex(NIGHT_LOOK.sky),
  hemiSky: linearHex(NIGHT_LOOK.hemiSky),
  hemiGround: linearHex(NIGHT_LOOK.hemiGround),
  moonColor: linearHex(NIGHT_LOOK.moonColor),
};
const WHITE: Rgb = [1, 1, 1];
const MOON_DIRECTION = directionFrom(NIGHT_MOON.azimuthDeg, NIGHT_MOON.elevationDeg);

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** The look for a sun elevation (°) and its compass azimuth (°): every number the scene needs, at that moment. */
export function stateFor(elevationDeg: number, azimuthDeg: number): DayNightState {
  const phase = phaseAt(elevationDeg);
  const n = phase.night;
  const g = phase.golden;
  // How strongly the sun itself lights things: gone as it touches the horizon, full a little above it.
  const sunLevel = smoothstep(-2, 10, elevationDeg);
  // The sun's light is warmer low, whiter high.
  const sunWhite = smoothstep(20, 55, elevationDeg);
  const sunColor = mixRgb(mixRgb(DAY.keyColor, DAY.noonKey, sunWhite), GOLD.keyColor, g * 0.85);
  const sunIntensity = DAY_LOOK.keyIntensity * mix(1, GOLDEN_LOOK.keyScale, g) * sunLevel;
  const sunDir = directionFrom(azimuthDeg, Math.max(SUN_MIN_ELEVATION, elevationDeg));
  // The moon takes over as the night weight grows.
  const moonLevel = smoothstep(0.1, 0.9, n);
  const moonIntensity = NIGHT_LOOK.moonIntensity * moonLevel;
  const keyIntensity = sunIntensity + moonIntensity;
  const w = keyIntensity > 1e-6 ? sunIntensity / keyIntensity : 1;
  const keyDir = normalize([
    mix(MOON_DIRECTION[0], sunDir[0], w),
    mix(MOON_DIRECTION[1], sunDir[1], w),
    mix(MOON_DIRECTION[2], sunDir[2], w),
  ]);
  const keyColor = mixRgb(NIGHT.moonColor, sunColor, w);

  const dayMix = (a: Rgb, b: Rgb) => mixRgb(a, b, n);
  return {
    sunElevationDeg: elevationDeg,
    day: phase.day,
    night: n,
    golden: g,
    lights: lightsAt(n),
    stars: smoothstep(0.55, 0.95, n),
    exposure: mix(DAY_LOOK.exposure, NIGHT_LOOK.exposure, n),
    sky: mixRgb(dayMix(DAY.sky, NIGHT.sky), GOLD.sky, g * 0.8),
    hemiSky: mixRgb(dayMix(DAY.hemiSky, NIGHT.hemiSky), GOLD.hemiSky, g * 0.7),
    hemiGround: mixRgb(dayMix(DAY.hemiGround, NIGHT.hemiGround), GOLD.hemiGround, g * 0.6),
    hemiIntensity: mix(DAY_LOOK.hemiIntensity, NIGHT_LOOK.hemiIntensity, n),
    keyColor,
    keyIntensity,
    keyDir,
    lift: mix(DAY_LIFT, NIGHT_LOOK.lift, n),
    liftTint: dayMix(WHITE, NIGHT_LOOK.liftTint),
    dayTint: mixRgb(WHITE, GOLDEN_LOOK.dayTint, g),
    foliageTint: dayMix(mixRgb(WHITE, GOLDEN_LOOK.dayTint, g), NIGHT_LOOK.foliageTint),
    cherryTint: dayMix(mixRgb(WHITE, GOLDEN_LOOK.dayTint, g), NIGHT_LOOK.cherryTint),
    domeTint: dayMix(mixRgb(WHITE, GOLDEN_LOOK.domeTint, g), NIGHT_LOOK.domeTint),
    hazeTint: dayMix(mixRgb(WHITE, GOLDEN_LOOK.hazeTint, g), NIGHT_LOOK.hazeTint),
    waterTint: dayMix(mixRgb(WHITE, GOLDEN_LOOK.waterTint, g), NIGHT_LOOK.waterTint),
  };
}

/** The village's look at an instant (Unix epoch ms, UTC). */
export function dayNightAt(utcMs: number): DayNightState {
  const sun = sunAt(utcMs);
  return stateFor(sun.elevationDeg, sun.azimuthDeg);
}

/**
 * The memorial hall's light: always the warm afternoon, whatever the hour outside (no night weight, no lamps lit;
 * the hall's own lights are its decoration's, Task 9). The key light keeps the baked afternoon's direction.
 */
export function indoorState(): DayNightState {
  const s = stateFor(35, 70);
  s.sunElevationDeg = 35;
  s.keyDir = [...DAY_SUN_DIRECTION];
  s.keyColor = [...DAY.keyColor];
  s.keyIntensity = DAY_LOOK.keyIntensity;
  s.sky = [...DAY.sky];
  return s;
}

/** A copy (every colour and vector its own). */
export function cloneState(s: DayNightState): DayNightState {
  return {
    ...s,
    sky: [...s.sky],
    hemiSky: [...s.hemiSky],
    hemiGround: [...s.hemiGround],
    keyColor: [...s.keyColor],
    keyDir: [...s.keyDir],
    liftTint: [...s.liftTint],
    dayTint: [...s.dayTint],
    foliageTint: [...s.foliageTint],
    cherryTint: [...s.cherryTint],
    domeTint: [...s.domeTint],
    hazeTint: [...s.hazeTint],
    waterTint: [...s.waterTint],
  };
}

/** Overwrite `into` with `from` in place (no allocation). */
export function copyState(into: DayNightState, from: DayNightState): void {
  ease(into as unknown as Tree, from as unknown as Tree, 1);
}

/** The time constant of the scene's easing toward a new target (s): the look glides, it never steps. */
export const EASE_SECONDS = 4;

/** The share of the way to the target covered in `dt` seconds. */
export function easeFactor(dt: number, tau: number = EASE_SECONDS): number {
  return dt <= 0 ? 0 : 1 - Math.exp(-dt / tau);
}

type Tree = { [key: string]: number | Tree | number[] };

/** `cur += (target - cur) * k`, leaf by leaf, in place (numbers and number arrays). */
function ease(cur: Tree, target: Tree, k: number): void {
  for (const key in cur) {
    const c = cur[key];
    const t = target[key];
    if (typeof c === "number") {
      cur[key] = k >= 1 ? (t as number) : c + ((t as number) - c) * k;
    } else if (Array.isArray(c)) {
      const ta = t as number[];
      for (let i = 0; i < c.length; i++) c[i] = k >= 1 ? ta[i]! : c[i]! + (ta[i]! - c[i]!) * k;
    }
  }
}

/** Move `cur` toward `target` by `dt` seconds of easing, in place (no allocation); `keyDir` stays a unit vector. */
export function easeState(cur: DayNightState, target: DayNightState, dt: number): void {
  const k = easeFactor(dt);
  if (k <= 0) return;
  ease(cur as unknown as Tree, target as unknown as Tree, k);
  const d = cur.keyDir;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= len;
  d[1] /= len;
  d[2] /= len;
}

/** How often the target is read from the clock (s): the sun moves 0.04° in this time, nobody sees a step. */
export const TARGET_SECONDS = 10;

/** The sun's key light as a position offset from its target, `KEY_DISTANCE` m out, for a unit direction. */
export function keyOffset(dir: Vec3, into: Vec3 = [0, 0, 0]): Vec3 {
  into[0] = dir[0] * KEY_DISTANCE;
  into[1] = dir[1] * KEY_DISTANCE;
  into[2] = dir[2] * KEY_DISTANCE;
  return into;
}

/** Luminance weights, for the scene's checks and tests (Rec. 709 on linear light). */
export function linearLuma(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
