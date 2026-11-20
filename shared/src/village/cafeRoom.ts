/**
 * The village café's walk-in room (owner 2026-11-20: "케이슨카페에는 못 들어가?" → "들어갈 수 있게 해"). The café's front room used to be
 * seen through the glass only; now its door takes a visitor into the same kind of room as the school, the library and the churches
 * (villageLots.ts: a `lot:<unit>` area far from the village, a teleporting door pad, the room's own walls, furniture and seats).
 *
 * Numbers first. LOCAL frame = the café's own (parts_cafe.py, client/src/village/cafe/cafeLayout.ts): x to the right seen from the
 * front, z toward the door side (west), y up, the room x -6.8..6.8, z -4.1 (the kitchen partition) .. 3.7 (the front wall), 4.3 m
 * ceiling. ROOM frame (the interior spec's, like every lot room): x across the room, z from the inside face of the door wall inwards,
 * door on z = 0, a visitor arriving faces +z (yaw 0). The map between them is a turn by half a circle, no mirror:
 *     room x = 6.8 - local x        room z = 3.7 - local z
 * (the visitor's right hand, local +x, is room -x: a person facing +z has -x on their right). The client builds the room's geometry
 * in the local frame and turns it with the same map (CafeRoom.tsx), so the furniture here and there are one set of numbers.
 *
 * Browser-safe, values only; the types come from villageLots.ts (type-only import: no cycle at run time).
 */
import type { LotInteriorSeat, LotInteriorSpec, LotRect } from "./villageLots";

/** The café's centre in the village (the layout's `cafe` house; a test keeps the two equal). */
export const CAFE_CENTRE_XZ = Object.freeze({ x: 50.6, z: -15.1 });

/** The café room's area id (a lot room: `lot:<unit>`). Emoji go through in it, as in the village and the memorial hall. */
export const CAFE_ROOM_AREA = "lot:lot_cafe_room";

/** The modelled room (local metres): the inner wall faces, the kitchen partition at the back and the ceiling. */
export const CAFE_ROOM_LOCAL = Object.freeze({ x0: -6.8, x1: 6.8, zBack: -4.1, zFront: 3.7, ceil: 4.3 });
/** The room frame's size (m): across, deep. */
export const CAFE_ROOM_SIZE = Object.freeze({ x: 13.6, z: 7.8 });

/** Local (x, z) → room-frame (x, z): a half turn (a proper rotation, so windings and handedness carry over). */
export function cafeToRoom(lx: number, lz: number): { x: number; z: number } {
  return { x: CAFE_ROOM_LOCAL.x1 - lx, z: CAFE_ROOM_LOCAL.zFront - lz };
}
/** Room-frame (x, z) → local (x, z): the same half turn back. */
export function cafeFromRoom(x: number, z: number): { x: number; z: number } {
  return { x: CAFE_ROOM_LOCAL.x1 - x, z: CAFE_ROOM_LOCAL.zFront - z };
}

export interface CafeRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A local rectangle as a room-frame LotRect (x0 < x1, z0 < z1). */
export function cafeRectToRoom(r: CafeRect): LotRect {
  const a = cafeToRoom(r.x0, r.z0);
  const b = cafeToRoom(r.x1, r.z1);
  const R = (v: number) => Math.round(v * 1e4) / 1e4;
  return { x0: R(Math.min(a.x, b.x)), x1: R(Math.max(a.x, b.x)), z0: R(Math.min(a.z, b.z)), z1: R(Math.max(a.z, b.z)) };
}

const PI = Math.PI;

// ─────────────────────────────── the furniture (local frame) ───────────────────────────────

/** A round bistro table (top radius, m); its solid box is a little wider than the top. */
export const CAFE_TABLE_RADIUS = 0.33;
const TABLE_BOX = 0.35;
/** How far a chair's centre stands from its table's centre (m): the bake's own (cafe_interior uses 0.72). */
export const CAFE_CHAIR_DIST = 0.72;

export interface CafeTableSpot {
  x: number;
  z: number;
  /** Which sides have a chair: the chair's centre is at this angle (rad, from +x toward +z) and CAFE_CHAIR_DIST. */
  chairs: readonly number[];
  /** The pendant over it: "dome" (brass) or "globe" (opal glass). */
  lamp: "dome" | "globe";
}

/**
 * The tables the room adds to the bake's two (x 2.9 and 5.3, z 0.3: BAKED_TABLES). The banquette's table stands out in the room (its
 * seat is a bench sat on from the front only, so its 0.6 m front strip and a body's width must stay clear: 1 m from the bench).
 */
export const CAFE_TABLES: readonly CafeTableSpot[] = Object.freeze([
  { x: -4.9, z: 1.7, chairs: [-PI / 2, PI / 2], lamp: "globe" },
  { x: -2.5, z: 0.9, chairs: [-PI / 2, PI / 2], lamp: "dome" },
  { x: -1.0, z: 0.0, chairs: [-PI / 2, PI / 2], lamp: "globe" },
]);

/** The bake's own two tables (their chairs and tops are baked into the village model; the room rebuilds them). */
export const CAFE_BAKED_TABLES: readonly CafeTableSpot[] = Object.freeze([
  { x: 2.9, z: 0.3, chairs: [-PI / 2, PI / 2], lamp: "dome" },
  { x: 5.3, z: 0.3, chairs: [-PI / 2, PI / 2], lamp: "globe" },
]);

/** Every table of the room (the new ones, then the bake's two). */
export const CAFE_ALL_TABLES: readonly CafeTableSpot[] = Object.freeze([...CAFE_TABLES, ...CAFE_BAKED_TABLES]);

/** The counter (white panelled, oak top 1.07 m) and the back bar under the shelves, as the bake has them. */
export const CAFE_COUNTER: CafeRect = Object.freeze({ x0: -5.24, x1: -0.16, z0: -2.42, z1: -1.7 });
export const CAFE_BACK_BAR: CafeRect = Object.freeze({ x0: -5.63, x1: 0.83, z0: -4.1, z1: -3.46 });
/** The open shelf unit right of the kitchen door. */
export const CAFE_SHELF_UNIT = Object.freeze({ x0: 5.45, x1: 6.7, z0: -4.1, z1: -3.8, height: 2.3 });
/** The banquette along the left wall (Kelsch-check seat and back, an oak base): depth 0.55 m from the wall. */
export const CAFE_BANQUETTE = Object.freeze({ x0: -6.8, x1: -6.25, z0: 0.25, z1: 2.95, depth: 0.55 });
/** The counter stools (facing the counter, backless, sat on from either side). */
export const CAFE_STOOLS: readonly { x: number; z: number }[] = Object.freeze([-4.5, -3.3, -2.1].map((x) => ({ x, z: -0.9 })));
/** The stool's seat height (m) and radius. */
export const CAFE_STOOL = Object.freeze({ seatTop: 0.62, radius: 0.19 });
/** The potted figs and the palm: [x, z, radius, height]. */
export const CAFE_PLANTS: readonly (readonly [number, number, number, number])[] = Object.freeze([
  [-6.15, 3.3, 0.28, 2.3],
  [6.3, 3.25, 0.25, 1.9],
  [1.8, 3.15, 0.25, 1.9],
  [-6.3, -1.2, 0.25, 1.9],
]);

/** A chair's centre and the way it faces (local), for table `t`. */
export function cafeTableChairs(t: CafeTableSpot): { x: number; z: number; face: "px" | "nx" | "pz" | "nz" }[] {
  return t.chairs.map((a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    // faces the table: opposite to where it stands (axis-aligned: the angles are 0, +-pi/2, pi)
    const face = Math.abs(c) > 0.5 ? (c > 0 ? "nx" : "px") : s > 0 ? "nz" : "pz";
    return { x: t.x + c * CAFE_CHAIR_DIST, z: t.z + s * CAFE_CHAIR_DIST, face };
  });
}

// ─────────────────────────────── the interior spec ───────────────────────────────

const R4 = (v: number) => Math.round(v * 1e4) / 1e4;
const solid = (name: string, r: CafeRect, height: number) => ({ name, rect: cafeRectToRoom(r), height });
const box = (x: number, z: number, h: number): CafeRect => ({ x0: x - h, x1: x + h, z0: z - h, z1: z + h });

/** A local facing as a room-frame one: the half turn flips each direction. */
const FACE: Readonly<Record<"px" | "nx" | "pz" | "nz", LotInteriorSeat["faces"]>> = { px: "left", nx: "right", pz: "out", nz: "in" };

let tableNo = 0;
const tableSolids = CAFE_ALL_TABLES.map((t) => solid(`table_${++tableNo}`, box(t.x, t.z, TABLE_BOX), 0.78));
let plantNo = 0;
const plantSolids = CAFE_PLANTS.map(([x, z, r, h]) => solid(`plant_${++plantNo}`, box(x, z, r), h));

/** The chairs round every table (they are sat on facing the table; stood up from beside, as a terrace chair is). */
const chairSeats: LotInteriorSeat[] = CAFE_ALL_TABLES.flatMap((t) => cafeTableChairs(t)).map((c, i) => {
  const p = cafeToRoom(c.x, c.z);
  return { id: `lot_cafe_chair_${i + 1}`, x: R4(p.x), z: R4(p.z), faces: FACE[c.face], kind: "backed", seatTop: 0.46, length: 0.42, frontEdge: 0.21, backDepth: 0.26, places: 1, tableFront: true };
});

const stoolSeats: LotInteriorSeat[] = CAFE_STOOLS.map((s, i) => {
  const p = cafeToRoom(s.x, s.z);
  // backless, a round stool: sat on from either side (the counter side and the room side)
  return { id: `lot_cafe_stool_${i + 1}`, x: R4(p.x), z: R4(p.z), faces: FACE.nz, kind: "backless", seatTop: CAFE_STOOL.seatTop, length: 0.38, frontEdge: 0.19, backDepth: 0.19, places: 1, both: true };
});

/** The Kelsch banquette: three places on one long backed seat, sat on and stood up from in front (the room side), never from the wall. */
const BQ = CAFE_BANQUETTE;
const bq = cafeToRoom(BQ.x0 + 0.275, (BQ.z0 + BQ.z1) / 2);
const banquetteSeat: LotInteriorSeat = { id: "lot_cafe_banquette", x: R4(bq.x), z: R4(bq.z), faces: FACE.px, kind: "backed", seatTop: 0.46, length: R4(BQ.z1 - BQ.z0), frontEdge: 0.275, backDepth: 0.275, places: 3 }; // (the sitter's back plane is 0.225 m behind the seat's middle: the back panel is 3 cm thick against the wall, cafeBuild.ts, so the cloth stops short of it)

/** 케이슨 카페 안: the oak room with the counter and the back bar, tables and bentwood chairs, counter stools, a Kelsch banquette. */
export const CAFE_IN: LotInteriorSpec = {
  unit: "lot_cafe_room",
  lot: "lot_cafe",
  doorX: R4(cafeToRoom(0, 0).x),
  doorWidth: 2.4,
  solids: [
    solid("counter", CAFE_COUNTER, 1.07),
    solid("back_bar", CAFE_BACK_BAR, 2.5),
    solid("shelf_unit", { x0: CAFE_SHELF_UNIT.x0, x1: CAFE_SHELF_UNIT.x1, z0: CAFE_SHELF_UNIT.z0, z1: CAFE_SHELF_UNIT.z1 }, CAFE_SHELF_UNIT.height),
    solid("seatfurn_banquette", { x0: BQ.x0, x1: BQ.x1, z0: BQ.z0, z1: BQ.z1 }, 0.88),
    ...tableSolids,
    ...plantSolids,
  ],
  seats: [...chairSeats, ...stoolSeats, banquetteSeat],
  budget: { pc: { triangles: 90_000, textureMB: 40, draws: 20 }, phone: { triangles: 40_000, textureMB: 14, draws: 16 } },
  program: ["참나무 바닥·회벽·징두리 판벽", "노출 참나무 들보·펜던트 등", "카운터(에스프레소 머신·케이크)와 뒤 선반", "원형 비스트로 테이블·벤트우드 의자 10(앉기)", "카운터 스툴 3(앉기)", "켈쉬 체크 벤치 3자리(앉기)", "창밖은 실제 마을(낮·저녁·밤)", "칠판 메뉴·액자·화분"],
};
