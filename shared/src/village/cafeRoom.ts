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
/** The salon upstairs (2026-11-21): emoji go through there too, as in the café below. */
export const CAFE_UP_AREA = "lot:lot_cafe_upstairs";

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

/**
 * The two tables on the stair's side of the room (the bake's two by the left window until 2026-11-21; owner "2층까지 만들어서 계단도
 * 만들어": the staircase took their corner, so they stand one behind the other between the stair and the door, room x 4.0).
 */
export const CAFE_BAKED_TABLES: readonly CafeTableSpot[] = Object.freeze([
  { x: 2.8, z: 0.7, chairs: [-PI / 2, PI / 2], lamp: "dome" },
  { x: 2.8, z: -1.7, chairs: [-PI / 2, PI / 2], lamp: "globe" },
]);

/** Every table of the room (the new ones, then the bake's two). */
export const CAFE_ALL_TABLES: readonly CafeTableSpot[] = Object.freeze([...CAFE_TABLES, ...CAFE_BAKED_TABLES]);

/** The counter (white panelled, oak top 1.07 m) and the back bar under the shelves, as the bake has them. */
export const CAFE_COUNTER: CafeRect = Object.freeze({ x0: -5.24, x1: -0.16, z0: -2.42, z1: -1.7 });
export const CAFE_BACK_BAR: CafeRect = Object.freeze({ x0: -5.63, x1: 0.83, z0: -4.1, z1: -3.46 });
/**
 * The staircase to the upstairs salon (owner 2026-11-21: "2층까지 있는데 왜 계단이 없어? 2층까지 만들어서 계단도 만들어"), ROOM frame: a
 * half-turn (U) oak stair in the back corner by the kitchen wall — flight A up along the side wall (x 0.05..1.15, from z 3.9 to the landing),
 * the landing across the back (z 6.6..7.75), flight B back toward the front (x 1.25..2.35) to the upstairs floor at z 3.9. 20 risers of
 * 0.23 m (the 4.6 m storey), treads 0.3 m. It is used as a house's stair is (its pad and the 2층 button; a tap on it walks there).
 */
export const CAFE_STAIR = Object.freeze({
  rect: Object.freeze({ x0: 0, x1: 2.45, z0: 3.85, z1: 7.8 }),
  flightA: Object.freeze({ x0: 0.05, x1: 1.15 }),
  flightB: Object.freeze({ x0: 1.25, x1: 2.35 }),
  foot: 3.9,
  landing: 6.6,
  risers: 20,
  riser: 0.23,
  tread: 0.3,
  storey: 4.6,
});
/** The upstairs salon's floor is this far above the café's (m). */
export const CAFE_STOREY = 4.6;
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
    { name: "stair", rect: { ...CAFE_STAIR.rect }, height: 4.3 },
    solid("seatfurn_banquette", { x0: BQ.x0, x1: BQ.x1, z0: BQ.z0, z1: BQ.z1 }, 0.88),
    ...tableSolids,
    ...plantSolids,
  ],
  seats: [...chairSeats, ...stoolSeats, banquetteSeat],
  stair: { pad: { x: 0.6, z: 3.3, radius: 0.5 }, faces: "in", to: "lot_cafe_upstairs", arrival: { x: 0.65, z: 2.6, faces: "right" } },
  budget: { pc: { triangles: 120_000, textureMB: 48, draws: 40 }, phone: { triangles: 48_000, textureMB: 14, draws: 30 } },
  program: ["참나무 바닥·회벽·징두리 판벽", "노출 참나무 들보·펜던트 등", "카운터(에스프레소 머신·그라인더·유리 진열장의 크루아상·타르트·케이크)와 뒤 선반", "대리석 비스트로 테이블·벤트우드 의자 10(앉기)", "카운터 스툴 3(앉기)", "켈쉬 체크 벤치 3자리(앉기)", "2층으로 가는 참나무 계단(올라가기)", "창밖은 실제 마을(낮·저녁·밤)", "칠판 메뉴·법랑 간판·액자·화분"],
};

// ─────────────────────────────── upstairs: the salon (ROOM frame) ───────────────────────────────

/**
 * 케이슨 카페 2층: a pâtisserie salon over the whole upper floor (owner 2026-11-21: "2층까지 만들어서 계단도 만들어"), its four front
 * windows the facade's four upper ones, four on each side, four at the back. Room frame as the café's (the same half turn: the front wall
 * on z = 0, room x = 6.8 - local x, room z = 3.7 - local z), 13.6 x 13.0 (local z 3.7..-9.3), 3.5 m to the ceiling. Reached by the stair
 * only: no way out (its "door" fields name the stairwell's top).
 */
export const CAFE_UP_SIZE = Object.freeze({ x: 13.6, z: 13.0 });
export const CAFE_UP_CEIL = 3.5;
/** The upstairs tables (room frame): round marble, `chairs` where a chair stands (angle from +x toward +z, as the café's). */
export const CAFE_UP_TABLES: readonly { x: number; z: number; chairs: readonly number[] }[] = Object.freeze([
  { x: 4.6, z: 1.35, chairs: [0, PI] }, // by the front windows: a chair either side along the wall
  { x: 8.6, z: 1.35, chairs: [0, PI] },
  { x: 6.4, z: 5.0, chairs: [-PI / 2, PI / 2] },
  { x: 8.8, z: 7.6, chairs: [-PI / 2, PI / 2] },
  { x: 5.6, z: 9.4, chairs: [-PI / 2, PI / 2] },
  { x: 11.55, z: 3.9, chairs: [PI] }, // the sofa's two tables: a chair on the room side, the sofa on the wall side
  { x: 11.55, z: 6.0, chairs: [PI] },
]);
/** The velvet sofa along the right wall (room x 13.0..13.6), facing into the room (-x): three places. */
export const CAFE_UP_SOFA = Object.freeze({ x0: 13.0, x1: 13.6, z0: 3.0, z1: 6.9 });
/** Two wing armchairs against the back wall with a low table between them, facing into the room (sat on and stood up from in front). */
export const CAFE_UP_ARMCHAIRS: readonly { x: number; z: number; faces: LotInteriorSeat["faces"] }[] = Object.freeze([
  { x: 10.0, z: 11.4, faces: "out" },
  { x: 11.6, z: 11.4, faces: "out" },
]);
const UP_TABLE_BOX = 0.35;

const upChairSeats: LotInteriorSeat[] = CAFE_UP_TABLES.flatMap((t) =>
  t.chairs.map((a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    // (room frame, x right / z in: a chair at angle a from the table faces back toward it)
    const faces: LotInteriorSeat["faces"] = Math.abs(c) > 0.5 ? (c > 0 ? "left" : "right") : s > 0 ? "out" : "in";
    return { x: R4(t.x + c * CAFE_CHAIR_DIST), z: R4(t.z + s * CAFE_CHAIR_DIST), faces };
  }),
).map((c, i): LotInteriorSeat => ({ id: `lot_cafe_up_chair_${i + 1}`, x: c.x, z: c.z, faces: c.faces, kind: "backed", seatTop: 0.46, length: 0.42, frontEdge: 0.21, backDepth: 0.26, places: 1, tableFront: true }));
const SO = CAFE_UP_SOFA;
const upSofa: LotInteriorSeat = { id: "lot_cafe_up_sofa", x: R4((SO.x0 + SO.x1) / 2), z: R4((SO.z0 + SO.z1) / 2), faces: "left", kind: "backed", seatTop: 0.45, length: R4(SO.z1 - SO.z0), frontEdge: 0.3, backDepth: 0.3, places: 3 };
const upArm: LotInteriorSeat[] = CAFE_UP_ARMCHAIRS.map((a, i): LotInteriorSeat => ({ id: `lot_cafe_up_armchair_${i + 1}`, x: a.x, z: a.z, faces: a.faces, kind: "backed", seatTop: 0.44, length: 0.78, frontEdge: 0.3, backDepth: 0.42, places: 1 }));

/** 케이슨 카페 2층 살롱: windows on four sides, marble tables, a velvet sofa, wing chairs, the pâtisserie sideboard, the stairwell. */
export const CAFE_UP: LotInteriorSpec = {
  unit: "lot_cafe_upstairs",
  lot: "lot_cafe",
  doorX: 1.8,
  doorWidth: 1.1,
  noExit: true,
  solids: [
    { name: "stairwell", rect: { ...CAFE_STAIR.rect }, height: 1.0 },
    { name: "sideboard", rect: { x0: 4.2, x1: 8.4, z0: 12.45, z1: 13.0 }, height: 1.0 },
    { name: "bookcase", rect: { x0: 0.0, x1: 0.42, z0: 9.6, z1: 12.4 }, height: 2.4 },
    { name: "lowtable", rect: { x0: 10.45, x1: 11.15, z0: 11.15, z1: 11.65 }, height: 0.48 },
    { name: "seatfurn_sofa", rect: { x0: SO.x0, x1: SO.x1, z0: SO.z0, z1: SO.z1 }, height: 0.85 },
    ...CAFE_UP_TABLES.map((t, i) => ({ name: `uptable_${i + 1}`, rect: { x0: R4(t.x - UP_TABLE_BOX), x1: R4(t.x + UP_TABLE_BOX), z0: R4(t.z - UP_TABLE_BOX), z1: R4(t.z + UP_TABLE_BOX) }, height: 0.78 })),
    { name: "plant_up_1", rect: { x0: 0.15, x1: 0.75, z0: 0.15, z1: 0.75 }, height: 1.9 },
    { name: "plant_up_2", rect: { x0: 12.95, x1: 13.45, z0: 0.15, z1: 0.65 }, height: 1.9 },
    { name: "plant_up_3", rect: { x0: 12.95, x1: 13.45, z0: 12.35, z1: 12.85 }, height: 2.1 },
  ],
  seats: [...upChairSeats, upSofa, ...upArm],
  stair: { pad: { x: 1.8, z: 3.35, radius: 0.5 }, faces: "in", to: "lot_cafe_room", arrival: { x: 1.8, z: 2.65, faces: "right" } },
  budget: { pc: { triangles: 110_000, textureMB: 48, draws: 40 }, phone: { triangles: 45_000, textureMB: 14, draws: 30 } },
  program: ["2층 살롱: 사방의 창(앞 4·옆 4+4·뒤 4), 리넨 커튼", "계단참과 난간(1층으로 내려가기)", "대리석 원형 테이블 7·벤트우드 의자(앉기)", "벨벳 소파 3자리(앉기)", "윙체어 2와 낮은 탁자(앉기)", "케이크 돔을 올린 사이드보드", "책장·액자·거울·화분", "황동 샹들리에·벽등"],
};
