/**
 * 마을 부지 건물 약속 v2 (village lots contract, docs/designs/village-lots-v2/design.md + contract.md): the five empty plots get
 * the buildings their original name boards promised, as a brand-new European storybook village (owner 2026-11-17: "유럽의
 * 시골마을인데 모든게 새것인 것처럼 … 원래대로 도서관, 학교 등 건물을 지어", "원래대로 다 지어"); the 케이슨랜드 gate on the south
 * bank stays as built (owner: "그대로 둬", feat/lot-mart-gate 75ab7df — its entry here is unchanged).
 *
 * v1 (feat/lots-design 4892567: market, shops, hall, post office, mart) was cancelled by the owner; none of its programs remain.
 *  - plot_e  → lot_school   케이슨 마을 학교: schoolhouse with a bell cupola and a clock, a fenced schoolyard with a playground;
 *  - plot_ne → lot_chapel   케이슨 마을 성당: a small stone chapel, spire, rose window, arched doors, two little gardens;
 *  - plot_w  → lot_library  케이슨 마을 도서관: arched reading-room windows, two bay-window reading nooks, a pergola reading garden
 *                           (replaces the old construction site: scaffold, crane, col__construction);
 *  - plot_nw → lot_temple   마을 절: a small brand-new 한옥 temple inside a 돌담 garden (일주문, 대웅전, 석등, 석탑, 범종각, 연못, 소나무);
 *  - plot_s  → lot_church   케이슨 마을 교회: a white clapboard country church with a tall steeple and a columned porch;
 *  - south bank → lot_gate  케이슨랜드 정문 (unchanged from 75ab7df; a brand-new polish pass only).
 *
 * Numbers first, in each lot's LOCAL frame — the same frame as the houses (vlib.py loc()): origin at the footprint's centre,
 * local x = the right hand of someone walking in through the main door, local z = out of the door, so the front edge is local
 * z = +depth/2. World = `lotLocalToWorld`. Walking stays on y = 0 everywhere (no lifts): steps and plinths are inside the body
 * box, the door pad stands on the paving in front.
 *
 * Browser-safe, values only from this file; types only from the layout. The L5 wiring modules (feat/lots-wiring 0fbbbaa:
 * lotsLoader, lotsPrep, pickLotLevels, lotGeometryColliders, lotVillageSeats, LotsVillagePatch) read only the exports kept here.
 */


import type { AABB, CameraBox } from "../collision";
import type { PlotId, Point2, Side } from "./villageLayout";

/** v2 ids (2026-11-17). v1's market/shops/hall/post/mart ids were never released (cancelled), so they are not kept. */
export type LotId = "lot_school" | "lot_chapel" | "lot_library" | "lot_temple" | "lot_church" | "lot_gate";


/** What a lot holds (design 2). */
export type LotKind = "school" | "chapel" | "library" | "temple" | "church" | "park_gate";

/** A rectangle in a lot's local frame (m): x0 < x1, z0 < z1. */
export interface LotRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * When a part opens to players (design 4): 1 = phase 1 (every exterior, yards and gardens, the seats, what is visible through the
 * windows — the library's reading nooks), 2 = the walk-in interiors (library → school → chapel → church → temple hall), 3 = unused
 * in v2 (kept for the type), 4 = with 케이슨랜드 (B11).
 */
export type LotPhase = 1 | 2 | 3 | 4;

/** How a player gets in: walk in under the roof on the village plane (the market), or a door that loads an interior area. */
export type LotEntry = "walk_in" | "door" | "closed";

/** A door in the front (or a side) wall, by its centre along the wall (local x for the front wall). */
export interface LotDoor {
  id: string;
  /** "front" = the door-side wall (local z = body front); "left"/"right" = the end walls (local x = body x0 / x1). */
  wall: "front" | "left" | "right";
  /** The door's centre along its wall: local x on the front wall, local z on an end wall. */
  at: number;
  width: number;
  height: number;
  /** "auto" = a sliding automatic door (autoDoor.ts PUBLIC_AUTO_DOOR), "swing" = a glass push door, "open" = no leaf (a gap). */
  leaf: "auto" | "swing" | "open";
  entry: LotEntry;
  /** Phase from which using it does something (before that it is shut, with a small "준비 중" plate). */
  phase: LotPhase;
  /** What the door pad says before `phase` (default "준비 중"); the religious buildings say "조용히 둘러보세요" (design 3). */
  closedNote?: string;
}

/** A room of a lot (교실, 열람실, 성당 안, 대웅전, 예배당): its slice of the front, its sign and its walk-in interior (phase 2). */
export interface LotUnit {
  id: string;
  /** Korean name of the trade (generic words only, no brand). */
  name: string;
  /** The words on its fascia sign (generic Korean only). */
  sign: string;
  /** Its slice of the front, local x. */
  x0: number;
  x1: number;
  door: string;
  /** Interior area id (`lot:<unit id>`) and its reserved origin, far from the village (x >= 400, like the hall at 300). */
  interior: { area: string; origin: Point2; size: { x: number; z: number }; ceiling: number; phase: LotPhase };
}

/** A solid box of a lot: `col__<id>` in the model, a camera box when `cameraHeight` is set. */
export interface LotColliderSpec {
  /** Suffix after the lot id: the collider id is `<lot id>` for "" (the body) or `<lot id>_<suffix>`. */
  suffix: string;
  rect: LotRect;
  /** Height of its camera box (m), or 0 when the camera looks over it (counters, benches, fences). */
  cameraHeight: number;
}

/**
 * A seat of a lot (phase 1, owner rule P6: every seat can be sat on; backless from either side, backed only from the front).
 * Local: the seat's centre (middle of the seat board), the way a sitter faces (local "out" = +z), seat top and length.
 */
export interface LotSeatSpec {
  /** Seat id, stable forever: `<lot id>_<name>`. */
  id: string;
  lx: number;
  lz: number;
  /** The way the sitter faces, in local terms: "out" = +z (away from the building), "in" = -z, "left" = -x, "right" = +x. */
  faces: "out" | "in" | "left" | "right";
  kind: "backless" | "backed";
  seatTop: number;
  length: number;
  /** Distance from the centre to the seat's front edge along the facing (m). */
  frontEdge: number;
  places: number;
  /** "front": sat on from in front of its front edge (benches, 평상); "side": a chair at a table, stepped into from beside it. */
  approach: "front" | "side";
}

/** What an interaction slot is for. The v1 kinds stay in the type only so the L5 wiring compiles; owner 2026-11-17 "그런거 없다": no money, so the v2 lots never use sell/price/shop/ATM/desk/ticket kinds (tested). */
export type LotSlotKind =
  | "sell_counter"
  | "price_board"
  | "scale"
  | "shop_rack"
  | "checkout"
  | "fitting_room"
  | "mirror"
  | "shop_window"
  | "nameplate"
  | "notice_board"
  | "house_desk"
  | "parcel_counter"
  | "atm"
  | "postbox"
  | "ticket_booth"
  | "turnstile"
  | "gate_sign"
  // v2 (2026-11-17), appended:
  | "playground"
  | "bell"
  | "clock"
  | "garden"
  | "reading_nook"
  | "book_return"
  | "lantern"
  | "pond";

/**
 * An interaction slot: an empty (`slot__<lot id>_<name>`, no parent, world position and yaw) the game finds by name. `tags`:
 * holders on it (`slot__<lot id>_<name>_tag_<n>`, n = 1..tags, left to right as you face it): v1 only, always 0 in v2 (no prices).
 */
export interface LotSlotSpec {
  name: string;
  kind: LotSlotKind;
  lx: number;
  lz: number;
  /** Height of the slot's centre above the floor (m). */
  y: number;
  /** The way the slot's face looks (local), as for seats. */
  faces: "out" | "in" | "left" | "right";
  /** Interior slots live in the unit's interior area, in the unit's own frame (design 3); exterior ones in the lot's frame. */
  where: "exterior" | `interior:${string}`;
  width: number;
  height: number;
  tags: number;
  phase: LotPhase;
}

export interface VillageLot {
  id: LotId;
  /** The plot it fills (null: the gateway, which is not one of the six plots). */
  plot: PlotId | null;
  kind: LotKind;
  /** Korean name. */
  name: string;
  /** The main sign's words (generic Korean only, no brand, no real business name). */
  sign: string;
  storeys: number;
  /** Storey height (floor to floor, m); chibi scale like the houses (4.0) and the café. */
  storeyHeight: number;
  /** Top of the highest solid part (ridge / parapet), m. */
  height: number;
  doorSide: Side;
  /** Footprint centre and world size (x by z): front (local x) by depth (local z) turned to the door side. */
  centre: Point2;
  front: number;
  depth: number;
  /** The body as a solid box (outer wall faces + plinth, steps), local. */
  body: LotRect;
  /** The walkable paved apron in front of the body, local z from body front to the footprint's front edge. */
  apron: number;
  entry: LotEntry;
  doors: readonly LotDoor[];
  units: readonly LotUnit[];
  colliders: readonly LotColliderSpec[];
  seats: readonly LotSeatSpec[];
  slots: readonly LotSlotSpec[];
  /** Where the walk from the lane meets the lot: the point on the footprint's front edge on the main door's line (world). */
  approach: Point2;
  /** The phase the exterior is built in (always 1) and the phase of its first interior. */
  phase: { exterior: 1; interior: LotPhase };
  /** Detail priority among the lots' interiors (1 = first). */
  priority: number;
}

const R2 = (v: number): number => Math.round(v * 100) / 100;
const R6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const rect = (x0: number, x1: number, z0: number, z1: number): LotRect => ({ x0, x1, z0, z1 });

/** Game yaw of each door side (the local +z direction), as houseExterior.ts DOOR_YAW. */
export const LOT_DOOR_YAW: Readonly<Record<Side, number>> = Object.freeze({ s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 });

type LotFrame = Pick<VillageLot, "centre" | "doorSide">;

/** A local point as a world point: vlib.py loc(), the same frame as the houses (x = cx + lx cos + lz sin, z = cz - lx sin + lz cos). */
export function lotLocalToWorld(l: LotFrame, lx: number, lz: number): { x: number; z: number } {
  const { x: cx, z: cz } = l.centre;
  switch (l.doorSide) {
    case "s": return { x: R2(cx + lx), z: R2(cz + lz) };
    case "n": return { x: R2(cx - lx), z: R2(cz - lz) };
    case "e": return { x: R2(cx + lz), z: R2(cz - lx) };
    case "w": return { x: R2(cx - lz), z: R2(cz + lx) };
  }
}

/** A world point in a lot's local frame (the inverse, unrounded). */
export function lotWorldToLocal(l: LotFrame, x: number, z: number): { lx: number; lz: number } {
  const dx = x - l.centre.x;
  const dz = z - l.centre.z;
  switch (l.doorSide) {
    case "s": return { lx: dx, lz: dz };
    case "n": return { lx: -dx, lz: -dz };
    case "e": return { lx: -dz, lz: dx };
    case "w": return { lx: dz, lz: -dx };
  }
}

/** A local rectangle as a world box (to the centimetre, like the model's col__ boxes). */
export function lotBox(l: LotFrame, r: LotRect): AABB {
  const a = lotLocalToWorld(l, r.x0, r.z0);
  const b = lotLocalToWorld(l, r.x1, r.z1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

/** Game yaw of a local facing. */
export function lotYaw(l: Pick<VillageLot, "doorSide">, faces: LotSeatSpec["faces"]): number {
  const base = LOT_DOOR_YAW[l.doorSide];
  const turn = { out: 0, in: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[faces];
  let y = base + turn;
  while (y > Math.PI + 1e-9) y -= Math.PI * 2;
  while (y <= -Math.PI + 1e-9) y += Math.PI * 2;
  return R6(y);
}

/** The compass side a local facing points to. */
export function lotFacingSide(l: Pick<VillageLot, "doorSide">, faces: LotSeatSpec["faces"]): Side {
  const order: Side[] = ["n", "e", "s", "w"]; // clockwise
  const i = order.indexOf(l.doorSide);
  const step = { out: 0, right: 1, in: 2, left: 3 }[faces];
  // local +x is the right hand of someone walking IN (facing -out): turning from "out" to the right hand of an inward walker is anticlockwise
  return order[(i + 4 - step) % 4]!;
}

/** The lot's whole footprint in the world (the plot's building zone; the apron is walkable). */
export function lotFootprint(l: Pick<VillageLot, "centre" | "doorSide" | "front" | "depth">): AABB {
  return lotBox(l, rect(-l.front / 2, l.front / 2, -l.depth / 2, l.depth / 2));
}

function interior(unitId: string, origin: Point2, size: { x: number; z: number }, ceiling: number, phase: LotPhase): LotUnit["interior"] {
  return { area: `lot:${unitId}`, origin, size, ceiling, phase };
}

const door = (id: string, at: number, width: number, leaf: LotDoor["leaf"], entry: LotEntry, phase: LotPhase, wall: LotDoor["wall"] = "front", height = 2.9): LotDoor =>
  ({ id, wall, at, width, height, leaf, entry, phase });

const seat = (id: string, lx: number, lz: number, faces: LotSeatSpec["faces"], kind: LotSeatSpec["kind"], length: number, places = 2, seatTop = 0.45, frontEdge = 0.22, approach: LotSeatSpec["approach"] = "front"): LotSeatSpec =>
  ({ id, lx, lz, faces, kind, seatTop, length, frontEdge, places, approach });

const slot = (name: string, kind: LotSlotKind, lx: number, lz: number, y: number, faces: LotSlotSpec["faces"], width: number, height: number, phase: LotPhase, where: LotSlotSpec["where"] = "exterior", tags = 0): LotSlotSpec =>
  ({ name, kind, lx, lz, y, faces, where, width, height, tags, phase });

// ─────────────────────────────── the six lots (design 3) ───────────────────────────────

/**
 * 케이슨 마을 학교: a two-storey village schoolhouse (Alpine / English village school), pastel render over a stone plinth, steep
 * clay-tile roof, a white timber bell cupola with a real bronze bell on the ridge and a round clock in the front gable, a gabled
 * entrance porch on two posts. The schoolyard in front (12 m deep) is fenced with a white picket fence and open to the lane:
 * swings, a climbing frame with a slide, a seesaw, a sandbox, the school notice board. Plot_e, facing west to the lane.
 */
const SCHOOL: VillageLot = {
  id: "lot_school",
  plot: "plot_e",
  kind: "school",
  name: "케이슨 마을 학교",
  sign: "케이슨 마을 학교",
  storeys: 2,
  storeyHeight: 4,
  // eaves 8.4, ridge 12.2, the cupola's weathervane 16.5
  height: 16.5,
  doorSide: "w",
  centre: { x: 58.5, z: 15 },
  front: 22,
  depth: 20,
  body: rect(-8, 8, -10, -2),
  apron: 12,
  entry: "door",
  doors: [door("lot_school_main", 0, 2.2, "swing", "door", 2, "front", 3.2)],
  units: [
    {
      id: "lot_school_class", name: "교실", sign: "교실", x0: -8, x1: 8, door: "lot_school_main",
      interior: interior("lot_school_class", { x: 410, z: 0 }, { x: 15.4, z: 7.4 }, 3.7, 2),
    },
  ],
  colliders: [
    { suffix: "", rect: rect(-8, 8, -10, -2), cameraHeight: 12.2 },
    { suffix: "porch_post_1", rect: rect(-1.75, -1.45, -0.75, -0.45), cameraHeight: 3.6 }, // gabled entrance porch
    { suffix: "porch_post_2", rect: rect(1.45, 1.75, -0.75, -0.45), cameraHeight: 3.6 },
    { suffix: "bench_1", rect: rect(-5.9, -4.1, -1.975, -1.425), cameraHeight: 0 }, // backed benches against the front wall
    { suffix: "bench_2", rect: rect(4.1, 5.9, -1.975, -1.425), cameraHeight: 0 },
    { suffix: "swings", rect: rect(-10.4, -6, 2, 4.4), cameraHeight: 0 }, // two-seat swing frame (2.6 m)
    { suffix: "climber", rect: rect(-10.4, -7, 6.4, 9.2), cameraHeight: 0 }, // climbing frame + slide
    { suffix: "seesaw", rect: rect(6.4, 9.8, 2.6, 3.2), cameraHeight: 0 },
    { suffix: "notice", rect: rect(-4.6, -3, 9.2, 9.5), cameraHeight: 0 }, // the school notice board by the gate
    { suffix: "fence_n", rect: rect(-11, -10.88, -1.5, 10), cameraHeight: 0 }, // white picket fence round the yard
    { suffix: "fence_s", rect: rect(10.88, 11, -1.5, 10), cameraHeight: 0 },
    { suffix: "fence_fl", rect: rect(-11, -2.6, 9.88, 10), cameraHeight: 0 }, // the front fence, a 5.2 m gate opening on the lane
    { suffix: "fence_fr", rect: rect(2.6, 11, 9.88, 10), cameraHeight: 0 },
    // B1 (2026-11-17), appended: two young lime trees in the yard (trunk boxes; their crowns are high and inside the footprint)
    { suffix: "tree_1", rect: rect(9.4, 9.8, 6.4, 6.8), cameraHeight: 0 },
    { suffix: "tree_2", rect: rect(-5.8, -5.4, 8.4, 8.8), cameraHeight: 0 },
  ],
  seats: [
    seat("lot_school_bench_1", -5, -1.725, "out", "backed", 1.8),
    seat("lot_school_bench_2", 5, -1.725, "out", "backed", 1.8),
  ],
  slots: [
    slot("clock", "clock", 0, -2.05, 9.2, "out", 1.3, 1.3, 1), // shows the village clock's time
    slot("bell", "bell", 0, -6, 13.4, "out", 0.8, 0.8, 1), // rings on the hour (sound, phase 1 optional)
    slot("notice", "notice_board", -3.8, 9.35, 1.3, "out", 1.6, 1.0, 1),
    slot("swing_1", "playground", -8.9, 3.2, 0.45, "right", 0.5, 0.3, 2),
    slot("swing_2", "playground", -7.5, 3.2, 0.45, "right", 0.5, 0.3, 2),
    slot("slide", "playground", -8.7, 7.8, 0.3, "right", 0.6, 0.6, 2),
    slot("seesaw", "playground", 8.1, 2.9, 0.5, "in", 3.4, 0.4, 2),
    slot("nameplate", "nameplate", 0, -0.45, 3.9, "out", 2.2, 0.5, 1), // the porch's carved name board
  ],
  approach: { x: 48.5, z: 15 },
  phase: { exterior: 1, interior: 2 },
  priority: 2,
};

/**
 * 케이슨 마을 성당: a small stone chapel (Breton / Alsatian village chapel), honey limestone ashlar with buttresses, dark slate roof,
 * a stone spire over the west gable, a rose window above round-arched double oak doors, a half-round apse at the back, a little
 * fountain garden on the south side and a rose-arbour garden on the north. No diocese name, no saint's name, no scripture.
 * Plot_ne, facing west to the lane.
 */
const CHAPEL: VillageLot = {
  id: "lot_chapel",
  plot: "plot_ne",
  kind: "chapel",
  name: "케이슨 마을 성당",
  sign: "케이슨 마을 성당",
  storeys: 1,
  storeyHeight: 7.5,
  // nave eaves 7.5, ridge 12, the spire's cross 21
  height: 21,
  doorSide: "w",
  centre: { x: 48.5, z: -37 },
  front: 24,
  depth: 17,
  body: rect(-5, 5, -5.5, 5.5),
  apron: 3,
  entry: "door",
  doors: [{ ...door("lot_chapel_main", 0, 2.4, "swing", "door", 2, "front", 3.6), closedNote: "조용히 둘러보세요" }],
  units: [
    {
      id: "lot_chapel_nave", name: "성당 안", sign: "케이슨 마을 성당", x0: -5, x1: 5, door: "lot_chapel_main",
      interior: interior("lot_chapel_nave", { x: 440, z: 0 }, { x: 9.4, z: 13.4 }, 9, 2),
    },
  ],
  colliders: [
    { suffix: "", rect: rect(-5, 5, -5.5, 5.5), cameraHeight: 12 }, // nave with its buttresses
    { suffix: "apse", rect: rect(-3.2, 3.2, -8.2, -5.5), cameraHeight: 8 },
    { suffix: "fountain", rect: rect(7, 9.4, -2.4, 0), cameraHeight: 0 }, // south garden: stone basin fountain
    { suffix: "bench_1", rect: rect(7.3, 9.1, -4.25, -3.7), cameraHeight: 0 },
    { suffix: "bench_2", rect: rect(-9.1, -7.3, -4.25, -3.7), cameraHeight: 0 },
    { suffix: "arbor_1", rect: rect(-9.75, -9.45, -1.2, -0.9), cameraHeight: 0 }, // north garden: rose arbour posts
    { suffix: "arbor_2", rect: rect(-6.95, -6.65, -1.2, -0.9), cameraHeight: 0 },
    { suffix: "lamp_1", rect: rect(-2.95, -2.65, 7.2, 7.5), cameraHeight: 0 }, // lantern posts at the forecourt
    { suffix: "lamp_2", rect: rect(2.65, 2.95, 7.2, 7.5), cameraHeight: 0 },
  ],
  seats: [
    seat("lot_chapel_bench_1", 8.2, -3.975, "out", "backed", 1.8),
    seat("lot_chapel_bench_2", -8.2, -3.975, "out", "backed", 1.8),
  ],
  slots: [
    slot("bell", "bell", 0, 4.4, 15.5, "out", 0.9, 0.9, 1),
    slot("fountain", "garden", 8.2, -1.2, 0.8, "out", 2.4, 1.0, 1),
    slot("notice", "notice_board", -3.6, 5.56, 1.6, "out", 1.0, 1.2, 1), // glazed case on the facade
    slot("nameplate", "nameplate", 3.6, 5.56, 2.0, "out", 1.0, 0.4, 1),
  ],
  approach: { x: 40, z: -37 },
  phase: { exterior: 1, interior: 2 },
  priority: 4,
};

/**
 * 케이슨 마을 도서관: a cosy single-storey reading hall (small Carnegie / English village library), warm red brick with limestone
 * dressings, three tall round-arched windows, a slate roof with a small lantern cupola, a pedimented entrance with double oak
 * doors, two bay windows with cushioned window seats (the reading nooks, visible inside from phase 1), a pergola reading garden on
 * the north side. Plot_w (the old construction site), facing east to the lane.
 */
const LIBRARY: VillageLot = {
  id: "lot_library",
  plot: "plot_w",
  kind: "library",
  name: "케이슨 마을 도서관",
  sign: "케이슨 마을 도서관",
  storeys: 1,
  storeyHeight: 5.6,
  // eaves 5.6, ridge 9.6, the lantern cupola 11.5
  height: 11.5,
  doorSide: "e",
  centre: { x: -56.5, z: 12 },
  front: 20,
  depth: 15,
  body: rect(-10, 4, -7.5, 3.5),
  apron: 4,
  entry: "door",
  doors: [door("lot_library_main", -3, 2.2, "swing", "door", 2, "front", 3.4)],
  units: [
    {
      id: "lot_library_reading", name: "열람실", sign: "열람실", x0: -10, x1: 4, door: "lot_library_main",
      interior: interior("lot_library_reading", { x: 470, z: 0 }, { x: 13.4, z: 10.4 }, 5.2, 2),
    },
  ],
  colliders: [
    { suffix: "", rect: rect(-10, 4, -7.5, 3.5), cameraHeight: 9.6 },
    { suffix: "bay_l", rect: rect(-8.6, -5.6, 3.5, 4.4), cameraHeight: 4.6 }, // bay windows = the reading nooks
    { suffix: "bay_r", rect: rect(-0.4, 2.6, 3.5, 4.4), cameraHeight: 4.6 },
    { suffix: "bench_1", rect: rect(6.1, 7.9, -2.85, -2.3), cameraHeight: 0 }, // reading garden benches
    { suffix: "bench_2", rect: rect(6.1, 7.9, 1.35, 1.9), cameraHeight: 0 },
    { suffix: "pergola_1", rect: rect(4.5, 4.8, -5.8, -5.5), cameraHeight: 0 }, // pergola posts (its roof: LOT_ROOF_SLABS)
    { suffix: "pergola_2", rect: rect(9.2, 9.5, -5.8, -5.5), cameraHeight: 0 },
    { suffix: "pergola_3", rect: rect(4.5, 4.8, 3, 3.3), cameraHeight: 0 },
    { suffix: "pergola_4", rect: rect(9.2, 9.5, 3, 3.3), cameraHeight: 0 },
    { suffix: "book_return", rect: rect(-9.5, -8.9, 4.8, 5.3), cameraHeight: 0 },
    { suffix: "lamp_1", rect: rect(-5.65, -5.35, 6.6, 6.9), cameraHeight: 0 },
    { suffix: "lamp_2", rect: rect(-0.65, -0.35, 6.6, 6.9), cameraHeight: 0 },
    // B1 (2026-11-17), appended: clipped bay-tree topiaries in planters either side of the door
    { suffix: "topiary_1", rect: rect(-4.95, -4.45, 3.55, 4.05), cameraHeight: 0 },
    { suffix: "topiary_2", rect: rect(-1.55, -1.05, 3.55, 4.05), cameraHeight: 0 },
  ],
  seats: [
    seat("lot_library_bench_1", 7, -2.6, "out", "backed", 1.8),
    seat("lot_library_bench_2", 7, 1.6, "out", "backed", 1.8),
  ],
  slots: [
    slot("nook_l", "reading_nook", -7.1, 3.9, 0.5, "in", 2.4, 0.5, 2), // window seat inside the bay (sat on from the interior, phase 2)
    slot("nook_r", "reading_nook", 1.1, 3.9, 0.5, "in", 2.4, 0.5, 2),
    slot("book_return", "book_return", -9.2, 5.05, 0.9, "out", 0.6, 1.0, 2),
    slot("notice", "notice_board", 3.2, 3.56, 1.6, "out", 1.0, 1.2, 1),
    slot("nameplate", "nameplate", -3, 3.56, 4.3, "out", 3.4, 0.5, 1), // carved stone frieze over the door
    slot("armchair_nook", "reading_nook", 1.2, 8.6, 0.45, "right", 1.0, 0.5, 2, "interior:lot_library_reading"), // fireside armchairs (phase 2)
  ],
  approach: { x: -49, z: 15 },
  phase: { exterior: 1, interior: 2 },
  priority: 1,
};

/**
 * 마을 절: a small brand-new 한옥 temple inside a 돌담 (stone wall with a 기와 coping) garden at the village's north-west edge, so the
 * change from European houses to Korean timber architecture happens behind a wall and a planted buffer of pines. 일주문 on the
 * lane side, a granite path past a 석등 to a three-bay 대웅전 on a dressed-granite 기단 (fresh 단청: 녹청 + 석간주 + 금단청 accents),
 * a three-storey 석탑, a small 범종각 with a bronze bell, a lotus pond, pines. No 卍, no scripture, no real temple's name: the gate
 * plaque says "케이슨산", the hall plaque "대웅전". Plot_nw, facing east to the lane.
 */
const TEMPLE: VillageLot = {
  id: "lot_temple",
  plot: "plot_nw",
  kind: "temple",
  name: "마을 절",
  sign: "대웅전",
  storeys: 1,
  storeyHeight: 4.6,
  // 기단 0.9 + columns 3.7 + brackets, ridge 10.4, 취두 11
  height: 11,
  doorSide: "e",
  centre: { x: -52, z: -37 },
  front: 24,
  depth: 26,
  body: rect(-6.5, 6.5, -11.5, -3),
  apron: 16,
  entry: "door",
  doors: [{ ...door("lot_temple_main", 0, 3, "swing", "door", 2, "front", 3.4), closedNote: "조용히 둘러보세요" }],
  units: [
    {
      id: "lot_temple_hall", name: "대웅전", sign: "대웅전", x0: -6.5, x1: 6.5, door: "lot_temple_main",
      interior: interior("lot_temple_hall", { x: 410, z: 40 }, { x: 11.4, z: 7.4 }, 6, 2),
    },
  ],
  colliders: [
    { suffix: "", rect: rect(-6.5, 6.5, -11.5, -3), cameraHeight: 10.4 }, // 대웅전 on its 기단 (steps inside the box)
    { suffix: "iljumun_l", rect: rect(-2.3, -1.7, 11.9, 12.5), cameraHeight: 6.5 }, // 일주문's two pillars (roof: LOT_ROOF_SLABS)
    { suffix: "iljumun_r", rect: rect(1.7, 2.3, 11.9, 12.5), cameraHeight: 6.5 },
    { suffix: "wall_fl", rect: rect(-12, -2.3, 12.5, 12.9), cameraHeight: 0 }, // 돌담 1.5 m, 기와 coping
    { suffix: "wall_fr", rect: rect(2.3, 12, 12.5, 12.9), cameraHeight: 0 },
    { suffix: "wall_l", rect: rect(-12, -11.6, -13, 12.5), cameraHeight: 0 },
    { suffix: "wall_r", rect: rect(11.6, 12, -13, 12.5), cameraHeight: 0 },
    { suffix: "wall_b", rect: rect(-11.6, 11.6, -13, -12.6), cameraHeight: 0 },
    { suffix: "lantern", rect: rect(-0.5, 0.5, 1.2, 2.2), cameraHeight: 0 }, // 석등 on the axis
    { suffix: "pagoda", rect: rect(-6, -4, 1.5, 3.5), cameraHeight: 6.5 }, // 삼층 석탑
    { suffix: "pond", rect: rect(4, 10, 3, 9), cameraHeight: 0 }, // lotus pond with a granite rim
    { suffix: "bell_pavilion", rect: rect(-11.2, -8.2, -10, -7), cameraHeight: 7 }, // 범종각
    { suffix: "pine_1", rect: rect(-10.3, -9.7, 7.5, 8.1), cameraHeight: 0 }, // pine trunks (crowns over the walk)
    { suffix: "pine_2", rect: rect(-9.8, -9.2, -1.5, -0.9), cameraHeight: 0 },
    { suffix: "pine_3", rect: rect(9.7, 10.3, -5.2, -4.6), cameraHeight: 0 },
    { suffix: "pine_4", rect: rect(8.3, 8.9, 10.6, 11.2), cameraHeight: 0 },
  ],
  seats: [
    seat("lot_temple_bench_1", -8, 4.2, "right", "backless", 1.8), // granite benches (돌의자) under the pines
    seat("lot_temple_bench_2", 7, 1, "out", "backless", 1.8),
  ],
  slots: [
    slot("lantern", "lantern", 0, 1.7, 1.6, "out", 0.5, 0.5, 1), // lit at night
    slot("bell", "bell", -9.7, -8.5, 2.4, "right", 1.2, 1.6, 2), // tap to hear one soft stroke (phase 2)
    slot("pond", "pond", 7, 6, 0.1, "out", 6, 6, 1),
    slot("hall_plaque", "nameplate", 0, -2.9, 6.2, "out", 2.4, 0.9, 1),
    slot("gate_plaque", "nameplate", 0, 12.2, 5.4, "out", 1.8, 0.7, 1),
  ],
  approach: { x: -39, z: -37 },
  phase: { exterior: 1, interior: 2 },
  priority: 5,
};

/**
 * 케이슨 마을 교회: a classic country church (Scandinavian / New England white church), white-painted timber clapboard on a granite
 * plinth, dark shingle roof, a tall white steeple with a louvred belfry and a slender spire, round-topped windows with pale sage
 * trim, a little columned porch over panelled double doors, benches and a notice board ("환영합니다"). No denomination's name.
 * Plot_s, facing north to the lane from the plaza.
 */
const CHURCH: VillageLot = {
  id: "lot_church",
  plot: "plot_s",
  kind: "church",
  name: "케이슨 마을 교회",
  sign: "케이슨 마을 교회",
  storeys: 1,
  storeyHeight: 6,
  // eaves 6, ridge 10, the belfry 13, the spire 22
  height: 22,
  doorSide: "n",
  centre: { x: 0, z: 58 },
  front: 18,
  depth: 16,
  body: rect(-4.2, 4.2, -8, 3),
  apron: 5,
  entry: "door",
  doors: [{ ...door("lot_church_main", 0, 2.2, "swing", "door", 2, "front", 3.4), closedNote: "조용히 둘러보세요" }],
  units: [
    {
      id: "lot_church_nave", name: "예배당", sign: "예배당", x0: -4.2, x1: 4.2, door: "lot_church_main",
      interior: interior("lot_church_nave", { x: 440, z: 40 }, { x: 9.4, z: 9.4 }, 7, 2),
    },
  ],
  colliders: [
    { suffix: "", rect: rect(-4.2, 4.2, -8, 3), cameraHeight: 10 }, // nave 8.4 x 11 with the steeple over its front gable
    { suffix: "porch_post_1", rect: rect(-1.75, -1.45, 4.3, 4.6), cameraHeight: 3.8 }, // columned porch (roof: LOT_ROOF_SLABS)
    { suffix: "porch_post_2", rect: rect(1.45, 1.75, 4.3, 4.6), cameraHeight: 3.8 },
    { suffix: "bench_1", rect: rect(-7.9, -6.1, 4.25, 4.8), cameraHeight: 0 },
    { suffix: "bench_2", rect: rect(6.1, 7.9, 4.25, 4.8), cameraHeight: 0 },
    { suffix: "lamp_1", rect: rect(-3.6, -3.3, 6.2, 6.5), cameraHeight: 0 },
    { suffix: "lamp_2", rect: rect(3.3, 3.6, 6.2, 6.5), cameraHeight: 0 },
    { suffix: "notice", rect: rect(5.8, 7.2, 6.3, 6.55), cameraHeight: 0 }, // 환영합니다 board on two posts
  ],
  seats: [
    seat("lot_church_bench_1", -7, 4.5, "out", "backed", 1.8),
    seat("lot_church_bench_2", 7, 4.5, "out", "backed", 1.8),
  ],
  slots: [
    slot("bell", "bell", 0, 1.5, 11.6, "out", 0.9, 0.9, 1),
    slot("notice", "notice_board", 6.5, 6.4, 1.4, "out", 1.3, 0.9, 1),
    slot("nameplate", "nameplate", 0, 3.06, 5.2, "out", 3.0, 0.45, 1),
  ],
  approach: { x: 0, z: 50 },
  phase: { exterior: 1, interior: 2 },
  priority: 3,
};

/**
 * 케이슨랜드 정문: on the south bank beyond the footbridge, a 20 x 12 m gate plaza at the walk bounds' south edge. Two stone-clad
 * towers carry a 7 m arch with the park's name; closed iron gate leaves and a fence across the lot until B11 opens the park (the
 * park itself lies south of z 95); two ticket booths with shutters; benches on the plaza. Faces north, toward the bridge.
 */
const GATE: VillageLot = {
  id: "lot_gate",
  plot: null,
  kind: "park_gate",
  name: "케이슨랜드 정문",
  sign: "케이슨랜드",
  storeys: 1,
  storeyHeight: 7,
  // L4 2026-11-17 (coordinator, contract 11): the grand gate's domed main towers reach 16.5 m (was 10.5)
  height: 16.5,
  doorSide: "n",
  centre: { x: -24, z: 89 },
  front: 20,
  depth: 12,
  // the gate line sits on the walk bounds' south edge (z 95): nobody walks round a closed gate, the park is beyond it
  body: rect(-10, 10, -6, -3.6),
  apron: 9.6,
  entry: "closed",
  doors: [door("lot_gate_main", 0, 6, "swing", "closed", 4, "front", 5)],
  units: [],
  colliders: [
    { suffix: "tower_l", rect: rect(-4.4, -3, -6, -3.6), cameraHeight: 16.5 }, // L4 grand gate: domed towers (contract 11)
    { suffix: "tower_r", rect: rect(3, 4.4, -6, -3.6), cameraHeight: 16.5 },
    { suffix: "leaves", rect: rect(-3, 3, -5.9, -5.7), cameraHeight: 3.2 }, // closed gate leaves (phases 1-3)
    { suffix: "booth_l", rect: rect(-8.4, -5.4, -6, -3.4), cameraHeight: 3.6 },
    { suffix: "booth_r", rect: rect(5.4, 8.4, -6, -3.4), cameraHeight: 3.6 },
    { suffix: "fence_l", rect: rect(-10, -8.4, -6, -5.76), cameraHeight: 0 },
    { suffix: "fence_r", rect: rect(8.4, 10, -6, -5.76), cameraHeight: 0 },
    { suffix: "fence_ml", rect: rect(-5.4, -4.4, -6, -5.76), cameraHeight: 0 },
    { suffix: "fence_mr", rect: rect(4.4, 5.4, -6, -5.76), cameraHeight: 0 },
    // L4 2026-11-17 (coordinator, contract 11: the grand gate), appended so every earlier id keeps its place:
    { suffix: "wing_l", rect: rect(-10, -4.4, -6, -3.4), cameraHeight: 6.4 }, // arcade wing with three ticket windows
    { suffix: "wing_r", rect: rect(4.4, 10, -6, -3.4), cameraHeight: 6.4 },
    { suffix: "dome_l", rect: rect(-10, -8.55, -6, -3.4), cameraHeight: 12 }, // domed corner tower at the wing's end
    { suffix: "dome_r", rect: rect(8.55, 10, -6, -3.4), cameraHeight: 12 },
    { suffix: "barrier", rect: rect(-3, 3, -5.45, -4.95), cameraHeight: 0 }, // belt stanchions + the "곧 문을 열어요" stand
    { suffix: "fountain", rect: rect(-1.6, 1.6, -0.95, 2.5), cameraHeight: 0 }, // the plaza roundabout fountain
    { suffix: "planter_l", rect: rect(-5.6, -4.2, 2.6, 4.0), cameraHeight: 0 }, // big planters with topiary
    { suffix: "planter_r", rect: rect(4.2, 5.6, 2.6, 4.0), cameraHeight: 0 },
    { suffix: "lamp_1", rect: rect(-9.7, -9.3, 4.3, 4.7), cameraHeight: 0 }, // decorative lamp posts (flag lines hang between)
    { suffix: "lamp_2", rect: rect(9.3, 9.7, 4.3, 4.7), cameraHeight: 0 },
    { suffix: "lamp_3", rect: rect(-9.7, -9.3, -1.7, -1.3), cameraHeight: 0 },
    { suffix: "lamp_4", rect: rect(9.3, 9.7, -1.7, -1.3), cameraHeight: 0 },
  ],
  seats: [
    seat("lot_gate_bench_1", -7, 0, "out", "backless", 1.8),
    seat("lot_gate_bench_2", 7, 0, "out", "backless", 1.8),
  ],
  slots: [
    slot("arch_sign", "gate_sign", 0, -4.8, 7.6, "out", 7, 1.6, 1),
    slot("soon_sign", "gate_sign", 0, -5.68, 1.6, "out", 1.8, 0.7, 1),
    slot("booth_l", "ticket_booth", -6.9, -3.38, 1.2, "out", 1.4, 0.8, 4),
    slot("booth_r", "ticket_booth", 6.9, -3.38, 1.2, "out", 1.4, 0.8, 4),
    slot("turnstile", "turnstile", 0, -4.6, 1.0, "out", 6, 1.0, 4),
  ],
  approach: { x: -24, z: 83 },
  phase: { exterior: 1, interior: 4 },
  priority: 6,
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** Every lot, in build/priority-independent fixed order (seat ids and collider ids follow this order; never reorder). */
export const VILLAGE_LOTS: readonly VillageLot[] = deepFreeze([SCHOOL, CHAPEL, LIBRARY, TEMPLE, CHURCH, GATE]);

export function villageLot(id: LotId): VillageLot {
  const l = VILLAGE_LOTS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown lot ${id}`);
  return l;
}

// ─────────────────────────────── world forms the game and the build read ───────────────────────────────

export interface LotCollider {
  /** `col__<id>` in the model. */
  id: string;
  box: AABB;
  camera: boolean;
  cameraHeight: number;
}

/** A lot's solid boxes in the world, in the spec's order (the body first where it has one). */
export function lotColliders(l: VillageLot): LotCollider[] {
  return l.colliders.map((c) => ({
    id: c.suffix ? `${l.id}_${c.suffix}` : l.id,
    box: lotBox(l, c.rect),
    camera: c.cameraHeight > 0,
    cameraHeight: c.cameraHeight,
  }));
}

/** Every lot's colliders, lot by lot. */
export function allLotColliders(): LotCollider[] {
  return VILLAGE_LOTS.flatMap(lotColliders);
}

/** Half the depth of the door pad: the pad stands this far out of the wall, and its radius (as the hall's 1.4 m pad). */
export const LOT_DOOR_PAD = Object.freeze({ out: 0.65, radius: 1.2 });

export interface LotDoorPoint {
  door: string;
  /** Standing here and using the door goes in (the door pad's centre, 0.65 m out of the wall). */
  pad: { x: number; z: number; radius: number };
  /** Where the way out puts a visitor: 2.2 m out of the wall, facing away from the building. */
  arrival: { x: number; z: number; yaw: number };
  /** The door's opening (world, on the wall line) and its height, for the model's `door__<id>` node. */
  centre: { x: number; z: number };
  yaw: number;
}

/** Where a door's pad, arrival and opening are in the world. */
export function lotDoorPoint(l: VillageLot, d: LotDoor): LotDoorPoint {
  let wallLx: number, wallLz: number, outLx: number, outLz: number;
  if (d.wall === "front") {
    wallLx = d.at; wallLz = l.body.z1; outLx = 0; outLz = 1;
  } else if (d.wall === "left") {
    wallLx = l.body.x0; wallLz = d.at; outLx = -1; outLz = 0;
  } else {
    wallLx = l.body.x1; wallLz = d.at; outLx = 1; outLz = 0;
  }
  const at = (k: number) => lotLocalToWorld(l, R6(wallLx + outLx * k), R6(wallLz + outLz * k));
  const faces: LotSeatSpec["faces"] = d.wall === "front" ? "out" : d.wall === "left" ? "left" : "right";
  const yaw = lotYaw(l, faces);
  const pad = at(LOT_DOOR_PAD.out);
  const arr = at(2.2);
  return { door: d.id, pad: { ...pad, radius: LOT_DOOR_PAD.radius }, arrival: { ...arr, yaw }, centre: at(0), yaw };
}

export function lotDoorPoints(l: VillageLot): LotDoorPoint[] {
  return l.doors.map((d) => lotDoorPoint(l, d));
}

/** A lot seat in the world, in the shape the build's `seat__` markers and benchSeats.ts read (facing is a compass side). */
export interface LotSeatMarker {
  id: string;
  lot: LotId;
  x: number;
  z: number;
  facing: Side;
  yaw: number;
  kind: "backless" | "backed";
  seatTop: number;
  frontEdge: number;
  length: number;
  places: number;
  approach: "front" | "side";
}

export function lotSeatMarkers(l: VillageLot): LotSeatMarker[] {
  return l.seats.map((s) => {
    const p = lotLocalToWorld(l, s.lx, s.lz);
    return { id: s.id, lot: l.id, x: p.x, z: p.z, facing: lotFacingSide(l, s.faces), yaw: lotYaw(l, s.faces), kind: s.kind, seatTop: s.seatTop, frontEdge: s.frontEdge, length: s.length, places: s.places, approach: s.approach };
  });
}

/**
 * Every lot seat in the one fixed order the game appends them in: AFTER every seat `VILLAGE_SEATS` has today (the lake's last), lot
 * by lot in `VILLAGE_LOTS` order, each lot's seats in spec order. Never renumber: a new seat goes at the end of this list.
 */
export const LOT_SEAT_ORDER: readonly string[] = Object.freeze(VILLAGE_LOTS.flatMap((l) => l.seats.map((s) => s.id)));

export function allLotSeatMarkers(): LotSeatMarker[] {
  return VILLAGE_LOTS.flatMap(lotSeatMarkers);
}

/** The model's node of a slot: `slot__<lot id>_<name>`; its price-tag holders `..._tag_<n>`. */
export function lotSlotNode(lotId: LotId, name: string): string {
  return `slot__${lotId}_${name}`;
}
export function lotSlotTagNode(lotId: LotId, name: string, n: number): string {
  return `${lotSlotNode(lotId, name)}_tag_${n}`;
}

export interface LotSlot {
  node: string;
  kind: LotSlotKind;
  where: LotSlotSpec["where"];
  /** World point for exterior slots; the unit's interior frame (x, z) for interior slots. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  tags: readonly string[];
  phase: LotPhase;
}

/** A lot's slots: exterior ones in the world, interior ones in their unit's interior frame (x across, z in from the door). */
export function lotSlots(l: VillageLot): LotSlot[] {
  return l.slots.map((s) => {
    const tags = Array.from({ length: s.tags }, (_, i) => lotSlotTagNode(l.id, s.name, i + 1));
    if (s.where === "exterior") {
      const p = lotLocalToWorld(l, s.lx, s.lz);
      return { node: lotSlotNode(l.id, s.name), kind: s.kind, where: s.where, x: p.x, y: s.y, z: p.z, yaw: lotYaw(l, s.faces), width: s.width, height: s.height, tags, phase: s.phase };
    }
    const yaw = { out: 0, in: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[s.faces];
    return { node: lotSlotNode(l.id, s.name), kind: s.kind, where: s.where, x: s.lx, y: s.y, z: s.lz, yaw, width: s.width, height: s.height, tags, phase: s.phase };
  });
}

// ─────────────────────────────── the lots' GLB (design 6) ───────────────────────────────

/** village_lots.glb's nodes: the always-drawn shell, the near-only detail, and village.glb's stand-in box per lot. */
export function lotShellNode(id: LotId): string {
  return `lotshell__${id}`;
}
export function lotDetailNode(id: LotId): string {
  return `lotdetail__${id}`;
}
export function lotProxyNode(id: LotId): string {
  return `lotproxy__${id}`;
}
/** A shop window's dressed display box (1.2 m deep behind the glass, real 3D goods), part of the detail, its own node for LOD. */
export function lotWindowNode(id: LotId, slotName: string): string {
  return `lotwindow__${id}_${slotName}`;
}
/** A door's opening (the leaf animates in the game): `door__<door id>`. */
export function lotDoorNode(doorId: string): string {
  return `door__${doorId}`;
}
/** Night-only emissive parts (sign letters, window glow, string lights): `lotnight__<lot id>_<part>`. */
export function lotNightNode(id: LotId, part: string): string {
  return `lotnight__${id}_${part}`;
}

/**
 * Triangle budget per lot (design 7): `shell` always drawn, `detail` only near (LOD), both measured on the exported GLB (instances
 * counted once per instance). The gate keeps the budget its 75ab7df build was reviewed at (v1 contract 11, L4 exception).
 */
export const LOT_TRIANGLES: Readonly<Record<LotId, { shell: number; detail: number }>> = Object.freeze({
  lot_school: Object.freeze({ shell: 3_000, detail: 18_000 }),
  lot_chapel: Object.freeze({ shell: 3_000, detail: 16_000 }),
  lot_library: Object.freeze({ shell: 2_600, detail: 18_000 }),
  lot_temple: Object.freeze({ shell: 3_400, detail: 20_000 }),
  lot_church: Object.freeze({ shell: 2_400, detail: 14_000 }),
  lot_gate: Object.freeze({ shell: 4_000, detail: 25_000 }),
});

/**
 * One GLB per lot (`client/public/models/village/lots/<lot id>.glb`, as the L5 loader reads them), each with its shell, its detail
 * split in two LOD levels (`lotdetail__<lot>_mesh` = structure, `lotgoods__<lot>` = small repeated things), doors, night parts and
 * markers. Textures are KTX2 (design 6: v1's decoded WebP maps were hundreds of MB on the GPU).
 */
export const LOT_GLB_BUDGET = Object.freeze({
  dir: "models/village/lots",
  /** Per lot file: geometry (Draco) + markers; textures are separate KTX2 files. */
  maxBytes: 0.6 * 1024 * 1024,
  shellTrianglesTotal: 18_400,
  detailTrianglesTotal: 111_000,
  /** Materials per lot file. */
  maxMaterials: 10,
  maxTextureSide: 2048,
  /** Each lot's shell at most this many draw calls; each lot's detail (both levels) at most `detailDraws`. */
  shellDraws: 4,
  detailDraws: 10,
  /** Repeated things (pickets, ridge tiles, 공포 brackets, books, flowers) are GPU instances: one draw per kind. */
  instancedKindsPerLot: 8,
  /** The structure level's share of a lot's detail: what the phone draws between `phoneGoodsWithin` and its detail distance. */
  structureShare: 0.55,
  proxyTriangles: 12,
  /** Each lot's own light map (day / night, KB): PC and phone. */
  lightmap: Object.freeze({ dayKB: 120, nightKB: 100, phoneDayKB: 60, phoneNightKB: 50 }),
  /**
   * GPU memory of each lot's OWN maps (trim sheets, signs, dancheong, stained glass), KTX2 with mips: PC <= 6 MB, phone <= 1.5 MB.
   * The shared PBR library sets the lots use are counted once for all lots (`pbrSets`), loaded through pbrLibrary.ts.
   */
  gpuTextureMB: Object.freeze({ pc: 6, phone: 1.5 }),
  pbrSets: Object.freeze({ maxDistinct: 12, pcMB: 60, phoneMB: 24 }),
  textureFormat: "ktx2",
});

/**
 * When a lot's detail is drawn: the same pool as the houses' (PC 35 m, phone 25 m, hysteresis 4 m), one near-detail triangle pool
 * per tier, nearest first: PC <= 40k (the lots stand >= 30 m apart, so one or two are near at once), the phone <= 14k and at most
 * 2 detailed buildings; on the phone a lot's `lotgoods__` level only within `phoneGoodsWithin`. A lot farther than `proxyBeyond`
 * draws its proxy box instead of its shell on the phone tier only.
 */
export const LOT_DETAIL_LOD = Object.freeze({ pc: 35, phone: 25, hysteresis: 4, poolPc: 40_000, poolPhone: 14_000, phoneMaxDetailed: 2, phoneGoodsWithin: 15, proxyBeyondPhone: 110 });

/** The scene's triangle ceiling (owner Q3 2026-11-16, VILLAGE_SCENE_TRIANGLE_CAP): unchanged by the lots. */
export const LOT_SCENE_CAP = Object.freeze({ pc: 310_000, phone: 300_000 });

/** House shells' total (house exteriors: 10 x 1,800). */
export const HOUSE_SHELLS_TOTAL = 18_000;

/**
 * Worst-case scene triangles with the lots: the base scene (village.glb as vrb2 rebuilds it), every house shell, every lot shell,
 * and the full shared near-detail pool.
 */
export function worstSceneTrianglesWithLots(base: number, tier: "pc" | "phone"): number {
  const pool = tier === "pc" ? LOT_DETAIL_LOD.poolPc : LOT_DETAIL_LOD.poolPhone;
  return base + HOUSE_SHELLS_TOTAL + LOT_GLB_BUDGET.shellTrianglesTotal + pool;
}

/** The largest base scene the lots leave room for, per tier (L6 measures vrb2's village.glb against this). */
export function maxBaseSceneTriangles(tier: "pc" | "phone"): number {
  return LOT_SCENE_CAP[tier] - worstSceneTrianglesWithLots(0, tier);
}

// ─────────────────────────────── surfaces (design 5, owner 2026-11-16 / 2026-11-17) ───────────────────────────────

/**
 * Every visible surface is photo-real PBR (albedo + normal + roughness; metal parts also metalness), texel density as the houses
 * (>= 512 px/m within 3.5 m of the ground and anything reachable, >= 256 px/m above), no flat colour (FAIL in review; glass, lamp
 * glow, emissive letters and stained glass exempt). BRAND-NEW look (owner 2026-11-17 "전부 새것같은 느낌"): no grime, moss, rust,
 * streaks or chipped paint; crisp 2–3 cm bevels so edges catch the light; fresh paint slightly glossier (roughness -0.1). The sets
 * come from the shared PBR library (feat/pbr-library c654e09, KTX2); `families` names library set ids, and the ids marked NEW in
 * design 6 are added to the library by the builder who needs them first (not a private copy).
 */
export const LOT_SURFACE_RULES = Object.freeze({
  pbr: Object.freeze(["albedo", "normal", "roughness"] as const),
  texelsPerMetre: Object.freeze({ firstPerson: 512, far: 256 }),
  firstPersonMaxHeight: 3.5,
  mapSide: 1024,
  exempt: Object.freeze(["M_glass", "M_glass_stained", "M_lamp", "M_sign_emit", "M_leaf_flora", "M_screen", "M_water"] as const),
  families: Object.freeze({
    lot_school: Object.freeze(["stucco_white", "roof_clay_tile", "granite_flamed", "wood_painted", "wood_oak", "cast_iron", "play_rubber", "sand", "grass"]),
    lot_chapel: Object.freeze(["stone_ashlar", "roof_slate", "granite_flamed", "wood_oak", "cast_iron", "gravel", "copper_new"]),
    // B1 2026-11-17: orange clay tiles, not slate (owner's Colmar reference "이런 동화 같은 집의 느낌"); roof_slate stays in the library for the chapel
    lot_library: Object.freeze(["brick_red", "stone_ashlar", "roof_clay_tile", "wood_painted", "wood_oak", "floor_wood", "plaster_painted", "fabric_upholstery", "granite_flamed"]),
    lot_temple: Object.freeze(["roof_giwa", "dancheong_wood", "wood_pine_natural", "granite_flamed", "stone_wall_korean", "rock", "dirt_path"]),
    lot_church: Object.freeze(["wood_siding", "roof_shingle", "wood_painted", "granite_flamed", "wood_oak", "cast_iron", "metal_roof_seam"]),
    lot_gate: Object.freeze(["stone_cladding", "wrought_iron", "render", "granite", "concrete_paving", "metal_painted"]),
  }),
});

/** Generic words only on signs and plaques (no denomination, diocese, order or real temple name; no scripture). Tests check them. */
export const LOT_SIGN_WORDS: readonly string[] = Object.freeze([
  "케이슨 마을 학교", "교실", "케이슨 마을 성당", "케이슨 마을 도서관", "열람실", "책 반납함", "대웅전", "케이슨산", "케이슨 마을 교회", "예배당",
  "환영합니다", "조용히 둘러보세요", "준비 중",
  // the gate (75ab7df). Owner 2026-11-17 "그런거 없다": no money in the game, so the polish pass takes its ticket-price boards
  // (입장권 · 어른 · 어린이 · 자유이용권) off; only these words stay on it
  "케이슨랜드", "곧 문을 열어요",
]);

/** For layout.json (scripts/export-village-layout.ts, L5): everything the Blender build needs, in world form. */
export function lotsForLayoutJson(): unknown {
  return VILLAGE_LOTS.map((l) => ({
    id: l.id,
    plot: l.plot,
    kind: l.kind,
    name: l.name,
    sign: l.sign,
    centre: l.centre,
    doorSide: l.doorSide,
    front: l.front,
    depth: l.depth,
    footprint: lotFootprint(l),
    body: l.body,
    apron: l.apron,
    storeys: l.storeys,
    storeyHeight: l.storeyHeight,
    height: l.height,
    doors: lotDoorPoints(l).map((p, i) => ({ ...l.doors[i], ...p })),
    units: l.units,
    colliders: lotColliders(l),
    seats: lotSeatMarkers(l),
    slots: lotSlots(l),
  }));
}

// ─────────────────────────────── the game's walk and camera boxes (L5, 2026-11-17) ───────────────────────────────

/**
 * The lots whose committed model (`client/public/models/village/lots/<lot>.glb`, L1–L4) holds every `col__` box of the contract
 * (server/src/tools/lot*Glb.test.ts and villageLotsWiring.test.ts check the files). Only these lots' boxes go into the walk and
 * camera colliders: a box with no building drawn round it would be an invisible wall (contract 9, L5). All six since 2026-11-17.
 */
export const LOTS_WITH_MODEL: readonly LotId[] = Object.freeze([]); // v2: none yet — L5v2 adds each lot when its GLB lands (the gate first)

/**
 * Roofs a third-person camera may stand UNDER but never pass through (T8): camera boxes with a floor (`CameraBox.minY`), local to
 * the lot: porch roofs, the pergola, the 일주문 roof and the 대웅전's and 범종각's deep eaves (Korean eaves reach 1.5–2 m past the
 * columns). The builders give the measured undersides; L5v2 checks them with upward rays in the game, as v1 did.
 */
export const LOT_ROOF_SLABS: Readonly<Record<LotId, readonly { rect: LotRect; minY: number; height: number }[]>> = Object.freeze({
  lot_school: Object.freeze([{ rect: rect(-2.2, 2.2, -2, -0.3), minY: 3.3, height: 5 }]), // gabled entrance porch
  lot_chapel: Object.freeze([]),
  lot_library: Object.freeze([{ rect: rect(4.4, 9.6, -5.9, 3.4), minY: 2.7, height: 3.2 }]), // pergola beams
  lot_temple: Object.freeze([
    { rect: rect(-3.6, 3.6, 11.2, 13), minY: 4.4, height: 6.8 }, // 일주문 roof
    { rect: rect(-8.3, 8.3, -3, -1.3), minY: 4.6, height: 8 }, // 대웅전 front eaves
    { rect: rect(-11.6, -7.8, -10.4, -6.6), minY: 3.6, height: 7 }, // 범종각 roof
  ]),
  lot_church: Object.freeze([{ rect: rect(-2.2, 2.2, 3, 4.8), minY: 3.6, height: 4.8 }]), // columned porch
  lot_gate: Object.freeze([]),
});

/**
 * The seats' furniture the contract gives no `col__` box (the market's and the gate's backless benches, the mart's two plastic chairs:
 * L1 hand-over "the model marks them walk-over"): a box of the seat's length and twice its front edge round its centre, so nobody walks
 * through a bench (an obstacle only; the camera looks over it). A seat whose centre already lies in a lot collider (a 평상, a bench with
 * its own box) adds nothing.
 */
export function lotSeatFurnitureBoxes(l: VillageLot): AABB[] {
  const out: AABB[] = [];
  const own = lotColliders(l).map((c) => c.box);
  for (const sp of l.seats) {
    const c = lotLocalToWorld(l, sp.lx, sp.lz);
    if (own.some((b) => c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ)) continue;
    const half = sp.length / 2;
    const along = sp.faces === "out" || sp.faces === "in";
    const r = along ? rect(sp.lx - half, sp.lx + half, sp.lz - sp.frontEdge, sp.lz + sp.frontEdge) : rect(sp.lx - sp.frontEdge, sp.lx + sp.frontEdge, sp.lz - half, sp.lz + half);
    out.push(lotBox(l, r));
  }
  return out;
}

/** The lots' boxes as the village geometry takes them: every collider an obstacle, the tall ones and the roof slabs camera boxes. */
export function lotGeometryColliders(ids: readonly LotId[] = LOTS_WITH_MODEL): { obstacles: AABB[]; cameraBoxes: CameraBox[] } {
  const obstacles: AABB[] = [];
  const cameraBoxes: CameraBox[] = [];
  for (const l of VILLAGE_LOTS) {
    if (!ids.includes(l.id)) continue;
    for (const c of lotColliders(l)) {
      obstacles.push(c.box);
      if (c.camera) cameraBoxes.push({ ...c.box, height: c.cameraHeight });
    }
    obstacles.push(...lotSeatFurnitureBoxes(l));
    for (const s of LOT_ROOF_SLABS[l.id]) cameraBoxes.push({ ...lotBox(l, s.rect), minY: s.minY, height: s.height });
  }
  return { obstacles, cameraBoxes };
}

/**
 * What village.glb (before vrb2's rebuild) still stands on a lot's plot that the lot replaces (design 9): plot_w's library scaffold
 * and crane, with its `col__construction` box. Owner 2026-11-17: the crane and scaffold go ("건설중이라는 크레인도 … 빼고") — so,
 * unlike v1, they go as soon as the wiring lands, whether or not the library's model is in yet: `replacedByLot` defaults to every
 * lot. vrb2 deletes them from village.glb itself (contract 8); then these entries match nothing and can stay.
 */
export const LOT_REPLACED_MODEL_BOXES: ReadonlyArray<{ lot: LotId; id: string; box: AABB; top: number }> = Object.freeze([
  { lot: "lot_library", id: "construction", box: Object.freeze({ minX: -72.4, maxX: -66.3, minZ: 2.6, maxZ: 21.4 }), top: 40 },
]);

/**
 * The crane's jib over plot_w (village.glb, measured in the game by L5: LM_atlas triangles 10.5–28 m up over x -80..-47, z 0..8):
 * only what is this high in this box goes (a tree's crown nearby stays under 10.4 m). No collider (it is in the air).
 */
export const LOT_REPLACED_HIGH: ReadonlyArray<{ lot: LotId; box: AABB; minY: number; maxY: number }> = Object.freeze([
  { lot: "lot_library", box: Object.freeze({ minX: -82, maxX: -44, minZ: -2, maxZ: 10 }), minY: 10.4, maxY: 30 },
]);

/** Whether `b` is one of the model boxes a built lot replaces (to the centimetre). */
export function replacedByLot(b: AABB, ids: readonly LotId[] = VILLAGE_LOTS.map((l) => l.id)): boolean {
  const same = (x: number, y: number) => Math.abs(x - y) < 0.005;
  return LOT_REPLACED_MODEL_BOXES.some((r) => ids.includes(r.lot) && same(r.box.minX, b.minX) && same(r.box.maxX, b.maxX) && same(r.box.minZ, b.minZ) && same(r.box.maxZ, b.maxZ));
}

/** The lot whose footprint holds (x, z), or null (the HUD's place name, the map's labels). */
export function lotAt(x: number, z: number): VillageLot | null {
  for (const l of VILLAGE_LOTS) {
    const f = lotFootprint(l);
    if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) return l;
  }
  return null;
}
