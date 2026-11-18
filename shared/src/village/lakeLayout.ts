/**
 * 케이슨 낚시터 (A10): the fishing lake east of the village, as data. The ONE source of numbers for the lake — read by the
 * server (collision, later the fishing rules), the client (walking, the scene, the HUD) and the Blender scripts of the art
 * chunks (A terrain/water, B structures, C gear), which get the same numbers through `art/lake/layout.json`
 * (scripts/export-lake-layout.ts). Design: docs/designs/lake-fishing/design.md (chapters 2-3 and 13), numbers from
 * docs/designs/lake-fishing/mockup_src/lake_layout.py.
 *
 * Browser-safe and data-driven, like villageLayout.ts: plain numbers and the shared collision types. Village frame:
 * x east, z south (north is -z), metres; the walking floor is y = 0 everywhere (the server judges steps in 2D); the water
 * surface lies at y = -0.55, 55 cm under the decks. Yaw follows the game's `atan2(dirX, dirZ)` (0 faces +z).
 *
 * Owner decisions (2026-11-16, "추천대로"): the lake lies EAST of the village, the sign reads "케이슨 낚시터", rods are free
 * and unlimited, 30 fishing spots = the room's capacity. Those are the parameters in `LAKE_PARAMS`; the geometry below is
 * the approved east layout.
 *
 * What walks and what does not: inside `LAKE_COLLIDER_AREA` everything outside the walkable ground is a collider box
 * (`lakeTerrainColliders`: water with a 0.8 m bank, hills and forest, ground beyond the walk limit — a 0.5 m grid painted
 * and merged into boxes, the decks cut out exactly), plus the facilities' boxes (`lakeGreyboxColliders`). Both sit in
 * `villageGeometry`, so a lake player is simply a village player further east (`Player.area` stays "village").
 */

import type { AABB, CameraBox } from "../collision";
import { isBlocked } from "../collision";
import { SIT_POSE, SIT_ROOT_AHEAD } from "../sitPose";
import { PLAYER_RADIUS, type Seat } from "../worldMap";

/** A point on the ground plane. */
export interface LakePoint {
  x: number;
  z: number;
}

/** Non-geometry defaults the owner approved; the art and the HUD read them from here, so changing one is one edit. */
export const LAKE_PARAMS = {
  /** Where the lake lies relative to the village. */
  side: "east",
  /** The sign of the whole place and of the office building. */
  signText: "케이슨 낚시터",
  officeSignText: "케이슨 낚시터 · 관리소",
  rentalSignText: "낚싯대 무료 대여",
  /** The rod (민장대, 2 칸 = 3.6 m); free and unlimited. */
  rodName: "2칸 민장대",
  rentalFree: true,
  /** Fishing spots = the room's capacity (VILLAGE_MAX_CLIENTS; the test pins it). */
  spotCount: 30,
  /** The float lands this far ahead of a spot (rod 3.6 m + line), metres. */
  castMetres: 6,
  /** Any two floats are at least this far apart (m). */
  floatSpacingMetres: 3,
  /** A float must land at least this far from the shoreline (m): in the water, not on the mud (P02 is the tightest, 1.25 m). */
  floatShoreMarginMetres: 1,
  /** Mud bank between the water and the walkable ground (m). */
  bankMetres: 0.8,
  /** The rental pad's radius (m): within it the rod is lent (server check is a little wider). */
  rentalPadRadius: 2.5,
} as const;

/** Walkable floor and water surface heights (m). */
export const LAKE_FLOOR_Y = 0;
export const LAKE_WATER_Y = -0.55;

/** The lake zone: the walkable rectangle that joins the village at x = 95.5 (a village ground grid line, height 0). */
export const LAKE_AREA: AABB = { minX: 95.5, maxX: 186, minZ: -69.5, maxZ: 45.5 };

/**
 * Where the lake's colliders are laid (the lake zone, plus the 0.5 m strip west of it that the village's own east edge
 * leaves: the old blocker began at x = 95). The strip is open ground like the zone beside it.
 */
export const LAKE_COLLIDER_AREA: AABB = { minX: 95, maxX: 186, minZ: -69.5, maxZ: 45.5 };

/** The shoreline (water's edge), clockwise from the north-west. 18 points, about 67 x 92 m, ~5,300 m2. */
export const LAKE_SHORE: readonly LakePoint[] = pts([
  [113, -44], [120, -53], [133, -58], [150, -57], [165, -50], [175, -36], [178, -18], [176, 0],
  [179, 14], [171, 27], [155, 34], [138, 33], [124, 28], [115, 19], [111, 6], [112, -8], [111, -24], [110, -36],
]);

/** The outer limit of walkable ground (before the water and its bank are taken out, and the decks put back). */
export const LAKE_WALK: readonly LakePoint[] = pts([[95.5, -66], [152, -66], [152, -58], [157, 34.5], [157, 43], [95.5, 43]]);

/** `lane_lake`, the 2.5 m dirt path from the bus lane's end to the pier's mouth. */
export const LAKE_TRAIL: readonly LakePoint[] = pts([[38.5, 1.0], [52, 0.2], [66, -6], [80, -9], [95.5, -10], [106, -12]]);
export const LAKE_TRAIL_WIDTH = 2.5;

/** Decks: the walkable timber over the water (top at y 0, 55 cm over the water). */
export const LAKE_PIER: AABB = { minX: 106, maxX: 140, minZ: -13.5, maxZ: -10.5 }; // 잔교
export const LAKE_PIER_T: AABB = { minX: 140, maxX: 146, minZ: -18, maxZ: -6 }; // T-end
export const LAKE_WALKWAY_A: AABB = { minX: 142.1, maxX: 143.9, minZ: -26, maxZ: -18 }; // 부교 to 좌대 A
export const LAKE_WALKWAY_B: AABB = { minX: 142.1, maxX: 143.9, minZ: -6, maxZ: 2 };
export const LAKE_JWADAE_A: AABB = { minX: 139, maxX: 147, minZ: -33, maxZ: -26 }; // 좌대 A (8 x 7)
export const LAKE_JWADAE_B: AABB = { minX: 139, maxX: 147, minZ: 2, maxZ: 9 };
export const LAKE_HUT_A: AABB = { minX: 141.5, maxX: 144.5, minZ: -30.5, maxZ: -28 }; // log hut on the 좌대 (solid, 3 x 2.5)
export const LAKE_HUT_B: AABB = { minX: 141.5, maxX: 144.5, minZ: 4.5, maxZ: 7 };
export const LAKE_DECKS: readonly { id: string; box: AABB }[] = [
  { id: "pier", box: LAKE_PIER },
  { id: "pier_t", box: LAKE_PIER_T },
  { id: "walkway_a", box: LAKE_WALKWAY_A },
  { id: "walkway_b", box: LAKE_WALKWAY_B },
  { id: "jwadae_a", box: LAKE_JWADAE_A },
  { id: "jwadae_b", box: LAKE_JWADAE_B },
];

/** 관리소 겸 대여점 (8 x 5.5): the window faces south, onto the rental pad. */
export const LAKE_SHOP: AABB = { minX: 98, maxX: 106, minZ: -25, maxZ: -19.5 };
export const LAKE_RENTAL_PAD: LakePoint & { radius: number } = { x: 102, z: -16.8, radius: LAKE_PARAMS.rentalPadRadius };
/** 정자 (6 x 6) on the south-west shore. */
export const LAKE_PAVILION = { centre: { x: 112, z: 33.5 } as LakePoint, size: 6 } as const;

/** The four sides a spot can face (compass), plus the two diagonals of the shore spots. */
export type LakeFace = "n" | "s" | "e" | "w" | "ne" | "se";
export const LAKE_FACE_DIR: Readonly<Record<LakeFace, LakePoint>> = {
  n: { x: 0, z: -1 },
  s: { x: 0, z: 1 },
  e: { x: 1, z: 0 },
  w: { x: -1, z: 0 },
  ne: { x: 0.7071, z: -0.7071 },
  se: { x: 0.7071, z: 0.7071 },
};

export type LakeSpotGroup = "pier" | "jwadae_a" | "jwadae_b" | "shore_n" | "shore_s";

/** One of the 30 fishing spots. `anchor` is the mock-up's point (the deck edge / the shore ground); the float lands `castMetres` ahead. */
export interface LakeFishingSpot {
  id: string;
  group: LakeSpotGroup;
  anchor: LakePoint;
  face: LakeFace;
  /** Facing as a game yaw (atan2(dirX, dirZ)). */
  yaw: number;
  /** Where the float lands (the spot's centre of scatter; the server scatters +-0.6 m by seed). */
  float: LakePoint;
}

const yawOf = (d: LakePoint) => Math.atan2(d.x, d.z);

function makeSpots(): LakeFishingSpot[] {
  const raw: Array<[string, LakeSpotGroup, number, number, LakeFace]> = [];
  let n = 1;
  for (const x of [111, 115, 119, 123, 127, 131, 135]) {
    // the pier, both sides (14)
    raw.push([`P${String(n).padStart(2, "0")}`, "pier", x + 2, -13.5, "n"]);
    n++;
    raw.push([`P${String(n).padStart(2, "0")}`, "pier", x + 2, -10.5, "s"]);
    n++;
  }
  raw.push(["P15", "pier", 146, -15, "e"], ["P16", "pier", 146, -9, "e"]);
  raw.push(["A1", "jwadae_a", 141, -33, "n"], ["A2", "jwadae_a", 145, -33, "n"], ["A3", "jwadae_a", 139, -29.5, "w"], ["A4", "jwadae_a", 147, -29.5, "e"]);
  raw.push(["B1", "jwadae_b", 141, 9, "s"], ["B2", "jwadae_b", 145, 9, "s"], ["B3", "jwadae_b", 139, 5.5, "w"], ["B4", "jwadae_b", 147, 5.5, "e"]);
  raw.push(["N1", "shore_n", 115.5, -50.5, "se"], ["N2", "shore_n", 129, -59.5, "s"], ["N3", "shore_n", 142, -60, "s"]);
  raw.push(["S1", "shore_s", 121.5, 30.5, "ne"], ["S2", "shore_s", 133, 35, "n"], ["S3", "shore_s", 147, 36.5, "n"]);
  return raw.map(([id, group, x, z, face]) => {
    const d = LAKE_FACE_DIR[face];
    return {
      id,
      group,
      anchor: { x, z },
      face,
      yaw: yawOf(d),
      float: { x: round(x + d.x * LAKE_PARAMS.castMetres), z: round(z + d.z * LAKE_PARAMS.castMetres) },
    };
  });
}

/** The 30 fishing spots in seat order: pier (P01..P16), 좌대 A, 좌대 B, north shore, south shore. */
export const LAKE_FISHING_SPOTS: readonly LakeFishingSpot[] = Object.freeze(makeSpots().map((s) => Object.freeze(s)));

/** Backed benches facing the water (visual 1.86 x 0.6 m, like the plaza's), centres. */
export const LAKE_BENCHES: readonly (LakePoint & { id: string; face: "e" })[] = [
  { id: "bench_1", x: 104.5, z: -32, face: "e" },
  { id: "bench_2", x: 104.5, z: 2, face: "e" },
  { id: "bench_3", x: 104.5, z: 10, face: "e" },
];
/** Picnic tables (backless long benches either side of a 0.9 x 2.4 m top, long side along z), centres. */
export const LAKE_PICNIC: readonly (LakePoint & { id: string })[] = [
  { id: "picnic_1", x: 99.5, z: 4.5 },
  { id: "picnic_2", x: 99.5, z: 12.5 },
];
/**
 * Lamp posts. 2-4 stand on the pier's north edge and the T-end's corner (F, 2026-11-16: D1 had them at z -15.2 / -19, on piles
 * in the water); between the pier's fishing chairs (x 113, 117, ... 137), clear of the chairs' get-up spots.
 */
export const LAKE_LAMPS: readonly LakePoint[] = pts([[110, -15.2], [119, -13.32], [131, -13.32], [140.3, -17.8], [103, -14.5], [108, 0]]);
/** Reed beds: centre and radius (m). Visual only (they stand on the mud bank). */
export const LAKE_REEDS: readonly { centre: LakePoint; radius: number }[] = [
  { centre: { x: 112, z: -40 }, radius: 4.5 }, { centre: { x: 123, z: 24 }, radius: 6 }, { centre: { x: 170, z: -40 }, radius: 9 },
  { centre: { x: 174, z: 18 }, radius: 8 }, { centre: { x: 112, z: 12 }, radius: 3.5 }, { centre: { x: 160, z: 32 }, radius: 6 },
];

/**
 * Small solid facility props beside the office (rod rack, vending machine, the blue bin for invasive fish). Provisional
 * greybox boxes: the art chunk B draws them and its `col__lake_*` boxes replace these.
 */
export const LAKE_PROPS: readonly { id: string; box: AABB }[] = [
  { id: "rod_rack", box: { minX: 106.3, maxX: 107.5, minZ: -22.4, maxZ: -21.6 } },
  { id: "vending", box: { minX: 106.3, maxX: 107.2, minZ: -21, maxZ: -20 } },
  { id: "invasive_bin", box: { minX: 106.3, maxX: 107.1, minZ: -24.4, maxZ: -23.6 } },
];

// ------------------------------------------------------------------------------------------------ geometry helpers

function pts(a: ReadonlyArray<readonly [number, number]>): LakePoint[] {
  return a.map(([x, z]) => ({ x, z }));
}
function round(v: number, d = 1e6): number {
  return Math.round(v * d) / d;
}
const inBox = (x: number, z: number, b: AABB) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

function distToSegment(px: number, pz: number, a: LakePoint, b: LakePoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

/** Distance (m) from a point to the nearest edge of a closed polygon. */
export function distToPolygonEdge(x: number, z: number, poly: readonly LakePoint[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegment(x, z, poly[i]!, poly[(i + 1) % poly.length]!));
  return best;
}

/** Ray-casting point in polygon (a point exactly on an edge may fall either way). */
function rayInside(x: number, z: number, poly: readonly LakePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

/** Point in polygon; a point on an edge counts as inside. */
export function insidePolygon(x: number, z: number, poly: readonly LakePoint[]): boolean {
  return rayInside(x, z, poly) || distToPolygonEdge(x, z, poly) < 1e-9;
}

/** On a deck (its box, edges included). */
export function onLakeDeck(x: number, z: number): boolean {
  return LAKE_DECKS.some((d) => inBox(x, z, d.box));
}

/** In the water (inside the shoreline). */
export function inLakeWater(x: number, z: number): boolean {
  return insidePolygon(x, z, LAKE_SHORE);
}

/** Walk limit used for colliders: the same polygon, its west edge reaching the village's east edge (x 95). */
const WALK_FOR_COLLIDERS: readonly LakePoint[] = LAKE_WALK.map((p) => (p.x === 95.5 ? { x: 95, z: p.z } : p));

/** Walkable terrain, decks not counted: inside the walk limit, off the water and its bank. */
function groundOk(x: number, z: number): boolean {
  if (!insidePolygon(x, z, WALK_FOR_COLLIDERS)) return false;
  return !rayInside(x, z, LAKE_SHORE) && distToPolygonEdge(x, z, LAKE_SHORE) >= LAKE_PARAMS.bankMetres;
}

/** The ground a body can stand on, before facility boxes: open ground or a deck. */
export function lakeWalkable(x: number, z: number): boolean {
  return onLakeDeck(x, z) || groundOk(x, z);
}

// ------------------------------------------------------------------------------------------------ colliders

const GRID = 0.5;

/** `box` minus `cut`: up to four boxes that tile what remains. */
function subtract(box: AABB, cut: AABB): AABB[] {
  if (cut.maxX <= box.minX || cut.minX >= box.maxX || cut.maxZ <= box.minZ || cut.minZ >= box.maxZ) return [box];
  const out: AABB[] = [];
  const cx0 = Math.max(box.minX, cut.minX);
  const cx1 = Math.min(box.maxX, cut.maxX);
  if (box.minZ < cut.minZ) out.push({ minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: cut.minZ });
  if (cut.maxZ < box.maxZ) out.push({ minX: box.minX, maxX: box.maxX, minZ: cut.maxZ, maxZ: box.maxZ });
  const z0 = Math.max(box.minZ, cut.minZ);
  const z1 = Math.min(box.maxZ, cut.maxZ);
  if (box.minX < cx0) out.push({ minX: box.minX, maxX: cx0, minZ: z0, maxZ: z1 });
  if (cx1 < box.maxX) out.push({ minX: cx1, maxX: box.maxX, minZ: z0, maxZ: z1 });
  return out;
}

let terrainCache: AABB[] | null = null;

/**
 * The boxes that keep players on the walkable ground: the lake zone painted on a 0.5 m grid (a cell is solid when any of
 * its 3 x 3 inset sample points is not walkable ground), merged into boxes (rows, then equal rows), with the decks cut
 * out exactly. Deterministic. Every solid band is as thick as the water/hill it stands for or the village's gap blockers
 * behind it, far more than one legal step (4.8 m) wherever two walkable places are separate.
 */
export function lakeTerrainColliders(): readonly AABB[] {
  if (terrainCache) return terrainCache;
  const a = LAKE_COLLIDER_AREA;
  const cols = Math.round((a.maxX - a.minX) / GRID);
  const rows = Math.round((a.maxZ - a.minZ) / GRID);
  const offsets = [0.1, 0.25, 0.4];
  const solidCell = (c: number, r: number): boolean => {
    for (const ox of offsets) for (const oz of offsets) if (!groundOk(a.minX + c * GRID + ox, a.minZ + r * GRID + oz)) return true;
    return false;
  };
  const boxes: AABB[] = [];
  let open = new Map<string, AABB>(); // runs of the previous row, by "c0:c1"
  for (let r = 0; r < rows; r++) {
    const next = new Map<string, AABB>();
    let c = 0;
    while (c < cols) {
      if (!solidCell(c, r)) {
        c++;
        continue;
      }
      const c0 = c;
      while (c < cols && solidCell(c, r)) c++;
      const key = `${c0}:${c}`;
      const above = open.get(key);
      const z0 = a.minZ + r * GRID;
      const z1 = a.minZ + (r + 1) * GRID;
      if (above) {
        above.maxZ = z1;
        next.set(key, above);
        open.delete(key);
      } else {
        const box: AABB = { minX: a.minX + c0 * GRID, maxX: a.minX + c * GRID, minZ: z0, maxZ: z1 };
        boxes.push(box);
        next.set(key, box);
      }
    }
    open = next;
  }
  let out = boxes;
  for (const d of LAKE_DECKS) out = out.flatMap((b) => subtract(b, d.box));
  terrainCache = out.map((b) => ({ minX: round(b.minX), maxX: round(b.maxX), minZ: round(b.minZ), maxZ: round(b.maxZ) }));
  return terrainCache;
}

/** Provisional benches' box (visual 1.86 long x 0.6 deep; backed). */
const BENCH_BOX = { along: 1.86, deep: 0.6 } as const;
/** A fishing chair's footprint (m): about 0.5 x 0.5, seat 0.46 m up (parts_cafe.py's chair is 0.42 wide). */
const CHAIR = { halfWidth: 0.21, backBehind: 0.26, frontEdge: 0.21, seatTop: 0.46 } as const;
/**
 * The sitter goes this much further forward on the chair than the bare torso needs (owner 2026-11-19: "캐릭터 옷이 의자를 살짝 뚫고 나오네",
 * a pink dress and an orange top went through the backrest). Measured from character.glb seated (Sit_Chair_Idle) with every outfit: the
 * bulkiest top / coat reaches 0.738 m behind the root at back height and the fattest skirt 0.68 m at seat height; the chair's back
 * panel face (build_chair: z -0.208 at its lower edge, leaning back) and uprights are 0.208 m behind the chair's centre, i.e. 0.668 m
 * behind the old root: the bare torso (0.71) was already inside it. With the gap the face is 0.768 m behind the root, 3 cm clear of
 * the bulkiest top; the butt (0.40 to 0.50 m behind the root) still rests on the seat (its front edge is 0.36 m behind the root) and
 * the hanging calves (0.22 m behind the root) stay clear of the front edge. The pier-edge chairs then have the root 1 cm past the deck's
 * edge (the avatar's own width is far more than that).
 */
export const CHAIR_BODY_GAP = 0.1;
/** Picnic table: top 0.9 wide x 2.4 long; benches 0.4 deep, centres 0.95 either side, seat 0.45 up. */
const PICNIC = { topX: 0.9, length: 2.4, benchCentre: 0.95, benchDeep: 0.4, seatTop: 0.45 } as const;
/** Pavilion benches: one 1.9 x 0.45 m board in the middle of each side, 2.55 m from the centre; posts at the corners. */
const PAVILION = { benchLength: 1.9, benchDeep: 0.45, benchCentre: 2.55, post: 0.3, postCentre: 2.85, seatTop: 0.45 } as const;
/** The porch bench against a hut's wall: 2.0 x 0.45 m. */
const PORCH = { length: 2, deep: 0.45, seatTop: 0.45 } as const;

const boxAround = (cx: number, cz: number, sx: number, sz: number): AABB => ({
  minX: round(cx - sx / 2),
  maxX: round(cx + sx / 2),
  minZ: round(cz - sz / 2),
  maxZ: round(cz + sz / 2),
});

/** A named facility collider; `node` is the `col__*` empty the Blender model carries for it (art chunk B). */
export interface LakeCollider {
  id: string;
  node: string;
  box: AABB;
}

const lakeNode = (id: string) => `col__lake_${id}`;

/** Where the benches/porch benches stand. Reused by the colliders and the seats. */
function porchBenches(): { id: string; box: AABB; centre: LakePoint; face: "n" | "s" }[] {
  // 좌대 A: against the hut's south wall, facing the walkway (south); 좌대 B: against the north wall, facing it (north)
  return [
    { id: "porch_a", centre: { x: 143, z: round(LAKE_HUT_A.maxZ + PORCH.deep / 2) }, face: "s", box: boxAround(143, LAKE_HUT_A.maxZ + PORCH.deep / 2, PORCH.length, PORCH.deep) },
    { id: "porch_b", centre: { x: 143, z: round(LAKE_HUT_B.minZ - PORCH.deep / 2) }, face: "n", box: boxAround(143, LAKE_HUT_B.minZ - PORCH.deep / 2, PORCH.length, PORCH.deep) },
  ];
}

/** The facilities' boxes with their ids (the greybox the Blender model must contain; B's `col__lake_*` boxes replace them). */
export function lakeGreyboxColliders(): LakeCollider[] {
  const c = (id: string, box: AABB): LakeCollider => ({ id, node: lakeNode(id), box });
  const out: LakeCollider[] = [c("shop", LAKE_SHOP), c("hut_a", LAKE_HUT_A), c("hut_b", LAKE_HUT_B)];
  for (const p of LAKE_PROPS) out.push(c(p.id, p.box));
  for (const b of porchBenches()) out.push(c(b.id, b.box));
  for (const b of LAKE_BENCHES) out.push(c(b.id, boxAround(b.x, b.z, BENCH_BOX.deep, BENCH_BOX.along)));
  const half = PICNIC.benchCentre + PICNIC.benchDeep / 2;
  for (const t of LAKE_PICNIC) out.push(c(t.id, boxAround(t.x, t.z, half * 2, PICNIC.length)));
  const pc = LAKE_PAVILION.centre;
  const P = PAVILION;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) out.push(c(`pavilion_post_${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`, boxAround(pc.x + sx * P.postCentre, pc.z + sz * P.postCentre, P.post, P.post)));
  for (const side of ["n", "s", "e", "w"] as const) {
    const horizontal = side === "n" || side === "s";
    const sign = side === "s" || side === "e" ? 1 : -1;
    out.push(c(`pavilion_bench_${side}`, horizontal ? boxAround(pc.x, pc.z + sign * P.benchCentre, P.benchLength, P.benchDeep) : boxAround(pc.x + sign * P.benchCentre, pc.z, P.benchDeep, P.benchLength)));
  }
  LAKE_LAMPS.forEach((l, i) => {
    if (lakeWalkable(l.x, l.z)) out.push(c(`lamp_${i + 1}`, boxAround(l.x, l.z, 0.3, 0.3)));
  });
  // the small things of lake_structures.glb that had no box (lake v2 audit, 2026-11-17): the counter shelf outside the rental
  // window (chest high, 0.42 m out), the awning's two posts, the info and welcome signs, the trash bins, the nets on the office's
  // west wall, the stacked chairs
  for (const p of LAKE_SMALL_PROPS) out.push(c(p.id, p.box));
  // the pipe railings of the decks (owner 2026-11-17: "낚시터에 난간을 그냥 통과해버려"): thin walls along every rail, open where the
  // rail is (the chairs, the walkways, the pier mouth); props for the camera (lakeCameraBoxes takes only the buildings)
  lakeRailSegments().forEach((r, i) => out.push(c(`rail_${i + 1}`, r.box)));
  return out;
}

/** Bounds of the small props of lake_structures.glb (docs/designs/lake-fishing/tools/parts_lake_structures.py). */
export const LAKE_SMALL_PROPS: readonly { id: string; box: AABB }[] = [
  { id: "shop_counter", box: { minX: 99.85, maxX: 104.15, minZ: -19.5, maxZ: -19.08 } },
  { id: "awning_post_w", box: { minX: 99.16, maxX: 99.36, minZ: -17.9, maxZ: -17.7 } },
  { id: "awning_post_e", box: { minX: 104.64, maxX: 104.84, minZ: -17.9, maxZ: -17.7 } },
  { id: "info_sign", box: { minX: 98.75, maxX: 100.45, minZ: -13.8, maxZ: -13.6 } },
  { id: "welcome_sign", box: { minX: 97.22, maxX: 97.41, minZ: -14.6, maxZ: -12 } },
  { id: "trash", box: { minX: 106.58, maxX: 107.12, minZ: -21.57, maxZ: -21.02 } },
  { id: "nets", box: { minX: 97.76, maxX: 98, minZ: -23, maxZ: -20.8 } },
  { id: "chair_stack", box: { minX: 98.43, maxX: 98.89, minZ: -19.5, maxZ: -19.38 } },
];

/** A railing's run: the line a -> b at the rail (x, z), the openings cut out. */
export interface LakeRail {
  deck: string;
  a: LakePoint;
  b: LakePoint;
  /** The box a body cannot cross (the rail line, RAIL_THICK thick). */
  box: AABB;
}

/** How thick a rail's wall is (m): the posts and the pipes (5 cm) and a little; the body's radius keeps it off the rail. */
export const RAIL_THICK = 0.1;

/**
 * Every railing run of the decks, as docs/designs/lake-fishing/tools/parts_lake_structures.py builds them: the pier's entrance
 * rails (from the mouth to the first chair), the T-end's four edges (opened at the pier, at both walkways and in front of P15 /
 * P16), the walkways' two sides, the 좌대' four edges (opened in front of each chair and where the walkway joins). Only the runs
 * between openings: the openings stay open.
 */
export function lakeRailSegments(): readonly LakeRail[] {
  if (railCache) return railCache;
  const out: LakeRail[] = [];
  const t = RAIL_THICK / 2;
  // a run a -> b along x (z fixed) or along z (x fixed), minus the openings [from, to] in metres from a
  const run = (deck: string, a: LakePoint, b: LakePoint, openings: Array<[number, number]>) => {
    const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
    const len = alongX ? b.x - a.x : b.z - a.z;
    const cuts = openings.map(([o0, o1]) => [Math.max(0, Math.min(o0, o1)), Math.min(len, Math.max(o0, o1))] as [number, number]).sort((p, q) => p[0] - q[0]);
    let s0 = 0;
    const pieces: Array<[number, number]> = [];
    for (const [c0, c1] of cuts) {
      if (c0 > s0) pieces.push([s0, c0]);
      s0 = Math.max(s0, c1);
    }
    if (s0 < len) pieces.push([s0, len]);
    for (const [p0, p1] of pieces) {
      if (p1 - p0 < 0.05) continue;
      const pa = alongX ? { x: a.x + p0, z: a.z } : { x: a.x, z: a.z + p0 };
      const pb = alongX ? { x: a.x + p1, z: a.z } : { x: a.x, z: a.z + p1 };
      const box = alongX
        ? { minX: pa.x - t, maxX: pb.x + t, minZ: pa.z - t, maxZ: pa.z + t }
        : { minX: pa.x - t, maxX: pa.x + t, minZ: pa.z - t, maxZ: pb.z + t };
      out.push({ deck, a: pa, b: pb, box });
    }
  };
  const spots = (g: string) => LAKE_FISHING_SPOTS.filter((s) => s.group === g);
  // the pier: entrance rails both sides, from the mouth to x 111 (the fishing sides have a kerb, no rail)
  {
    const d = LAKE_PIER;
    for (const z of [d.minZ + 0.1, d.maxZ - 0.1]) run("pier", { x: d.minX + 0.1, z }, { x: 111, z }, []);
  }
  // the T-end
  {
    const d = LAKE_PIER_T;
    const i = 0.1;
    const ch = [LAKE_FISHING_SPOTS.find((s) => s.id === "P15")!.anchor.z, LAKE_FISHING_SPOTS.find((s) => s.id === "P16")!.anchor.z];
    run("pier_t", { x: d.maxX - i, z: d.minZ + i }, { x: d.maxX - i, z: d.maxZ - i }, ch.map((c) => [c - d.minZ - i - 0.8, c - d.minZ - i + 0.8]));
    run("pier_t", { x: d.minX + i, z: d.minZ + i }, { x: d.minX + i, z: d.maxZ - i }, [[LAKE_PIER.minZ - d.minZ - i, LAKE_PIER.maxZ - d.minZ - i]]);
    run("pier_t", { x: d.minX + i, z: d.minZ + i }, { x: d.maxX - i, z: d.minZ + i }, [[LAKE_WALKWAY_A.minX - d.minX - i, LAKE_WALKWAY_A.maxX - d.minX - i]]);
    run("pier_t", { x: d.minX + i, z: d.maxZ - i }, { x: d.maxX - i, z: d.maxZ - i }, [[LAKE_WALKWAY_B.minX - d.minX - i, LAKE_WALKWAY_B.maxX - d.minX - i]]);
  }
  // the walkways: both sides, continuous
  for (const [id, d] of [["walkway_a", LAKE_WALKWAY_A], ["walkway_b", LAKE_WALKWAY_B]] as const) {
    run(id, { x: d.minX + 0.08, z: d.minZ + 0.1 }, { x: d.minX + 0.08, z: d.maxZ - 0.1 }, []);
    run(id, { x: d.maxX - 0.08, z: d.minZ + 0.1 }, { x: d.maxX - 0.08, z: d.maxZ - 0.1 }, []);
  }
  // the 좌대: four edges, opened in front of each chair (+-0.8 m) and where the walkway joins
  for (const [id, d, faceIn, wk] of [["jwadae_a", LAKE_JWADAE_A, "s", LAKE_WALKWAY_A], ["jwadae_b", LAKE_JWADAE_B, "n", LAKE_WALKWAY_B]] as const) {
    const i = 0.1;
    const edges: Record<"n" | "s" | "w" | "e", [LakePoint, LakePoint, "x" | "z"]> = {
      n: [{ x: d.minX + i, z: d.minZ + i }, { x: d.maxX - i, z: d.minZ + i }, "x"],
      s: [{ x: d.minX + i, z: d.maxZ - i }, { x: d.maxX - i, z: d.maxZ - i }, "x"],
      w: [{ x: d.minX + i, z: d.minZ + i }, { x: d.minX + i, z: d.maxZ - i }, "z"],
      e: [{ x: d.maxX - i, z: d.minZ + i }, { x: d.maxX - i, z: d.maxZ - i }, "z"],
    };
    for (const side of ["n", "s", "w", "e"] as const) {
      const [a, b, ax] = edges[side];
      const ops: Array<[number, number]> = [];
      for (const sp of spots(id)) {
        if (sp.face !== side) continue;
        const c = ax === "x" ? sp.anchor.x : sp.anchor.z;
        const lo = ax === "x" ? a.x : a.z;
        ops.push([c - lo - 0.8, c - lo + 0.8]);
      }
      if (side === faceIn) ops.push([wk.minX - a.x - 0.02, wk.maxX - a.x + 0.02]);
      run(id, a, b, ops);
    }
  }
  railCache = out;
  return out;
}
let railCache: LakeRail[] | null = null;

/**
 * The facilities the third-person camera must not enter (the spring arm of cameraCollision.ts casts against these): the office,
 * the log huts and the lamp posts, with the heights of their walls. Low furniture (benches, tables, the rod rack) is looked over,
 * as in the village. B's `col__lake_*` camera boxes replace these when the facilities model lands.
 */
export function lakeCameraBoxes(): readonly CameraBox[] {
  const height: Record<string, number> = { shop: 4.4, hut_a: 2.9, hut_b: 2.9 };
  return lakeGreyboxColliders()
    .filter((g) => g.id in height || g.id.startsWith("lamp_"))
    .map((g) => ({ ...g.box, height: height[g.id] ?? 4.4 }));
}

let allCache: AABB[] | null = null;

/** Every box of the lake: the terrain's, then the facilities'. These go into `villageGeometry`. */
export function lakeColliders(): readonly AABB[] {
  if (!allCache) allCache = [...lakeTerrainColliders(), ...lakeGreyboxColliders().map((g) => g.box)];
  return allCache;
}

// ------------------------------------------------------------------------------------------------ seats

/** How a seat is sat on. */
export type LakeSeatKind = "fishing_chair" | "bench" | "picnic" | "pavilion" | "porch";
export type LakeApproach = "front" | "side" | "either";

/**
 * A lake seat. Owner rule (seating, 2026-11-13): every seat can be sat on; a backed one only from its front.
 *  - `front` (a backed bench, a porch bench): sat on from in front of its front edge (`Seat.frontEdge`); one yaw.
 *  - `side` (a fishing chair, its front is the water): sat on from beside it, in front of its backrest (`Seat.beside`).
 *  - `either` (backless: picnic benches, pavilion boards): from either side; the sitter faces the way they came (rule P6).
 *    `Seat.x/z` is the middle of the board (not the avatar root): the root is `rootAhead` ahead of it along the facing, so
 *    the hips are over the board whichever way the sitter faces. `Seat.yaw` and the stand spot are for the first side,
 *    `other` for the second. A picnic bench's table side is solid: its second side stands up on the first side's spot.
 */
export interface LakeSeat extends Seat {
  id: string;
  kind: LakeSeatKind;
  /** Which spot (fishing seats): the chair of `LAKE_FISHING_SPOTS[...]`. */
  spot?: string;
  /** The bench or table this seat is on (the same words as the collider ids). */
  bench: string;
  backed: boolean;
  approach: LakeApproach;
  other?: { yaw: number; standX: number; standZ: number };
  /** Backless seats: how far ahead of (x, z) the sitter's root goes along the facing (m). */
  rootAhead?: number;
  /** Backless seats: the board's depth across the facing (m). */
  deep?: number;
}

const STAND_STEP = 0.05;
const STAND_SEARCH = 1.5;
const STAND_TURNS = [0, -0.26, 0.26, -0.52, 0.52, -0.79, 0.79] as const;
const STAND_CLEARANCE = 0.05;

function standsClear(x: number, z: number, obstacles: readonly AABB[]): boolean {
  return !isBlocked(x, z, PLAYER_RADIUS + STAND_CLEARANCE, obstacles, 0);
}

/** The nearest clear spot straight ahead of `root` facing `yaw` (or turned up to 45 degrees), 5 cm steps. */
function dismountAhead(root: LakePoint, yaw: number, obstacles: readonly AABB[], id: string): LakePoint {
  for (let d = 0; d <= STAND_SEARCH + 1e-9; d += STAND_STEP) {
    for (const turn of STAND_TURNS) {
      const a = yaw + turn;
      const x = round(root.x + Math.sin(a) * d, 1000);
      const z = round(root.z + Math.cos(a) * d, 1000);
      if (standsClear(x, z, obstacles)) return { x, z };
    }
  }
  throw new Error(`lake seat ${id}: no clear dismount spot ahead`);
}

/** A point `along` metres along a bench (its local x) and `ahead` metres along the facing from (x, z) — benchSeats.ts `offset`. */
function offsetAt(x: number, z: number, yaw: number, along: number, ahead: number): LakePoint {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x + along * c + ahead * s, z: z - along * s + ahead * c };
}

const FACING = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 } as const;
/** Two seats along a bench of `length`: the same offsets as benchSeats.ts `benchSeatOffsets`. */
function seatOffsets(length: number): [number, number] {
  const d = round(Math.min(0.6, length / 2 - 0.35), 1000);
  return [-d, d];
}

let seatCache: readonly LakeSeat[] | null = null;

/** The approach of a fishing chair: from beside it, anywhere in front of its backrest. */
function chairSeat(spot: LakeFishingSpot, obstacles: readonly AABB[]): LakeSeat {
  const f = LAKE_FACE_DIR[spot.face];
  // the chair stands 0.55 m inside the edge (its centre), facing out
  const centre = { x: spot.anchor.x - f.x * 0.55, z: spot.anchor.z - f.z * 0.55 };
  const rootAhead = CHAIR.frontEdge + SIT_ROOT_AHEAD + CHAIR_BODY_GAP;
  const root = { x: round(centre.x + f.x * rootAhead, 1000), z: round(centre.z + f.z * rootAhead, 1000) };
  const side = { x: Math.cos(spot.yaw), z: -Math.sin(spot.yaw) }; // the chair's right
  let stand: LakePoint | null = null;
  outer: for (const back of [0.7, 0.9, 0.5]) {
    for (const sign of [1, -1]) {
      const x = round(root.x + side.x * 1.1 * sign - f.x * back, 1000);
      const z = round(root.z + side.z * 1.1 * sign - f.z * back, 1000);
      if (standsClear(x, z, obstacles) && lakeWalkable(x, z)) {
        stand = { x, z };
        break outer;
      }
    }
  }
  if (!stand) throw new Error(`lake seat ${spot.id}: no clear get-up spot beside the chair`);
  const approachEdge = round(SIT_ROOT_AHEAD + CHAIR_BODY_GAP + CHAIR.frontEdge + CHAIR.backBehind, 1000);
  return {
    id: `chair_${spot.id}`,
    kind: "fishing_chair",
    spot: spot.id,
    bench: `chair_${spot.id}`,
    backed: true,
    approach: "side",
    x: root.x,
    z: root.z,
    yaw: spot.yaw,
    standX: stand.x,
    standZ: stand.z,
    seatY: CHAIR.seatTop,
    frontEdge: round(SIT_ROOT_AHEAD + CHAIR_BODY_GAP, 1000),
    approachEdge,
    beside: { lateral: round(CHAIR.halfWidth + PLAYER_RADIUS - 0.05, 1000), edge: round(approachEdge + 0.35, 1000) },
  };
}

/**
 * Seats along a bench, `faces` giving the facings: one entry = a backed bench, sat on from the front (the root goes
 * ahead of the front edge); two = a backless one, either side (the root goes `SIT_POSE.hipsBehindRoot` ahead of the
 * board's middle, the hips over the board). `innerBlocked`: the second side is a table, so it stands up on the first
 * side's spot.
 */
function benchSeats(opts: {
  id: string;
  kind: LakeSeatKind;
  centre: LakePoint;
  length: number;
  deep: number;
  seatTop: number;
  faces: readonly ("n" | "s" | "e" | "w")[];
  innerBlocked?: boolean;
  obstacles: readonly AABB[];
}): LakeSeat[] {
  const out: LakeSeat[] = [];
  const backless = opts.faces.length === 2;
  const frontEdge = opts.deep / 2;
  for (const along of seatOffsets(opts.length)) {
    const centre = offsetAt(opts.centre.x, opts.centre.z, FACING[opts.faces[0]!], along, 0);
    const sides = opts.faces.map((face) => {
      const yaw = FACING[face];
      const ahead = backless ? SIT_POSE.hipsBehindRoot : frontEdge + SIT_ROOT_AHEAD;
      const p = offsetAt(opts.centre.x, opts.centre.z, yaw, along, ahead);
      const root = { x: round(p.x, 1000), z: round(p.z, 1000) };
      return { yaw, root, stand: dismountAhead(root, yaw, opts.obstacles, `${opts.id}:${along}`) };
    });
    const first = sides[0]!;
    const seat: LakeSeat = {
      id: `${opts.id}_${out.length + 1}`,
      kind: opts.kind,
      bench: opts.id,
      backed: !backless,
      approach: backless ? "either" : "front",
      x: backless ? round(centre.x, 1000) : first.root.x,
      z: backless ? round(centre.z, 1000) : first.root.z,
      yaw: first.yaw,
      standX: first.stand.x,
      standZ: first.stand.z,
      seatY: opts.seatTop,
      ...(backless ? { rootAhead: SIT_POSE.hipsBehindRoot, deep: opts.deep } : { frontEdge: SIT_ROOT_AHEAD }),
    };
    if (backless) {
      const second = sides[1]!;
      const stand = opts.innerBlocked ? first.stand : second.stand;
      seat.other = { yaw: second.yaw, standX: stand.x, standZ: stand.z };
    }
    out.push(seat);
  }
  return out;
}

/**
 * Every lake seat, in a fixed order: the 30 fishing chairs (spot order), the 3 shore benches (2 seats each), the 2 picnic
 * tables' 4 long benches (2 seats each), the pavilion's 4 boards (2 each), the 2 porch benches (2 each) — 56 seats.
 * Positions are for a sitter's ROOT, as in benchSeats.ts. (Wiring into `Player.seatIndex` is a later chunk's job.)
 */
export function lakeSeats(): readonly LakeSeat[] {
  if (seatCache) return seatCache;
  const obstacles = lakeColliders();
  const seats: LakeSeat[] = [];
  for (const s of LAKE_FISHING_SPOTS) seats.push(chairSeat(s, obstacles));
  for (const b of LAKE_BENCHES) seats.push(...benchSeats({ id: b.id, kind: "bench", centre: b, length: BENCH_BOX.along, deep: BENCH_BOX.deep, seatTop: 0.445, faces: [b.face], obstacles }));
  for (const t of LAKE_PICNIC) {
    for (const side of [-1, 1]) {
      seats.push(
        ...benchSeats({
          id: `${t.id}_${side < 0 ? "w" : "e"}`,
          kind: "picnic",
          centre: { x: t.x + side * PICNIC.benchCentre, z: t.z },
          length: PICNIC.length,
          deep: PICNIC.benchDeep,
          seatTop: PICNIC.seatTop,
          faces: side < 0 ? ["w", "e"] : ["e", "w"], // outside first (where the sitter comes from), the table side second
          innerBlocked: true,
          obstacles,
        }),
      );
    }
  }
  const pc = LAKE_PAVILION.centre;
  for (const side of ["n", "s", "e", "w"] as const) {
    const horizontal = side === "n" || side === "s";
    const sign = side === "s" || side === "e" ? 1 : -1;
    const centre = horizontal ? { x: pc.x, z: pc.z + sign * PAVILION.benchCentre } : { x: pc.x + sign * PAVILION.benchCentre, z: pc.z };
    // inward first (toward the pavilion's middle), outward second
    const inward = side === "n" ? "s" : side === "s" ? "n" : side === "e" ? "w" : "e";
    const outward = side;
    seats.push(...benchSeats({ id: `pavilion_${side}`, kind: "pavilion", centre, length: PAVILION.benchLength, deep: PAVILION.benchDeep, seatTop: PAVILION.seatTop, faces: [inward, outward], obstacles }));
  }
  for (const b of porchBenches()) seats.push(...benchSeats({ id: b.id, kind: "porch", centre: b.centre, length: PORCH.length, deep: PORCH.deep, seatTop: PORCH.seatTop, faces: [b.face], obstacles }));
  seatCache = Object.freeze(seats.map((s) => Object.freeze(s)));
  return seatCache;
}

// ------------------------------------------------------------------------------------------------ export

/**
 * Everything the Blender scripts need, as plain JSON-able data (scripts/export-lake-layout.ts writes it to
 * art/lake/layout.json): the zone, shoreline, walk limit, trail, decks, office, pad, pavilion, spots with their float
 * points, seats, benches, tables, lamps, reeds, the facilities' colliders by `col__lake_*` node name, the seat marker
 * names (`seat__lake_*`, `spot__*`) and the terrain colliders. The same input gives the same output.
 */
export function exportLakeLayout() {
  const bounded = (b: AABB) => ({ ...b });
  return {
    format: "caysonverse-lake-layout",
    version: 1,
    axes: "metres; x east, z south (north is -z), walk floor at y = 0, water surface at y = -0.55; yaw 0 faces +z",
    params: LAKE_PARAMS,
    floorY: LAKE_FLOOR_Y,
    waterY: LAKE_WATER_Y,
    area: LAKE_AREA,
    colliderArea: LAKE_COLLIDER_AREA,
    shore: LAKE_SHORE,
    walk: LAKE_WALK,
    trail: { points: LAKE_TRAIL, width: LAKE_TRAIL_WIDTH },
    decks: LAKE_DECKS.map((d) => ({ id: d.id, ...bounded(d.box) })),
    huts: [{ id: "hut_a", ...bounded(LAKE_HUT_A) }, { id: "hut_b", ...bounded(LAKE_HUT_B) }],
    shop: { ...bounded(LAKE_SHOP), facing: "s", sign: LAKE_PARAMS.officeSignText, rentalSign: LAKE_PARAMS.rentalSignText },
    rentalPad: LAKE_RENTAL_PAD,
    pavilion: { ...LAKE_PAVILION, bounds: boxAround(LAKE_PAVILION.centre.x, LAKE_PAVILION.centre.z, LAKE_PAVILION.size, LAKE_PAVILION.size) },
    props: LAKE_PROPS.map((p) => ({ id: p.id, node: lakeNode(p.id), ...p.box })),
    spots: LAKE_FISHING_SPOTS.map((s) => ({ id: s.id, node: `spot__${s.id}`, group: s.group, anchor: s.anchor, face: s.face, yaw: s.yaw, float: s.float })),
    seats: lakeSeats().map((s) => ({
      id: s.id,
      node: `seat__lake_${s.id}`,
      kind: s.kind,
      spot: s.spot,
      bench: s.bench,
      approach: s.approach,
      backed: s.backed,
      x: s.x,
      z: s.z,
      yaw: s.yaw,
      standX: s.standX,
      standZ: s.standZ,
      seatY: s.seatY,
      other: s.other,
      rootAhead: s.rootAhead,
    })),
    benches: LAKE_BENCHES,
    picnicTables: LAKE_PICNIC,
    lamps: LAKE_LAMPS,
    reeds: LAKE_REEDS,
    colliders: lakeGreyboxColliders().map((g) => ({ id: g.id, node: g.node, ...g.box })),
    terrainColliders: lakeTerrainColliders(),
  };
}
