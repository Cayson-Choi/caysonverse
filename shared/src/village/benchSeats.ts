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
import { BACKED_ROOT_AHEAD, SIT_ROOT_AHEAD } from "../sitPose";
import { MEMORIAL_SEAT_MARKERS } from "./generated/memorialSeats";
import type { SeatMarker } from "./seatMarkers";
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
  /** `backed`: a backrest behind the sitter (sat from the front only); `backless`: sat from either side (a second facing). */
  kind: SeatKind;
}

/** What a seat is like to approach: a backrest behind it (front only, leaning back), or none (either side). */
export type SeatKind = "backless" | "backed";

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
  return true;
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
 * A chair with another chair of its kind next to it (the two consult chairs at the desk, the letter table's four): its dismount
 * spot — where a click on it walks to and where its sitter stands up — is the nearest clear spot from which the chair is offered
 * (`approachesSeat`: beside or in front of it, never behind its backrest) that is clearly nearer this chair's seat than any
 * neighbour's (`STAND_NEIGHBOUR_MARGIN`). Review 2026-11-15 round 5: the second consult chair's spot was in the gap between the
 * two, as near the first chair, so stopping a step short of it and pressing E sat on the first one. Null: none within reach.
 */
function chairStand(seat: Seat, neighbours: readonly Point2[], bounds: Bounds): Point2 | null {
  let best: Point2 | null = null;
  let bestD = Infinity;
  const step = 0.05;
  for (let ix = -26; ix <= 26; ix++) {
    for (let iz = -26; iz <= 26; iz++) {
      const x = Math.round((seat.x + ix * step) * 1000) / 1000;
      const z = Math.round((seat.z + iz * step) * 1000) / 1000;
      const own = Math.hypot(x - seat.x, z - seat.z);
      if (own >= bestD || own > 1.6) continue;
      // offered from the spot itself; and from anywhere a step short of it (a tap walk stops 0.35 m before its target) never the
      // neighbour instead: there it is this chair or none
      let ok = own - (seat.reachBonus ?? 0) <= SEAT_REACH - STAND_SHORT - 0.05 && approachesSeat(seat, x, z);
      for (let k = 0; k <= 8 && ok; k++) {
        const a = (k * Math.PI) / 4;
        const px = k === 8 ? x : x + Math.cos(a) * STAND_SHORT;
        const pz = k === 8 ? z : z + Math.sin(a) * STAND_SHORT;
        const d = Math.hypot(px - seat.x, pz - seat.z);
        ok = !neighbours.some((n) => Math.hypot(n.x - px, n.z - pz) < d + (k === 8 ? STAND_NEIGHBOUR_MARGIN : 0.01));
      }
      if (!ok || !standsClear(x, z, bounds)) continue;
      best = { x, z };
      bestD = own;
    }
  }
  return best;
}

/** How much nearer (m) a chair's dismount spot is to its own seat than to a neighbouring chair's (`chairStand`). */
const STAND_NEIGHBOUR_MARGIN = 0.25;
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
 * The seats of one marker of the hall model: one facing, or for a backless seat sat from either side the front and the
 * back facing (one exclusive group). The root is where the avatar's origin goes (see the header): ahead of the front edge for
 * a backless seat, in front of the backrest's face for a backed one.
 */
function markerSeats(m: SeatMarker): VillageSeat[] {
  const out: VillageSeat[] = [];
  const turns = m.kind === "backless" && m.both ? [0, Math.PI] : [0];
  for (const turn of turns) {
    const yaw = wrapYaw(m.yaw + turn);
    // `ahead` from the marker along the facing to the root; `frontEdge` from the root back to the seat's front edge
    const ahead = m.kind === "backless" ? m.edge + SIT_ROOT_AHEAD : BACKED_ROOT_AHEAD - m.back;
    const frontEdge = m.kind === "backless" ? SIT_ROOT_AHEAD : Math.max(0.05, ahead - m.edge);
    const p = offset(m.x, m.z, yaw, 0, ahead);
    const root = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 };
    const id = turns.length > 1 ? `${m.id}:${turn === 0 ? "front" : "back"}` : m.id;
    const stand = dismountAhead(root, yaw + m.exitTurn, VILLAGE_LAYOUT.areas.hall, id);
    const seat: VillageSeat = {
      id,
      x: root.x,
      z: root.z,
      yaw,
      standX: stand.x,
      standZ: stand.z,
      seatY: m.y,
      frontEdge,
      bench: m.id,
      area: "hall",
      kind: m.kind,
      lean: m.kind === "backed" ? m.lean : 0,
      group: m.group,
      // a chair at a table has the table in front of it: it is also sat on from its sides, up to the backrest's face (never
      // through the backrest); a sofa or an armchair from the front only
      sidePlane: m.furn === "chair" ? Math.round((ahead + m.back) * 1000) / 1000 : undefined,
      sideHalf: m.furn === "chair" ? Math.round((m.width / 2) * 1000) / 1000 : undefined,
      // its seat point is under the desk / table (BACKED_ROOT_AHEAD in front of the backrest): reached that much farther
      reachBonus: m.furn === "chair" ? CHAIR_REACH_BONUS : undefined,
      // the table in front: farther ahead than this is across it (the chair opposite's front), never this chair's
      aheadMax: m.furn === "chair" ? CHAIR_AHEAD_MAX : undefined,
    };
    // the roots of the chairs of the same kind next to this one
    const neighbours = MEMORIAL_SEAT_MARKERS.filter((o) => o.id !== m.id && o.furn === m.furn && Math.hypot(o.x - m.x, o.z - m.z) < 2.5).map((o) =>
      offset(o.x, o.z, o.yaw, 0, o.kind === "backless" ? o.edge + SIT_ROOT_AHEAD : BACKED_ROOT_AHEAD - o.back),
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
    if (m.furn === "chair" && neighbours.length > 0) {
      const side = chairStand(seat, neighbours, VILLAGE_LAYOUT.areas.hall);
      if (side) {
        seat.standX = side.x;
        seat.standZ = side.z;
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

function makeSeats(benches: readonly VillageBench[]): VillageSeat[] {
  const seats: VillageSeat[] = [];
  // the open village's benches first (0..19), the shelter's held back so the hall's indices (20..50) and the houses' stay put
  for (const b of benches) if (b !== SHELTER_BENCH) seats.push(...benchSeats(b));
  for (const m of MEMORIAL_SEAT_MARKERS) seats.push(...markerSeats(m));
  for (const layout of Object.values(HOUSE_INTERIOR_LAYOUTS)) {
    const bounds = VILLAGE_LAYOUT.areas.hall;
    for (const s of layout.seats) {
      const root = { x: Math.round((300 + s.x) * 1000) / 1000, z: Math.round(s.z * 1000) / 1000 };
      const stand = dismountAhead(root, s.yaw, bounds, s.id, houseInteriorGeometry);
      seats.push({
        id: `${layout.buildingId}:${s.id}`,
        x: root.x,
        z: root.z,
        yaw: s.yaw,
        standX: stand.x,
        standZ: stand.z,
        seatY: s.seatY,
        frontEdge: SIT_ROOT_AHEAD,
        bench: s.id,
        area: houseArea(layout.buildingId),
        kind: "backless",
        lean: 0,
      });
    }
  }
  // main's later seats last, so the benches', the hall's and the houses' indices stay as they were (review 2026-11-15): the bus
  // stop shelter's bench, then the art's marked seats (café terrace chairs, porch benches)
  if (benches.includes(SHELTER_BENCH)) seats.push(...benchSeats(SHELTER_BENCH));
  seats.push(...villageMarkerSeats(VILLAGE_SEAT_MARKERS));
  return seats;
}

/**
 * The village's seats, ONE global list for every area, in this order (so every index another branch or a saved test pins stays put):
 *  - two places per bench of the open village in `VILLAGE_BENCHES` order, the bus shelter's excepted (a backless one with two
 *    facings): plaza 1..8 and the forecourt, 0..19;
 *  - the memorial hall's, from its model's markers: 20..50;
 *  - the houses' interiors: 51..90;
 *  - the bus stop shelter's bench (2), then the art's marked village seats (café terrace chairs, porch benches).
 * Index === `Player.seatIndex` in the village room: the server validates and assigns by this index, the client looks the seat up
 * by it (activeMap's `seats`) and offers only the seats of the area the player is in (`VillageSeat.area`).
 */
export const VILLAGE_SEATS: readonly VillageSeat[] = Object.freeze(makeSeats(VILLAGE_BENCHES).map((s) => Object.freeze(s)));
