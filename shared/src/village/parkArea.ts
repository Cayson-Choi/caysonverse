/**
 * 케이슨랜드 — the park AREA (phase 2): `Player.area === "park"`. Browser-safe, pure data and rules; the SERVER (door, movement, arrival)
 * and every CLIENT (scene, map, targets) read the same numbers.
 *
 * The park is its own place, like the memorial hall and the houses: the village gate's door takes you in (`UseDoor` + the curtain), the village
 * model is not mounted while you are inside, and only the park's players are drawn. It has its OWN coordinate frame (the coaster's track-local
 * metres: x east, z SOUTH, the track's station at the origin), so it overlaps nothing in the village's space.
 *
 *     z = -190  gate arch (the way out) ........ the main promenade south to the star plaza
 *     z = -112  star plaza (fountain), paths west to the coaster queue and east to the future rides
 *     z = -46   the coaster's queue gate (boarding pad) .. -8 the queue pavilion .. -1.4 the station platform
 *     z >= 0    the coaster's circuit (fenced off: the park's south edge is z = -2.2)
 *
 * Seat ids: this file adds NONE to the village's seat table (docs/designs/caysonland/DESIGN.md section 2: 400+ is reserved, rides use rideSeat).
 */
import { LOT_DOOR_REACH_M, lotDoorPoint, villageLot } from "./villageLots";
import type { AABB } from "../collision";
import type { Bounds, MapGeometry } from "../school/geometry";
import { makeGeometry } from "../school/geometry";

export const PARK_AREA = "park" as const;
export type ParkAreaId = typeof PARK_AREA;

export function isParkArea(area: string): area is ParkAreaId {
  return area === PARK_AREA;
}

/** The playable rectangle (park-local metres). The south edge keeps everyone off the coaster's circuit. */
export const PARK_BOUNDS: Bounds = Object.freeze({ minX: -170, maxX: 380, minZ: -190, maxZ: -2.2 });

/** The gate arch's way-out pad and the arrival spot inside (park-local). */
export const PARK_EXIT_PAD = Object.freeze({ x: 40, z: -181, radius: 1.8 });
export const PARK_ARRIVAL = Object.freeze({ x: 40, z: -171, yaw: Math.PI }); // facing north is yaw PI (villageLayout FACING_NORTH)

/** The star plaza and its fountain. */
export const PARK_PLAZA = Object.freeze({ x: 40, z: -112, radius: 26, fountainHalf: 4 });

/** The coaster's queue gate: the boarding pad (the server's RideBoard reach is `COASTER_BOARD_REACH_M` from its centre). */
export const COASTER_QUEUE_PAD = Object.freeze({ x: -17, z: -46, radius: 3.2 });
export const COASTER_BOARD_REACH_M = 6;

/** The carousel's boarding pad (its entrance gate, south of the platform) and the wheel's (phase 2c). */
export const CAROUSEL_PAD = Object.freeze({ x: 110, z: -119, radius: 3 });
/** The wheel's boarding pad: on the grass at the foot of the platform steps (the rider is lifted into the gondola; the avatar never walks on the deck). */
export const WHEEL_PAD = Object.freeze({ x: 211, z: -134.5, radius: 3 });

/** The village side: the gate lot's door pad and where you stand coming out (world metres, from the gate lot). */
export function parkGateDoor() {
  const lot = villageLot("lot_gate");
  return lotDoorPoint(lot, lot.doors[0]!);
}

/** The reach (m) the offered door and the server's rule share beyond a pad's edge. */
export const PARK_DOOR_REACH_M = LOT_DOOR_REACH_M;

/**
 * Using a park door (pure, the server's rule): in the village within reach of the gate's pad → into the park (its arrival spot); in the
 * park within reach of the arch's exit pad → out to the gate's arrival. Null otherwise.
 */
export function useParkDoor(area: string, x: number, z: number): { area: "village" | ParkAreaId; x: number; z: number; yaw: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (area === "village") {
    const g = parkGateDoor();
    const d = Math.hypot(x - g.pad.x, z - g.pad.z);
    if (d > g.pad.radius + PARK_DOOR_REACH_M) return null;
    return { area: PARK_AREA, x: PARK_ARRIVAL.x, z: PARK_ARRIVAL.z, yaw: PARK_ARRIVAL.yaw };
  }
  if (area !== PARK_AREA) return null;
  const d = Math.hypot(x - PARK_EXIT_PAD.x, z - PARK_EXIT_PAD.z);
  if (d > PARK_EXIT_PAD.radius + PARK_DOOR_REACH_M) return null;
  const out = parkGateDoor().arrival;
  return { area: "village", x: out.x, z: out.z, yaw: out.yaw };
}

// ───────────────────────────────────────── the park's solids (collision truth and render layout) ─────────────────────────────────────────

const box = (minX: number, maxX: number, minZ: number, maxZ: number): AABB => ({ minX, maxX, minZ, maxZ });

/** A storybook shop front: where it stands (centre), size, which way its door faces (+1 east, -1 west) and its look. */
export interface ParkShop {
  id: string;
  x: number;
  z: number;
  w: number; // along z
  d: number; // along x
  faces: 1 | -1;
  wall: [number, number, number];
  beam: [number, number, number];
  roofH: number;
}

export const PARK_SHOPS: readonly ParkShop[] = Object.freeze([
  { id: "bakery", x: 17, z: -168, w: 14, d: 8, faces: 1, wall: [0.96, 0.9, 0.78], beam: [0.34, 0.22, 0.14], roofH: 3.4 },
  { id: "toys", x: 17, z: -150, w: 13, d: 8, faces: 1, wall: [0.78, 0.86, 0.93], beam: [0.3, 0.2, 0.13], roofH: 3.8 },
  { id: "tea", x: 17, z: -133, w: 12, d: 8, faces: 1, wall: [0.93, 0.8, 0.8], beam: [0.34, 0.22, 0.14], roofH: 3.2 },
  { id: "souvenir", x: 63, z: -168, w: 14, d: 8, faces: -1, wall: [0.86, 0.92, 0.8], beam: [0.3, 0.2, 0.13], roofH: 3.6 },
  { id: "candy", x: 63, z: -150, w: 13, d: 8, faces: -1, wall: [0.97, 0.88, 0.7], beam: [0.34, 0.22, 0.14], roofH: 3.4 },
  { id: "photo", x: 63, z: -133, w: 12, d: 8, faces: -1, wall: [0.82, 0.8, 0.92], beam: [0.3, 0.2, 0.13], roofH: 3.8 },
]);

/** The coaster's queue pavilion (a roofed hall the queue switchbacks through) and the station platform. */
export const PARK_QUEUE_HALL = Object.freeze({ minX: -31, maxX: -3, minZ: -40, maxZ: -9 });
export const PARK_PLATFORM = Object.freeze({ minX: -14, maxX: 17, minZ: -6.8, maxZ: -1.4 });

/** Trees: deterministic scatter on the lawn, never on a path, the plaza, a building or the coaster's ground. */
export interface ParkTree {
  x: number;
  z: number;
  s: number; // size 0.8..1.5
  kind: 0 | 1 | 2;
}

function onPath(x: number, z: number, m: number): boolean {
  const P = PARK_PLAZA;
  if (Math.hypot(x - P.x, z - P.z) < P.radius + m) return true;
  if (x > 28 - m && x < 52 + m && z < -134 + m) return true; // the promenade
  if (x > -24 - m && x < 24 + m && z > -20 - m) return true; // the station's frontage
  if (z > -118 - m && z < -106 + m && x > -23 - m && x < 345 + m) return true; // the east-west avenue
  if (x > -23 - m && x < -11 + m && z > -118 && z < -40) return true; // the queue approach
  return false;
}

function buildTrees(): ParkTree[] {
  let seed = 20261117;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: ParkTree[] = [];
  const ok = (x: number, z: number): boolean => {
    if (x < PARK_BOUNDS.minX + 6 || x > PARK_BOUNDS.maxX - 6 || z < PARK_BOUNDS.minZ + 6 || z > -7) return false;
    if (onPath(x, z, 5)) return false;
    if (PARK_SHOPS.some((s) => Math.abs(x - s.x) < s.d / 2 + 5 && Math.abs(z - s.z) < s.w / 2 + 4)) return false;
    const q = PARK_QUEUE_HALL;
    if (x > q.minX - 8 && x < q.maxX + 8 && z > q.minZ - 8 && z < q.maxZ + 8) return false;
    if (Math.hypot(x - PARK_EXIT_PAD.x, z - PARK_EXIT_PAD.z) < 14) return false;
    if (Math.hypot(x - 110, z + 135) < 30 || Math.hypot(x - 205, z + 135) < 34) return false; // the ride plots (the carousel's, the wheel's) stay open
    return true;
  };
  // groves: clusters of trees with open lawn between them (lawns stay open beside the paths, the plaza and the ride plots)
  const centres: { x: number; z: number }[] = [];
  let g0 = 0;
  while (centres.length < 16 && g0++ < 4000) {
    const x = PARK_BOUNDS.minX + 14 + rnd() * (PARK_BOUNDS.maxX - PARK_BOUNDS.minX - 28);
    const z = PARK_BOUNDS.minZ + 14 + rnd() * (PARK_BOUNDS.maxZ - PARK_BOUNDS.minZ - 28);
    if (!ok(x, z) || centres.some((c) => Math.hypot(c.x - x, c.z - z) < 38)) continue;
    centres.push({ x, z });
  }
  for (const c of centres) {
    let placed = 0;
    let guard = 0;
    while (placed < 9 && guard++ < 300) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 11;
      const x = Math.round((c.x + Math.cos(a) * r) * 10) / 10;
      const z = Math.round((c.z + Math.sin(a) * r * 0.9) * 10) / 10;
      if (!ok(x, z) || out.some((t) => Math.hypot(t.x - x, t.z - z) < 4.6)) continue;
      out.push({ x, z, s: 0.8 + rnd() * 0.7, kind: (Math.floor(rnd() * 3) % 3) as 0 | 1 | 2 });
      placed++;
    }
  }
  return out;
}
export const PARK_TREES: readonly ParkTree[] = Object.freeze(buildTrees());

/** Lamp posts: both sides of the promenade, round the plaza, along the avenue and the queue approach. */
function buildLamps(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = -176; z <= -140; z += 12) out.push({ x: 31, z }, { x: 49, z });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    out.push({ x: PARK_PLAZA.x + Math.cos(a) * (PARK_PLAZA.radius - 2.5), z: PARK_PLAZA.z + Math.sin(a) * (PARK_PLAZA.radius - 2.5) });
  }
  for (let x = -10; x >= -20; x -= 10) out.push({ x, z: -119 });
  // (none at x = 110: the carousel's entrance sign and its boarding pad sit on that axis)
  for (let x = 70; x <= 330; x += 20) if (x !== 110) out.push({ x, z: -119 }, { x, z: -105 });
  for (let z = -100; z <= -52; z += 16) out.push({ x: -24, z }, { x: -10, z });
  return out;
}
export const PARK_LAMPS: readonly { x: number; z: number }[] = Object.freeze(buildLamps());

/** People-scale props: a ticket kiosk by the arch, stone planters at the promenade's south end, litter bins by the lamp posts. */
export const PARK_KIOSK = Object.freeze({ x: 55, z: -177, w: 4.2, d: 3.4 });
export const PARK_PLANTERS: readonly { x: number; z: number; w: number; d: number }[] = Object.freeze([
  { x: 33.5, z: -137, w: 3, d: 1.6 },
  { x: 46.5, z: -137, w: 3, d: 1.6 },
  { x: 33.5, z: -182, w: 3, d: 1.6 },
  { x: 46.5, z: -182, w: 3, d: 1.6 },
]);
export const PARK_BINS: readonly { x: number; z: number }[] = Object.freeze([
  { x: 32.2, z: -164 },
  { x: 47.8, z: -164 },
  { x: 32.2, z: -146 },
  { x: 47.8, z: -146 },
  { x: 64, z: -108.6 },
  { x: 150, z: -108.6 },
  { x: -12.2, z: -100 },
]);

/** The star plaza's flower troughs (stone, 0.8 m high; the village flower system plants them): twelve round the fountain, axis-aligned rectangles. */
export interface ParkTrough {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** soil height (m) */
  y: number;
}
function buildTroughs(): ParkTrough[] {
  const out: ParkTrough[] = [];
  const ring = PARK_PLAZA.radius - 8.5;
  for (let k = 0; k < 12; k++) {
    const a = ((k + 0.5) / 12) * Math.PI * 2;
    const cx = PARK_PLAZA.x + Math.cos(a) * ring;
    const cz = PARK_PLAZA.z + Math.sin(a) * ring;
    const alongZ = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
    const hx = alongZ ? 0.8 : 1.6;
    const hz = alongZ ? 1.6 : 0.8;
    out.push({ x0: Math.round((cx - hx) * 10) / 10, x1: Math.round((cx + hx) * 10) / 10, z0: Math.round((cz - hz) * 10) / 10, z1: Math.round((cz + hz) * 10) / 10, y: 0.84 });
  }
  return out;
}
export const PARK_TROUGHS: readonly ParkTrough[] = Object.freeze(buildTroughs());

/** Everything a player body collides with. */
function buildSolids(): AABB[] {
  const out: AABB[] = [];
  for (const s of PARK_SHOPS) out.push(box(s.x - s.d / 2, s.x + s.d / 2, s.z - s.w / 2, s.z + s.w / 2));
  const q = PARK_QUEUE_HALL;
  // the queue pavilion: walled but for the entrance on its north side (the boarding pad stands in front of it)
  out.push(box(q.minX, q.maxX, q.minZ + 3, q.maxZ));
  const p = PARK_PLATFORM;
  out.push(box(p.minX, p.maxX, p.minZ, p.maxZ));
  // the fountain and its ring
  const f = PARK_PLAZA.fountainHalf;
  out.push(box(PARK_PLAZA.x - f, PARK_PLAZA.x + f, PARK_PLAZA.z - f, PARK_PLAZA.z + f));
  // the gate arch's two towers
  out.push(box(29.5, 33, -190, -183), box(47, 50.5, -190, -183));
  out.push(box(PARK_KIOSK.x - PARK_KIOSK.w / 2, PARK_KIOSK.x + PARK_KIOSK.w / 2, PARK_KIOSK.z - PARK_KIOSK.d / 2, PARK_KIOSK.z + PARK_KIOSK.d / 2));
  out.push(box(110 - 12.8, 110 + 12.8, -135 - 12.8, -135 + 12.8)); // the carousel's platform and its fence (the ride's own pad is outside it)
  // the wheel: the four feet of its A-frames and the boarding platform's deck
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(205 + sx * 11 - 1, 205 + sx * 11 + 1, -140 + sz * 2.75 - 1, -140 + sz * 2.75 + 1));
  out.push(box(205 + 0.7, 205 + 9.9, -140 - 2.5, -140 + 2.5));
  for (const t of PARK_TROUGHS) out.push(box(t.x0, t.x1, t.z0, t.z1));
  for (const p of PARK_PLANTERS) out.push(box(p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2));
  for (const b of PARK_BINS) out.push(box(b.x - 0.3, b.x + 0.3, b.z - 0.3, b.z + 0.3));
  for (const t of PARK_TREES) out.push(box(t.x - 0.45, t.x + 0.45, t.z - 0.45, t.z + 0.45));
  return out;
}
export const PARK_SOLIDS: readonly AABB[] = Object.freeze(buildSolids());

export const parkGeometry: MapGeometry = makeGeometry("park", PARK_BOUNDS, [], PARK_SOLIDS);
