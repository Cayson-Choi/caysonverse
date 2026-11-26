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
 *     z = -12   the coaster's boarding pad, at the foot of the station platform's north steps (-6.8 .. -1.4 the platform)
 *     z >= 0    the coaster's circuit (fenced off: the park's south edge is z = -2.2)
 *
 * Seat ids: this file adds NONE to the village's seat table (docs/designs/caysonland/DESIGN.md section 2: 400+ is reserved, rides use rideSeat).
 */
import { parkRideSolids } from "./parkRideSolids";
import { LOT_DOOR_REACH_M, lotDoorPoint, villageLot } from "./villageLots";
import type { AABB, CameraBox } from "../collision";
import { shopWindows, WINDOW_BOX } from "./parkShopWindowLayout";
import type { Bounds, MapGeometry } from "../school/geometry";
import { makeGeometry } from "../school/geometry";
import { islandSolids } from "./parkIslands";
import { parkBenchSolids } from "./parkBenches";
import { PARK_WALL_PLAN, PARK_WALL_SOLIDS, distanceToWall } from "./parkWall";

export const PARK_AREA = "park" as const;
export type ParkAreaId = typeof PARK_AREA;

export function isParkArea(area: string): area is ParkAreaId {
  return area === PARK_AREA;
}

/** The playable rectangle (park-local metres). The south edge keeps everyone off the coaster's circuit. */
export const PARK_BOUNDS: Bounds = Object.freeze({ minX: -170, maxX: 380, minZ: -190, maxZ: -2.2 });

/** The gate arch's way-out pad and the arrival spot inside (park-local). */
export const PARK_EXIT_PAD = Object.freeze({ x: 40, z: -181, radius: 1.8 });
// Arriving, one looks INTO the park: south (+z, yaw 0), the promenade and the star plaza ahead. (It was yaw PI, north: every visitor
// arrived staring back at the arch they had just come through - owner 2026-11-21 "반대방향을 보도록".)
export const PARK_ARRIVAL = Object.freeze({ x: 40, z: -171, yaw: 0 });

/**
 * The gate is ONE gate with two sides: the village's gatehouse (lot_gate, world metres, its line z 94 on the avenue x -24) stands in the
 * park's north wall at x 40, z -186.5. A village point + this offset is the same point of the gate in the park's frame (the client draws
 * the village's gatehouse there, and the village's picture beyond the arch by the same mapping).
 */
export const PARK_GATE_FROM_VILLAGE = Object.freeze({ dx: 64, dz: -280.5 });

/** The star plaza and its fountain. */
export const PARK_PLAZA = Object.freeze({ x: 40, z: -112, radius: 26, fountainHalf: 4 });

/** The coaster's boarding pad: on the paving at the foot of the station platform's north steps (the server's RideBoard reach is `COASTER_BOARD_REACH_M` from its centre). */
export const COASTER_PAD = Object.freeze({ x: 2, z: -12, radius: 3.2 });
export const COASTER_BOARD_REACH_M = 6;

/** The carousel's boarding pad (its entrance gate, south of the platform) and the wheel's (phase 2c). */
export const CAROUSEL_PAD = Object.freeze({ x: 110, z: -119, radius: 3 });
/** The wheel's boarding pad: on the grass at the foot of the platform steps (the rider is lifted into the gondola; the avatar never walks on the deck). */
export const WHEEL_PAD = Object.freeze({ x: 205, z: -128.2, radius: 3 });
/** The 달배's site (axle over its middle; the 달토끼 숲, the park's west) and its boarding pad: on the grass at the foot of its platform steps, east of the hull (shared/src/land/moonBoat.ts, moonBoatGeometry.ts). */
export const MOON_BOAT_SITE_AT = Object.freeze({ x: -95, z: -140 });
export const MOON_BOAT_PAD = Object.freeze({ x: -82.1, z: -140, radius: 3 });
/** The cloud drop tower (shared/src/land/dropTower.ts): its axis and its boarding pad, on the grass east of its platform (the rider is lifted into the seat). */
export const DROP_SITE_AT = Object.freeze({ x: -75, z: -88 });
export const DROP_PAD = Object.freeze({ x: -61, z: -88, radius: 3 });

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

/** The coaster's station platform (the queue hall that stood north of it was taken away: owner 2026-11-19; boarding is from the platform's steps, like every ride). */
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
  if (x > -4 - m && x < 8 + m && z > -118 && z < -26) return true; // the station approach (gravel)
  if (x > -7 - m && x < 11 + m && z > -26 - m && z < -7) return true; // the station apron (paving)
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
    if (Math.hypot(x - PARK_EXIT_PAD.x, z - PARK_EXIT_PAD.z) < 14) return false;
    if (Math.hypot(x - 110, z + 135) < 30 || Math.hypot(x - 205, z + 135) < 34 || Math.hypot(x - MOON_BOAT_SITE_AT.x - 4, z - MOON_BOAT_SITE_AT.z) < 32 || Math.hypot(x - DROP_SITE_AT.x - 6, z - DROP_SITE_AT.z) < 24) return false; // the ride plots (the carousel's, the wheel's, the moon boat's, the drop tower's) stay open
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
/** A tree whose crown would stand in the castle wall's stone (parkWall.ts) is left out (the rest keep their places). */
export const PARK_TREES: readonly ParkTree[] = Object.freeze(buildTrees().filter((t) => distanceToWall(PARK_WALL_PLAN, t.x, t.z) > 3.2 + 1.4 * t.s));

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
  for (let z = -100; z <= -28; z += 18) out.push({ x: -6, z }, { x: 10, z });
  return out;
}
export const PARK_LAMPS: readonly { x: number; z: number }[] = Object.freeze(buildLamps());

/** People-scale props: a ticket kiosk by the arch, stone planters at the promenade's south end, litter bins by the lamp posts. */
export const PARK_KIOSK = Object.freeze({ x: 55, z: -177, w: 4.2, d: 3.4 });
export const PARK_PLANTERS: readonly { x: number; z: number; w: number; d: number }[] = Object.freeze([
  { x: 33.5, z: -137, w: 3, d: 1.6 },
  { x: 46.5, z: -137, w: 3, d: 1.6 },
  // (the two that flanked the old arch at z -182 went: the gatehouse's own turnstile canopy and planters stand there now)
  // flower beds flanking the station apron (where the queue hall stood)
  { x: -8.5, z: -20, w: 3, d: 1.6 },
  { x: 12.5, z: -20, w: 3, d: 1.6 },
  { x: -8.5, z: -9.5, w: 3, d: 1.6 },
  { x: 12.5, z: -9.5, w: 3, d: 1.6 },
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

// ═══════════════ fix/veg-off-paths (owner 2026-11-21) — this block only: the park's street furniture, beds and hedge as solids ═══════════════
// ("조명이랑 그냥 통과해버리네", "화단에 식물이 있는데 이걸 그냥 통과해버리네", "의자도 통과해버리네"). Ride structures and their railings are
// NOT here (fix/moonboat-seats owns them). e2e/solid-audit.mjs --park renders the park from above and fails when anything drawn at
// body height can still be walked through.

/** The star fountain's basin: 9.2 m across at the rim, its stepped foot a little wider (client fountain/fountainDesigns.ts STAR_FOUNTAIN). */
export const PARK_FOUNTAIN_RADIUS = 4.7;

/**
 * The round basin as nine boxes (the collision world is axis-aligned boxes): their corners stand 15 cm outside the rim, every 10
 * degrees, so the steps between them cut no more than 0.3 m into it and nothing reaches out over the paving.
 */
export function parkFountainSolids(): AABB[] {
  const { x, z } = PARK_PLAZA;
  const r = PARK_FOUNTAIN_RADIUS + 0.15;
  return [5, 15, 25, 35, 45, 55, 65, 75, 85].map((deg) => {
    const hx = Math.round(r * Math.cos((deg * Math.PI) / 180) * 100) / 100;
    const hz = Math.round(r * Math.sin((deg * Math.PI) / 180) * 100) / 100;
    return box(x - hx, x + hx, z - hz, z + hz);
  });
}

/**
 * The clipped shrubs along the park's south edge (client land/ParkVegetation.tsx: one every 3 m at z -2.7, 1.3-2 m in radius (a phone's:
 * every 6 m, up to 2.5 m), the last ones at x -30 and 30 either side of the station): the walk bounds end at z -2.2, INSIDE the row, so
 * a walker stood in the hedge. Its north face is the wall now (`face`: the widest shrub's leaf tips reach z -4.7).
 */
export const PARK_SOUTH_HEDGE = Object.freeze({ z: -2.7, face: -4.7, gap: 27.8 });
export function parkSouthHedgeSolids(): AABB[] {
  const h = PARK_SOUTH_HEDGE;
  return [box(PARK_BOUNDS.minX - 1, -h.gap, h.face, PARK_BOUNDS.maxZ + 1), box(h.gap, PARK_BOUNDS.maxX + 1, h.face, PARK_BOUNDS.maxZ + 1)];
}

/**
 * The carousel's ticket booth (client land/CarouselWorld.tsx `ticketBooth`: 7.5 m east of the carousel's axis, 1.5 m south of its
 * pad, on the avenue's edge): it had no collider at all. Like the snack kiosk it serves over a counter that reaches out of its front.
 */
export const PARK_TICKET_BOOTH = Object.freeze({ x: 117.5, z: -117.5, w: 3.4, d: 3.0 });

/** A booth's serving counter (client land/ParkBooth.tsx: a plank over the sill, 0.66 m out of the +z front, 0.3 m wider than the window each side). */
export function boothCounterSolid(b: { x: number; z: number; w: number; d: number }, snack: boolean): AABB {
  const half = Math.min(b.w - 1.2, snack ? 2.7 : 2.0) / 2 + 0.3;
  return box(b.x - half, b.x + half, b.z + b.d / 2, b.z + b.d / 2 + 0.66);
}

/** A booth's chalk menu on its easel, beside the counter (ParkBooth.tsx: 0.55 m wide, turned 20 degrees). */
export function boothMenuSolid(b: { x: number; z: number; w: number; d: number }): AABB {
  const x = b.x + b.w / 2 + 0.55;
  const z = b.z + b.d / 2 + 0.45;
  return box(x - 0.3, x + 0.3, z - 0.15, z + 0.15);
}

/** A lamp post's box: its cast base is a 0.17 m disc (the village's lamps: streetPoles.ts LAMP_COLLIDER_HALF). */
export const PARK_LAMP_HALF = 0.2;

/** The fountain's basin, the two booths' counters (and the ticket booth itself), lamp posts, the planted islands (at the kerb), the benches and the south hedge. */
export function parkStreetSolids(): AABB[] {
  return [
    ...parkFountainSolids(),
    boothCounterSolid(PARK_KIOSK, true),
    boothMenuSolid(PARK_KIOSK),
    boothMenuSolid(PARK_TICKET_BOOTH),
    box(PARK_TICKET_BOOTH.x - PARK_TICKET_BOOTH.w / 2, PARK_TICKET_BOOTH.x + PARK_TICKET_BOOTH.w / 2, PARK_TICKET_BOOTH.z - PARK_TICKET_BOOTH.d / 2, PARK_TICKET_BOOTH.z + PARK_TICKET_BOOTH.d / 2),
    boothCounterSolid(PARK_TICKET_BOOTH, false),
    ...PARK_LAMPS.map((l) => box(l.x - PARK_LAMP_HALF, l.x + PARK_LAMP_HALF, l.z - PARK_LAMP_HALF, l.z + PARK_LAMP_HALF)),
    ...islandSolids(),
    ...parkBenchSolids(),
    ...parkSouthHedgeSolids(),
  ];
}
// ═══════════════ (end of fix/veg-off-paths) ═══════════════

/** Everything a player body collides with. */
function buildSolids(): AABB[] {
  const out: AABB[] = [];
  for (const s of PARK_SHOPS) {
    out.push(box(s.x - s.d / 2, s.x + s.d / 2, s.z - s.w / 2, s.z + s.w / 2));
    // Each waist-high trough projects past the wall on its own brackets; the gaps between them stay walkable.
    const halfDepth = (WINDOW_BOX.offset + WINDOW_BOX.depth / 2) / 2;
    for (const w of shopWindows(s)) {
      const cx = w.x + w.out[0] * halfDepth, cz = w.z + w.out[2] * halfDepth;
      const hx = w.out[0] ? halfDepth : WINDOW_BOX.width / 2;
      const hz = w.out[2] ? halfDepth : WINDOW_BOX.width / 2;
      out.push(box(cx - hx, cx + hx, cz - hz, cz + hz));
    }
  }
  const p = PARK_PLATFORM;
  out.push(box(p.minX, p.maxX, p.minZ, p.maxZ));
  out.push(box(2 - 3.6, 2 + 3.6, p.minZ - 4.3, p.minZ)); // the station's north steps (the boarding pad is just beyond them)
  // (the fountain's round basin: parkStreetSolids below)
  // the gatehouse (the village's, seen from behind: PARK_GATE_FROM_VILLAGE): its wings and piers either side of the 6 m passage (x 37 .. 43),
  // and the back planters under its flags
  out.push(box(29.5, 37, -190, -185.3), box(43, 50.5, -190, -185.3));
  out.push(box(31.9, 33.7, -184, -182.2), box(46.3, 48.1, -184, -182.2));
  out.push(box(PARK_KIOSK.x - PARK_KIOSK.w / 2, PARK_KIOSK.x + PARK_KIOSK.w / 2, PARK_KIOSK.z - PARK_KIOSK.d / 2, PARK_KIOSK.z + PARK_KIOSK.d / 2));
  // ── the rides (parkRideSolids.ts): every platform, flight of steps, railing, queue fence, post and name board of the carousel, the wheel, the 달배 and
  // the 구름 낙하탑 (owner 2026-11-21: the fences and steps were walked through). One block of its own: a ride's barrier is added THERE, not here ──
  out.push(...parkRideSolids());
  for (const t of PARK_TROUGHS) out.push(box(t.x0, t.x1, t.z0, t.z1));
  for (const p of PARK_PLANTERS) out.push(box(p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2));
  for (const b of PARK_BINS) out.push(box(b.x - 0.3, b.x + 0.3, b.z - 0.3, b.z + 0.3));
  out.push(...parkStreetSolids());
  for (const t of PARK_TREES) out.push(box(t.x - 0.45, t.x + 0.45, t.z - 0.45, t.z + 0.45));
  // the castle wall round the park (parkWall.ts, owner 2026-11-20): its runs (the north ones sealed out to the bounds' edge) and towers
  out.push(...PARK_WALL_SOLIDS.obstacles);
  return out;
}
export const PARK_SOLIDS: readonly AABB[] = Object.freeze(buildSolids());

/** The star plaza's low solids the camera rises over (QA 2026-11-20): the fountain's basin (its bowl hides an avatar's lower body) and the stone troughs (0.84 m). */
export const PARK_HURDLES: readonly CameraBox[] = Object.freeze([
  ...parkFountainSolids().map((b) => ({ ...b, height: 1.1 })),
  ...PARK_TROUGHS.map((t) => ({ minX: t.x0, maxX: t.x1, minZ: t.z0, maxZ: t.z1, height: t.y })),
]);

export const parkGeometry: MapGeometry = makeGeometry("park", PARK_BOUNDS, [], PARK_SOLIDS, PARK_WALL_SOLIDS.cameraBoxes, PARK_HURDLES);
