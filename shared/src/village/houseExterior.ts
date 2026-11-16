/**
 * 집 외관 A8 약속 (X0 contract, docs/designs/house-exteriors/design.md + contract.md): the ten houses' exterior as numbers the
 * Blender kit (X1 body, X2 porch/fixtures), the game (X3) and the build (X4) all read. The owner approved the A plan on
 * 2026-11-16 ("추천대로"): the body is the interior plus its walls (11.2 x 8.4 m, so the windows match 1:1), every house
 * shows its wide side to the street (houses 5, 8 and 10 turned), the porch is raised 0.30 m with two steps (the server
 * still walks on y = 0: only the picture and the porch benches' seat height change), and the PC scene cap is 310k.
 *
 * Everything is in a house's LOCAL frame first — the same Frame as art/village/tools/parts_houses.py: origin at the
 * footprint's centre, local x = the right hand of someone walking in through the door, local z = out of the door — and
 * turned into world boxes here (`localBox`). The layout (villageLayout.ts) keeps each house's world footprint
 * (`centre`, `size`), which for every house is 11.2 m along its front by 10.75 m deep.
 *
 * Browser-safe, no imports of values from villageLayout.ts (it imports this file): only types.
 */

import type { AABB } from "../collision";
import type { VillageSeatMarker } from "./benchSeats";
import type { SceneryHouse, Side } from "./villageLayout";

/** The A plan's house in its local frame (m). Footprint: 11.2 wide x 10.75 deep = back margin 0.10 + body 8.4 + porch 2.25. */
export const HOUSE_A8 = Object.freeze({
  /** Footprint along the front (local x). */
  front: 11.2,
  /** Footprint depth (local z): backMargin + bodyDepth + porchDepth. */
  depth: 10.75,
  /** Between the footprint's back edge and the body's back wall (the foundation cap stays inside the footprint). */
  backMargin: 0.1,
  /** Body (outer wall faces): 11.2 x 8.4 = the interior 10.6 x 7.8 plus 0.30 walls. */
  bodyWidth: 11.2,
  bodyDepth: 8.4,
  wallThickness: 0.3,
  /** The walkable porch between the body's front wall and the footprint's front edge. */
  porchDepth: 2.25,
  /** The granite plinth (기초 단) stands this far out of the body on every side; the solid box is body + plinth (11.36 x 8.56). */
  plinthOut: 0.08,
  /** The visible ground floor, porch and deck tops (m above the lawn). The server's walking plane stays at y = 0. */
  floorLift: 0.3,
  /** Two steps down from the porch to the lawn: risers 0.10 (porch 0.30 -> 0.20 -> 0.10 -> lawn), treads 0.34. */
  stepRise: 0.1,
  stepTread: 0.34,
  stepCount: 2,
  /** Front door: 1.8 x 2.9 glass double door, centred on the body (local x +-0.9), in the front wall. */
  doorHalfWidth: 0.9,
  doorHeight: 2.9,
  /** The house's camera box (the body's solid box), as tall as the ridge plus the lift with room to spare. */
  cameraHeight: 12,
});

const R2 = (v: number): number => Math.round(v * 100) / 100;
/** Local constants are kept to the micrometre (5.375 must stay 5.375); world boxes are rounded to the centimetre. */
const R6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Local z of the footprint's front edge (+) and back edge (-). */
export const HOUSE_Z_EDGE = HOUSE_A8.depth / 2; // 5.375
/** Local z of the body's back wall's outer face. */
export const HOUSE_BODY_BACK = R6(-HOUSE_Z_EDGE + HOUSE_A8.backMargin); // -5.275
/** Local z of the body's front wall's outer face (the door's plane). */
export const HOUSE_BODY_FRONT = R6(HOUSE_BODY_BACK + HOUSE_A8.bodyDepth); // 3.125
/** Half the body's width (outer faces). */
export const HOUSE_BODY_HALF = HOUSE_A8.bodyWidth / 2; // 5.6

/** The three porch types (design 4.2). */
export type PorchKind = "gable" | "canopy" | "deck";

/** Porch type of each house: gable porch 1, 5, 6, 7; box canopy 3, 4, 8; wide deck 2, 9, 10. */
export const HOUSE_PORCH_KIND: Readonly<Record<string, PorchKind>> = Object.freeze({
  house_1: "gable",
  house_2: "deck",
  house_3: "canopy",
  house_4: "canopy",
  house_5: "gable",
  house_6: "gable",
  house_7: "gable",
  house_8: "canopy",
  house_9: "deck",
  house_10: "deck",
});

/** A rectangle in a house's local frame. */
export interface LocalRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Half a post collider (m). */
export const PORCH_POST_HALF = 0.12;
/** Depth of the kerb / rail that blocks the slab's front edge beside the steps (m). */
export const PORCH_FRONT_KERB = 0.1;

/**
 * Each porch type in the local frame. The porch slab (raised `floorLift`) spans x +-halfSlab from the body's front wall to the
 * footprint's front edge; the two steps (+-halfStairs) go out past that edge; between the slab's edge and the footprint's side
 * edge, raised stone-kerbed flower beds fill the porch depth (solid). Where the slab is wider than the steps, a 0.10 m kerb
 * (gable: the plinth band; deck: the skirt and the front rail) blocks the slab's front edge so the porch is climbed only by the
 * steps. Posts are 0.24 m square colliders (the posts are 0.20, plus a skin), standing on the front kerb (flush with it, and the deck's
 * end posts flush with the beds) so no sliver of deck between them is left that a tap could pick but no body could reach.
 */
export const PORCH_SPECS = Object.freeze({
  gable: Object.freeze({ halfSlab: 2.6, halfStairs: 1.6, posts: Object.freeze([-2.3, 2.3]), postZ: R6(HOUSE_Z_EDGE - PORCH_FRONT_KERB - PORCH_POST_HALF) }),
  canopy: Object.freeze({ halfSlab: 1.6, halfStairs: 1.6, posts: Object.freeze([] as number[]), postZ: 0 }),
  deck: Object.freeze({ halfSlab: 3.4, halfStairs: 1.2, posts: Object.freeze([-3.28, -1.575, 1.575, 3.28]), postZ: R6(HOUSE_Z_EDGE - PORCH_FRONT_KERB - PORCH_POST_HALF) }),
} as const);


/**
 * The wide-deck houses' porch bench (2, 9, 10): oak seat, backrest toward the house, sat on facing the street. Local x -3.4..-2.2
 * (1.2 m, left of the door), its box backed onto the plinth and against the left bed, so no strip of seemingly open deck is left
 * behind or beside it (a 0.45 m gap there was a tap nobody could walk to); 1.27 m of deck in front of it to the posts, so a
 * sitter gets up onto the deck, not past its front rail. Seat 0.45 above the deck = 0.75 above the lawn.
 */
export const PORCH_BENCH = Object.freeze({
  x0: -3.4,
  x1: -2.2,
  z: R6(HOUSE_BODY_FRONT + HOUSE_A8.plinthOut + 0.25), // 3.455: its box backs onto the plinth (no gap behind it), 1.27 m to the middle post
  halfDepth: 0.25,
  seatTop: 0.75,
  frontEdge: 0.22,
});

/** The vegetable garden behind each house (col__garden_house_N), moved back with the deeper body: 6 x 2.6, 0.4 m behind the footprint. */
export const HOUSE_GARDEN: Readonly<LocalRect> = Object.freeze({ x0: -3, x1: 3, z0: R6(-HOUSE_Z_EDGE - 3.0), z1: R6(-HOUSE_Z_EDGE - 0.4) });
/** Houses whose back has a flush deck instead of the garden (house 9: the big patio window's deck, design 4.2). */
export const HOUSES_WITHOUT_GARDEN: readonly string[] = Object.freeze(["house_9"]);
/** A garden slid sideways (local x, m) to keep 1 m from a plot: house 10's toward its north (plot_w is 0.4 m south of the centred one). */
export const HOUSE_GARDEN_SHIFT: Readonly<Record<string, number>> = Object.freeze({ house_10: -0.6 });

/**
 * The LPG cylinders' cage (2 x 50 kg behind a mesh) against the back wall, right of centre (seen from the street: left), solid
 * (col__house_N_lpg); house 10's is mirrored to the other corner (the right one would stand 0.6 m from plot_w).
 */
export const HOUSE_LPG: Readonly<LocalRect> = Object.freeze({ x0: 3.5, x1: 4.9, z0: -6.005, z1: R6(HOUSE_BODY_BACK - HOUSE_A8.plinthOut) });
export const HOUSES_LPG_MIRRORED: readonly string[] = Object.freeze(["house_10"]);

/** A house's LPG cage, local. */
export function houseLpgLocal(id: string): LocalRect {
  return HOUSES_LPG_MIRRORED.includes(id) ? { ...HOUSE_LPG, x0: -HOUSE_LPG.x1, x1: -HOUSE_LPG.x0 } : { ...HOUSE_LPG };
}

/**
 * Flush decks (4.5 cm, lift 0 — walkable lawn-level timber, no steps): house 3's side deck west of the body (its local +x side;
 * the 1.8 m gap to house 6 is on the other side) and house 9's back deck where its garden was.
 */
export const HOUSE_FLUSH_DECKS: Readonly<Record<string, LocalRect>> = Object.freeze({
  house_3: Object.freeze({ x0: 5.6, x1: 7.6, z0: -2.005, z1: HOUSE_BODY_FRONT }),
  house_9: Object.freeze({ x0: -3, x1: 3, z0: R6(-HOUSE_Z_EDGE - 2.0), z1: R6(HOUSE_BODY_BACK - HOUSE_A8.plinthOut) }),
});

/** Game yaw of each door side (the local +z direction): parts_houses.py FACING. */
export const DOOR_YAW: Readonly<Record<Side, number>> = Object.freeze({ s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 });

type HouseFrame = Pick<SceneryHouse, "centre" | "doorSide">;

/** A local point (lx, lz) of a house as a world point: vlib.py loc() (x = cx + lx cos + lz sin, z = cz - lx sin + lz cos). */
export function houseLocalToWorld(h: HouseFrame, lx: number, lz: number): { x: number; z: number } {
  const { x: cx, z: cz } = h.centre;
  switch (h.doorSide) {
    case "s": return { x: R2(cx + lx), z: R2(cz + lz) };
    case "n": return { x: R2(cx - lx), z: R2(cz - lz) };
    case "e": return { x: R2(cx + lz), z: R2(cz - lx) };
    case "w": return { x: R2(cx - lz), z: R2(cz + lx) };
  }
}

/** A world point as a house's local point (the inverse of houseLocalToWorld, unrounded). */
export function houseWorldToLocal(h: HouseFrame, x: number, z: number): { lx: number; lz: number } {
  const dx = x - h.centre.x;
  const dz = z - h.centre.z;
  switch (h.doorSide) {
    case "s": return { lx: dx, lz: dz };
    case "n": return { lx: -dx, lz: -dz };
    case "e": return { lx: -dz, lz: dx };
    case "w": return { lx: dz, lz: -dx };
  }
}

/** A local rectangle of a house as a world box (to the centimetre, like the model's col__ boxes). */
export function localBox(h: HouseFrame, r: LocalRect): AABB {
  const a = houseLocalToWorld(h, r.x0, r.z0);
  const b = houseLocalToWorld(h, r.x1, r.z1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

/** The footprint's world size of a house facing `doorSide`: 11.2 along the front, 10.75 deep. */
export function houseFootprintSize(doorSide: Side): { x: number; z: number } {
  return doorSide === "n" || doorSide === "s" ? { x: HOUSE_A8.front, z: HOUSE_A8.depth } : { x: HOUSE_A8.depth, z: HOUSE_A8.front };
}

/** The body plus the plinth, local: the house's solid box and its camera box (col__house_N, 11.36 x 8.56). */
export const HOUSE_SOLID_LOCAL: Readonly<LocalRect> = Object.freeze({
  x0: -R6(HOUSE_BODY_HALF + HOUSE_A8.plinthOut),
  x1: R6(HOUSE_BODY_HALF + HOUSE_A8.plinthOut),
  z0: R6(HOUSE_BODY_BACK - HOUSE_A8.plinthOut),
  z1: R6(HOUSE_BODY_FRONT + HOUSE_A8.plinthOut),
});

/** The house's solid box in the world: body + plinth. */
export function houseSolidBox(h: HouseFrame): AABB {
  return localBox(h, HOUSE_SOLID_LOCAL);
}

export function porchKind(id: string): PorchKind {
  const k = HOUSE_PORCH_KIND[id];
  if (!k) throw new Error(`no porch kind for ${id}`);
  return k;
}

/** The porch slab (raised floorLift), local. */
export function porchSlabLocal(id: string): LocalRect {
  const s = PORCH_SPECS[porchKind(id)];
  return { x0: -s.halfSlab, x1: s.halfSlab, z0: HOUSE_BODY_FRONT, z1: HOUSE_Z_EDGE };
}

/** The steps, local, outermost last: tread k (0 = next to the porch) at height floorLift - (k + 1) * stepRise. */
export function porchTreadsLocal(id: string): Array<LocalRect & { top: number }> {
  const s = PORCH_SPECS[porchKind(id)];
  const out: Array<LocalRect & { top: number }> = [];
  for (let k = 0; k < HOUSE_A8.stepCount; k++) {
    out.push({
      x0: -s.halfStairs,
      x1: s.halfStairs,
      z0: R6(HOUSE_Z_EDGE + k * HOUSE_A8.stepTread),
      z1: R6(HOUSE_Z_EDGE + (k + 1) * HOUSE_A8.stepTread),
      top: R6(HOUSE_A8.floorLift - (k + 1) * HOUSE_A8.stepRise),
    });
  }
  return out;
}

/** The whole stair run (both treads), local: walkable, out in front of the footprint. */
export function porchStairsLocal(id: string): LocalRect {
  const t = porchTreadsLocal(id);
  return { x0: t[0]!.x0, x1: t[0]!.x1, z0: t[0]!.z0, z1: t[t.length - 1]!.z1 };
}

/** One small solid on a porch: id is the collider's name (col__<id>). */
export interface HouseCollider {
  id: string;
  box: AABB;
  camera: boolean;
}

/**
 * A house's porch colliders in a fixed order (their ids are the model's col__ nodes): porch_1 / porch_2 the left / right
 * flower beds (slab edge to the footprint's side edge, plinth to front edge), porch_3 / porch_4 the kerb beside the steps
 * (only where the slab is wider than the steps), then one per post left to right, then the deck bench.
 */
export function housePorchColliders(h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): HouseCollider[] {
  const kind = porchKind(h.id);
  const s = PORCH_SPECS[kind];
  const zf = HOUSE_SOLID_LOCAL.z1; // the plinth's front face
  const W = HOUSE_A8.front / 2;
  const rects: LocalRect[] = [
    { x0: -W, x1: -s.halfSlab, z0: zf, z1: HOUSE_Z_EDGE },
    { x0: s.halfSlab, x1: W, z0: zf, z1: HOUSE_Z_EDGE },
  ];
  if (s.halfSlab > s.halfStairs) {
    const z0 = R6(HOUSE_Z_EDGE - PORCH_FRONT_KERB);
    rects.push({ x0: -s.halfSlab, x1: -s.halfStairs, z0, z1: HOUSE_Z_EDGE }, { x0: s.halfStairs, x1: s.halfSlab, z0, z1: HOUSE_Z_EDGE });
  }
  for (const px of s.posts) rects.push({ x0: R6(px - PORCH_POST_HALF), x1: R6(px + PORCH_POST_HALF), z0: R6(s.postZ - PORCH_POST_HALF), z1: R6(s.postZ + PORCH_POST_HALF) });
  if (kind === "deck") rects.push({ x0: PORCH_BENCH.x0, x1: PORCH_BENCH.x1, z0: R6(PORCH_BENCH.z - PORCH_BENCH.halfDepth), z1: R6(PORCH_BENCH.z + PORCH_BENCH.halfDepth) });
  return rects.map((r, i) => ({ id: `${h.id}_porch_${i + 1}`, box: localBox(h, r), camera: false }));
}

/** The garden behind the house (col__garden_house_N), or none (house 9). */
export function houseGardenCollider(h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): HouseCollider | null {
  if (HOUSES_WITHOUT_GARDEN.includes(h.id)) return null;
  const dx = HOUSE_GARDEN_SHIFT[h.id] ?? 0;
  return { id: `garden_${h.id}`, box: localBox(h, { ...HOUSE_GARDEN, x0: R6(HOUSE_GARDEN.x0 + dx), x1: R6(HOUSE_GARDEN.x1 + dx) }), camera: false };
}

/** Every small solid of a house outside its body: porch pieces, the LPG cage, the garden. */
export function houseExteriorColliders(h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): HouseCollider[] {
  const g = houseGardenCollider(h);
  return [...housePorchColliders(h), { id: `${h.id}_lpg`, box: localBox(h, houseLpgLocal(h.id)), camera: false }, ...(g ? [g] : [])];
}

/** A rectangle of the ground the picture lifts (the porch slab or a tread), world box and height. */
export interface LiftZone {
  houseId: string;
  part: "porch" | "tread";
  box: AABB;
  lift: number;
}

/** A house's lifted ground: the porch slab at floorLift and each tread at its top (design 3.4). */
export function houseLiftZones(h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): LiftZone[] {
  const out: LiftZone[] = [{ houseId: h.id, part: "porch", box: localBox(h, porchSlabLocal(h.id)), lift: HOUSE_A8.floorLift }];
  for (const t of porchTreadsLocal(h.id)) out.push({ houseId: h.id, part: "tread", box: localBox(h, t), lift: t.top });
  return out;
}

/**
 * How high the picture lifts a body standing at (x, z) (m): the porch / deck slab 0.30, the treads 0.20 and 0.10, elsewhere 0.
 * Edges count as inside (the higher one wins where two touch). The client eases to this value (X3: ~0.12 s) and adds it to the
 * avatar, its name tag, speech bubble, foot shadow, the first-person eye and the camera's floor; the server never uses it.
 */
export function houseStepLift(x: number, z: number, zones: readonly LiftZone[]): number {
  let best = 0;
  for (const zn of zones) {
    if (zn.lift > best && x >= zn.box.minX && x <= zn.box.maxX && z >= zn.box.minZ && z <= zn.box.maxZ) best = zn.lift;
  }
  return best;
}

/** The porch bench's seat marker (houses 2, 9 and 10), in the model's seat__ marker form; null for the other houses. */
export function housePorchSeatMarker(h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): VillageSeatMarker | null {
  if (porchKind(h.id) !== "deck") return null;
  const c = houseLocalToWorld(h, (PORCH_BENCH.x0 + PORCH_BENCH.x1) / 2, PORCH_BENCH.z);
  return {
    id: `${h.id}_porch`,
    x: c.x,
    z: c.z,
    facing: h.doorSide,
    seatTop: PORCH_BENCH.seatTop,
    approach: "front",
    frontEdge: PORCH_BENCH.frontEdge,
    places: 1,
    length: R6(PORCH_BENCH.x1 - PORCH_BENCH.x0),
  };
}

// ─────────────────────────────── owner slots (design 6) ───────────────────────────────

export type HouseSlotKind = "nameplate" | "mailbox" | "sign";

/** The model's node of an owner slot: `slot__house_N_<kind>` (an empty, no parent, world position and yaw). */
export function houseSlotNode(houseId: string, kind: HouseSlotKind): string {
  return `slot__${houseId}_${kind}`;
}

/**
 * Where the owner slots are, local, and the board each one holds (width x height, m). y is above the lawn: the nameplate is
 * 1.6 m above the porch floor on the front wall right of the door (x 1.45), the mailbox's name strip 1.15 m above it on the
 * wall left of the door (x -1.55, on the box's front face 0.2 m out), the yard sign on a 1.2 m stake in the right-hand bed.
 * Every board faces the street (the door side's yaw).
 */
export const HOUSE_SLOTS: Readonly<Record<HouseSlotKind, { lx: number; lz: number; y: number; width: number; height: number }>> = Object.freeze({
  nameplate: Object.freeze({ lx: 1.45, lz: R6(HOUSE_BODY_FRONT + 0.02), y: R6(HOUSE_A8.floorLift + 1.6), width: 0.42, height: 0.16 }),
  mailbox: Object.freeze({ lx: -1.55, lz: R6(HOUSE_BODY_FRONT + 0.2), y: R6(HOUSE_A8.floorLift + 1.15), width: 0.2, height: 0.06 }),
  sign: Object.freeze({ lx: 4.2, lz: R6(HOUSE_Z_EDGE - 0.6), y: 0.925, width: 0.9, height: 0.55 }),
});

export interface HouseSlot {
  node: string;
  kind: HouseSlotKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
}

/** A house's three owner slots in the world. */
export function houseSlots(h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): HouseSlot[] {
  return (Object.keys(HOUSE_SLOTS) as HouseSlotKind[]).map((kind) => {
    const s = HOUSE_SLOTS[kind];
    const p = houseLocalToWorld(h, s.lx, s.lz);
    return { node: houseSlotNode(h.id, kind), kind, x: p.x, y: s.y, z: p.z, yaw: DOOR_YAW[h.doorSide], width: s.width, height: s.height };
  });
}

// ─────────────────────────────── the houses' own GLB (design 5) ───────────────────────────────

/** village_houses.glb's nodes: the always-drawn shell, the near-only detail, and village.glb's stand-in box per house. */
export function houseShellNode(houseId: string): string {
  return `houseshell__${houseId}`;
}
export function houseDetailNode(houseId: string): string {
  return `housedetail__${houseId}`;
}
/** village.glb keeps a 12-triangle box in the wall colour per house, drawn until village_houses.glb's shell has arrived. */
export function houseProxyNode(houseId: string): string {
  return `houseproxy__${houseId}`;
}

/** village_houses.glb's budgets (design 5.1, 8 A1-A5). */
export const HOUSE_GLB_BUDGET = Object.freeze({
  file: "village_houses.glb",
  maxBytes: 1.2 * 1024 * 1024,
  shellTriangles: 1_800,
  detailTriangles: 6_000,
  totalTriangles: 78_000,
  maxMaterials: 10,
  materials: Object.freeze(["LM_render", "LM_roof", "LM_stone", "LM_wood", "LM_metal", "M_glass", "M_window", "M_lamp", "M_leaf_flora", "M_screen"]),
  maxTextureSide: 2048,
  /** All ten shells merged, always drawn: at most this many draw calls; each house's detail at most `detailDraws`. */
  shellDraws: 8,
  detailDraws: 6,
  proxyTriangles: 12,
  lightmap: Object.freeze({ file: "village_houses_lm.webp", dayKB: 420, nightKB: 350, phoneDayKB: 220, phoneNightKB: 180 }),
});

/**
 * When a house's detail is drawn (X3): within `pc` m of the camera's target on PC, within `phone` m on a phone and then only
 * the `phoneNearest` nearest houses; a shown detail hides again only `hysteresis` m farther out. The layout keeps at most
 * `pcMaxNear` houses within `pc` m of any point (houseExterior.test.ts).
 */
export const HOUSE_DETAIL_LOD = Object.freeze({ pc: 35, phone: 25, phoneNearest: 2, pcMaxNear: 4, hysteresis: 4 });

/**
 * The village scene's triangle ceiling (village.glb + the bus + the always-drawn extras + the house shells + the near houses'
 * detail at its worst): PC (high tier) 310k since the owner's Q3 (2026-11-16), the phone 300k as before.
 */
export const VILLAGE_SCENE_TRIANGLE_CAP = Object.freeze({ pc: 310_000, phone: 300_000 });

/** Worst-case scene triangles: the base scene, every shell and the most detail one tier draws at once. */
export function worstSceneTriangles(base: number, shells: number, maxDetail: number, tier: "pc" | "phone"): number {
  const near = tier === "pc" ? HOUSE_DETAIL_LOD.pcMaxNear : HOUSE_DETAIL_LOD.phoneNearest;
  return base + shells + near * maxDetail;
}

// ─────────────────────────────── surfaces: photo-real PBR (owner 2026-11-16) ───────────────────────────────

/**
 * Owner, 2026-11-16: "전체 건물 땅 사물들이 모두 실제와 비슷한 느낌의 질감이 느껴져야해". Every visible surface of a house — walls,
 * plinth, roof, trims (fascia, sills, lintels, gutters, downpipes), doors, window frames, porch / deck / steps — is a photo-real
 * PBR material: an albedo, a tangent-space normal and a roughness map (CC0 scans are fine: ambientCG, Poly Haven; the source goes
 * in art/village/refs/exterior/SOURCES.txt). No flat colour: a surface whose material has no albedo texture, or whose albedo is
 * one colour, fails review (reviewers check every close-up in 8 C1). Glass, the lamp glow and the flower cards are exempt.
 *
 * Texel density (albedo pixels per metre of surface): `firstPerson` for everything a standing body can reach or look at from
 * 1-3 m (walls up to 3.5 m, plinth, doors, frames, sills, porch, deck, steps, posts, rails), `far` for what is only seen from
 * the street (upper walls above 3.5 m, roof, chimney, gutters). Tiling sets (one per surface family, `sets`) repeat across a
 * house, tinted per house in the shader for the owner's pastel colours; the light map stays separate (its texels are coarse).
 * The village's ground and props follow the same rule in their own work; this contract covers the houses.
 */
export const HOUSE_SURFACE_RULES = Object.freeze({
  pbr: Object.freeze(["albedo", "normal", "roughness"] as const),
  texelsPerMetre: Object.freeze({ firstPerson: 512, far: 256 }),
  firstPersonMaxHeight: 3.5,
  /** One tiling set per surface family, each map <= `mapSide` px, WebP (normal: lossless or q >= 90). */
  sets: Object.freeze(["render", "granite", "shingle", "oak", "pvc_frame", "metal_painted", "timber_cladding"] as const),
  mapSide: 1024,
  /** Download budget of all the houses' sets together (all maps), so the first visit stays within design 5.1 D3. */
  setsMaxBytes: 3 * 1024 * 1024,
  exempt: Object.freeze(["M_glass", "M_lamp", "M_leaf_flora", "M_screen"] as const),
});
