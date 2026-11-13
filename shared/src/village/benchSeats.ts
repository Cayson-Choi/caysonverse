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
import { BACKED_ROOT_AHEAD, SIT_ROOT_AHEAD } from "../sitPose";
import { MEMORIAL_SEAT_MARKERS } from "./generated/memorialSeats";
import type { SeatMarker } from "./seatMarkers";
import type { Bounds } from "../school/geometry";
import { VILLAGE_LAYOUT, houseArea, houseInteriorGeometry, villageGeometry, type AreaId, type Point2 } from "./villageLayout";
import { HOUSE_INTERIOR_LAYOUTS } from "./houseInterior";

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

/** Yaw that faces south (+z). */
const FACING_SOUTH = 0;

function makeBenches(): VillageBench[] {
  const plaza = VILLAGE_LAYOUT.plaza.benches.map(
    (b, i): VillageBench => ({ id: `plaza_${i + 1}`, area: "village", centre: { x: b.x, z: b.z }, yaw: b.yaw, ...PLAZA_BENCH }),
  );
  return [
    ...plaza,
    // parts_buildings.py: mb.box(-4.8, -50.4, 0.0, 2.2, 0.55, 0.45, "LM_stone") — a stone block with no back: sat from either side
    { id: "memorial_forecourt", area: "village", centre: { x: -4.8, z: -50.4 }, yaw: FACING_SOUTH, seatTop: 0.45, frontEdge: 0.55 / 2, length: 2.2, kind: "backless" },
  ];
}

/** Every bench of the open village a player can sit on, in seat order (plaza 1..8, the forecourt). The hall's seats come from its model's markers. */
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
    out.push({
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
      // a chair at a table has the table in front of it: it is sat on from any side (a sofa or an armchair from the front only)
      anySide: m.furn === "chair" ? true : undefined,
    });
  }
  return out;
}

function makeSeats(benches: readonly VillageBench[]): VillageSeat[] {
  const seats: VillageSeat[] = [];
  for (const b of benches) {
    const bounds = b.area === "village" ? VILLAGE_LAYOUT.areas.village : VILLAGE_LAYOUT.areas.hall;
    const turns = b.kind === "backless" ? [0, Math.PI] : [0];
    for (const along of benchSeatOffsets(b.length)) {
      for (const turn of turns) {
        const yaw = wrapYaw(b.yaw + turn);
        const p = offset(b.centre.x, b.centre.z, yaw, along, b.frontEdge + SIT_ROOT_AHEAD);
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
  }
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
  return seats;
}

/**
 * The village's seats: two places per bench in `VILLAGE_BENCHES` order (a backless one with two facings), the hall's from its model's
 * markers, the houses'. Index === `Player.seatIndex` in the village room, ONE global list for every area: the server validates and
 * assigns by this index, the client looks the seat up by it (activeMap's `seats`) and offers only the seats of the area the player
 * is in (`VillageSeat.area`).
 */
export const VILLAGE_SEATS: readonly VillageSeat[] = Object.freeze(makeSeats(VILLAGE_BENCHES).map((s) => Object.freeze(s)));
