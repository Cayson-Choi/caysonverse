/**
 * Scene lighting presets for `PlayShell` (AI 학교 탈출, Task 15).
 *
 *  - `day`: the legacy world's daylight interior (design 30) — the very values WorldScene
 *    draws with, so a scene on "day" looks like the world.
 *  - `brightDay`: the school (hall, corridor, classrooms) — a clear daytime sky, no night. The
 *    character lights are the art pass's measured values (key 2.5, hemisphere 2.0): the rooms
 *    arrive as baked GLBs (Task 23), and under the brief's lower 1.2 / 1.0 the live-lit figures
 *    read about twice as dark as the baked walls around them.
 *  - `village`: 케이슨 마을, the open countryside in a golden afternoon, matched to the baked model (Task 7): the
 *    sun where the bake has it (east-north-east), the haze of the model's sky dome as the fog and clear colour,
 *    and a light fog from 120 to 900 m (the village's own ground barely fades and meets the backdrop, whose haze
 *    is baked in, without a seam; the far plane is 1.6 km, VillageScene). The unlit, light-mapped model reads
 *    through the neutral tone curve at exposure 1.4 (the brightness gate, Task 7). It is one preset of DATA — the
 *    village's day and night (Task 7A) will drive these values from the clock instead of switching presets.
 *
 * `fog` is [near, far] in metres; `hemi` is [sky colour, ground colour, intensity]; `key` is
 * the directional "sun" — its `position` is relative to the map's centre (PlayShell aims it
 * at the centre of the active map's bounds).
 */

import { FOG_FAR, FOG_NEAR, SKY_COLOR } from "./constants";
import type { ToneCurve } from "./quality";

export type LightingId = "day" | "brightDay" | "village";

export interface Lighting {
  sky: string;
  fog: [number, number];
  hemi: [string, string, number];
  key: { color: string; intensity: number; position: [number, number, number] };
  /** The scene's tone-mapping exposure, multiplied with the player's brightness (QualityEffects). Default 1. */
  exposure?: number;
  /**
   * The scene's tone curve (QualityEffects): "aces" (three's ACES filmic, the default: the school's rooms) or
   * "neutral" (Khronos PBR Neutral: colours below ~0.8 pass almost as they are, only highlights are compressed).
   */
  toneCurve?: ToneCurve;
}

export const LIGHTING: Record<LightingId, Lighting> = {
  day: {
    sky: SKY_COLOR,
    fog: [FOG_NEAR, FOG_FAR],
    hemi: ["#FFFFFF", "#D8CFC2", 1.1],
    key: { color: "#FFFFFF", intensity: 1.7, position: [8, 14, 6] },
  },
  brightDay: {
    sky: "#9ED8FF",
    fog: [30, 90],
    hemi: ["#FFFFFF", "#F2E4CE", 2.0],
    key: { color: "#FFF1D6", intensity: 2.5, position: [12, 18, 6] },
  },
  village: {
    sky: "#C4CDD4",
    fog: [120, 900],
    hemi: ["#FFFFFF", "#D3E2B4", 1.7],
    // The afternoon sun: warm, from the baked sun's side (azimuth 70°), 28° up — a little higher than the bake's 20°,
    // so the players' live shadows fall the same way as the baked ones but are long without lying flat.
    key: { color: "#FFD6A8", intensity: 2.4, position: [41.5, 23.5, -15.1] },
    exposure: 1.4,
    toneCurve: "neutral",
  },
};
