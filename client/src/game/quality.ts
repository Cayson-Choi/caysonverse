/**
 * Graphics quality tiers and the brightness range (AI 학교 탈출, Task 21) — the pure part, so every rule is
 * unit-tested without a browser.
 *
 * Two tiers for the school scenes (the hall and the classrooms; the legacy world keeps its own rendering):
 *  - `high` ("화려하게"): bloom, light shafts through the windows, sparkles in them, soft real-time shadows
 *    for the characters.
 *  - `low` ("가볍게"): no post-processing, the baked lighting of the model and cheap blob shadows.
 * The setting is "auto" / "high" / "low"; "auto" picks `low` on a touch device and `high` otherwise, and
 * the choice can be changed in the menu at any time.
 *
 * The dpr cap and the shadow kind of a tier are NOT applied from here: `getRenderProfile(isTouch, tier)`
 * (renderProfile.ts) reads this table and is the one place a Canvas gets its render budget from (ruling E17).
 */

export type GraphicsSetting = "auto" | "high" | "low";
export type QualityTier = "high" | "low";

/** "auto" is the device's call (touch → light); an explicit choice is taken as it is. */
export function resolveQuality(setting: GraphicsSetting, touch: boolean): QualityTier {
  if (setting === "auto") return touch ? "low" : "high";
  return setting;
}

export interface QualitySpec {
  /** Bloom (an UnrealBloomPass in an EffectComposer). Costs an extra full-screen pass or more. */
  bloom: boolean;
  /** Additive light cones from the model's `shaft__*` nodes. */
  shafts: boolean;
  /** Total sparkle particles near the shafts (0 = none). */
  sparkles: number;
  /** "soft": a real-time shadow map for the characters. "blob": a flat radial-gradient under each one. */
  shadows: "soft" | "blob";
  /** react-three-fiber dpr clamp `[min, max]`. */
  dpr: [number, number];
}

export const QUALITY: Record<QualityTier, QualitySpec> = {
  high: { bloom: true, shafts: true, sparkles: 60, shadows: "soft", dpr: [1, 2] },
  low: { bloom: false, shafts: false, sparkles: 0, shadows: "blob", dpr: [1, 1] },
};

/**
 * The rich tier's bloom: strength / radius are the brief's; the threshold sits above the (tone-map-compensated) sky, the floor
 * and the BAKED sun patches, so only real highlights glow. The rooms' light maps carry HDR sun patches: a lit white surface
 * comes out at up to 1.6 x its albedo (lightMapIntensity 1.6π on a map that stores L / 2, clipped at 1), about 1.4 on cream
 * plaster and wood. At 1.3 (Task 21's value, tuned on plain boxes) those patches, the lockers and the window-lit walls
 * bloomed into a haze; at 1.6 nothing baked glows, while what is pushed past 1 on purpose (the glowing board, Ari's screen, the
 * last door: counselModelPrep's GLOW_ADD up to ~2.5) and the escape's additive light still do.
 */
export const BLOOM = { strength: 0.6, radius: 0.4, threshold: 1.6 } as const;

/** The brightness slider: the renderer's tone-mapping exposure, 0.8 (softer) .. 1.4 (brighter). */
export const BRIGHTNESS = { min: 0.8, max: 1.4, step: 0.1, default: 1.0 } as const;

/** `toneMappingExposure` for a brightness: the value itself, kept inside the range (a non-number is the default). */
export function exposureFor(brightness: number): number {
  if (Number.isNaN(brightness)) return BRIGHTNESS.default;
  return Math.min(BRIGHTNESS.max, Math.max(BRIGHTNESS.min, brightness));
}

/** The fewest sparkles a single shaft gets (a handful reads as dust; one or two as a glitch). */
const MIN_SPARKLES_PER_SHAFT = 2;

/** How many sparkles each of `shafts` light cones gets out of the tier's total `budget` (0 when there is none to spend). */
export function sparklesPerPoint(budget: number, shafts: number): number {
  if (budget <= 0 || shafts <= 0) return 0;
  return Math.max(MIN_SPARKLES_PER_SHAFT, Math.floor(budget / shafts));
}

// ───────────────────────────────── the rich tier's sky ─────────────────────────────────
//
// The rich tier draws the scene into a half-float target and tone-maps the WHOLE frame in its last pass, the
// clear colour included. The light tier lets the renderer tone-map, which leaves its clear colour alone. So the
// same sky colour would come out washed grey-blue on the rich tier. `skyBeforeToneMap` is the clear colour that
// tone-maps (three's ACES filmic, at the given exposure) back into the sky.

type RGB = [number, number, number];

/** What a pixel becomes under three's ACESFilmicToneMapping (OutputPass / the renderer) at `exposure`, in linear light. Mirrors the shader. */
export function acesFilmic(rgb: readonly number[], exposure: number): RGB {
  const s = exposure / 0.6;
  const r = rgb[0] * s;
  const g = rgb[1] * s;
  const b = rgb[2] * s;
  // sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
  const x = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const y = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const z = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v: number): number =>
    (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const fx = fit(x);
  const fy = fit(y);
  const fz = fit(z);
  // ODT_SAT => XYZ => D60_2_D65 => sRGB, then clamp to [0, 1]
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  return [
    clamp01(1.60475 * fx - 0.53108 * fy - 0.07367 * fz),
    clamp01(-0.10208 * fx + 1.10813 * fy - 0.00605 * fz),
    clamp01(-0.00327 * fx - 0.07276 * fy + 1.07602 * fz),
  ];
}

/** sRGB "#RRGGBB" -> linear light. */
function srgbHexToLinear(hex: string): RGB {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(1), channel(2)];
}

/** The curve only reaches 1 at infinity, so the target is held just under it (255 becomes ~253 in sRGB). */
const SKY_TARGET_MAX = 0.985;

/**
 * The linear clear colour that comes out as `skyHex` after the rich tier tone-maps it at `exposure` (Newton's
 * method on `acesFilmic`, a handful of steps, run once per sky / brightness — not per frame). Best effort for a
 * colour the curve cannot reach; always finite and never negative.
 */
export function skyBeforeToneMap(skyHex: string, exposure: number): RGB {
  const target = srgbHexToLinear(skyHex).map((v) => Math.min(SKY_TARGET_MAX, v)) as RGB;
  const err = (x: RGB): RGB => {
    const f = acesFilmic(x, exposure);
    return [f[0] - target[0], f[1] - target[1], f[2] - target[2]];
  };
  const norm = (e: RGB): number => Math.hypot(e[0], e[1], e[2]);
  let x: RGB = [target[0] * 2, target[1] * 2, target[2] * 2];
  let e = err(x);
  for (let i = 0; i < 60 && norm(e) > 1e-6; i++) {
    // Jacobian by finite differences, columns = d err / d x_c.
    const cols: RGB[] = [];
    for (let c = 0; c < 3; c++) {
      const h = 1e-4 * Math.max(1, x[c]);
      const xp: RGB = [x[0], x[1], x[2]];
      xp[c] += h;
      const ep = err(xp);
      cols.push([(ep[0] - e[0]) / h, (ep[1] - e[1]) / h, (ep[2] - e[2]) / h]);
    }
    const [a, b, c] = cols; // J = [a b c] by columns
    const det =
      a[0] * (b[1] * c[2] - c[1] * b[2]) - b[0] * (a[1] * c[2] - c[1] * a[2]) + c[0] * (a[1] * b[2] - b[1] * a[2]);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    // Cramer: step = J^-1 e
    const solve = (m0: RGB, m1: RGB, m2: RGB): number =>
      m0[0] * (m1[1] * m2[2] - m2[1] * m1[2]) - m1[0] * (m0[1] * m2[2] - m2[1] * m0[2]) + m2[0] * (m0[1] * m1[2] - m1[1] * m0[2]);
    const step: RGB = [solve(e, b, c) / det, solve(a, e, c) / det, solve(a, b, e) / det];
    // Backtrack until the error goes down (the curve is steep near black and flat near white).
    let k = 1;
    let next = x;
    let nextErr = e;
    for (let tries = 0; tries < 12; tries++, k /= 2) {
      const cand: RGB = [
        Math.min(1e4, Math.max(0, x[0] - k * step[0])),
        Math.min(1e4, Math.max(0, x[1] - k * step[1])),
        Math.min(1e4, Math.max(0, x[2] - k * step[2])),
      ];
      const ce = err(cand);
      if (norm(ce) < norm(e)) {
        next = cand;
        nextErr = ce;
        break;
      }
    }
    if (next === x) break;
    x = next;
    e = nextErr;
  }
  return x;
}
