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
 *  - the oak bench inside the hall: a 2.4 x 0.42 m board 0.455 m up on two legs, 2.3 m south of the memorial table.
 *    No back either; a sitter faces north, toward the table and the cubby wall;
 *  - the bus stop shelter's bench (`SHELTER_BENCH`): slats along its glass back wall; a sitter faces west, to the road.
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
import { PLAYER_RADIUS, type Seat } from "../worldMap";
import { SIT_ROOT_AHEAD } from "../sitPose";
import type { Bounds } from "../school/geometry";
import { VILLAGE_LAYOUT, houseArea, houseInteriorGeometry, villageGeometry, type AreaId, type Point2 } from "./villageLayout";
import { HOUSE_INTERIOR_LAYOUTS } from "./houseInterior";
import { VILLAGE_SEAT_MARKERS } from "./generated/villageSeatMarkers";

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
}

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
const PLAZA_BENCH = { seatTop: 0.445, frontEdge: 0.22 + 0.085 / 2, length: 1.86 } as const;

/** Yaw that faces south (+z), north (-z) and west (-x). */
const FACING_SOUTH = 0;
const FACING_NORTH = Math.PI;
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
};

function makeBenches(): VillageBench[] {
  const plaza = VILLAGE_LAYOUT.plaza.benches.map(
    (b, i): VillageBench => ({ id: `plaza_${i + 1}`, area: "village", centre: { x: b.x, z: b.z }, yaw: b.yaw, ...PLAZA_BENCH }),
  );
  return [
    ...plaza,
    // parts_buildings.py: mb.box(-4.8, -50.4, 0.0, 2.2, 0.55, 0.45, "LM_stone")
    { id: "memorial_forecourt", area: "village", centre: { x: -4.8, z: -50.4 }, yaw: FACING_SOUTH, seatTop: 0.45, frontEdge: 0.55 / 2, length: 2.2 },
    // build_memorial.py `bench`: rbox(mb, 300.6, -1.6, 0.40, 2.4, 0.42, 0.055, "LM_oak")
    { id: "hall", area: "hall", centre: { x: 300.6, z: -1.6 }, yaw: FACING_NORTH, seatTop: 0.455, frontEdge: 0.42 / 2, length: 2.4 },
    SHELTER_BENCH,
  ];
}

/** Every bench a player can sit on, in seat order (plaza 1..8, the forecourt, the hall, the bus stop's shelter). */
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
  return !isBlocked(x, z, r, geometry.obstacles, 0);
}

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

/** A village seat, plus the bench and the area it belongs to. */
export interface VillageSeat extends Seat {
  bench: string;
  area: AreaId;
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

/** The marked seats (`VILLAGE_SEAT_MARKERS`) as village seats, in marker order. */
function markerSeats(markers: readonly VillageSeatMarker[]): VillageSeat[] {
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
        });
      } else {
        const stand = dismountAhead(root, yaw, bounds, `${m.id}:${along}`);
        seats.push({ x: root.x, z: root.z, yaw, standX: stand.x, standZ: stand.z, seatY: m.seatTop, frontEdge: SIT_ROOT_AHEAD, bench: m.id, area: "village" });
      }
    }
  }
  return seats;
}

function makeSeats(benches: readonly VillageBench[]): VillageSeat[] {
  const seats: VillageSeat[] = [];
  for (const b of benches) {
    const bounds = b.area === "village" ? VILLAGE_LAYOUT.areas.village : VILLAGE_LAYOUT.areas.hall;
    for (const along of b.seatOffsets ?? benchSeatOffsets(b.length)) {
      const p = offset(b.centre.x, b.centre.z, b.yaw, along, b.frontEdge + SIT_ROOT_AHEAD);
      const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
      const stand = dismountAhead(root, b.yaw, bounds, `${b.id}:${along}`);
      seats.push({
        x: root.x,
        z: root.z,
        yaw: b.yaw,
        standX: stand.x,
        standZ: stand.z,
        seatY: b.seatTop,
        frontEdge: SIT_ROOT_AHEAD,
        bench: b.id,
        area: b.area,
      });
    }
  }
  for (const layout of Object.values(HOUSE_INTERIOR_LAYOUTS)) {
    const bounds = VILLAGE_LAYOUT.areas.hall;
    for (const s of layout.seats) {
      const root = { x: Math.round((300 + s.x) * 1000) / 1000, z: Math.round(s.z * 1000) / 1000 };
      const stand = dismountAhead(root, s.yaw, bounds, s.id, houseInteriorGeometry);
      seats.push({ x: root.x, z: root.z, yaw: s.yaw, standX: stand.x, standZ: stand.z, seatY: s.seatY, frontEdge: SIT_ROOT_AHEAD, bench: s.id, area: houseArea(layout.buildingId) });
    }
  }
  // the art's marked seats last, so the benches' and the houses' indices stay as they were (review 2026-11-15)
  seats.push(...markerSeats(VILLAGE_SEAT_MARKERS));
  return seats;
}

/**
 * The village's seats: two per bench in `VILLAGE_BENCHES` order, the house interiors' seats, then the art's marked
 * seats (café terrace chairs, porch benches). Index === `Player.seatIndex` in the village room;
 * the server validates and assigns by this index, the client looks the seat up by it (activeMap's `seats`).
 */
export const VILLAGE_SEATS: readonly VillageSeat[] = Object.freeze(makeSeats(VILLAGE_BENCHES).map((s) => Object.freeze(s)));
