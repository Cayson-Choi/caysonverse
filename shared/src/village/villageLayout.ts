/**
 * 케이슨 마을 (Cayson Village): the open countryside village, as data. Single source of truth for the
 * village map — walk bounds, spawn, the big fountain plaza, ring road with its sidewalk and bus stop, the
 * lanes, a curving creek with a footbridge, the pavilion (정자), the six building plots, the pet memorial hall
 * (추모관) outside and inside, the scenery houses and café, and the backdrop (waterfall, lake) — read by the
 * server (spawn, door arrivals, collision), the client (scene, plot markers, camera) and the Blender scripts
 * (through `art/village/layout.json`, written by scripts/export-village-layout.ts).
 *
 * Browser-safe and data-driven: plain numbers plus the shared collision types. North is -z, metres, ground y = 0.
 * Yaw follows the game's `atan2(dirX, dirZ)` convention (0 faces +z), so facing north (-z) is PI.
 *
 * Layout v2 (owner, 2026-11-03): a much bigger plaza so many people can gather, in the style of
 * art/village/refs/owner_village_style.webp. From the plaza centre outwards: fountain (basin 16 m) inside
 * a paved disk (r 30), the ring road (r 31..37) with a 2 m sidewalk outside it, small colourful houses and
 * a café, then the six 18 x 18 plots on a ring of r ~58, and the creek beyond the southern plots. The
 * waterfall and the lake are backdrop outside the walk bounds (visual only).
 *
 * Two areas live in ONE coordinate space, far apart: the village (x -95..95) and the memorial hall's interior
 * (around x = 300). A validated door message teleports a player between them; nobody can WALK between them.
 * `makeGeometry` takes a single bounds rectangle, so `villageGeometry` uses the rectangle that spans both areas
 * and blocking boxes fill the space between and around them (`areaGapBlockers`, `hallSurroundBlockers`). The
 * hall's own walls seal the room.
 *
 * The layout VALUES (positions, sizes) are separate from the collider LIST: `greyboxColliders(layout)` builds
 * axis-aligned boxes from the values, and `buildVillageGeometry(layout, colliders)` takes any list — the game
 * plays on the colliders generated from the Blender GLB (Task 7: `villageGeometry`), which contain every
 * greybox box exactly plus the model's own (benches, planters, trunks, garden fences...). `VILLAGE_LAYOUT` is deeply frozen and
 * shares no object between two fields.
 */

import type { AABB, CameraBox } from "../collision";
import { DEFAULT_WALL_THICKNESS, makeGeometry, wallsAround } from "../school/geometry";
import { VILLAGE_CAMERA_BOXES, VILLAGE_COLLIDERS } from "./generated/villageColliders";
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

/** A compass side: north is -z, east is +x. */
export type Side = "n" | "s" | "e" | "w";

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
  /** True while a building is going up here (Task 6 dresses it with scaffold and a crane). */
  underConstruction: boolean;
  /** Where the sign post stands (inside the plot, at the edge facing the plaza) and the way it faces; null for a built plot. */
  signPost: (Point2 & { facing: Side }) | null;
}

/** Wall colours of the scenery houses (the café and the flower kiosk are "wood"). */
export type HouseColour = "pink" | "skyblue" | "yellow" | "white" | "mint" | "wood";

/** The footprint of each kind of scenery building (x by z, m). */
export const SCENERY_SIZES = { house: { x: 8, z: 6 }, cafe: { x: 12, z: 9 }, kiosk: { x: 4, z: 3 } } as const;

/**
 * A small colourful house, the café with striped awnings, or the café's timber flower kiosk, for the scenery.
 * Its door is closed for good.
 */
export interface SceneryHouse {
  id: string;
  kind: keyof typeof SCENERY_SIZES;
  centre: Point2;
  size: Size2;
  enterable: false;
  colour: HouseColour;
  /** The side the (closed) door is on; it faces the ring road. */
  doorSide: Side;
}

/** One stretch of the creek: its centre line runs at `z` from `minX` to `maxX` (the water is `width` wide). */
export interface StreamSegment {
  minX: number;
  maxX: number;
  z: number;
}

/**
 * The creek: a gentle curve approximated by axis-aligned segments, west to east, each starting where the
 * previous ends. Collision is 2D boxes covering the whole water band of every segment; the only break is the
 * bridge gap, which lies inside one segment.
 */
export interface VillageStream {
  /** Width of the water (m); the bridge spans exactly this. */
  width: number;
  /**
   * Width of the bank on each side of the water (m), solid in the collision: the creek's boxes cover the water
   * plus this much on both sides, so the barrier is `width + 2 * bankWidth` thick and one legal step (up to 4.8 m)
   * cannot hop it, not even across the corner where two segments meet.
   */
  bankWidth: number;
  segments: readonly StreamSegment[];
  /** The one place the creek can be crossed: no collider here (4 m wide). */
  bridgeGap: { minX: number; maxX: number };
}

/** A visual lane: a polyline `width` wide (not a collider). */
export interface VillageLane {
  id: string;
  width: number;
  points: readonly Point2[];
}

export interface MemorialExterior {
  centre: Point2;
  /** Building footprint (x by z), centred on plot_n. */
  size: Size2;
  /** The side of the building the door is on ("s": the south face, toward the plaza). */
  doorSide: "s";
  /** Standing here and using the door goes inside. 0.4 m outside the façade; the pad reaches into the footprint (a recess at the door). */
  doorPad: Disc;
  /** Where the way out puts a visitor: the pad centre 2.2 m south, facing +z, away from the building. */
  arrival: Point2 & { yaw: number };
}

/**
 * One wall of cubbies (봉안함 칸) in the memorial hall: `rows` x `cols` square cubbies of `cell` m with `frame` m boards
 * between and around them, on a plinth, open toward the room. The model (memorial.glb, Task 8) builds the wall from
 * these values and puts an `anchor__cubby_<wall>_<row>_<col>` empty at every cubby's opening centre (`cubbyAnchors`).
 */
export interface CubbyWall {
  /** The wall it stands against: "n" the back (north) wall, "e" the east wall. */
  wall: "n" | "e";
  /** White lacquer (the back wall) or light oak (the east wall). */
  finish: "lacquer" | "oak";
  rows: number;
  cols: number;
  /** Inner width and height of one cubby (m). */
  cell: number;
  /** Board thickness between and around the cubbies (m). */
  frame: number;
  /** From the opening to the back panel (m). Back panel and the gap to the wall make the unit `unitDepth` deep. */
  depth: number;
  /** The whole unit's depth, opening plane to the wall (m). */
  unitDepth: number;
  /** Height of the plinth under the bottom board (m). */
  plinth: number;
  /** The run's start on the opening plane: the outer edge of column 0's frame (floor level). */
  start: Point2;
  /** Unit vector along the run on the ground plane: columns count this way. */
  along: Point2;
  /** Yaw the cubbies face, into the room (game yaw: 0 faces +z). */
  yaw: number;
}

/** A cubby's opening centre, where the runtime puts what a family placed in it (Task 9). */
export interface CubbyAnchor {
  /** `<wall>_<row>_<col>`; row 0 is the bottom row, column 0 the run's start. */
  id: string;
  wall: CubbyWall["wall"];
  row: number;
  col: number;
  x: number;
  /** Height of the opening centre (m); the cubby's floor is `cell / 2` lower. */
  y: number;
  z: number;
  /** Facing out of the cubby, into the room. */
  yaw: number;
}

export interface MemorialInterior {
  /** Centre of the room; the area sits far from the village in the same coordinate space. */
  origin: Point2;
  size: Size2;
  /** The floor of the room, `size` centred on `origin`. The walls sit just outside it. */
  room: AABB;
  ceilingHeight: number;
  /** The wall the way out is on (the south wall, like the outside door). */
  doorSide: "s";
  /** Standing here and using the door goes back outside. */
  doorPad: Disc;
  /** Where a visitor appears when they come in (yaw faces into the room). */
  spawn: Point2 & { yaw: number };
  /** The cubby walls: the back wall (white lacquer, 20 x 7) and the east wall (light oak, 18 x 7), meeting in the north-east corner. */
  cubbyWalls: readonly CubbyWall[];
}

export interface VillageLayout {
  /** Where the village's walkable ground ends (the server clamps players into the bounds). */
  walkBounds: Bounds;
  /** Where players appear (plus a random offset of up to `jitter` m): on the plaza, facing the fountain. */
  spawn: Point2 & { yaw: number; jitter: number };
  /** The big fountain plaza; the ring road runs around it. */
  plaza: {
    centre: Point2;
    /** The fountain in the middle: a round basin (visual) inside a box collider. */
    fountain: { centre: Point2; /** Outer diameter of the round basin (visual only). */ basinDiameter: number; collider: Size2 };
    /** The paved disk of the plaza, inside the ring road (visual only). */
    paving: { centre: Point2; radius: number };
    /** One big zelkova (느티나무) with a round wooden deck at the plaza's edge; the trunk is inside the deck. */
    zelkova: { centre: Point2; deck: { shape: "round"; diameter: number }; collider: Size2 };
    /** Benches round the fountain, facing it (visual only). */
    benches: readonly (Point2 & { yaw: number })[];
    /** Lamp posts on the paving's rim (visual only). */
    lamps: readonly Point2[];
  };
  /** Visual only: no collider. The sidewalk runs along the outer edge. */
  ringRoad: { centre: Point2; radius: number; width: number; sidewalk: { width: number; side: "outer" } };
  /** A bus stop on the ring road's outer side: the shelter is visual, the parked bus is a collider. */
  busStop: { shelter: { centre: Point2; size: Size2 }; bus: { centre: Point2; size: Size2 } };
  stream: VillageStream;
  /** Walkable. Spans the water exactly: x = the stream's bridge gap, z = the water band of the segment it crosses. */
  bridge: AABB;
  pavilion: { centre: Point2; size: Size2 };
  /** Visual lanes: plaza to each plot, plaza to the bridge, the bus stop. */
  lanes: readonly VillageLane[];
  plots: readonly VillagePlot[];
  memorial: { exterior: MemorialExterior; interior: MemorialInterior };
  sceneryHouses: readonly SceneryHouse[];
  /** Outside the walk bounds, visual only: the waterfall on a cliff (back left) and the lake with a pavilion (right). */
  backdrop: {
    waterfall: { centre: Point2; size: Size2; height: number; facing: Side };
    lake: { centre: Point2; size: Size2; pavilion: { centre: Point2; size: Size2 } };
  };
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

/** The Blender collider node of a collider id: `col__<id>`. */
export function colliderNode(id: string): string {
  return `col__${id}`;
}

/** Freeze `value` and everything reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** Yaw that faces north (-z): atan2(dirX, dirZ) with dir = (0, -1). */
const FACING_NORTH = Math.atan2(0, -1);
/** Yaw that faces south (+z): atan2(0, 1). */
const FACING_SOUTH = Math.atan2(0, 1);
/** Yaw that faces west (-x): atan2(-1, 0). */
const FACING_WEST = Math.atan2(-1, 0);

const SIGN_COMING_SOON = "곧 지어져요";
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const pt = (x: number, z: number): Point2 => ({ x, z });
const sz = (x: number, z: number): Size2 => ({ x, z });

/** A point at compass `azimuthDeg` (clockwise from north) and `radius` from the origin, rounded to 1 cm. */
function onCircle(azimuthDeg: number, radius: number): Point2 {
  const a = (azimuthDeg * Math.PI) / 180;
  return pt(round(radius * Math.sin(a), 2), round(-radius * Math.cos(a), 2));
}

/** Benches round the fountain at 11 m, one per 45 degrees, facing the fountain. */
function fountainBenches(): (Point2 & { yaw: number })[] {
  return [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((azimuth) => {
    const p = onCircle(azimuth, 11);
    return { ...p, yaw: round(Math.atan2(-p.x, -p.z), 4) };
  });
}

function plot(
  id: PlotId,
  centre: Point2,
  label: string,
  rest: { signPost: (Point2 & { facing: Side }) | null; underConstruction?: boolean },
): VillagePlot {
  return {
    id,
    centre,
    size: sz(18, 18),
    label,
    sign: rest.signPost === null ? null : SIGN_COMING_SOON,
    underConstruction: rest.underConstruction ?? false,
    signPost: rest.signPost,
  };
}

function house(
  id: string,
  centre: Point2,
  colour: HouseColour,
  doorSide: Side,
  kind: SceneryHouse["kind"] = "house",
): SceneryHouse {
  const size = SCENERY_SIZES[kind];
  return { id, kind, centre, size: sz(size.x, size.z), enterable: false, colour, doorSide };
}

/** Cubby size (inner, m), board thickness, depth to the back panel and the unit's full depth (the approved concept, 2026-11-03). */
const CUBBY = { cell: 0.4, frame: 0.025, depth: 0.36, unitDepth: 0.39, plinth: 0.12, rows: 7 } as const;

/**
 * The hall's two cubby walls (room x 295.5..304.5, z -6..6). The east unit runs from the back unit's front face
 * (z = -6 + 0.39) toward the door, 18 columns (7.675 m, to z = 2.065); the back unit runs west from the east unit's
 * front face (x = 304.5 - 0.39), 20 columns (8.525 m, to x = 295.585; a filler closes the 8.5 cm to the west wall).
 */
function hallCubbyWalls(): CubbyWall[] {
  const run = (cols: number) => cols * (CUBBY.cell + CUBBY.frame) + CUBBY.frame;
  const eastFront = 304.5 - CUBBY.unitDepth;
  const backFront = -6 + CUBBY.unitDepth;
  return [
    { wall: "n", finish: "lacquer", ...CUBBY, cols: 20, start: pt(round(eastFront - run(20), 6), backFront), along: pt(1, 0), yaw: FACING_SOUTH },
    { wall: "e", finish: "oak", ...CUBBY, cols: 18, start: pt(eastFront, backFront), along: pt(0, 1), yaw: FACING_WEST },
  ];
}

function makeVillageLayout(): VillageLayout {
  return {
    walkBounds: { minX: -95, maxX: 95, minZ: -95, maxZ: 95 },
    spawn: { x: 0, z: 14, yaw: FACING_NORTH, jitter: 3 },
    plaza: {
      centre: pt(0, 0),
      fountain: { centre: pt(0, 0), basinDiameter: 16, collider: sz(12, 12) },
      paving: { centre: pt(0, 0), radius: 30 },
      zelkova: { centre: pt(-25, -5), deck: { shape: "round", diameter: 5 }, collider: sz(5, 5) },
      benches: fountainBenches(),
      lamps: [27.5, 80, 142.5, 217.5, 332.5].map((azimuth) => onCircle(azimuth, 28)),
    },
    ringRoad: { centre: pt(0, 0), radius: 34, width: 6, sidewalk: { width: 2, side: "outer" } },
    // Parked on the outer lane at the east (x 33.1..35.6 stays inside the road's 31..37 band along its whole 8 m).
    busStop: {
      shelter: { centre: pt(38, -6), size: sz(1.6, 4) },
      bus: { centre: pt(34.35, -6), size: sz(2.5, 8) },
    },
    // A gentle bow to the south beyond plot_s (z 49..67); every segment is 6 m of water with 3 m of bank on each side,
    // and the centre line moves at most 3 m from one segment to the next.
    stream: {
      width: 6,
      bankWidth: 3,
      segments: [
        { minX: -95, maxX: -70, z: 70 },
        { minX: -70, maxX: -46, z: 72 },
        { minX: -46, maxX: -4, z: 75 },
        { minX: -4, maxX: 24, z: 78 },
        { minX: 24, maxX: 52, z: 76 },
        { minX: 52, maxX: 95, z: 73 },
      ],
      bridgeGap: { minX: -26, maxX: -22 },
    },
    bridge: { minX: -26, maxX: -22, minZ: 72, maxZ: 78 },
    pavilion: { centre: pt(-16, 62), size: sz(5, 5) },
    lanes: [
      { id: "lane_plot_n", width: 3, points: [pt(0, -30), pt(0, -51.6)] },
      { id: "lane_plot_ne", width: 3, points: [pt(24.72, -16.99), pt(38.5, -33)] },
      { id: "lane_plot_e", width: 3, points: [pt(28.98, 7.76), pt(47.5, 15)] },
      { id: "lane_plot_s", width: 3, points: [pt(0, 30), pt(0, 49)] },
      { id: "lane_plot_w", width: 3, points: [pt(-28.98, 7.76), pt(-47.5, 15)] },
      { id: "lane_plot_nw", width: 3, points: [pt(-24.72, -16.99), pt(-38.5, -33)] },
      { id: "lane_bridge", width: 3, points: [pt(-11, 27.91), pt(-24, 46), pt(-24, 72)] },
      { id: "lane_bus", width: 2.5, points: [pt(30, 1), pt(38.5, 1), pt(38.5, -6)] },
    ],
    plots: [
      plot("plot_n", pt(0, -58), "추모관", { signPost: null }),
      plot("plot_ne", pt(48, -33), "성당", { signPost: { x: 40, z: -33, facing: "w" } }),
      plot("plot_e", pt(56, 15), "학교", { signPost: { x: 48, z: 15, facing: "w" } }),
      plot("plot_w", pt(-56, 15), "도서관", { signPost: { x: -48, z: 15, facing: "e" }, underConstruction: true }),
      plot("plot_nw", pt(-48, -33), "절", { signPost: { x: -40, z: -33, facing: "e" } }),
      plot("plot_s", pt(0, 58), "교회", { signPost: { x: 0, z: 50, facing: "n" } }),
    ],
    memorial: {
      exterior: {
        centre: pt(0, -58),
        size: sz(14, 12),
        doorSide: "s",
        doorPad: { centre: pt(0, -51.6), radius: 1.6 },
        arrival: { x: 0, z: -49.4, yaw: FACING_SOUTH },
      },
      interior: {
        origin: pt(300, 0),
        size: sz(9, 12),
        room: boxAt(pt(300, 0), sz(9, 12)),
        ceilingHeight: 3.4,
        doorSide: "s",
        doorPad: { centre: pt(300, 5.2), radius: 1.4 },
        // 0.2 m outside the 1.4 m door pad's edge (pad centre z = 5.2, spawn z = 3.6, distance 1.6), so a new arrival is not standing on the door.
        spawn: { x: 300, z: 3.6, yaw: FACING_NORTH },
        cubbyWalls: hallCubbyWalls(),
      },
    },
    // Between the ring road's sidewalk (r 39) and the plots, doors toward the road. Houses 6-10 and the kiosk were
    // added with the Blender model (Task 6, validated there against lanes, plots, the road and the creek); the model's
    // col__<id> boxes sit exactly on these rectangles.
    sceneryHouses: [
      house("house_1", pt(21, -42), "pink", "s"),
      house("house_2", pt(-21, -42), "skyblue", "s"),
      house("house_3", pt(29, 37), "yellow", "n"),
      house("house_4", pt(-28, 38), "white", "n"),
      house("house_5", pt(-46, -8), "mint", "e"),
      house("house_6", pt(15, -52), "yellow", "s"),
      house("house_7", pt(31, -50), "mint", "s"),
      house("house_8", pt(-15, -52), "skyblue", "s"),
      house("house_9", pt(-31, -50), "pink", "s"),
      house("house_10", pt(-40, 28), "white", "e"),
      house("cafe", pt(46, -12), "wood", "w", "cafe"),
      house("kiosk", pt(46, -3), "wood", "w", "kiosk"),
    ],
    backdrop: {
      waterfall: { centre: pt(-118, -78), size: sz(28, 14), height: 36, facing: "e" },
      lake: { centre: pt(130, -15), size: sz(60, 90), pavilion: { centre: pt(108, -12), size: sz(6, 6) } },
    },
    areas: { village: { minX: -95, maxX: 95, minZ: -95, maxZ: 95 }, hall: boxAt(pt(300, 0), sz(9, 12)) },
  };
}

export const VILLAGE_LAYOUT: VillageLayout = deepFreeze(makeVillageLayout());

/**
 * One solid thing on the walkable ground. `id` is the name the Blender collider node gets (`col__<id>`),
 * so a generated list and this greybox list line up. `camera`: a building the third-person camera must
 * not see through (it is a camera box as tall as a wall); fountain, zelkova deck, banks and the pavilion are looked over.
 */
export interface VillageCollider {
  id: string;
  box: AABB;
  camera: boolean;
}

/** The water band `[minZ, maxZ]` of a creek segment. */
export function segmentBand(stream: VillageStream, segment: StreamSegment): { minZ: number; maxZ: number } {
  return { minZ: segment.z - stream.width / 2, maxZ: segment.z + stream.width / 2 };
}

/** The water band plus the bank on both sides: the z extent of the segment's collider. */
export function segmentBank(stream: VillageStream, segment: StreamSegment): { minZ: number; maxZ: number } {
  const band = segmentBand(stream, segment);
  return { minZ: band.minZ - stream.bankWidth, maxZ: band.maxZ + stream.bankWidth };
}

/**
 * The creek's colliders: every segment's water band and its banks (so nobody steps into the water, not even
 * off the bridge's sides, and no single step hops across), the one holding the bridge gap in two boxes (west
 * and east of it; the gap column stays free over the whole bank, so the bridge has an approach on each end).
 */
function streamColliders(stream: VillageStream): VillageCollider[] {
  const gap = stream.bridgeGap;
  const out: VillageCollider[] = [];
  stream.segments.forEach((seg, i) => {
    const { minZ, maxZ } = segmentBank(stream, seg);
    const name = `stream_bank_${i + 1}`;
    if (gap.minX >= seg.minX && gap.maxX <= seg.maxX) {
      if (gap.minX > seg.minX) out.push({ id: `${name}_w`, box: { minX: seg.minX, maxX: gap.minX, minZ, maxZ }, camera: false });
      if (gap.maxX < seg.maxX) out.push({ id: `${name}_e`, box: { minX: gap.maxX, maxX: seg.maxX, minZ, maxZ }, camera: false });
    } else {
      out.push({ id: name, box: { minX: seg.minX, maxX: seg.maxX, minZ, maxZ }, camera: false });
    }
  });
  return out;
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
 * Greybox colliders of the village area, built from the layout values: the plaza fountain and the zelkova's
 * deck, the creek, the pavilion, the parked bus, the memorial footprint and the scenery houses and café.
 * Plots, lanes, the ring road, the sidewalk and the bridge have none.
 */
export function greyboxColliders(layout: VillageLayout): VillageCollider[] {
  const { plaza, stream, pavilion, busStop, memorial, sceneryHouses } = layout;
  return [
    { id: "plaza_fountain", box: boxAt(plaza.fountain.centre, plaza.fountain.collider), camera: false },
    { id: "plaza_zelkova", box: boxAt(plaza.zelkova.centre, plaza.zelkova.collider), camera: false },
    ...streamColliders(stream),
    { id: "pavilion", box: boxAt(pavilion.centre, pavilion.size), camera: false },
    { id: "bus", box: boxAt(busStop.bus.centre, busStop.bus.size), camera: true },
    ...memorialColliders(memorial.exterior),
    ...sceneryHouses.map((h): VillageCollider => ({ id: h.id, box: boxAt(h.centre, h.size), camera: true })),
  ];
}

/** The model's node name of a cubby anchor: `anchor__cubby_<id>`. */
export function cubbyAnchorNode(id: string): string {
  return `anchor__cubby_${id}`;
}

/** Every cubby's opening centre, wall by wall, row by row (bottom first), column by column. */
export function cubbyAnchors(layout: VillageLayout): CubbyAnchor[] {
  const out: CubbyAnchor[] = [];
  for (const w of layout.memorial.interior.cubbyWalls) {
    const pitch = w.cell + w.frame;
    for (let row = 0; row < w.rows; row += 1) {
      for (let col = 0; col < w.cols; col += 1) {
        const u = w.frame + col * pitch + w.cell / 2;
        out.push({
          id: `${w.wall}_${row}_${col}`,
          wall: w.wall,
          row,
          col,
          x: round(w.start.x + w.along.x * u, 6),
          y: round(w.plinth + w.frame + row * pitch + w.cell / 2, 6),
          z: round(w.start.z + w.along.z * u, 6),
          yaw: w.yaw,
        });
      }
    }
  }
  return out;
}

/** A cubby wall's footprint: from its opening plane back to the room wall, along its whole run. */
export function cubbyWallBox(w: CubbyWall): AABB {
  const len = w.cols * (w.cell + w.frame) + w.frame;
  const end = { x: w.start.x + w.along.x * len, z: w.start.z + w.along.z * len };
  // the unit lies behind the opening plane: opposite to where the cubbies face
  const back = { x: -Math.sin(w.yaw) * w.unitDepth, z: -Math.cos(w.yaw) * w.unitDepth };
  const xs = [w.start.x, end.x, w.start.x + back.x, end.x + back.x];
  const zs = [w.start.z, end.z, w.start.z + back.z, end.z + back.z];
  return {
    minX: round(Math.min(...xs), 6),
    maxX: round(Math.max(...xs), 6),
    minZ: round(Math.min(...zs), 6),
    maxZ: round(Math.max(...zs), 6),
  };
}

/** The memorial hall's four walls: just outside the room, no openings (the door is a teleport pad). */
export function hallWalls(layout: VillageLayout): AABB[] {
  return wallsAround(layout.areas.hall);
}

/**
 * Solid ground around the hall's walls, at least this thick (m). One legal step is up to 4.8 m (`RUN_SPEED` x 0.5 s
 * x 1.5) and the server judges only where a step LANDS, so a 0.5 m wall alone is not a seal.
 */
export const HALL_APRON = 5;

/** The rectangle `villageGeometry` uses as its bounds: spans the village and the hall (walls and apron included). */
export function villageBounds(layout: VillageLayout): Bounds {
  const v = layout.areas.village;
  const h = layout.areas.hall;
  const margin = DEFAULT_WALL_THICKNESS + HALL_APRON;
  return {
    minX: Math.min(v.minX, h.minX - margin),
    maxX: Math.max(v.maxX, h.maxX + margin),
    minZ: Math.min(v.minZ, h.minZ - margin),
    maxZ: Math.max(v.maxZ, h.maxZ + margin),
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
 * Solid ground over ALL the free space around the hall's walls inside the bounds: the strips north and south
 * (from the walls' west face to the bounds' east edge) and the strip east of the walls. West of the walls the
 * gap blocker is adjacent. Every one is at least `HALL_APRON` (5 m) thick, so a legal step through a wall ends
 * inside a blocker and is dropped. `hallWalls` stay the render and camera geometry; these boxes are invisible.
 */
export function hallSurroundBlockers(layout: VillageLayout): AABB[] {
  const bounds = villageBounds(layout);
  const hall = layout.areas.hall;
  const t = DEFAULT_WALL_THICKNESS;
  const walls: AABB = { minX: hall.minX - t, maxX: hall.maxX + t, minZ: hall.minZ - t, maxZ: hall.maxZ + t };
  const out: AABB[] = [];
  if (bounds.minZ < walls.minZ) out.push({ minX: walls.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: walls.minZ });
  if (walls.maxZ < bounds.maxZ) out.push({ minX: walls.minX, maxX: bounds.maxX, minZ: walls.maxZ, maxZ: bounds.maxZ });
  if (walls.maxX < bounds.maxX) out.push({ minX: walls.maxX, maxX: bounds.maxX, minZ: walls.minZ, maxZ: walls.maxZ });
  return out;
}

/**
 * The village area's colliders as scripts/extract-colliders.ts writes them from the GLB's `col__*` boxes
 * (shared/src/village/generated/villageColliders.ts): every box, unnamed, and apart from them the boxes 1.6 m or
 * taller, with their height, that the camera must not see through.
 */
export interface GeneratedColliders {
  obstacles: readonly AABB[];
  cameraBoxes: readonly CameraBox[];
}

/**
 * The village map from a layout and the village area's colliders: the hall's walls (also camera boxes), then the
 * gap blocker, the hall surround and the colliders as obstacles. The colliders come either as a named list (the
 * greybox: the ones flagged `camera` are camera boxes too) or as the generated `{ obstacles, cameraBoxes }`.
 */
export function buildVillageGeometry(layout: VillageLayout, colliders: readonly VillageCollider[] | GeneratedColliders): MapGeometry {
  const village: GeneratedColliders =
    "obstacles" in colliders
      ? colliders
      : { obstacles: colliders.map((c) => c.box), cameraBoxes: colliders.filter((c) => c.camera).map((c) => c.box) };
  return makeGeometry(
    "village",
    villageBounds(layout),
    hallWalls(layout),
    [...areaGapBlockers(layout), ...hallSurroundBlockers(layout), ...village.obstacles],
    village.cameraBoxes,
  );
}

/** The village area's colliders generated from village.glb (Task 7): the layout's boxes plus the model's own. */
export const VILLAGE_MODEL_COLLIDERS: GeneratedColliders = { obstacles: VILLAGE_COLLIDERS, cameraBoxes: VILLAGE_CAMERA_BOXES };

/**
 * The village map the server and the client play on: the colliders generated from the Blender model (Task 7) for
 * the village area, the hall's walls and the blockers around it. `greyboxColliders(VILLAGE_LAYOUT)` stays the
 * layout's own list (the model must contain each of its boxes exactly: scripts/check-school-glb.ts).
 */
export const villageGeometry: MapGeometry = buildVillageGeometry(VILLAGE_LAYOUT, VILLAGE_MODEL_COLLIDERS);

/**
 * Everything a Blender script needs, as plain JSON-able data (scripts/export-village-layout.ts writes it to
 * art/village/layout.json): the layout values, a ready-made rectangle (`bounds`) next to every centre and
 * size, the greybox colliders by id with their `col__<id>` node names, the lanes, the plots' sign posts, the
 * houses' doors and colours, the backdrop, the hall walls and the blockers.
 */
export function exportVillageLayout(layout: VillageLayout = VILLAGE_LAYOUT) {
  const colliders = greyboxColliders(layout);
  const bounded = <T extends { centre: Point2; size: Size2 }>(o: T) => ({ ...o, bounds: boxAt(o.centre, o.size) });
  const collider = (c: VillageCollider) => ({ id: c.id, node: colliderNode(c.id), ...c.box, camera: c.camera });
  const colliderBox = (id: string, centre: Point2, size: Size2) => ({
    centre,
    size,
    bounds: boxAt(centre, size),
    node: colliderNode(id),
  });
  const { stream, memorial, plaza, busStop } = layout;
  return {
    format: "caysonverse-village-layout",
    version: 2,
    axes: "metres; x east, z south (north is -z), ground at y = 0; yaw 0 faces +z, PI faces north",
    walkBounds: layout.walkBounds,
    spawn: layout.spawn,
    plaza: {
      centre: plaza.centre,
      fountain: {
        centre: plaza.fountain.centre,
        basinDiameter: plaza.fountain.basinDiameter,
        collider: { size: plaza.fountain.collider, bounds: boxAt(plaza.fountain.centre, plaza.fountain.collider), node: colliderNode("plaza_fountain") },
      },
      paving: plaza.paving,
      zelkova: {
        centre: plaza.zelkova.centre,
        deck: plaza.zelkova.deck,
        collider: { size: plaza.zelkova.collider, bounds: boxAt(plaza.zelkova.centre, plaza.zelkova.collider), node: colliderNode("plaza_zelkova") },
      },
      benches: plaza.benches,
      lamps: plaza.lamps,
    },
    ringRoad: layout.ringRoad,
    busStop: {
      shelter: bounded(busStop.shelter),
      bus: colliderBox("bus", busStop.bus.centre, busStop.bus.size),
    },
    stream: {
      width: stream.width,
      bankWidth: stream.bankWidth,
      segments: stream.segments.map((s) => ({
        ...s,
        water: { minX: s.minX, maxX: s.maxX, ...segmentBand(stream, s) },
        bank: { minX: s.minX, maxX: s.maxX, ...segmentBank(stream, s) },
      })),
      bridgeGap: stream.bridgeGap,
      banks: colliders.filter((c) => c.id.startsWith("stream_bank_")).map(collider),
    },
    bridge: layout.bridge,
    pavilion: { ...bounded(layout.pavilion), node: colliderNode("pavilion") },
    lanes: layout.lanes,
    plots: layout.plots.map(bounded),
    memorial: {
      exterior: {
        ...memorial.exterior,
        footprint: boxAt(memorial.exterior.centre, memorial.exterior.size),
        colliders: colliders.filter((c) => c.id.startsWith("memorial_")).map(collider),
      },
      interior: {
        ...memorial.interior,
        walls: hallWalls(layout),
        blockers: hallSurroundBlockers(layout),
        cubbyWalls: memorial.interior.cubbyWalls.map((w) => ({ ...w, footprint: cubbyWallBox(w) })),
        cubbyAnchors: cubbyAnchors(layout).map((a) => ({ ...a, node: cubbyAnchorNode(a.id) })),
      },
    },
    sceneryHouses: layout.sceneryHouses.map((h) => ({ ...bounded(h), node: colliderNode(h.id) })),
    backdrop: {
      waterfall: bounded(layout.backdrop.waterfall),
      lake: { ...bounded(layout.backdrop.lake), pavilion: bounded(layout.backdrop.lake.pavilion) },
    },
    areas: layout.areas,
    colliders: colliders.map(collider),
    areaGapBlockers: areaGapBlockers(layout),
  };
}
