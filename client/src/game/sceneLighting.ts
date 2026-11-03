/**
 * Scene lighting presets for `PlayShell` (AI 학교 탈출, Task 15).
 *
 *  - `day`: the legacy world's daylight interior (design 30) — the very values WorldScene
 *    draws with, so a scene on "day" looks like the world.
 *  - `brightDay`: the school (hall, corridor, classrooms) — a clear daytime sky, no night. The
 *    character lights are the art pass's measured values (key 2.5, hemisphere 2.0): the rooms
 *    arrive as baked GLBs (Task 23), and under the brief's lower 1.2 / 1.0 the live-lit figures
 *    read about twice as dark as the baked walls around them.
 *  - `village`: 케이슨 마을, the open countryside in a clear afternoon: a warm, lower sun, a clear sky and a
 *    long view (fog 60 to 220 m, so the far hills and the lake still read). It is one preset of DATA — the
 *    village's day and night (Task 7A) will drive these values from the clock instead of switching presets.
 *
 * `fog` is [near, far] in metres; `hemi` is [sky colour, ground colour, intensity]; `key` is
 * the directional "sun" — its `position` is relative to the map's centre (PlayShell aims it
 * at the centre of the active map's bounds).
 */

import { FOG_FAR, FOG_NEAR, SKY_COLOR } from "./constants";

export type LightingId = "day" | "brightDay" | "village";

export interface Lighting {
  sky: string;
  fog: [number, number];
  hemi: [string, string, number];
  key: { color: string; intensity: number; position: [number, number, number] };
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
    sky: "#8CC8F0",
    fog: [60, 220],
    hemi: ["#FFFFFF", "#D3E2B4", 1.7],
    // The afternoon sun: warm, from the south-west, about 45 degrees up (so the shadows are long but never lie flat).
    key: { color: "#FFE3B5", intensity: 2.4, position: [-26, 34, 22] },
  },
};
