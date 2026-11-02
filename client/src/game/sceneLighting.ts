/**
 * Scene lighting presets for `PlayShell` (AI 학교 탈출, Task 15).
 *
 *  - `day`: the legacy world's daylight interior (design 30) — the very values WorldScene
 *    draws with, so a scene on "day" looks like the world.
 *  - `brightDay`: the school (hall, corridor, classrooms) — a clear daytime sky, no night. The
 *    character lights are the art pass's measured values (key 2.5, hemisphere 2.0): the rooms
 *    arrive as baked GLBs (Task 23), and under the brief's lower 1.2 / 1.0 the live-lit figures
 *    read about twice as dark as the baked walls around them.
 *
 * `fog` is [near, far] in metres; `hemi` is [sky colour, ground colour, intensity]; `key` is
 * the directional "sun" — its `position` is relative to the map's centre (PlayShell aims it
 * at the centre of the active map's bounds).
 */

import { FOG_FAR, FOG_NEAR, SKY_COLOR } from "./constants";

export type LightingId = "day" | "brightDay";

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
};
