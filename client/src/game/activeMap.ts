/**
 * The map the local player stands in right now — the seam between the scenes and the
 * per-frame code. 케이슨 마을's three maps (the open village, the memorial hall, a house interior) reach
 * collision, the camera spring arm, click-move, name-tag occlusion, the overview framing and the HUD
 * room name through here, so those keep ONE code path whatever the area.
 *
 * Module state, never React state: frame code reads `getActiveMap()` each frame (a plain
 * property read). A scene sets its map while it renders (`PlayShell`); the same object
 * again is ignored, a different object bumps `activeMapVersion()` so per-frame caches
 * (the obstacle list) rebuild once — and only then.
 */

import type { Seat } from "@caysonverse/shared/worldMap";
import { VILLAGE_LAYOUT, villageGeometry, type AreaId } from "@caysonverse/shared/village/villageLayout";
import {
  HOUSE_CAMERA,
  HOUSE_LOW_CEILINGS,
  HOUSE_ROOM,
  houseFloorBounds,
  houseFloorLabel,
  parseHouseFloorArea,
  type HouseFloor,
  type HouseNumber,
} from "@caysonverse/shared/village/houseAreas";
import { GENERATED_HOUSES } from "@caysonverse/shared/village/generated/houses";
import { houseFloorGeometry } from "@caysonverse/shared/village/housesGeometry";
import { VILLAGE_BENCHES, VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { MEMORIAL_SEAT_MARKERS } from "@caysonverse/shared/village/generated/memorialSeats";
import type { Bounds, MapGeometry } from "@caysonverse/shared/school/geometry";
import type { AABB } from "@caysonverse/shared/collision";
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
   * everywhere else (the open village: no clamp). The camera stays under the ceiling
   * (`maxY`, `maxDistance`), and the top-down overview is refused where `overview` is false (indoorCamera.ts).
   */
  cameraLimit?: CameraLimit;
  /** HUD room name at a position ("" outside every named place). */
  zoneLabel(x: number, z: number): string;
  /**
   * The seats of this map, indexed by `Player.seatIndex` as the room's server indexes them: 케이슨 마을's benches
   * (`VILLAGE_SEATS`, one list for all areas). Absent: nowhere to sit. The sit prompt, the seated avatar and its
   * camera all look a seat up here.
   */
  seats?: readonly Seat[];
  /**
   * The area whose seats this map offers (`VillageSeat.area`). `seats` is always the ONE global list, so an index means the same
   * seat to the client and to the server; this says which of them the player can sit on from here.
   */
  seatArea?: AreaId;
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
  [
    ...VILLAGE_BENCHES.map((b) => b.centre),
    // the rebuilt hall: the furniture a marker's seat is on (a bench, an armchair, a chair; the long sofa is wider than 3 m)
    ...MEMORIAL_SEAT_MARKERS.map((m) => ({ x: m.x, z: m.z })),
  ].flatMap((c) =>
    villageGeometry.obstacles.filter(
      (o) => c.x > o.minX && c.x < o.maxX && c.z > o.minZ && c.z < o.maxZ && o.maxX - o.minX <= 3 && o.maxZ - o.minZ <= 3,
    ),
  ).filter((o, i, all) => all.indexOf(o) === i),
);

/** 케이슨 마을, the open village : the village area's rectangle of the shared geometry. */
export const VILLAGE_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: villageGeometry,
  bounds: VILLAGE_LAYOUT.areas.village,
  cameraPad: VILLAGE_CAMERA_PAD,
  zoneLabel: () => "케이슨 마을",
  seats: VILLAGE_SEATS, // the one global list; only the village's seats are offered from here
  seatArea: "village",
  furniture: VILLAGE_FURNITURE,
});

/** 케이슨 마을, inside the memorial hall: the same geometry (one collision truth), the hall's own rectangle. */
export const HALL_ACTIVE_MAP: ActiveMap = Object.freeze({
  geometry: villageGeometry,
  bounds: VILLAGE_LAYOUT.areas.hall,
  cameraLimit: HALL_CAMERA_LIMIT, // a roof: the camera stays under the ceiling, no overview
  cameraPad: VILLAGE_CAMERA_PAD, // the same scene, the same near plane
  zoneLabel: () => "추모관",
  seats: VILLAGE_SEATS, // the same list (the server indexes one), so a seat index means the same seat in every area
  seatArea: "hall", // ...but only the hall's are offered here (the houses' share its coordinates)
  furniture: VILLAGE_FURNITURE,
});

/**
 * The camera limit of a house floor (design 7.6): under the ceiling less `HOUSE_CAMERA.ceilingPad`, lower in the attic rooms
 * (`HOUSE_LOW_CEILINGS`: house 8 and 10's floor 2 slope from 2.9 m); no overview (a roof). One object per floor: a limit that differs
 * from the last one is a crossing (the camera is re-seated at once, behind the stair's curtain).
 */
export function houseCameraLimit(n: HouseNumber, floor: HouseFloor): CameraLimit {
  const low = HOUSE_LOW_CEILINGS.find((l) => l.n === n && l.floor === floor);
  const top = low ? low.lowest : HOUSE_ROOM.ceiling;
  return { maxY: Math.round((top - HOUSE_CAMERA.ceilingPad) * 1e6) / 1e6, overview: false };
}

/**
 * The seat furniture of one house floor as colliders (for the tap planner: ground inside a sofa's or chair's box moves out to a spot a
 * body stands on): the model's boxes that hold a seat marker's centre, at most 3 m a side (the village's `VILLAGE_FURNITURE` rule).
 */
function houseFurniture(n: HouseNumber, floor: HouseFloor): readonly AABB[] {
  const g = GENERATED_HOUSES[n];
  if (!g) return [];
  const boxes = houseFloorGeometry(n, floor).obstacles;
  const centres = g.seats.filter((m) => m.floor === floor);
  return centres
    .flatMap((c) => boxes.filter((o) => c.x > o.minX && c.x < o.maxX && c.z > o.minZ && c.z < o.maxZ && o.maxX - o.minX <= 3 && o.maxZ - o.minZ <= 3))
    .filter((o, i, all) => all.indexOf(o) === i);
}

const HOUSE_MAPS = new Map<string, ActiveMap>();
/**
 * One house floor (집 실내 G): its own map — the floor's walls, furniture and ceiling slab as geometry, the floor's rectangle as bounds, the
 * ceiling limit. The seat list stays the ONE global list (an index is the server's index), narrowed to this floor by `seatArea`; a filtered
 * list would number a house's sofa 0..3 and the server would read those as the plaza's benches (the house-seat index bug of 2026-11-13).
 */
function houseActiveMap(area: AreaId): ActiveMap {
  const existing = HOUSE_MAPS.get(area);
  if (existing) return existing;
  const hit = parseHouseFloorArea(area);
  if (!hit) return VILLAGE_ACTIVE_MAP;
  const map: ActiveMap = Object.freeze({
    geometry: houseFloorGeometry(hit.n, hit.floor),
    bounds: houseFloorBounds(hit.n, hit.floor),
    cameraLimit: houseCameraLimit(hit.n, hit.floor),
    cameraPad: VILLAGE_CAMERA_PAD,
    zoneLabel: () => houseFloorLabel(hit.n, hit.floor),
    seats: VILLAGE_SEATS,
    seatArea: area,
    furniture: houseFurniture(hit.n, hit.floor),
  });
  HOUSE_MAPS.set(area, map);
  return map;
}

/** The village map for the area the local player is in: one of two prebuilt maps, so a re-render is never a switch. */
export function villageActiveMap(area: AreaId): ActiveMap {
  return area === "hall" ? HALL_ACTIVE_MAP : area === "village" ? VILLAGE_ACTIVE_MAP : houseActiveMap(area);
}

let current: ActiveMap = VILLAGE_ACTIVE_MAP;
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
