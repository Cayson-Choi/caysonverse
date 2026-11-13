/**
 * Scene lighting presets for `PlayShell`.
 *
 *  - `village`: 케이슨 마을, the open countryside in a golden afternoon, matched to the baked model (Task 7): the
 *    sun where the bake has it (east-north-east), the haze of the model's sky dome as the fog and clear colour,
 *    and a light fog from 120 to 900 m (the village's own ground barely fades and meets the backdrop, whose haze
 *    is baked in, without a seam; the far plane is 1.6 km, VillageScene). The unlit, light-mapped model reads
 *    through the neutral tone curve at exposure 1.4 (the brightness gate, Task 7). It is the DAY look and the memorial
 *    hall's warm indoor light. The village's day and night (Task 7A) move every one of these values with the clock
 *    instead of switching presets: village/dayNightBlend.ts blends this look with a golden hour and a night, and
 *    village/DayNight.tsx writes the result into the scene's lights, fog, clear colour and exposure every frame
 *    (the preset stays the value the scene is made with and the one the hall shows).
 *
 * `fog` is [near, far] in metres; `hemi` is [sky colour, ground colour, intensity]; `key` is
 * the directional "sun" — its `position` is relative to the map's centre (PlayShell aims it
 * at the centre of the active map's bounds).
 */

import type { ToneCurve } from "./quality";

export type LightingId = "village";

export interface Lighting {
  sky: string;
  fog: [number, number];
  hemi: [string, string, number];
  key: { color: string; intensity: number; position: [number, number, number] };
  /** The scene's tone-mapping exposure, multiplied with the player's brightness (QualityEffects). Default 1. */
  exposure?: number;
  /**
   * The scene's tone curve (QualityEffects): "aces" (three's ACES filmic, the default) or
   * "neutral" (Khronos PBR Neutral: colours below ~0.8 pass almost as they are, only highlights are compressed).
   */
  toneCurve?: ToneCurve;
}

export const LIGHTING: Record<LightingId, Lighting> = {
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
