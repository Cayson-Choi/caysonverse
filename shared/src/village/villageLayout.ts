/**
 * 케이슨 마을 (Cayson Village): the open countryside village, as data. Single source of truth for the
 * village map — walk bounds, spawn, plaza, ring road, stream and bridge, pavilion (정자), the six building
 * plots, the pet memorial hall (추모관) outside and inside, and the scenery houses — read by the server
 * (spawn, door pads, collision), the client (scene, plot markers, camera) and the Blender scripts (through
 * `art/village/layout.json`, written by scripts/export-village-layout.ts).
 *
 * Browser-safe and data-driven: plain numbers plus the shared collision types. North is -z, metres, ground y = 0.
 * Yaw follows the game's `atan2(dirX, dirZ)` convention (0 faces +z), so facing north (-z) is PI.
 *
 * Two areas live in ONE coordinate space, far apart: the village (x -60..60) and the memorial hall's interior
 * (around x = 300). A validated door message teleports a player between them; nobody can WALK between them.
 * `makeGeometry` takes a single bounds rectangle, so `villageGeometry` uses the rectangle that spans both areas
 * and a blocking box fills the gap between them (`areaGapBlockers`). The hall's own walls seal the room.
 *
 * The layout VALUES (positions, sizes) are separate from the collider LIST: `greyboxColliders(layout)` builds
 * axis-aligned boxes from the values for now, and `buildVillageGeometry(layout, colliders)` takes any list —
 * Task 7 passes the colliders generated from the Blender GLB instead.
 */

import type { AABB } from "../collision";
import { DEFAULT_WALL_THICKNESS, makeGeometry, wallsAround } from "../school/geometry";
import type { Bounds, MapGeometry } from "../school/geometry";

export interface Point2 {
  x: number;
  z: number;
}

/** Extent along x and along z (m). */
export interface Size2 {
  x: number;
  z: number;
}

/** A circular trigger area on the ground. */
export interface Disc {
  centre: Point2;
  radius: number;
}

/** The two places a player can be: the open village, or inside the memorial hall. */
export type AreaId = "village" | "hall";

export type PlotId = "plot_n" | "plot_ne" | "plot_e" | "plot_w" | "plot_nw" | "plot_s";

/**
 * A building plot. Plot markers are NOT colliders (players may walk onto an empty plot). A plot with
 * `sign === null` is already built (plot_n holds the memorial hall) and gets no glow marker or sign.
 */
export interface VillagePlot {
  id: PlotId;
  centre: Point2;
  size: Size2;
  /** Korean name of the building planned here (the memorial hall for plot_n). */
  label: string;
  /** Sign text for an empty plot, or null for a built one. */
  sign: string | null;
}

/** A rural house for the scenery. Its door is closed for good. */
export interface SceneryHouse {
  id: string;
  centre: Point2;
  size: Size2;
  enterable: false;
}

export interface VillageStream {
  /** Centre line of the water (it runs along x). */
  z: number;
  minX: number;
  maxX: number;
  /** Width of the water (m); the bridge spans exactly this. */
  width: number;
  /** The one place the stream can be crossed: no bank collider here. */
  bridgeGap: { minX: number; maxX: number };
}

export interface MemorialExterior {
  centre: Point2;
  /** Building footprint (x by z). */
  size: Size2;
  /** The side of the building the door is on ("s": the south face, toward the plaza). */
  doorSide: "s";
  /** Standing here and using the door goes inside. The pad reaches into the footprint (a recess at the door). */
  doorPad: Disc;
}

export interface MemorialInterior {
  /** Centre of the room; the area sits far from the village in the same coordinate space. */
  origin: Point2;
  size: Size2;
  /** The room's floor, `size` centred on `origin`. The walls sit just outside it. */
  room: AABB;
  ceilingHeight: number;
  /** Standing here and using the door goes back outside. */
  doorPad: Disc;
  /** Where a visitor appears when they come in (yaw faces into the room). */
  spawn: Point2 & { yaw: number };
}

export interface VillageLayout {
  /** Where the village's walkable ground ends (the server clamps players into the bounds). */
  walkBounds: Bounds;
  /** Where players appear (plus a random offset of up to `jitter` m). */
  spawn: Point2 & { yaw: number; jitter: number };
  /** A big fountain plaza (중앙에 커다란 분수 광장); the ring road runs around it. */
  plaza: {
    centre: Point2;
    /** The fountain in the middle: a round basin (visual) inside a box collider. */
    fountain: { centre: Point2; /** Outer diameter of the round basin (visual only). */ basinDiameter: number; collider: Size2 };
    /** The paved disk of the plaza, inside the ring road (visual only). */
    paving: { centre: Point2; radius: number };
    /** One big zelkova (느티나무) with a round wooden deck at the plaza's edge; the trunk is inside the deck. */
    zelkova: { centre: Point2; collider: Size2 };
  };
  /** Visual only: no collider. */
  ringRoad: { centre: Point2; radius: number; width: number };
  stream: VillageStream;
  /** Walkable. Spans the water exactly: x = the stream's bridge gap, z = the water band. */
  bridge: AABB;
  pavilion: { centre: Point2; size: Size2 };
  plots: readonly VillagePlot[];
  memorial: { exterior: MemorialExterior; interior: MemorialInterior };
  sceneryHouses: readonly SceneryHouse[];
  areas: Record<AreaId, Bounds>;
}

/** The axis-aligned box of `size` centred on `centre`. */
export function boxAt(centre: Point2, size: Size2): AABB {
  return {
    minX: centre.x - size.x / 2,
    maxX: centre.x + size.x / 2,
    minZ: centre.z - size.z / 2,
    maxZ: centre.z + size.z / 2,
  };
}

/** Yaw that faces north (-z): atan2(dirX, dirZ) with dir = (0, -1). */
const FACING_NORTH = Math.atan2(0, -1);

const WALK_BOUNDS: Bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
const HALL_ORIGIN: Point2 = { x: 300, z: 0 };
const HALL_SIZE: Size2 = { x: 9, z: 12 };
const HALL_ROOM: AABB = boxAt(HALL_ORIGIN, HALL_SIZE);
const SIGN_COMING_SOON = "곧 지어져요";
const PLOT_SIZE: Size2 = { x: 16, z: 16 };
const HOUSE_SIZE: Size2 = { x: 9, z: 7 };

export const VILLAGE_LAYOUT: VillageLayout = {
  walkBounds: WALK_BOUNDS,
  // First arrival: on the fountain plaza, just south of the fountain, facing it (north, -z).
  spawn: { x: 0, z: 9, yaw: FACING_NORTH, jitter: 2.5 },
  plaza: {
    centre: { x: 0, z: 0 },
    fountain: { centre: { x: 0, z: 0 }, basinDiameter: 12, collider: { x: 9, z: 9 } },
    paving: { centre: { x: 0, z: 0 }, radius: 17 },
    zelkova: { centre: { x: -12, z: -10 }, collider: { x: 5, z: 5 } },
  },
  ringRoad: { centre: { x: 0, z: 0 }, radius: 20, width: 5 },
  stream: { z: 30, minX: -60, maxX: 60, width: 6, bridgeGap: { minX: -2, maxX: 2 } },
  bridge: { minX: -2, maxX: 2, minZ: 27, maxZ: 33 },
  pavilion: { centre: { x: -14, z: 36 }, size: { x: 5, z: 5 } },
  plots: [
    { id: "plot_n", centre: { x: 0, z: -40 }, size: PLOT_SIZE, label: "추모관", sign: null },
    { id: "plot_ne", centre: { x: 36, z: -22 }, size: PLOT_SIZE, label: "성당", sign: SIGN_COMING_SOON },
    { id: "plot_e", centre: { x: 40, z: 10 }, size: PLOT_SIZE, label: "학교", sign: SIGN_COMING_SOON },
    { id: "plot_w", centre: { x: -40, z: 10 }, size: PLOT_SIZE, label: "도서관", sign: SIGN_COMING_SOON },
    { id: "plot_nw", centre: { x: -36, z: -22 }, size: PLOT_SIZE, label: "절", sign: SIGN_COMING_SOON },
    { id: "plot_s", centre: { x: 30, z: 44 }, size: PLOT_SIZE, label: "교회", sign: SIGN_COMING_SOON },
  ],
  memorial: {
    exterior: {
      centre: { x: 0, z: -42 },
      size: { x: 14, z: 12 },
      doorSide: "s",
      doorPad: { centre: { x: 0, z: -35.6 }, radius: 1.6 },
    },
    interior: {
      origin: HALL_ORIGIN,
      size: HALL_SIZE,
      room: HALL_ROOM,
      ceilingHeight: 3.4,
      doorPad: { centre: { x: 300, z: 5.2 }, radius: 1.4 },
      spawn: { x: 300, z: 4.2, yaw: FACING_NORTH },
    },
  },
  sceneryHouses: [
    { id: "house_1", centre: { x: -46, z: 40 }, size: HOUSE_SIZE, enterable: false },
    { id: "house_2", centre: { x: -30, z: 50 }, size: HOUSE_SIZE, enterable: false },
    { id: "house_3", centre: { x: 46, z: -46 }, size: HOUSE_SIZE, enterable: false },
    // The plan put this one at (52, 30), inside the stream (z 27..33); moved south of the water.
    { id: "house_4", centre: { x: 52, z: 40 }, size: HOUSE_SIZE, enterable: false },
    { id: "house_5", centre: { x: -52, z: -44 }, size: HOUSE_SIZE, enterable: false },
  ],
  areas: { village: WALK_BOUNDS, hall: HALL_ROOM },
};

/**
 * One solid thing on the walkable ground. `id` is the name the Blender collider node gets (`col__<id>`),
 * so a generated list and this greybox list line up. `camera`: a building the third-person camera must
 * not see through (it is a camera box as tall as a wall); fountain, zelkova deck and banks are looked over.
 */
export interface VillageCollider {
  id: string;
  box: AABB;
  camera: boolean;
}

/**
 * The memorial's solid footprint minus the door-side pad area: three boxes (west, east and back of the
 * door recess). The pad reaches `radius` into the building, so the recess is pad-wide and that deep; the
 * whole pad disc stays free of colliders and the door stays reachable.
 */
function memorialColliders(ex: MemorialExterior): VillageCollider[] {
  const fp = boxAt(ex.centre, ex.size);
  const pad = ex.doorPad;
  const left = pad.centre.x - pad.radius;
  const right = pad.centre.x + pad.radius;
  const recessBack = pad.centre.z - pad.radius;
  return [
    { id: "memorial_w", box: { minX: fp.minX, maxX: left, minZ: fp.minZ, maxZ: fp.maxZ }, camera: true },
    { id: "memorial_e", box: { minX: right, maxX: fp.maxX, minZ: fp.minZ, maxZ: fp.maxZ }, camera: true },
    { id: "memorial_back", box: { minX: left, maxX: right, minZ: fp.minZ, maxZ: recessBack }, camera: true },
  ];
}

/**
 * Greybox colliders of the village area, built from the layout values: the plaza fountain and the zelkova's deck, the stream
 * (its full water band, west and east of the bridge gap, so nobody steps into the water, not even off the
 * bridge's sides), the pavilion, the memorial footprint and the scenery houses. Plots, the ring road and
 * the bridge have none.
 */
export function greyboxColliders(layout: VillageLayout): VillageCollider[] {
  const { plaza, stream, pavilion, memorial, sceneryHouses } = layout;
  const minZ = stream.z - stream.width / 2;
  const maxZ = stream.z + stream.width / 2;
  return [
    { id: "plaza_fountain", box: boxAt(plaza.fountain.centre, plaza.fountain.collider), camera: false },
    { id: "plaza_zelkova", box: boxAt(plaza.zelkova.centre, plaza.zelkova.collider), camera: false },
    { id: "stream_bank_w", box: { minX: stream.minX, maxX: stream.bridgeGap.minX, minZ, maxZ }, camera: false },
    { id: "stream_bank_e", box: { minX: stream.bridgeGap.maxX, maxX: stream.maxX, minZ, maxZ }, camera: false },
    { id: "pavilion", box: boxAt(pavilion.centre, pavilion.size), camera: false },
    ...memorialColliders(memorial.exterior),
    ...sceneryHouses.map((h): VillageCollider => ({ id: h.id, box: boxAt(h.centre, h.size), camera: true })),
  ];
}

/** The memorial hall's four walls: just outside the room, no openings (the door is a teleport pad). */
export function hallWalls(layout: VillageLayout): AABB[] {
  return wallsAround(layout.areas.hall);
}

/** The rectangle `villageGeometry` uses as its bounds: spans the village and the hall (walls included). */
export function villageBounds(layout: VillageLayout): Bounds {
  const v = layout.areas.village;
  const h = layout.areas.hall;
  const t = DEFAULT_WALL_THICKNESS;
  return {
    minX: Math.min(v.minX, h.minX - t),
    maxX: Math.max(v.maxX, h.maxX + t),
    minZ: Math.min(v.minZ, h.minZ - t),
    maxZ: Math.max(v.maxZ, h.maxZ + t),
  };
}

/**
 * Fills the gap between the two areas (from the village's east edge to the hall's outer west wall,
 * the full z range of the bounds), so the spanning bounds do not let anyone walk from one to the other.
 */
export function areaGapBlockers(layout: VillageLayout): AABB[] {
  const bounds = villageBounds(layout);
  const minX = layout.areas.village.maxX;
  const maxX = layout.areas.hall.minX - DEFAULT_WALL_THICKNESS;
  if (maxX <= minX) return [];
  return [{ minX, maxX, minZ: bounds.minZ, maxZ: bounds.maxZ }];
}

/**
 * The village map from a layout and a village collider list: the hall's walls (also camera boxes), then the
 * gap blocker and the colliders as obstacles; the colliders flagged `camera` are camera boxes too.
 */
export function buildVillageGeometry(layout: VillageLayout, colliders: readonly VillageCollider[]): MapGeometry {
  return makeGeometry(
    "village",
    villageBounds(layout),
    hallWalls(layout),
    [...areaGapBlockers(layout), ...colliders.map((c) => c.box)],
    colliders.filter((c) => c.camera).map((c) => c.box),
  );
}

/** The village map for now: greybox colliders built from `VILLAGE_LAYOUT` (Task 7 swaps in the generated ones). */
export const villageGeometry: MapGeometry = buildVillageGeometry(VILLAGE_LAYOUT, greyboxColliders(VILLAGE_LAYOUT));

/**
 * Everything a Blender script needs, as plain JSON-able data (scripts/export-village-layout.ts writes it to
 * art/village/layout.json): the layout values, a ready-made rectangle (`bounds`) next to every centre and
 * size, the greybox colliders by id, the hall walls and the gap blocker.
 */
export function exportVillageLayout(layout: VillageLayout = VILLAGE_LAYOUT) {
  const colliders = greyboxColliders(layout);
  const bounded = <T extends { centre: Point2; size: Size2 }>(o: T) => ({ ...o, bounds: boxAt(o.centre, o.size) });
  const collider = (c: VillageCollider) => ({ id: c.id, ...c.box, camera: c.camera });
  const { stream, memorial } = layout;
  return {
    format: "caysonverse-village-layout",
    version: 1,
    axes: "metres; x east, z south (north is -z), ground at y = 0; yaw 0 faces +z, PI faces north",
    walkBounds: layout.walkBounds,
    spawn: layout.spawn,
    plaza: {
      centre: layout.plaza.centre,
      fountain: {
        centre: layout.plaza.fountain.centre,
        basinDiameter: layout.plaza.fountain.basinDiameter,
        collider: { size: layout.plaza.fountain.collider, bounds: boxAt(layout.plaza.fountain.centre, layout.plaza.fountain.collider) },
      },
      paving: layout.plaza.paving,
      zelkova: {
        centre: layout.plaza.zelkova.centre,
        collider: { size: layout.plaza.zelkova.collider, bounds: boxAt(layout.plaza.zelkova.centre, layout.plaza.zelkova.collider) },
      },
    },
    ringRoad: layout.ringRoad,
    stream: {
      ...stream,
      water: { minX: stream.minX, maxX: stream.maxX, minZ: stream.z - stream.width / 2, maxZ: stream.z + stream.width / 2 },
      banks: colliders.filter((c) => c.id.startsWith("stream_bank_")).map(collider),
    },
    bridge: layout.bridge,
    pavilion: bounded(layout.pavilion),
    plots: layout.plots.map(bounded),
    memorial: {
      exterior: {
        ...memorial.exterior,
        footprint: boxAt(memorial.exterior.centre, memorial.exterior.size),
        colliders: colliders.filter((c) => c.id.startsWith("memorial_")).map(collider),
      },
      interior: { ...memorial.interior, walls: hallWalls(layout) },
    },
    sceneryHouses: layout.sceneryHouses.map(bounded),
    areas: layout.areas,
    colliders: colliders.map(collider),
    areaGapBlockers: areaGapBlockers(layout),
  };
}
