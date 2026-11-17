/**
 * 케이슨 마을's benches as seats (owner, 2026-11-10: "벤치에 앉을 수도 있게 해줘. 벤치에 앉았을때 자연스럽게 보이도록").
 * They plug into the world's Sit / Stand system unchanged — `Player.seatIndex` indexes `VILLAGE_SEATS`, the server
 * validates a Sit with the same `validateSit` and owns who sits where — so remote players see each other sit.
 *
 * Each bench is described by the few numbers of its model that sitting needs (the Blender build scripts are the
 * source: art/village/tools/parts_props.py `bench`, parts_buildings.py's forecourt bench, build_memorial.py `bench`):
 * where it is, the way a sitter faces, the height of the seat surface, how far the seat's front edge is from the
 * bench's centre and how long the seat is. The layout and the art stay as they are; this only adds seats.
 *
 *  - the eight plaza benches round the fountain (`VILLAGE_LAYOUT.plaza.benches`): oiled slats on granite end blocks,
 *    a slatted backrest; seat 1.86 m long, its top 0.445 m up, its front edge 0.2625 m ahead of the centre. They face
 *    the fountain, the backrest behind the sitter;
 *  - the low stone bench on the memorial hall's forecourt: a 2.2 x 0.55 m block, 0.45 m high, west of the door. It
 *    has no back; a sitter faces south, toward the plaza, with the building behind;
 *  - the memorial hall (2026-11-13 rebuild): every sofa, armchair, chair and bench of the rebuilt interior, from the `seat__*`
 *    markers of its Blender scene (generated/memorialSeats.ts, scripts/gen-memorial-seats.ts). A BACKLESS seat (a bench) is
 *    sat on from either side: its place has two facings that exclude each other (one `group`), and the side the visitor stands on
 *    picks the facing. A BACKED seat (a sofa, an armchair, a chair) only from the front, leaning back (`lean`).
 *  - the bus stop shelter's bench (`SHELTER_BENCH`): slats along its glass back wall; a sitter faces west, to the road;
 *  - the art's marked village seats (`VILLAGE_SEAT_MARKERS`): the café terrace's chairs and the porch benches.
 *
 * Two seats per bench (`benchSeatOffsets`): the toy figure is about 1.05 m across the arms while seated (its head
 * 1.0 m), so two sitters 1.16–1.2 m apart keep clear of each other and both sit on the seat; three would not fit on
 * any of them. Wide hats and hair (the wizard's brim, twin tails: up to 1.6 m) can still touch a neighbour's.
 *
 * Where a sitter goes (the seat point is the avatar's ROOT, as with the legacy chairs; the sit pose puts the body
 * behind it, see sitPose.ts): `SIT_ROOT_AHEAD` in front of the seat's front edge, so the butt rests on the front half
 * of the seat and the hanging calves clear its edge. The client lifts the avatar to the seat surface (`seatY`).
 * Where a sitter gets up to (`standX/standZ`): straight ahead of the seat, the first spot in 5 cm steps where a
 * standing body (PLAYER_RADIUS plus a margin) is clear of every collider of the village — never inside the bench,
 * and the stand-up animation carries the body there from the seat.
 */

import { isBlocked } from "../collision";
import { CHAIR_SIDE_CLEAR, CHAIR_SIDE_FAR, PLAYER_RADIUS, SEAT_REACH, approachesSeat, type Seat } from "../worldMap";
import { BACKED_ROOT_AHEAD, FLOOR_SIT_POSE, SIT_ROOT_AHEAD } from "../sitPose";
import { MEMORIAL_SEAT_MARKERS } from "./generated/memorialSeats";
import type { Bounds } from "../school/geometry";
import { VILLAGE_LAYOUT, houseArea, villageGeometry, type AreaId, type Point2 } from "./villageLayout";
import { GENERATED_HOUSES } from "./generated/houses";
import { isRemovedHouseSeat } from "./houseFixes";
import { HOUSE_NUMBERS, HOUSE_PLACES, houseBuildingId, houseFloorBounds, compareHouseSeats, type HouseFloor, type HouseNumber, type HouseSeatMarker, type HouseSeatPose } from "./houseAreas";
import type { MapGeometry } from "../school/geometry";
import { fallsWalkable, villageWalkArea } from "./fallsWalk";
import { VILLAGE_SEAT_MARKERS } from "./generated/villageSeatMarkers";
import { lakeSeats, type LakeSeatKind } from "./lakeLayout";
import { LOTS_WITH_MODEL, LOT_ROOMS, VILLAGE_LOTS, lotLocalToWorld, lotRoomPoint, lotSeatMarkers, type LotInteriorSeat } from "./villageLots";


/**
 * A seat the art marks in village.glb (`seat__*` empties: the café terrace's 12 chairs, the porch benches of houses 2, 9
 * and 10), as scripts/extract-seat-markers.ts writes it (generated/villageSeatMarkers.ts). Owner rule (2026-11-13):
 * every seat can be sat on; a backed one only from its front.
 *  - `approach: "front"` (a porch bench, backrest toward the house): sat on from in front of its front edge, as a plaza
 *    bench; it gets up straight ahead.
 *  - `approach: "side"` (a café chair at a table): the table stands in front of it, so a sitter steps in from beside the
 *    chair (still in front of its backrest) and gets up there (`standX/standZ`, the art's spot clear of the table and
 *    the next chair).
 */
export interface VillageSeatMarker {
  id: string;
  /** The seat's centre (the marker), at the middle of the seat board. */
  x: number;
  z: number;
  /** The way a sitter faces (compass). */
  facing: "n" | "s" | "e" | "w";
  /** Height of the seat surface (m). */
  seatTop: number;
  approach: "front" | "side";
  /** Distance from the centre to the seat's front edge, along the facing (m). */
  frontEdge: number;
  /** Seats on it. */
  places: number;
  /** Length of a bench's seat (m). */
  length?: number;
  /** A side-approached chair's get-up spot. */
  standX?: number;
  standZ?: number;
}

/** How far behind a chair's centre its backrest's back face is (m): parts_cafe.py `cafe_chair` (the bowed rail, to -0.262). */
export const CHAIR_BACK_BEHIND = 0.26;
/** A chair's half width (m): parts_cafe.py `cafe_chair` (seat +-0.21). */
export const CHAIR_HALF_WIDTH = 0.21;
/** How far short of its goal a tap-walk may stop (m): client clickMove.ts ARRIVE_DIST. */
const TAP_ARRIVE_SLACK = 0.35;
const FACING_YAW = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 } as const;

/** One bench of the village: what sitting on it needs to know about its model. */
export interface VillageBench {
  id: string;
  area: AreaId;
  /** The centre of the bench's footprint. */
  centre: Point2;
  /** The way a sitter faces (game yaw, atan2(dirX, dirZ): 0 faces +z). The backrest, if any, is behind. */
  yaw: number;
  /** Height of the seat surface (m). */
  seatTop: number;
  /** Distance from the centre to the seat's front edge, along `yaw` (m). */
  frontEdge: number;
  /** Length of the seat along the bench (m). */
  length: number;
  /**
   * Where the seats are along the bench from its centre (m), when the bench has dividers: one seat per cell, in the
   * middle of it. Absent: `benchSeatOffsets(length)`.
   */
  seatOffsets?: readonly number[];
  /** `backed`: a backrest behind the sitter (sat from the front only); `backless`: sat from either side (a second facing). */
  kind: SeatKind;
}

/**
 * What a seat is like to approach: a backrest behind it (front only, leaning back), none (either side), or — the houses' cushions,
 * 보료 and floor sofas — on the floor (the cross-legged pose of chunk F; a cushion is sat on from any side, facing its table).
 */
export type SeatKind = "backless" | "backed" | "floor";

/**
 * How far from a bench's centre its two seats are (m): 0.6 where the seat is long enough, else as far as keeps the
 * sitter's thighs (0.31 m either side of the hips) on the seat with a few cm to spare — 0.58 on the 1.86 m plaza
 * benches, so two sitters are 1.16 m apart: their arms (1.05 m across) and heads (1.0 m) keep clear of each other.
 */
export const BENCH_SEAT_MAX_OFFSET = 0.6;
/** Room (m) a seat keeps from its end of the bench: the thighs' half-width plus a margin. */
export const BENCH_SEAT_END_ROOM = 0.35;

/** The offsets of a bench's two seats along it, from its centre (m). */
export function benchSeatOffsets(length: number): readonly number[] {
  const d = Math.round(Math.min(BENCH_SEAT_MAX_OFFSET, length / 2 - BENCH_SEAT_END_ROOM) * 1000) / 1000;
  return [-d, d];
}

/** Extra clearance (m) beyond PLAYER_RADIUS a dismount spot keeps from every collider. */
export const STAND_CLEARANCE = 0.05;
/** Step (m) of the search for a dismount spot ahead of a seat, and how far it looks (m). */
const STAND_STEP = 0.05;
const STAND_SEARCH = 1.5;

/** The plaza bench model (parts_props.py `bench`): five slats 0.085 m wide at -0.22..0.22, 0.40..0.445 m up, 1.86 m long. */
const PLAZA_BENCH = { seatTop: 0.445, frontEdge: 0.22 + 0.085 / 2, length: 1.86, kind: "backed" } as const;

/** Yaw that faces south (+z) and west (-x). */
const FACING_SOUTH = 0;
const FACING_WEST = -Math.PI / 2;

/**
 * The bus stop shelter's bench (art/village/tools/build_busstop.py build_shelter, village_busstop.glb; the shelter's centre is
 * busStop.shelter.centre (40.9, -4.9), its back glass at x 41.6): three 0.13 m slats at x 40.985..41.415 (the seat, 0.5125 m up
 * from the ground: 4.5 cm of pad and 0.4675 m of bench), 2.3 m long along z, two slatted back rests at x 41.48 and two arm
 * dividers at z -/+0.38 from the centre that cut it into a 0.76 m middle cell and two 0.77 m end cells. Its back is the glass
 * wall: a bench with a back rest is sat on from the front only (the road side, facing west), like the plaza's. Two seats, in
 * the end cells: the middle cell is too narrow for the toy figure's 1.05 m across the arms, and a seat 1.53 m from its
 * neighbour keeps both sitters clear of the dividers.
 */
export const SHELTER_BENCH: VillageBench = {
  id: "shelter",
  area: "village",
  centre: { x: 41.2, z: VILLAGE_LAYOUT.busStop.shelter.centre.z },
  yaw: FACING_WEST,
  seatTop: 0.5125,
  frontEdge: 41.2 - 40.985,
  length: 2.3,
  seatOffsets: [-0.765, 0.765],
  kind: "backed",
};

function makeBenches(): VillageBench[] {
  const plaza = VILLAGE_LAYOUT.plaza.benches.map(
    (b, i): VillageBench => ({ id: `plaza_${i + 1}`, area: "village", centre: { x: b.x, z: b.z }, yaw: b.yaw, ...PLAZA_BENCH }),
  );
  return [
    ...plaza,
    // parts_buildings.py: mb.box(-4.8, -50.4, 0.0, 2.2, 0.55, 0.45, "LM_stone") — a stone block with no back: sat from either side
    { id: "memorial_forecourt", area: "village", centre: { x: -4.8, z: -50.4 }, yaw: FACING_SOUTH, seatTop: 0.45, frontEdge: 0.55 / 2, length: 2.2, kind: "backless" },
    SHELTER_BENCH,
  ];
}

/**
 * Every bench of the open village a player can sit on (plaza 1..8, the forecourt, the bus stop's shelter). The hall's seats come from its model's
 * markers. Seat order: see `VILLAGE_SEATS` (the shelter's seats come after the houses').
 */
export const VILLAGE_BENCHES: readonly VillageBench[] = Object.freeze(makeBenches());

/** A point `along` metres along the bench (its local x) and `ahead` metres along the facing from (x, z). */
function offset(x: number, z: number, yaw: number, along: number, ahead: number): Point2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // The art's local frame (vlib.loc): local x = (cos, -sin), local z (the facing) = (sin, cos).
  return { x: x + along * c + ahead * s, z: z - along * s + ahead * c };
}

/** Whether a standing body at (x, z) is clear of every collider and inside `bounds`, with the dismount clearance. */
export function standsClear(x: number, z: number, bounds: Bounds, geometry = villageGeometry): boolean {
  const r = PLAYER_RADIUS + STAND_CLEARANCE;
  if (x < bounds.minX + r || x > bounds.maxX - r || z < bounds.minZ + r || z > bounds.maxZ - r) return false;
  if (isBlocked(x, z, r, geometry.obstacles, 0)) return false;
  // …and outside every collider grown SQUARE by the radius: the click-walk plans only from such a spot (clickPlan.ts isFreeSpot;
  // round 8: up from letter_s0 at the corner of the letter table's grown box, 5 cm in, every tap after was "unreachable")
  const q = PLAYER_RADIUS + STAND_SQUARE_CLEARANCE;
  for (const b of geometry.obstacles) if (x > b.minX - q && x < b.maxX + q && z > b.minZ - q && z < b.maxZ + q) return false;
  return standReach === null || standReach(x, z);
}

/** While a house floor's seats are made: the spots a body walks to from the floor's arrival (houseStandReach), else null (any clear spot). */
let standReach: ((x: number, z: number) => boolean) | null = null;

/** The grid (m) and the body's extra width (m) of a house floor's walkable area for its stand spots. */
const REACH_STEP = 0.1;
const REACH_MARGIN = 0.05;
const REACH_CACHE = new Map<string, (x: number, z: number) => boolean>();

/**
 * Where a body walks to on house N floor F from its arrival spot (a flood fill, the radius plus REACH_MARGIN: a slit a body only squeezes
 * through diagonally — which no tap finds — does not count). A house seat's stand spot must be one of these (G round 3: house 7's
 * window table chair stood up into a pocket behind its table reached only through such a slit).
 */
export function houseStandReach(n: HouseNumber, floor: HouseFloor, geometry: MapGeometry = villageGeometry): (x: number, z: number) => boolean {
  const key = `${n}:${floor}`;
  const hit = geometry === villageGeometry ? REACH_CACHE.get(key) : undefined;
  if (hit) return hit;
  const b = houseFloorBounds(n, floor);
  const start = floor === 1 ? HOUSE_PLACES[n].spawnIn : HOUSE_PLACES[n].spawnUp;
  const nx = Math.round((b.maxX - b.minX) / REACH_STEP) + 1;
  const nz = Math.round((b.maxZ - b.minZ) / REACH_STEP) + 1;
  const cellX = (i: number) => b.minX + i * REACH_STEP;
  const cellZ = (j: number) => b.minZ + j * REACH_STEP;
  const r = PLAYER_RADIUS + REACH_MARGIN;
  const free = (i: number, j: number) => {
    const x = cellX(i);
    const z = cellZ(j);
    return x > b.minX + r && x < b.maxX - r && z > b.minZ + r && z < b.maxZ - r && !isBlocked(x, z, r, geometry.obstacles, 0);
  };
  const seen = new Uint8Array(nx * nz);
  const si = Math.round((start.x - b.minX) / REACH_STEP);
  const sj = Math.round((start.z - b.minZ) / REACH_STEP);
  const queue: number[] = [];
  if (si >= 0 && sj >= 0 && si < nx && sj < nz && free(si, sj)) {
    seen[sj * nx + si] = 1;
    queue.push(sj * nx + si);
  }
  while (queue.length > 0) {
    const c = queue.pop()!;
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const k = j + dj;
      if (a < 0 || k < 0 || a >= nx || k >= nz || seen[k * nx + a]) continue;
      if (!free(a, k)) continue;
      seen[k * nx + a] = 1;
      queue.push(k * nx + a);
    }
  }
  // a stand spot within a cell of a reached one (it stands with the dismount clearance, a little more than the fill's margin)
  const reach = (x: number, z: number): boolean => {
    const i0 = Math.floor((x - b.minX) / REACH_STEP);
    const j0 = Math.floor((z - b.minZ) / REACH_STEP);
    for (let j = j0; j <= j0 + 1; j++) for (let i = i0; i <= i0 + 1; i++) if (i >= 0 && j >= 0 && i < nx && j < nz && seen[j * nx + i]) return true;
    return false;
  };
  if (geometry === villageGeometry) REACH_CACHE.set(key, reach);
  return reach;
}

/** Make a house floor's seats with the stand spots kept to where a body walks to (standReach), then back to any clear spot. */
function withHouseReach<T>(n: HouseNumber, floor: HouseFloor, geometry: MapGeometry, make: () => T): T {
  standReach = houseStandReach(n, floor, geometry);
  try {
    return make();
  } finally {
    standReach = null;
  }
}

/** How far (m) past the square growth of the colliders a dismount spot keeps (standsClear). */
const STAND_SQUARE_CLEARANCE = 0.02;

/** Directions the dismount search tries, turned off the facing (rad): straight ahead first, then up to 45 degrees aside. */
const STAND_TURNS: readonly number[] = [0, -0.26, 0.26, -0.52, 0.52, -0.79, 0.79];

/**
 * The nearest clear spot ahead of the seat point `root` facing `yaw`: along the facing or up to 45 degrees off it, in
 * STAND_STEP steps (the straighter direction wins a tie). A plaza bench's collider is the axis-aligned box of a turned
 * bench, so straight ahead one seat would have to step almost a metre past the box's corner; a slight turn is nearer.
 */
function dismountAhead(root: Point2, yaw: number, bounds: Bounds, id: string, geometry = villageGeometry): Point2 {
  for (let d = 0; d <= STAND_SEARCH + 1e-9; d += STAND_STEP) {
    for (const turn of STAND_TURNS) {
      const p = offset(root.x, root.z, yaw + turn, 0, d);
      const spot = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
      if (standsClear(spot.x, spot.z, bounds, geometry)) return spot;
    }
  }
  throw new Error(`no clear dismount spot ahead of bench seat ${id}`);
}

/**
 * A house chair walled in by its table and the chairs beside it is offered from behind its backrest up to this far (m; `Seat.sidePlane`):
 * its stand spot is there (markerSeats).
 */
export const CHAIR_BEHIND_PLANE = 1.6;

/** The nearest clear spot round the seat point `root`, any side (a floor cushion is left wherever there is room), the facing first. */
function dismountAround(root: Point2, yaw: number, bounds: Bounds, geometry: MapGeometry = villageGeometry): Point2 | null {
  for (let d = STAND_STEP; d <= STAND_SEARCH + 1e-9; d += STAND_STEP) {
    for (let k = 0; k < 16; k++) {
      const turn = ((k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 8;
      const p = offset(root.x, root.z, yaw + turn, 0, d);
      const spot = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
      if (standsClear(spot.x, spot.z, bounds, geometry)) return spot;
    }
  }
  return null;
}

/**
 * A chair with another chair of its kind next to it (the two consult chairs at the desk, the letter table's four): its dismount
 * spot — where a click on it walks to and where its sitter stands up — is the nearest clear spot from which the chair is offered
 * (`approachesSeat`: beside or in front of it, never behind its backrest) that is clearly nearer this chair's seat than any
 * neighbour's (`STAND_NEIGHBOUR_MARGIN`). Review 2026-11-15 round 5: the second consult chair's spot was in the gap between the
 * two, as near the first chair, so stopping a step short of it and pressing E sat on the first one. Null: none within reach.
 */
function chairStand(seat: Seat, neighbours: readonly Point2[], bounds: Bounds, geometry: MapGeometry = villageGeometry): Point2 | null {
  let best: Point2 | null = null;
  let bestD = Infinity;
  const step = 0.05;
  // (distances from where the seat is picked: its seat point, or a house seat's cushion — Seat.reachFrom)
  const cx = seat.reachFrom?.x ?? seat.x;
  const cz = seat.reachFrom?.z ?? seat.z;
  const bonus = seat.reachFrom ? 0 : (seat.reachBonus ?? 0);
  for (let ix = -26; ix <= 26; ix++) {
    for (let iz = -26; iz <= 26; iz++) {
      const x = Math.round((cx + ix * step) * 1000) / 1000;
      const z = Math.round((cz + iz * step) * 1000) / 1000;
      const own = Math.hypot(x - cx, z - cz);
      if (own >= bestD || own > 1.6) continue;
      // offered from the spot itself; and from anywhere a step short of it (a tap walk stops 0.35 m before its target) never the
      // neighbour instead: there it is this chair or none — and, for a house seat, this one still (a stop it is not offered from sat nobody)
      let ok = own - bonus <= SEAT_REACH - STAND_SHORT - 0.05 && approachesSeat(seat, x, z);
      for (let k = 0; k <= 8 && ok; k++) {
        const a = (k * Math.PI) / 4;
        const px = k === 8 ? x : x + Math.cos(a) * STAND_SHORT;
        const pz = k === 8 ? z : z + Math.sin(a) * STAND_SHORT;
        const d = Math.hypot(px - cx, pz - cz);
        ok = !neighbours.some((n) => Math.hypot(n.x - px, n.z - pz) < d + (k === 8 ? STAND_NEIGHBOUR_MARGIN : 0.01));
        if (ok && seat.reachFrom && k < 8 && !isBlocked(px, pz, PLAYER_RADIUS, geometry.obstacles, 0)) ok = approachesSeat(seat, px, pz);
      }
      if (!ok || !standsClear(x, z, bounds, geometry)) continue;
      // a house seat's spot keeps a hand's width more from the furniture: a tap-walk's way in to it turns there (G round 3: house 9's end chair)
      if (seat.reachFrom && isBlocked(x, z, PLAYER_RADIUS + HOUSE_STAND_EXTRA, geometry.obstacles, 0)) continue;
      best = { x, z };
      bestD = own;
    }
  }
  return best;
}

/** How much nearer (m) a chair's dismount spot is to its own seat than to a neighbouring chair's (`chairStand`). */
const STAND_NEIGHBOUR_MARGIN = 0.25;
/** How much farther (m) than the body a house seat's side or neighbour-safe stand spot keeps from the furniture (`chairStand`). */
const HOUSE_STAND_EXTRA = 0.12;
/** How far short of its target a tap walk may stop (m; clickMove's ARRIVE_DIST and a little). */
const STAND_SHORT = 0.35;
/** How far ahead of its seat point (m) a chair at a table is still offered (`Seat.aheadMax`): its own side, not across the table. */
const CHAIR_AHEAD_MAX = 0.6;
/** How much farther (m) a chair at a desk or table is reached (`Seat.reachBonus`). */
const CHAIR_REACH_BONUS = 0.35;

/** A village seat, plus the furniture, the area, the kind and the lean it belongs to. */
export interface VillageSeat extends Seat {
  /** The seat's name: `<furniture>` or `<furniture>:<facing>`; unique across the whole list. */
  id: string;
  /** The furniture (bench, sofa, chair...) it is on. */
  bench: string;
  area: AreaId;
  kind: SeatKind;
  /** How far the sitter leans back into the backrest (rad); 0 where there is none. */
  lean: number;
  /**
   * A house seat's sitting pose (houseAreas.ts HouseSeatPose): `chair` (today's sit), `perch` (a bar / work stool: legs bent to the foot rail)
   * or `floor` (cross-legged on a cushion, chunk F). Absent on the village's and the hall's seats (= `chair`).
   */
  pose?: HouseSeatPose;
  /** Lake seats (lakeLayout.ts, A10): what they are at the lake (a fishing chair, a shore bench, ...). Absent: a village seat. */
  lake?: LakeSeatKind;
  /** A fishing chair: the id of its spot in `LAKE_FISHING_SPOTS`. */
  spot?: string;
  /** A seat whose furniture was taken out (release 3.1): it keeps its index, far away and never offered (`retiredSeat`). */
  retired?: boolean;
}

/** Wrap an angle into (-pi, pi]. */
function wrapYaw(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r <= -Math.PI) r += 2 * Math.PI;
  // a marker's pi is stored to 6 decimals (3.141593, a hair past pi): it is still "facing north", not a turn from -pi
  if (Math.abs(Math.abs(r) - Math.PI) < 1e-5) return Math.PI;
  return Math.round(r * 1e6) / 1e6;
}

/**
 * A marker of a model, as the seat list reads it: the hall's `SeatMarker` (seatMarkers.ts) or a house's `HouseSeatMarker` (houseAreas.ts,
 * which adds `floor` seats and the `pose`). A `floor` marker with a back (a 보료, a floor sofa) is a backed seat on the ground; one
 * without (a cushion) has one facing and is sat on from any side.
 */
interface MarkerSource {
  id: string;
  furn: string;
  kind: "backless" | "backed" | "floor";
  x: number;
  z: number;
  y: number;
  yaw: number;
  edge: number;
  back: number;
  width: number;
  group: string;
  both: boolean;
  exitTurn: number;
  lean: number;
  pose?: HouseSeatPose;
}

/** Where a marker's seats are: the area, its walkable rectangle, the geometry the dismount is judged on, the other markers beside it. */
interface MarkerPlace {
  area: AreaId;
  bounds: Bounds;
  geometry: MapGeometry;
  peers: readonly MarkerSource[];
  /**
   * A house's marker whose facing has no clear dismount spot ahead (a stool at a vanity, sat from the wall side: its other side is
   * blocked by the furniture, which nobody can walk up to anyway) simply has no seat for that facing instead of failing the whole
   * list; the tests insist that every marker keeps at least one.
   */
  lenient?: boolean;
}

/**
 * The seats of one marker of a model: one facing, or for a backless seat sat from either side the front and the
 * back facing (one exclusive group). The root is where the avatar's origin goes (see the header): ahead of the front edge for
 * a backless seat, in front of the backrest's face for a backed one.
 */
function markerSeats(m: MarkerSource, place: MarkerPlace): VillageSeat[] {
  const out: VillageSeat[] = [];
  const backed = m.kind === "backed" || (m.kind === "floor" && m.back > 0);
  const turns = m.kind === "backless" && m.both ? [0, Math.PI] : [0];
  for (const turn of turns) {
    const yaw = wrapYaw(m.yaw + turn);
    // `ahead` from the marker along the facing to the root; `frontEdge` from the root back to the seat's front edge
    // a floor seat (cross-legged, FLOOR_SIT_POSE): the hips are 0.22 m behind the root, so a cushion's root is 0.22 m ahead of its centre (the
    // hips land on it); a backed floor seat (보료, floor sofa) puts the torso's back (0.47 m behind the root) at its backrest
    const floorPose = m.pose === "floor";
    const ahead = floorPose ? (backed ? FLOOR_SIT_POSE.torsoBehindRoot - m.back : FLOOR_SIT_POSE.hipsBehindRoot) : backed ? BACKED_ROOT_AHEAD - m.back : m.edge + SIT_ROOT_AHEAD;
    const frontEdge = backed ? Math.max(0.05, ahead - m.edge) : floorPose ? FLOOR_SIT_POSE.hipsBehindRoot : SIT_ROOT_AHEAD;
    const p = offset(m.x, m.z, yaw, 0, ahead);
    const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
    const id = turns.length > 1 ? `${m.id}:${turn === 0 ? "front" : "back"}` : m.id;
    let ahead0: Point2 | null = null;
    try {
      ahead0 = dismountAhead(root, yaw + m.exitTurn, place.bounds, id, place.geometry);
    } catch (err) {
      if (!place.lenient) throw err;
    }
    const cushion = m.kind === "floor" && m.back === 0;
    // a house chair pulled up to its table or a cushion before its low table has the table straight ahead: nothing is clear there, so
    // it is stood up from beside it (a chair: `chairStand` below, from its side; a cushion: the nearest clear spot all round)
    if (!ahead0 && cushion) ahead0 = dismountAround(root, yaw, place.bounds, place.geometry);
    if (!ahead0 && m.furn !== "chair") continue;
    const stand: Point2 = ahead0 ?? root;
    const seat: VillageSeat = {
      id,
      x: root.x,
      z: root.z,
      yaw,
      standX: stand.x,
      standZ: stand.z,
      seatY: m.y,
      // a cushion has no front: it is offered from every side (Seat.frontEdge absent), facing its table whichever side one comes from
      frontEdge: cushion ? undefined : frontEdge,
      bench: m.id,
      area: place.area,
      kind: m.kind,
      lean: backed ? m.lean : 0,
      group: m.group,
      // a chair at a table has the table in front of it: it is also sat on from its sides, up to the backrest's face (never
      // through the backrest); a sofa or an armchair from the front only
      sidePlane: m.furn === "chair" ? Math.round((ahead + m.back) * 1000) / 1000 : undefined,
      sideHalf: m.furn === "chair" ? Math.round((m.width / 2) * 1000) / 1000 : undefined,
      // its seat point is under the desk / table (BACKED_ROOT_AHEAD in front of the backrest): reached that much farther — a house seat
      // is reached from and picked by its cushion instead (Seat.reachFrom)
      reachBonus: m.furn === "chair" && !place.lenient ? CHAIR_REACH_BONUS : undefined,
      reachFrom: place.lenient ? { x: m.x, z: m.z } : undefined,
      // the table in front: farther ahead than this is across it (the chair opposite's front), never this chair's
      aheadMax: m.furn === "chair" ? CHAIR_AHEAD_MAX : undefined,
      pose: m.pose,
    };
    // the roots of the chairs of the same kind next to this one
    const neighbours = place.peers.filter((o) => o.id !== m.id && o.furn === m.furn && Math.hypot(o.x - m.x, o.z - m.z) < 2.5).map((o) =>
      offset(o.x, o.z, o.yaw, 0, o.kind === "backed" || (o.kind === "floor" && o.back > 0) ? BACKED_ROOT_AHEAD - o.back : o.edge + SIT_ROOT_AHEAD),
    );
    if (m.furn === "chair" && neighbours.length > 0 && seat.sideHalf !== undefined) {
      // beside it, behind the backrest's plane, only up to half the way to the next chair along the row (round 8 review)
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      let half = Infinity;
      for (const n of neighbours) {
        const ahead = (n.x - root.x) * sin + (n.z - root.z) * cos;
        if (Math.abs(ahead) > 0.5) continue; // across the table: not along the row
        half = Math.min(half, Math.abs((n.x - root.x) * cos - (n.z - root.z) * sin) / 2);
      }
      if (half < Infinity) seat.sideFar = Math.round(Math.min(CHAIR_SIDE_FAR, Math.max(CHAIR_SIDE_CLEAR + 0.1, half - seat.sideHalf + 0.1)) * 1000) / 1000;
    }
    if (m.furn === "chair" && (neighbours.length > 0 || !ahead0)) {
      // (a house chair is picked by its cushion: its neighbours' cushions are what it must be nearer than)
      const side = chairStand(seat, place.lenient ? place.peers.filter((o) => o.id !== m.id && o.furn === m.furn && Math.hypot(o.x - m.x, o.z - m.z) < 2.5).map((o) => ({ x: o.x, z: o.z })) : neighbours, place.bounds, place.geometry);
      if (side) {
        seat.standX = side.x;
        seat.standZ = side.z;
      } else if (!ahead0) {
        // a chair in the middle of a row at a table (or at its head between two walls of chairs): neither its front nor its sides are
        // clear, so — as one pulls such a chair out — it is sat on and stood up from from behind its backrest
        let behind: Point2;
        try {
          behind = dismountAhead(root, yaw + Math.PI, place.bounds, id, place.geometry);
        } catch {
          continue;
        }
        seat.standX = behind.x;
        seat.standZ = behind.z;
        seat.sidePlane = CHAIR_BEHIND_PLANE;
      }
    }
    // A house seat among others (cushions round a low table, a stool by a sofa, an ottoman between armchairs): its stand spot — where a tap
    // on it walks to, and where a walk stopping a step short of it ends — must offer THIS seat, not the next one (G round 3: house 3's
    // 2nd-floor cushion walked to a spot nearer its neighbour). A cushion always, any other seat when a neighbour is nearer its spot.
    const others = place.lenient ? place.peers.filter((o) => o.id !== m.id && Math.hypot(o.x - m.x, o.z - m.z) < 2.5).map((o) => ({ x: o.x, z: o.z })) : [];
    const ownD = Math.hypot(seat.standX - m.x, seat.standZ - m.z);
    if (cushion || others.some((o) => Math.hypot(o.x - seat.standX, o.z - seat.standZ) <= ownD + 0.05)) {
      if (others.length > 0) {
        const spot = chairStand(seat, others, place.bounds, place.geometry);
        if (spot) {
          seat.standX = spot.x;
          seat.standZ = spot.z;
        }
      }
    }
    out.push(seat);
  }
  return out;
}


/**
 * Room (m) beyond PLAYER_RADIUS a café chair's get-up spot keeps from every collider. More than a bench's dismount
 * (STAND_CLEARANCE): the terrace is tight (tables, chairs, planters), and a body that gets up wedged against a table's
 * corner could not walk off toward a tap (clickPlan's way round starts from a free cell; clickPlanSweep.test.ts).
 */
export const CHAIR_STAND_CLEARANCE = 0.15;

/**
 * A side-approached chair's get-up spot: the art's `standX/standZ` (beside the chair, away from its neighbour), or the
 * nearest spot to it (5 cm grid, up to 0.5 m off, never behind the backrest) where a body has CHAIR_STAND_CLEARANCE all
 * round — the art's spots are only clear of a 0.4 m body, some 0.43 m from a table box's corner. Where there is no
 * such spot (the corner chairs), the art's own spot, which keeps the dismount clearance.
 */
function besideChair(m: VillageSeatMarker, bounds: Bounds): Point2 {
  const yaw = FACING_YAW[m.facing];
  const f = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const r = PLAYER_RADIUS + CHAIR_STAND_CLEARANCE;
  let best: Point2 | null = null;
  let bestD = Infinity;
  for (let i = -10; i <= 10; i++) {
    for (let j = -10; j <= 10; j++) {
      const d = Math.hypot(i, j) * STAND_STEP;
      if (d > 0.5 + 1e-9 || d >= bestD) continue;
      const spot = { x: Math.round((m.standX! + i * STAND_STEP) * 1000) / 1000, z: Math.round((m.standZ! + j * STAND_STEP) * 1000) / 1000 };
      if ((spot.x - m.x) * f.x + (spot.z - m.z) * f.z < -CHAIR_BACK_BEHIND) continue; // behind the backrest
      if (!standsClear(spot.x, spot.z, bounds) || isBlocked(spot.x, spot.z, r, villageGeometry.obstacles, 0)) continue;
      best = spot;
      bestD = d;
    }
  }
  if (best) return best;
  // the corner chairs (between a long table's end and a planter, 1.08 m apart): the art's spot, clear of a body
  if (standsClear(m.standX!, m.standZ!, bounds)) return { x: m.standX!, z: m.standZ! };
  throw new Error(`seat ${m.id}: no clear get-up spot beside the chair`);
}

/** The art's marked village seats (`VILLAGE_SEAT_MARKERS`) as village seats, in marker order: every one has a backrest. */
function villageMarkerSeats(markers: readonly VillageSeatMarker[]): VillageSeat[] {
  const bounds = VILLAGE_LAYOUT.areas.village;
  const seats: VillageSeat[] = [];
  for (const m of markers) {
    const yaw = FACING_YAW[m.facing];
    const alongs = m.places > 1 && m.length !== undefined ? benchSeatOffsets(m.length) : [0];
    for (const along of alongs) {
      const p = offset(m.x, m.z, yaw, along, m.frontEdge + SIT_ROOT_AHEAD);
      const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
      if (m.approach === "side") {
        if (m.standX === undefined || m.standZ === undefined) throw new Error(`seat ${m.id}: a side-approached chair needs standX/standZ`);
        const stand = besideChair(m, bounds);
        seats.push({
          id: m.places > 1 ? `${m.id}:${along}` : m.id,
          x: root.x,
          z: root.z,
          yaw,
          standX: stand.x,
          standZ: stand.z,
          seatY: m.seatTop,
          frontEdge: SIT_ROOT_AHEAD,
          // offered from anywhere in front of the backrest (beside the chair too), never from behind it
          approachEdge: Math.round((SIT_ROOT_AHEAD + m.frontEdge + CHAIR_BACK_BEHIND) * 1000) / 1000,
          // beside the chair (a body's width clear of its side, so never behind the backrest), a tap-walk's slack more
          beside: {
            lateral: Math.round((CHAIR_HALF_WIDTH + PLAYER_RADIUS - 0.05) * 1000) / 1000,
            edge: Math.round((SIT_ROOT_AHEAD + m.frontEdge + CHAIR_BACK_BEHIND + TAP_ARRIVE_SLACK) * 1000) / 1000,
          },
          bench: m.id,
          area: "village",
          kind: "backed",
          lean: 0,
        });
      } else {
        const stand = dismountAhead(root, yaw, bounds, `${m.id}:${along}`);
        seats.push({
          id: m.places > 1 ? `${m.id}:${along}` : m.id,
          x: root.x,
          z: root.z,
          yaw,
          standX: stand.x,
          standZ: stand.z,
          seatY: m.seatTop,
          frontEdge: SIT_ROOT_AHEAD,
          bench: m.id,
          area: "village",
          kind: "backed",
          lean: 0,
        });
      }
    }
  }
  return seats;
}

/** A bench's seats: two places (or one per `seatOffsets` cell), a backless bench's with two facings each. */
function benchSeats(b: VillageBench): VillageSeat[] {
  const seats: VillageSeat[] = [];
  const bounds = b.area === "village" ? VILLAGE_LAYOUT.areas.village : VILLAGE_LAYOUT.areas.hall;
  const turns = b.kind === "backless" ? [0, Math.PI] : [0];
  for (const along of b.seatOffsets ?? benchSeatOffsets(b.length)) {
    for (const turn of turns) {
      const yaw = wrapYaw(b.yaw + turn);
      // `offset`'s "along" turns with the yaw: the back facing (yaw + pi) takes -along so both facings of one place stay at the
      // SAME spot on the bench (review 2026-11-14: the back seat of -0.6 landed at +0.6 and its group paired the wrong seats)
      const p = offset(b.centre.x, b.centre.z, yaw, turn === 0 ? along : -along, b.frontEdge + SIT_ROOT_AHEAD);
      const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
      const place = `${b.id}:${along}`;
      const stand = dismountAhead(root, yaw, bounds, place);
      seats.push({
        id: turns.length > 1 ? `${place}:${turn === 0 ? "front" : "back"}` : place,
        x: root.x,
        z: root.z,
        yaw,
        standX: stand.x,
        standZ: stand.z,
        seatY: b.seatTop,
        frontEdge: SIT_ROOT_AHEAD,
        bench: b.id,
        area: b.area,
        kind: b.kind,
        lean: 0,
        group: turns.length > 1 ? place : undefined,
      });
    }
  }
  return seats;
}

/**
 * The waterfall rest area's two stone seats (`backdrop.waterfall.seats`, owner 2026-11-16: backless seats, sat on from
 * either long side). A stone is 0.8 m deep and 1.9 m long, 0.42 m high: two places along it, each facing west and east,
 * so four seats a stone, in the order west places then east places (north to south by `benchSeatOffsets`). A sitter on
 * either side is offered the seats of their own side only (a seat has a front edge: `approachesSeat`), and the two sides
 * sit back to back on their own half of the stone, as on a log (so no exclusive group). The bench id is the stone's own
 * (`falls_seat_n`/`_s`).
 */
function fallsStoneSeats(): VillageSeat[] {
  if (!fallsWalkable(VILLAGE_LAYOUT)) return [];
  const { seats: stones, options } = VILLAGE_LAYOUT.backdrop.waterfall;
  if (!options.seats) return [];
  const bounds = villageWalkArea(VILLAGE_LAYOUT);
  const out: VillageSeat[] = [];
  for (const stone of stones) {
    for (const facing of stone.facings) {
      const yaw = facing === "w" ? FACING_WEST : Math.PI / 2;
      for (const along of benchSeatOffsets(stone.size.z)) {
        const p = offset(stone.centre.x, stone.centre.z, yaw, along, stone.size.x / 2 + SIT_ROOT_AHEAD);
        const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
        const id = `${stone.id}:${facing}:${along}`;
        const stand = dismountAhead(root, yaw, bounds, id);
        out.push({ id, x: root.x, z: root.z, yaw, standX: stand.x, standZ: stand.z, seatY: stone.seatTop, frontEdge: SIT_ROOT_AHEAD, bench: stone.id, area: "village", kind: "backless", lean: 0 });
      }
    }
  }
  return out;
}

/**
 * The memorial hall's seat markers in the order their seats took in release 3 (Player.seatIndex 20..50): seat ids are append-only.
 * Release 3.1 (mem-b, owner "안내데스크도 다 없애고 심플하게") took out the consult chairs and the letter table's four chairs; their
 * indices stay, held by retired seats nobody can reach.
 */
export const HALL_SEAT_ORDER: readonly string[] = [
  "armchair_0", "armchair_1", "bench_e1_s0", "bench_e1_s1", "bench_e2_s0", "bench_e2_s1", "bench_east_s0", "bench_east_s1",
  "bench_w1_s0", "bench_w1_s1", "bench_w2_s0", "bench_w2_s1", "consult_0", "consult_1", "letter_n0", "letter_n1", "letter_s0",
  "letter_s1", "sofa_a0", "sofa_a1", "sofa_b0",
];

/** Far outside every map (m): a retired seat's spot, so no player is ever within SEAT_REACH of it (client prompt, server Sit). */
const RETIRED_AT = -100000;

/**
 * A seat index whose furniture is gone (`retired`): kept so later indices do not move. It lies far outside every map, so neither the
 * client's prompt (nearestFreeSeat) nor the server's Sit (validateSit's reach gate) can ever pick it.
 */
function retiredSeat(id: string, area: AreaId): VillageSeat {
  return { id, bench: id, area, x: RETIRED_AT, z: RETIRED_AT, yaw: 0, standX: RETIRED_AT, standZ: RETIRED_AT, seatY: 0.45, frontEdge: SIT_ROOT_AHEAD, kind: "backed", lean: 0, retired: true };
}

function makeSeats(benches: readonly VillageBench[]): VillageSeat[] {
  const seats: VillageSeat[] = [];
  const late: VillageSeat[] = [];
  // the open village's benches first, the shelter's held back (main's later seats come after the hall's and the houses')
  for (const b of benches) if (b !== SHELTER_BENCH) seats.push(...benchSeats(b));
  const hall = { area: "hall" as AreaId, bounds: VILLAGE_LAYOUT.areas.hall, geometry: villageGeometry, peers: MEMORIAL_SEAT_MARKERS as readonly MarkerSource[] };
  // The hall's seats in their live order (HALL_SEAT_ORDER): a marker the hall no longer has keeps its index as a retired seat
  // (retiredSeat), so no later index moves; a marker the hall adds later goes after all of them (none so far).
  const hallMarkers = new Map(MEMORIAL_SEAT_MARKERS.map((m) => [m.id, m] as const));
  for (const id of HALL_SEAT_ORDER) {
    const m = hallMarkers.get(id);
    if (m) seats.push(...markerSeats(m, hall));
    else seats.push(retiredSeat(id, "hall")); // (each removed marker was a one-facing chair: one seat)
  }
  for (const m of MEMORIAL_SEAT_MARKERS) if (!HALL_SEAT_ORDER.includes(m.id)) late.push(...markerSeats(m, hall));
  // The houses (집 실내 G; design 6.4): house 1 floor 1, floor 2, house 2 … in marker order (compareHouseSeats), from each finished house's
  // seat markers (generated/houses). A house without a model has no seats.
  // Seat ids are append-only (Player.seatIndex is the index): a seat a later release brings back (LATE_HOUSE_SEATS) is left out here
  // and appended at the very end of the list instead, so no live index moves.
  for (const n of HOUSE_NUMBERS) {
    const house = GENERATED_HOUSES[n];
    if (!house) continue;
    // (a seat on a piece the game takes out — houseFixes.ts — is no seat)
    const markers = house.seats.filter((m) => !isRemovedHouseSeat(m.id)).sort(compareHouseSeats);
    // the floor's peers are every seat of the floor, the late ones too (their spots keep apart from each other)
    for (const m of markers) {
      const floorMarkers = markers.filter((o) => o.floor === m.floor);
      const made = withHouseReach(n, m.floor, villageGeometry, () =>
        markerSeats(m, {
          area: houseArea(houseBuildingId(n), m.floor),
          bounds: houseFloorBounds(n, m.floor),
          geometry: villageGeometry,
          peers: floorMarkers,
          lenient: true,
        }),
      );
      (LATE_HOUSE_SEATS.includes(m.id) ? late : seats).push(...made);
    }
  }
  // main's later seats last, so the benches', the hall's and the houses' indices stay as they were (review 2026-11-15): the bus
  // stop shelter's bench, then the art's marked seats (café terrace chairs, porch benches)
  if (benches.includes(SHELTER_BENCH)) seats.push(...benchSeats(SHELTER_BENCH));
  seats.push(...villageMarkerSeats(VILLAGE_SEAT_MARKERS));
  // the fishing lake's seats (A10) after every village seat: the 30 fishing chairs first, in LAKE_FISHING_SPOTS order
  // (LAKE_SEAT_BASE + spot), then the shore benches, picnic, pavilion and porch benches
  seats.push(...lakeVillageSeats());
  // the waterfall rest area's stone seats (B1 W5) after the lake's (release 2): no index before them moves, so the lake's
  // LAKE_SEAT_BASE + spot indices stay what release 1's clients and server use
  seats.push(...fallsStoneSeats());
  // the plaza zelkova's deck (평상, UX 2026-11-16) closes the list: after the lake's and after every seat another release adds
  // before it (release 2: the waterfall rest area's stones go between the lake's and these), so no index above ever moves
  seats.push(...zelkovaDeckSeats());
  // release 3: the house seats the art round 2 brought back (house 9's two dining end chairs, taken out in release 2), last of all
  seats.push(...late.sort((a, b) => LATE_HOUSE_SEATS.indexOf(a.bench) - LATE_HOUSE_SEATS.indexOf(b.bench)));
  // the lot buildings' seats (village-lots contract 4, L5 2026-11-17) after every seat main has (the falls' stones last): no earlier
  // index moves. they go after every seat main has, the zelkova deck and the late house seats included (never renumber).
  seats.push(...lotVillageSeats());
  // the lot buildings' walk-in rooms (L5v2, contract 11): every chair, pew, nook and 방석 inside, after every seat above (never renumber)
  seats.push(...lotInteriorSeats());
  return seats;
}

/**
 * Move a backed room seat's stand spot in front of the seat (ahead of its centre along the facing) when it came out behind: the clear
 * spot nearest the seat's centre in the half-plane before it, from which this seat is clearly the nearest (a 앉기 there sits on it).
 */
function frontStand(seat: VillageSeat, m: MarkerSource, peers: readonly MarkerSource[], bounds: Bounds): void {
  const fx = Math.sin(seat.yaw);
  const fz = Math.cos(seat.yaw);
  const aheadOf = (x: number, z: number) => (x - m.x) * fx + (z - m.z) * fz;
  if (aheadOf(seat.standX, seat.standZ) > 0.02) return;
  let best: Point2 | null = null;
  // first a spot this seat is clearly the nearest from; failing that (a pew's end place by the organ) any clear one in front — a tap on
  // the seat walks there and makes it the preferred seat, so the 앉기 button still sits on it
  for (const ownFirst of [true, false]) {
    let bestD = Infinity;
    for (let dx = -1.4; dx <= 1.4 + 1e-9; dx += 0.05)
      for (let dz = -1.4; dz <= 1.4 + 1e-9; dz += 0.05) {
        const x = Math.round((m.x + dx) * 1000) / 1000;
        const z = Math.round((m.z + dz) * 1000) / 1000;
        if (aheadOf(x, z) < 0.05) continue;
        const d = Math.hypot(x - m.x, z - m.z);
        if (d >= bestD || d > 1.4) continue;
        if (ownFirst && peers.some((o) => o.id !== m.id && Math.hypot(x - o.x, z - o.z) <= d + 0.05)) continue;
        if (!standsClear(x, z, bounds)) continue;
        best = { x, z };
        bestD = d;
      }
    if (best) break;
  }
  const found = best as Point2 | null;
  if (found) {
    seat.standX = found.x;
    seat.standZ = found.z;
  }
}

/** A room seat's facing as a game yaw (`atan2(dirX, dirZ)`): the room frame is the world's, "in" = +z. */
const ROOM_FACING_YAW: Readonly<Record<LotInteriorSeat["faces"], number>> = { in: 0, out: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

/**
 * The walk-in rooms' seats (`LOT_INTERIOR_SEAT_ORDER`: school chairs 12 → library chairs 8 + nooks 2 → chapel pews 10 → church pews 8 →
 * 대웅전 방석 12), one marker per place: a pew's three places and a nook's two spread evenly along it. A chair at a desk (`furn` chair:
 * also sat on from its sides, up to its backrest), a pew from its front only (P6: backed — sit and stand in front, the 0.6 m strip the
 * contract keeps clear), a nook cushion from the room, a 방석 cross-legged from any side. Ids `lotin:<seat id>:<place>`.
 */
function lotInteriorSeats(): VillageSeat[] {
  const out: VillageSeat[] = [];
  for (const r of LOT_ROOMS) {
    const markers: MarkerSource[] = r.spec.seats.flatMap((s) => {
      const yaw = ROOM_FACING_YAW[s.faces];
      // along the seat: the facing turned a quarter right
      const ax = Math.cos(yaw);
      const az = -Math.sin(yaw);
      // the contract's places spread along the seat, never closer than two sitters' hands allow (a 2.6 m church pew: three at 1.12 m)
      const step = s.places > 1 ? Math.max(s.length / s.places, LOT_PLACE_SPACING) : s.length;
      return Array.from({ length: s.places }, (_, k): MarkerSource => {
        const along = (k - (s.places - 1) / 2) * step;
        const c = lotRoomPoint(r, s.x + ax * along, s.z + az * along);
        const floor = s.kind === "floor";
        return {
          id: `lotin:${s.id}:${k + 1}`,
          furn: floor ? "cushion" : s.places === 1 && s.kind === "backed" ? "chair" : s.kind === "backed" ? "pew" : "nook",
          kind: s.kind,
          x: Math.round(c.x * 1000) / 1000,
          z: Math.round(c.z * 1000) / 1000,
          y: s.seatTop,
          yaw,
          edge: s.frontEdge,
          // the backrest's face: its board is ~5 cm of the seat's back depth
          back: s.kind === "backed" ? Math.max(0.05, Math.round((s.backDepth - 0.05) * 1000) / 1000) : 0,
          width: Math.min(s.length / s.places, s.length),
          group: `lotin:${s.id}:${k + 1}`,
          both: false,
          exitTurn: 0,
          lean: s.kind === "backed" ? 0.12 : 0,
          pose: floor ? "floor" : undefined,
        };
      });
    });
    const place: MarkerPlace = { area: r.area, bounds: r.bounds, geometry: villageGeometry, peers: markers, lenient: true };
    for (const m of markers) {
      // a pew's end place by a hymn board or the organ has no clear spot straight ahead: it is stood up from as a chair is (the nearest
      // clear spot it is offered from, frontStand below keeps that in front)
      let made = markerSeats(m, place);
      if (made.length === 0 && m.kind === "backed") made = markerSeats({ ...m, furn: "chair" }, place).map((q) => ({ ...q, sidePlane: undefined, sideHalf: undefined, sideFar: undefined, reachBonus: undefined, aheadMax: undefined }));
      for (const seat of made) {
        // P6 (backed: sit and stand in FRONT): a chair hemmed in by its desk ahead and the next one behind came out with its stand spot
        // behind its back (the house rule for a chair in a row) — here the nearest clear spot in front of it, nearer it than any other
        if (m.kind === "backed") frontStand(seat, m, markers, r.bounds);
        // a window nook's cushion has nothing round it: its sitter gets up a short step into the room, not on the spot
        if (m.kind === "backless" && Math.hypot(seat.standX - seat.x, seat.standZ - seat.z) < 0.1) {
          for (let d = 0.3; d <= 0.8 + 1e-9; d += 0.05) {
            const p = offset(seat.x, seat.z, seat.yaw, 0, d);
            if (standsClear(p.x, p.z, r.bounds)) {
              seat.standX = Math.round(p.x * 1000) / 1000;
              seat.standZ = Math.round(p.z * 1000) / 1000;
              break;
            }
          }
        }
        out.push({ ...seat, bench: `lotin:${m.id.split(":")[1]}` });
      }
    }
  }
  return out;
}

/** A two-place lot bench is seated as if this long (m): its places ±0.56 apart (two seated avatars' hands need 1.107 m). */
const LOT_BENCH_MIN_LENGTH = 1.82;
/** Sitters side by side on a pew or a nook keep at least this far apart (m): their hands do not meet (benchSeats.test.ts). */
const LOT_PLACE_SPACING = 1.12;

/** How far beside a lot's plastic chair (m, along the chair's local x, away from the table's side) its sitter steps in and gets up. */
const LOT_CHAIR_STEP_ASIDE = 0.62;

/**
 * The lot buildings' seats (villageLots.ts `LOT_SEAT_ORDER`, rule P6), lot by lot: a backed bench (shops, hall, post) or chair (the
 * mart's) as a marked village seat (front only; a chair stepped into from beside it), a backless bench sat on from either long side
 * (the market's and the gate's: two facings per place, one group), a 평상 edge (its `_in` / `_out` seats are already its two sides)
 * from its own side only. Ids `lot:<seat id>…`; only the lots whose model is in (`LOTS_WITH_MODEL`).
 */
function lotVillageSeats(): VillageSeat[] {
  const bounds = VILLAGE_LAYOUT.areas.village;
  const out: VillageSeat[] = [];
  for (const lot of VILLAGE_LOTS) {
    if (!LOTS_WITH_MODEL.includes(lot.id)) continue;
    for (const m of lotSeatMarkers(lot)) {
      if (m.kind === "backed") {
        const spec = lot.seats.find((s) => s.id === m.id)!;
        const stand = m.approach === "side" ? lotLocalToWorld(lot, spec.lx - LOT_CHAIR_STEP_ASIDE, spec.lz) : null;
        const marker: VillageSeatMarker = {
          id: m.id,
          x: m.x,
          z: m.z,
          facing: m.facing,
          seatTop: m.seatTop,
          approach: m.approach,
          frontEdge: m.frontEdge,
          places: m.places,
          // two sitters side by side keep their hands apart (1.107 m, benchSeats.test.ts): a 1.8 m lot bench seats them ±0.56
          ...(m.places > 1 ? { length: Math.max(m.length, LOT_BENCH_MIN_LENGTH) } : {}),
          ...(stand ? { standX: stand.x, standZ: stand.z } : {}),
        };
        out.push(...villageMarkerSeats([marker]).map((s) => ({ ...s, id: `lot:${s.id}`, bench: `lot:${m.id}` })));
        continue;
      }
      const yaw0 = FACING_YAW[m.facing];
      const turns = /_(in|out)$/.test(m.id) ? [0] : [0, Math.PI];
      for (const along of benchSeatOffsets(Math.max(m.length, LOT_BENCH_MIN_LENGTH))) {
        for (const turn of turns) {
          const yaw = wrapYaw(yaw0 + turn);
          const p = offset(m.x, m.z, yaw, turn === 0 ? along : -along, m.frontEdge + SIT_ROOT_AHEAD);
          const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
          const place = `lot:${m.id}:${along}`;
          const stand = dismountAhead(root, yaw, bounds, place);
          out.push({
            id: turns.length > 1 ? `${place}:${turn === 0 ? "front" : "back"}` : place,
            x: root.x,
            z: root.z,
            yaw,
            standX: stand.x,
            standZ: stand.z,
            seatY: m.seatTop,
            frontEdge: SIT_ROOT_AHEAD,
            bench: `lot:${m.id}`,
            area: "village",
            kind: "backless",
            lean: 0,
            group: turns.length > 1 ? place : undefined,
          });
        }
      }
    }
  }
  return out;
}

/** Whether a seat of `VILLAGE_SEATS` is a lot building's (its tap walks there; sitting is the 앉기 button's, owner 2026-11-17). */
export function isLotSeat(seat: object | undefined): boolean {
  const id = (seat as { id?: unknown } | undefined)?.id;
  return typeof id === "string" && (id.startsWith("lot:") || id.startsWith("lotin:"));
}

/**
 * House seats that were not in the live list when they came (houseFixes.ts took their piece out in release 2; the houses' art round 2
 * moved the piece and restored it in release 3). Seat ids are append-only, so these go at the very end of `VILLAGE_SEATS`, in this order,
 * not in their house's place. A seat restored later is added here, after these.
 */
export const LATE_HOUSE_SEATS: readonly string[] = ["h9_1_7", "h9_1_10"];

/**
 * The plaza zelkova's round deck (평상): an octagon about the trunk (VILLAGE_LAYOUT.plaza.zelkova), its faces 0.46 m up and
 * 2.31 m out from the trunk (measured on village.glb: the corners at game yaw 0, 45, 90, ... and the faces between them).
 * Visitors sit on its rim facing out, the legs down over the edge — a backless seat with nothing behind the sitter but the deck,
 * reached from outside only (the deck itself is solid ground nobody stands in), so each place is one facing. Six places, one per
 * face, the two faces on the ring road's side (west) left free. The tap footprint (`ZELKOVA_DECK_FOOTPRINTS`) is the face's strip.
 */
export const ZELKOVA_DECK = { seatTop: 0.46, apothem: 2.31, faceHalf: 0.85, faces: [22.5, 67.5, 112.5, 157.5, 202.5, 337.5] } as const;

function zelkovaDeckSeats(): VillageSeat[] {
  const c = VILLAGE_LAYOUT.plaza.zelkova.centre;
  const bounds = VILLAGE_LAYOUT.areas.village;
  return ZELKOVA_DECK.faces.map((deg, k) => {
    const yaw = wrapYaw((deg * Math.PI) / 180);
    const p = offset(c.x, c.z, yaw, 0, ZELKOVA_DECK.apothem + SIT_ROOT_AHEAD);
    const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
    const id = `zelkova_deck:${k + 1}`;
    const stand = dismountAhead(root, yaw, bounds, id);
    return {
      id,
      x: root.x,
      z: root.z,
      yaw,
      standX: stand.x,
      standZ: stand.z,
      seatY: ZELKOVA_DECK.seatTop,
      frontEdge: SIT_ROOT_AHEAD,
      bench: id,
      area: "village" as AreaId,
      kind: "backless" as SeatKind,
      lean: 0,
    };
  });
}

/**
 * The village's seats, ONE global list for every area, in this order (so every index another branch or a saved test pins stays put):
 *  - two places per bench of the open village in `VILLAGE_BENCHES` order, the bus shelter's excepted (a backless one with two
 *    facings): plaza 1..8 and the forecourt, 0..19;
 *  - the memorial hall's, from its model's markers: 20..50;
 *  - the houses' interiors (집 실내 G: every finished house's floors, in house, floor, marker order);
 *  - the bus stop shelter's bench (2), then the art's marked village seats (café terrace chairs, porch benches).
 *  - the fishing lake's seats (`LAKE_SEAT_BASE` on: the 30 fishing chairs first), then the waterfall rest area's stone seats.
 *  - the plaza zelkova's deck (6, UX 2026-11-16), last of all (release 3).
 * Index === `Player.seatIndex` in the village room: the server validates and assigns by this index, the client looks the seat up
 * by it (activeMap's `seats`) and offers only the seats of the area the player is in (`VillageSeat.area`).
 */
export const VILLAGE_SEATS: readonly VillageSeat[] = Object.freeze(makeSeats(VILLAGE_BENCHES).map((s) => Object.freeze(s)));

/**
 * The seats one house seat marker makes (the list's own rule, exported for tests): a floor marker's root places the hips on the marker's
 * centre (`FLOOR_SIT_POSE`), whatever the pose of the others.
 */
export function houseMarkerSeats(m: HouseSeatMarker): VillageSeat[] {
  return withHouseReach(m.n, m.floor, villageGeometry, () =>
    markerSeats(m, {
      area: houseArea(houseBuildingId(m.n), m.floor),
      bounds: houseFloorBounds(m.n, m.floor),
      geometry: villageGeometry,
      peers: [m],
      lenient: true,
    }),
  );
}

/** Index of the first lake seat in `VILLAGE_SEATS`: the 30 fishing chairs are `LAKE_SEAT_BASE + spotIndex` (spotIndex = LAKE_FISHING_SPOTS order). */
export const LAKE_SEAT_BASE: number = VILLAGE_SEATS.findIndex((s) => s.lake !== undefined);

/** The seat index of the fishing chair of spot `spot` (0..29). */
export function fishingSeatIndex(spot: number): number {
  return LAKE_SEAT_BASE + spot;
}

/** The fishing spot of a seat index, or -1 when it is not a fishing chair. */
export function fishingSpotOfSeat(seatIndex: number): number {
  const s = VILLAGE_SEATS[seatIndex];
  return s && s.lake === "fishing_chair" ? seatIndex - LAKE_SEAT_BASE : -1;
}

/**
 * The lake's seats in the village's seat model (lakeLayout.ts `lakeSeats`, rule P6): a fishing chair or a backed bench is one
 * seat sat on from its front (a fishing chair also from beside it: its front is the water); a backless board (picnic, pavilion)
 * is two seats of one group, one per facing, the sitter facing the side they came from — its root `rootAhead` ahead of the
 * board's middle, the hips over the board. A picnic bench is sat on from outside only (its other side is the table).
 */
function lakeVillageSeats(): VillageSeat[] {
  const out: VillageSeat[] = [];
  for (const s of lakeSeats()) {
    const base = { bench: s.bench, area: "village" as AreaId, lake: s.kind, seatY: s.seatY, lean: 0 };
    if (s.approach !== "either" || !s.other || s.rootAhead === undefined) {
      out.push({
        ...base,
        id: `lake:${s.id}`,
        x: s.x,
        z: s.z,
        yaw: s.yaw,
        standX: s.standX,
        standZ: s.standZ,
        frontEdge: s.frontEdge,
        approachEdge: s.approachEdge,
        beside: s.beside,
        kind: "backed",
        spot: s.spot,
      });
      continue;
    }
    const ahead = s.rootAhead;
    const deep = s.deep ?? 0.4;
    // a picnic bench's second facing is the table's side: nobody can stand there to sit facing it (lakeLayout.ts gives it the
    // first side's get-up spot), so a picnic board is the one seat sat on from outside (as lakeLayout's own rule chose)
    const facings = [
      { yaw: s.yaw, standX: s.standX, standZ: s.standZ, tag: "a" },
      ...(s.kind === "picnic" ? [] : [{ yaw: s.other.yaw, standX: s.other.standX, standZ: s.other.standZ, tag: "b" }]),
    ];
    for (const f of facings) {
      out.push({
        ...base,
        id: `lake:${s.id}:${f.tag}`,
        x: Math.round((s.x + Math.sin(f.yaw) * ahead) * 1000) / 1000,
        z: Math.round((s.z + Math.cos(f.yaw) * ahead) * 1000) / 1000,
        yaw: f.yaw,
        standX: f.standX,
        standZ: f.standZ,
        frontEdge: Math.round(Math.max(0.05, ahead - deep / 2) * 1000) / 1000,
        kind: "backless",
        group: facings.length > 1 ? `lake:${s.id}` : undefined,
      });
    }
  }
  return out;
}

