/**
 * The map the local player stands in right now — the seam between the scenes and the
 * per-frame code (AI 학교 탈출, Task 15). 케이슨 마을, the legacy world, the school hub (gate
 * shut or open) and a team classroom all reach collision, the camera spring arm, click-move,
 * name-tag occlusion, the overview framing and the HUD room name through here, so those
 * keep ONE code path whatever the map.
 *
 * Module state, never React state: frame code reads `getActiveMap()` each frame (a plain
 * property read). A scene sets its map while it renders (`PlayShell`); the same object
 * again is ignored, a different object bumps `activeMapVersion()` so per-frame caches
 * (the obstacle list) rebuild once — and only then.
 */

import { LEGACY_GEOMETRY } from "@caysonverse/shared/worldMap";
import { hubGeometry, hubZoneLabel } from "@caysonverse/shared/school/hubMap";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { zoneLabelAt } from "./hud";

export interface ActiveMap {
  geometry: MapGeometry;
  /** HUD room name at a position ("" outside every named place). */
  zoneLabel(x: number, z: number): string;
  /**
   * The legacy world's chairs and AI 조교 are interaction targets (ruling E6). Only the
   * legacy map sets it; the hub and the classrooms have neither, so the E key / context
   * button never offers a world seat or 조교 there.
   */
  seatsAndNpcs?: boolean;
}

/** The legacy world (the `?world=legacy` deep link). */
export const LEGACY_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: LEGACY_GEOMETRY,
  zoneLabel: zoneLabelAt,
  seatsAndNpcs: true,
});

/** 케이슨 마을 (the default 입장하기). The area-aware room names come with the village scene; for now one name. */
export const VILLAGE_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: villageGeometry,
  zoneLabel: () => "케이슨 마을",
});

const HUB_GATED: ActiveMap = Object.freeze({ geometry: hubGeometry(false), zoneLabel: hubZoneLabel });
const HUB_OPEN: ActiveMap = Object.freeze({ geometry: hubGeometry(true), zoneLabel: hubZoneLabel });

/** The hub for the gate's state: one of two prebuilt maps, so a re-render is never a switch. */
export function hubActiveMap(gateOpen: boolean): ActiveMap {
  return gateOpen ? HUB_OPEN : HUB_GATED;
}

let current: ActiveMap = LEGACY_ACTIVE_MAP;
let version = 0;

/** Make `m` the active map. The same object again is ignored; anything else bumps the version. */
export function setActiveMap(m: ActiveMap): void {
  if (m === current) return;
  current = m;
  version++;
}

export function getActiveMap(): ActiveMap {
  return current;
}

/** Bumped on every switch: per-frame caches compare it to rebuild once per map. */
export function activeMapVersion(): number {
  return version;
}
