/**
 * B1 waterfall runtime (design docs/designs/waterfall/design.md, W4): the pure numbers and rules, no three objects
 * and no DOM, so every decision (which mode, how loud, how much mist, whether the rainbow shows) is unit-tested
 * (falls.test.ts). The shape's numbers come from the layout (`VILLAGE_LAYOUT.backdrop.waterfall`, W0).
 */
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { versionedUrl } from "../modelUrl";
import type { VillageTier } from "../villageModelPrep";

export const FALLS = VILLAGE_LAYOUT.backdrop.waterfall;

/** The falls' own files. `waterfall.glb` loads late, after the village is up (never in the first-screen bytes). */
export const FALLS_MODEL_PATH = "/models/village/waterfall.glb";
export const FALLS_LIGHTMAP_PATH = "/models/village/waterfall_lm.webp";
export const FALLS_NIGHT_LIGHTMAP_PATH = "/models/village/waterfall_lm_night.webp";
export const FALLS_MODEL_URL = versionedUrl(FALLS_MODEL_PATH);
export const FALLS_LIGHTMAP_URL = versionedUrl(FALLS_LIGHTMAP_PATH);
export const FALLS_NIGHT_LIGHTMAP_URL = versionedUrl(FALLS_NIGHT_LIGHTMAP_PATH);

/**
 * Whether a model file was there when the client was built (`versionedUrl` adds `?v=<hash>` only to files that exist
 * under public/models). Asking the server for a file that is not there would put a 404 in the console.
 */
export function fileBuilt(url: string): boolean {
  return url.includes("?v=");
}

/** The node and material names agreed with the art (design §7.4). */
export const NODE = {
  rockLod0: "falls_rock_lod0",
  rockLod1: "falls_rock_lod1",
  plunge: "W_falls_plunge_",
  cascade: "W_falls_cascade",
  pool: "W_falls_pool",
  foam: "W_falls_foam",
  outlet: "W_falls_outlet",
  impact: "marker__falls_impact",
  lip: "marker__falls_lip",
} as const;

export const MAT = {
  rock: "M_falls_rock",
  ground: "M_falls_ground",
  slab: "M_falls_slab",
  water: "M_falls_water",
  cascade: "M_falls_cascade",
  foam: "M_falls_foam",
  pool: "M_water",
  leaf: "M_leaf_green",
} as const;

/**
 * W1's macro colour map lies over the cliff's face as the (z, y) rectangle falls_shape.py FACE_Z x FACE_Y (its UV2). W3
 * drops that UV set from the GLB (bytes) and the rock shader computes it from the world position instead.
 */
export const MACRO_RECT = { z0: -98.0, z1: -58.0, y0: -2.6, y1: 41.0 } as const;

/** The old waterfall inside village.glb (kept until the village rebuild, W6): the cliff node and the card material. */
export const OLD_CLIFF_NODE = "waterfall_cliff";
export const OLD_CARD_MATERIAL = "M_waterfall";
/** The old pool disc sits at y -0.2 in village.glb; the new pool is drawn this much above it until the rebuild. */
export const OLD_POOL_LIFT = 0.06;
/** The DEV stand-in lifts its pool above the village's meadow (the new pool is under the old ground until the rebuild cuts the hole). */
export const STUB_POOL_LIFT = 0.55;

/** What the falls draw for each `?falls=` value (DEV): `new` = the model if built, else the stand-in; `stub` = the stand-in; `old` = the previous runtime; `off` = nothing. */
export type FallsMode = "new" | "stub" | "old" | "off";

export function fallsModeFrom(search: string, dev: boolean): FallsMode {
  if (!dev) return "new";
  const v = new URLSearchParams(search).get("falls");
  if (v === "off" || v === "old" || v === "stub") return v;
  // the older flag of the previous runtime
  if (new URLSearchParams(search).get("waterfall") === "old") return "old";
  return "new";
}

export function fallsMode(): FallsMode {
  if (typeof location === "undefined") return "new";
  return fallsModeFrom(location.search, !!import.meta.env.DEV);
}

/** DEV `?fallsTier=low|high` forces a tier for the falls only (to look at both on one machine). */
export function fallsTierFrom(search: string, dev: boolean, tier: VillageTier): VillageTier {
  if (!dev) return tier;
  const v = new URLSearchParams(search).get("fallsTier");
  return v === "low" || v === "high" ? v : tier;
}

export interface FallsTierParams {
  /**
   * GPU drops (W3, "as real as the fountain": design 5.2's 160 / 48 raised): splash drops thrown up where the water
   * lands, drops peeling off the falling sheet, and soft churn clouds in the splash zone; mist puffs (28 / 10). Each is
   * one instanced quad (2 triangles): the high tier's sum is held so the falls stay within 72k triangles.
   */
  spray: number;
  peel: number;
  churn: number;
  mist: number;
  /** Rock detail: LOD1 always on low; LOD0 within `lod0Within` m on high. */
  lod0Within: number;
  /** Water ribbons drawn: all layers on high, two on low. */
  waterLayers: number;
  /** The wave detail layer of the pool and the second flow speed. */
  detail: boolean;
  /** The morning-mist rainbow (high only, owner 2026-11-16). */
  rainbow: boolean;
  /** Pool and flow textures are scaled down to this many px on low. */
  maxTexture: number;
}

export function fallsTierParams(tier: VillageTier): FallsTierParams {
  return tier === "high"
    ? { spray: 200, peel: 136, churn: 32, mist: 28, lod0Within: 90, waterLayers: 3, detail: true, rainbow: FALLS.options.rainbowTier === "high", maxTexture: 1024 }
    : { spray: 72, peel: 40, churn: 12, mist: 10, lod0Within: 0, waterLayers: 3, detail: false, rainbow: false, maxTexture: 512 };
}

/** Beyond this distance (m, camera to impact) the spray, mist and sound stop and the cliff is LOD1 (design §6). */
export const FALLS_FAR_M = 120;

/** Distance (m) from the camera to the point where the water lands. */
export function distanceToImpact(cx: number, cy: number, cz: number): number {
  return Math.hypot(cx - FALLS.impact.x, cy - FALLS.impact.y, cz - FALLS.impact.z);
}

/**
 * The sound's level by distance to the landing point (design 5.2.6): 1.0 in front of the pool (8 m), 0.35 at 30 m,
 * 0.08 at 80 m, 0 from the plaza (120 m). Piecewise linear in between.
 */
const SOUND_POINTS: ReadonlyArray<readonly [number, number]> = [
  [8, 1],
  [30, 0.35],
  [80, 0.08],
  [FALLS_FAR_M, 0],
];
export function soundLevelAt(distanceM: number): number {
  if (!(distanceM > SOUND_POINTS[0]![0])) return 1;
  for (let i = 1; i < SOUND_POINTS.length; i++) {
    const [d0, l0] = SOUND_POINTS[i - 1]!;
    const [d1, l1] = SOUND_POINTS[i]!;
    if (distanceM <= d1) return l0 + ((l1 - l0) * (distanceM - d0)) / (d1 - d0);
  }
  return 0;
}

/** The mist's and spray's fade near the camera: 0 within 1.5 m, 1 from 5 m (so they never cover the screen). */
export const MIST_NEAR_FADE: readonly [number, number] = [1.5, 5];
export function nearFade(distanceM: number, band: readonly [number, number] = MIST_NEAR_FADE): number {
  const t = (distanceM - band[0]) / (band[1] - band[0]);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Hours (KST, decimal, 0..24) at a UTC instant. */
export function kstHours(utcMs: number): number {
  const h = (utcMs / 3_600_000 + 9) % 24;
  return h < 0 ? h + 24 : h;
}

/**
 * How visible the morning rainbow is (0..1): inside `rainbowHours` with half-hour fades at both ends, only on the tier
 * that draws it, scaled by daylight (`day`, 0..1) so it never glows at night.
 */
export function rainbowAmount(hours: number, tier: VillageTier, day: number): number {
  if (tier !== "high" || FALLS.options.rainbowTier !== "high") return 0;
  const [from, to] = FALLS.options.rainbowHours;
  const edge = 0.5;
  const rise = Math.min(1, Math.max(0, (hours - from) / edge));
  const fall = Math.min(1, Math.max(0, (to - hours) / edge));
  return Math.min(rise, fall) * Math.min(1, Math.max(0, day));
}

/** The falls are worth drawing and listening to (within `FALLS_FAR_M`). */
export function fallsNear(distanceM: number): boolean {
  return distanceM < FALLS_FAR_M;
}

/**
 * Which cliff LOD to show. `lod0Within` 0 means never (the light tier). A 10 m band keeps it from flickering at the edge:
 * once LOD0 is shown it stays until the camera is 10 m beyond.
 */
export function pickLod(distanceM: number, lod0Within: number, current: 0 | 1): 0 | 1 {
  if (lod0Within <= 0) return 1;
  return distanceM < (current === 0 ? lod0Within + 10 : lod0Within) ? 0 : 1;
}

/** The plunge's parabola: where the water is `t` seconds after leaving the lip (x metres east of the lip, y the height). */
export function plungeAt(t: number): { x: number; y: number } {
  return { x: FALLS.lip.x + FALLS.plungeSpeed * t, y: FALLS.lip.y - 4.905 * t * t };
}

/** Seconds from the lip to the pool surface. */
export function plungeFallSeconds(): number {
  return Math.sqrt((FALLS.lip.y - FALLS.impact.y) / 4.905);
}

/**
 * What draws the falls: `model` (waterfall.glb), `stub` (the DEV stand-in), `old` (the previous runtime, waterfall3d.ts:
 * kept until the file exists in a build, so production never loses its waterfall), or `none`.
 */
export type FallsRuntime = "model" | "stub" | "old" | "none";
export function fallsRuntimeFor(mode: FallsMode, modelBuilt: boolean, dev: boolean): FallsRuntime {
  if (mode === "off") return "none";
  if (mode === "old") return "old";
  if (mode === "stub") return dev ? "stub" : "old";
  if (modelBuilt) return "model";
  return dev ? "stub" : "old";
}

/** DEV `?fallsFx=nospray,nomist,nosound,nowater` takes parts away (to measure what each costs), `?rainbow=1` forces the rainbow. */
export interface FallsFx {
  spray: boolean;
  mist: boolean;
  sound: boolean;
  water: boolean;
  rainbow: boolean;
}
export function fallsFxFrom(search: string, dev: boolean): FallsFx {
  const fx = { spray: true, mist: true, sound: true, water: true, rainbow: false };
  if (!dev) return fx;
  const p = new URLSearchParams(search);
  const off = new Set((p.get("fallsFx") ?? "").split(",").map((s) => s.trim()));
  fx.spray = !off.has("nospray");
  fx.mist = !off.has("nomist");
  fx.sound = !off.has("nosound");
  fx.water = !off.has("nowater");
  fx.rainbow = p.get("rainbow") === "1";
  return fx;
}
