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
import { VILLAGE_LAYOUT, villageGeometry, type AreaId } from "@caysonverse/shared/village/villageLayout";
import type { Bounds, MapGeometry } from "@caysonverse/shared/school/geometry";
import { zoneLabelAt } from "./hud";
import { HALL_CAMERA_LIMIT, type CameraLimit } from "./indoorCamera";

export interface ActiveMap {
  geometry: MapGeometry;
  /**
   * The rectangle this map's player can be in, where it is smaller than `geometry.bounds`. 케이슨 마을 is ONE
   * geometry spanning the village AND the memorial hall's interior hundreds of metres away (the server's
   * collision needs both), but a player is in one of the two: the village scene sets the bounds of the area
   * the local player is in. Everything that frames "the map" — the sun's shadow box, the shadow floor, the
   * overview camera, the click-move clamp, the spawn fallback — reads `mapBounds(map)`, never `geometry.bounds`.
   */
  bounds?: Bounds;
  /**
   * How far the third-person camera may go here — set by a place with a ROOF (the memorial hall's interior), absent
   * everywhere else (the open village, the legacy world, the hub: no clamp). The camera stays under the ceiling
   * (`maxY`, `maxDistance`), and the top-down overview is refused where `overview` is false (indoorCamera.ts).
   */
  cameraLimit?: CameraLimit;
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

/** The rectangle `m`'s player is in: its own `bounds`, else the geometry's. */
export function mapBounds(m: ActiveMap): Bounds {
  return m.bounds ?? m.geometry.bounds;
}

/** The bounds of the map the local player stands in right now (`getActiveMap()`). */
export function activeBounds(): Bounds {
  return mapBounds(current);
}

/** 케이슨 마을, the open village (the default 입장하기): the village area's rectangle of the shared geometry. */
export const VILLAGE_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: villageGeometry,
  bounds: VILLAGE_LAYOUT.areas.village,
  zoneLabel: () => "케이슨 마을",
});

/** 케이슨 마을, inside the memorial hall: the same geometry (one collision truth), the hall's own rectangle. */
export const HALL_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: villageGeometry,
  bounds: VILLAGE_LAYOUT.areas.hall,
  cameraLimit: HALL_CAMERA_LIMIT, // a roof: the camera stays under the ceiling, no overview
  zoneLabel: () => "추모관",
});

/** The village map for the area the local player is in: one of two prebuilt maps, so a re-render is never a switch. */
export function villageActiveMap(area: AreaId): ActiveMap {
  return area === "hall" ? HALL_ACTIVE_MAP : VILLAGE_ACTIVE_MAP;
}

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
