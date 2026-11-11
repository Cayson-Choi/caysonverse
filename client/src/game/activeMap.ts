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

import { LEGACY_GEOMETRY, SEATS, type Seat } from "@caysonverse/shared/worldMap";
import { hubGeometry, hubZoneLabel } from "@caysonverse/shared/school/hubMap";
import { VILLAGE_LAYOUT, villageGeometry, type AreaId } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_BENCHES, VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import type { Bounds, MapGeometry } from "@caysonverse/shared/school/geometry";
import type { AABB } from "@caysonverse/shared/collision";
import { zoneLabelAt } from "./hud";
import { HALL_CAMERA_LIMIT, VILLAGE_CAMERA_PAD, type CameraLimit } from "./indoorCamera";

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
  /**
   * The seats of this map, indexed by `Player.seatIndex` as the room's server indexes them: the legacy world's
   * chairs (`SEATS`), 케이슨 마을's benches (`VILLAGE_SEATS`, one list for both areas). Absent: nowhere to sit
   * (the hub, the classrooms). The sit prompt, the seated avatar and its camera all look a seat up here.
   */
  seats?: readonly Seat[];
  /**
   * How far in front of a wall the spring arm stops the camera here (m): absent = `SPRING.pad` (0.2). 케이슨 마을 sets
   * `VILLAGE_CAMERA_PAD`: its near plane is 0.2 (VILLAGE_CAMERA_PLANES), so a pad of 0.2 left no slack in a corner.
   */
  cameraPad?: number;
  /**
   * Colliders of furniture whose real shape covers less ground than its box: visible ground inside one moves out to the
   * nearest spot a body stands on from farther than a wall's foot (clickPlan.ts PlanOptions.furniture). 케이슨 마을's
   * benches (`VILLAGE_FURNITURE`); absent elsewhere.
   */
  furniture?: readonly AABB[];
}

/** 케이슨 마을's spring-arm pad: wider than its 0.2 m near plane (Task 7 review m5). Lives in indoorCamera.ts (the hall's limit derives from it). */
export { VILLAGE_CAMERA_PAD };

/** The legacy world (the `?world=legacy` deep link). */
export const LEGACY_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: LEGACY_GEOMETRY,
  zoneLabel: zoneLabelAt,
  seatsAndNpcs: true,
  seats: SEATS,
});

/** The rectangle `m`'s player is in: its own `bounds`, else the geometry's. */
export function mapBounds(m: ActiveMap): Bounds {
  return m.bounds ?? m.geometry.bounds;
}

/** The bounds of the map the local player stands in right now (`getActiveMap()`). */
export function activeBounds(): Bounds {
  return mapBounds(current);
}

/**
 * 케이슨 마을's benches as colliders: for each bench the box of the geometry that holds its centre (the art's
 * col__bench_<n>, the turned bench's footprint's box — benchSeats.test.ts — the forecourt's stone block, the hall's board).
 */
export const VILLAGE_FURNITURE: readonly AABB[] = Object.freeze(
  VILLAGE_BENCHES.flatMap((b) =>
    villageGeometry.obstacles.filter(
      (o) => b.centre.x > o.minX && b.centre.x < o.maxX && b.centre.z > o.minZ && b.centre.z < o.maxZ && o.maxX - o.minX <= 3 && o.maxZ - o.minZ <= 3,
    ),
  ),
);

/** 케이슨 마을, the open village (the default 입장하기): the village area's rectangle of the shared geometry. */
export const VILLAGE_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: villageGeometry,
  bounds: VILLAGE_LAYOUT.areas.village,
  cameraPad: VILLAGE_CAMERA_PAD,
  zoneLabel: () => "케이슨 마을",
  seats: VILLAGE_SEATS, // every bench of the village (the hall's are out of reach from here)
  furniture: VILLAGE_FURNITURE,
});

/** 케이슨 마을, inside the memorial hall: the same geometry (one collision truth), the hall's own rectangle. */
export const HALL_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: villageGeometry,
  bounds: VILLAGE_LAYOUT.areas.hall,
  cameraLimit: HALL_CAMERA_LIMIT, // a roof: the camera stays under the ceiling, no overview
  cameraPad: VILLAGE_CAMERA_PAD, // the same scene, the same near plane
  zoneLabel: () => "추모관",
  seats: VILLAGE_SEATS, // the same list (the server indexes one), so a seat index means the same bench in both areas
  furniture: VILLAGE_FURNITURE,
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

const NO_SEATS: readonly Seat[] = Object.freeze([]);

/** The seats of the map the local player stands in (empty where there is nowhere to sit). */
export function activeSeats(): readonly Seat[] {
  return current.seats ?? NO_SEATS;
}

/** Bumped on every switch: per-frame caches compare it to rebuild once per map. */
export function activeMapVersion(): number {
  return version;
}
