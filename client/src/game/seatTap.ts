/**
 * A tap on a marked chair or porch bench (the café terrace's chairs, the houses' porch benches: the art's `seat__*`
 * markers) means "I want to sit THERE": the walk goes to that seat's own approach spot (its get-up spot, which the
 * seat's reach rule offers it from) rather than the ground nearest the tap — which, on the terrace, is the next
 * chair's, the gap between a table and a planter or nothing at all (round 5 review: 10 of 24 taps sat on another chair).
 * Pure, no three.js: CameraRig hands the picked surface point here before planning the walk.
 */
import { PLAYER_RADIUS, SEAT_REACH, approachesSeat, type Seat } from "@caysonverse/shared/worldMap";
import type { AABB } from "@caysonverse/shared/collision";
import type { Bounds } from "@caysonverse/shared/school/geometry";
import { isFreeSpot } from "./clickPlan";
import { CHAIR_BACK_BEHIND, CHAIR_HALF_WIDTH, VILLAGE_SEAT_MARKERS, ZELKOVA_DECK } from "@caysonverse/shared/village/benchSeats";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { lakeSeats } from "@caysonverse/shared/village/lakeLayout";
import { LOTS_WITH_MODEL, VILLAGE_LOTS, lotColliders, lotLocalToWorld, lotSeatFurnitureBoxes } from "@caysonverse/shared/village/villageLots";

/** A tap this far past a chair's footprint (m) still counts as on it (a seat's edge, a leg, a rail seen edge-on). */
export const SEAT_TAP_MARGIN = 0.1;
/** Higher than a chair's back (m) is no chair. Ground (lower than TAP_GROUND_Y) counts only right under its footprint, seen between its legs. */
const TAP_GROUND_Y = 0.06;
const TAP_MAX_Y = 1.05;

const FACING_YAW = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 } as const;

/** A marked seat's footprint: its centre, facing and half sizes along (facing) and across it. */
interface Footprint {
  id: string;
  x: number;
  z: number;
  yaw: number;
  front: number;
  back: number;
  half: number;
}

/**
 * The fishing lake's 30 chairs (lakeLayout.ts: the art's `seat__lake_*` markers will replace these when the lake's seat markers are
 * generated). A seat is the sitter's ROOT; the chair's centre is behind it by the chair's front edge and the root's reach ahead.
 */
const CHAIR_FRONT_EDGE = 0.21;
const LAKE_CHAIR_FOOTPRINTS: Footprint[] = lakeSeats()
  .filter((s) => s.kind === "fishing_chair")
  .map((s) => {
    const back = CHAIR_FRONT_EDGE + (s.frontEdge ?? 0);
    return { id: s.bench, x: s.x - Math.sin(s.yaw) * back, z: s.z - Math.cos(s.yaw) * back, yaw: s.yaw, front: CHAIR_FRONT_EDGE, back: CHAIR_BACK_BEHIND, half: CHAIR_HALF_WIDTH };
  });

/**
 * The plaza zelkova deck's six places (평상, UX 2026-11-16): a strip of the deck along each face, from 0.4 m in to its rim (a
 * tap on the deck's top or its edge sits at that face's place).
 */
const DECK_IN = 0.4;
const ZELKOVA_DECK_FOOTPRINTS: Footprint[] = ZELKOVA_DECK.faces.map((deg, k) => {
  const yaw = (deg * Math.PI) / 180;
  const c = VILLAGE_LAYOUT.plaza.zelkova.centre;
  const r = ZELKOVA_DECK.apothem - DECK_IN;
  return { id: `zelkova_deck:${k + 1}`, x: c.x + Math.sin(yaw) * r, z: c.z + Math.cos(yaw) * r, yaw, front: DECK_IN + 0.05, back: 0.6, half: ZELKOVA_DECK.faceHalf };
});

const FOOTPRINTS: readonly Footprint[] = [...VILLAGE_SEAT_MARKERS.map((m): Footprint => ({
  id: m.id,
  x: m.x,
  z: m.z,
  yaw: FACING_YAW[m.facing],
  front: m.frontEdge,
  back: m.approach === "side" ? CHAIR_BACK_BEHIND : 0.3,
  half: m.approach === "side" ? CHAIR_HALF_WIDTH : (m.length ?? 1) / 2,
})), ...LAKE_CHAIR_FOOTPRINTS, ...ZELKOVA_DECK_FOOTPRINTS];

/** The waterfall rest area's seat stones (B1 W5): backless, four seats each (two places, a west and an east side). */
const STONES = VILLAGE_LAYOUT.backdrop.waterfall.options.seats ? VILLAGE_LAYOUT.backdrop.waterfall.seats : [];

/**
 * The lot buildings' seat furniture (L5, villageLots.ts): each bench, 평상 or chair as a box (its own collider when the contract has
 * one, else the seat's length by twice its front edge) with the seats on it (`lot:<seat id>`). A tap on it means the seat of the
 * tapped side and place nearest the tap, as on a seat stone.
 */
const LOT_SEAT_BOXES: ReadonlyArray<{ box: AABB; benches: ReadonlySet<string> }> = (() => {
  const out: Array<{ box: AABB; benches: Set<string> }> = [];
  for (const l of VILLAGE_LOTS) {
    if (!LOTS_WITH_MODEL.includes(l.id)) continue;
    const own = lotColliders(l).map((c) => c.box);
    const extra = lotSeatFurnitureBoxes(l);
    for (const sp of l.seats) {
      const c = lotLocalToWorld(l, sp.lx, sp.lz);
      const box = [...own, ...extra].find((b) => c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ && b.maxX - b.minX <= 3 && b.maxZ - b.minZ <= 3);
      if (!box) continue;
      const hit = out.find((o) => o.box === box);
      if (hit) hit.benches.add(`lot:${sp.id}`);
      else out.push({ box, benches: new Set([`lot:${sp.id}`]) });
    }
  }
  return out;
})();

/** Every lot seat furniture's bench ids (the seats a tap can mean). */
const LOT_BENCH_IDS: ReadonlySet<string> = new Set(LOT_SEAT_BOXES.flatMap((b) => [...b.benches]));

/**
 * The seat (index into `seats`) whose chair or bench the tap at (x, y, z) landed on, or -1. `seats` is the active map's
 * list; a marker whose seat is not in it (another area) never matches. The nearest footprint centre wins.
 */
export function seatUnderTap(seats: readonly Seat[], x: number, y: number, z: number): number {
  if (!(y <= TAP_MAX_Y)) return -1;
  const margin = y < TAP_GROUND_Y ? 0 : SEAT_TAP_MARGIN;
  let best = -1;
  let bestD = Infinity;
  for (const f of FOOTPRINTS) {
    const dx = x - f.x;
    const dz = z - f.z;
    const ahead = dx * Math.sin(f.yaw) + dz * Math.cos(f.yaw);
    const across = dx * Math.cos(f.yaw) - dz * Math.sin(f.yaw);
    if (ahead < -f.back - margin || ahead > f.front + margin || Math.abs(across) > f.half + margin) continue;
    const d = Math.hypot(dx, dz);
    if (d >= bestD) continue;
    const i = seats.findIndex((s) => (s as { bench?: string }).bench === f.id);
    if (i < 0) continue;
    best = i;
    bestD = d;
  }
  // a seat stone: the seat of the tapped side and place nearest the tap (the stone has no front, every side is one)
  for (const st of STONES) {
    const dx = x - st.centre.x;
    const dz = z - st.centre.z;
    if (Math.abs(dx) > st.size.x / 2 + margin || Math.abs(dz) > st.size.z / 2 + margin) continue;
    const d = Math.hypot(dx, dz);
    if (d >= bestD) continue;
    let at = -1;
    let atD = Infinity;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i] as { bench?: string; x: number; z: number };
      if (s.bench !== st.id) continue;
      const sd = Math.hypot(x - s.x, z - s.z);
      if (sd < atD) {
        at = i;
        atD = sd;
      }
    }
    if (at < 0) continue;
    best = at;
    bestD = d;
  }
  // a lot's bench, 평상 or chair: the seat on it nearest the tap (its side and place)
  for (const lb of LOT_SEAT_BOXES) {
    const b = lb.box;
    if (x < b.minX - margin || x > b.maxX + margin || z < b.minZ - margin || z > b.maxZ + margin) continue;
    const d = Math.hypot(x - (b.minX + b.maxX) / 2, z - (b.minZ + b.maxZ) / 2);
    if (d >= bestD) continue;
    let at = -1;
    let atD = Infinity;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i] as { bench?: string; x: number; z: number };
      if (!s.bench || !lb.benches.has(s.bench)) continue;
      const sd = Math.hypot(x - s.x, z - s.z);
      if (sd < atD) {
        at = i;
        atD = sd;
      }
    }
    if (at < 0) continue;
    best = at;
    bestD = d;
  }
  return best;
}

/** How far from the seat point (m) a tap's goal is looked for: the seat's own reach (worldMap SEAT_REACH). */
const GOAL_RADIUS = SEAT_REACH;
const GRID = 0.05;
/** Room past the body's edge (m) a goal is preferred to have: the walk's way round (clickPlan.ts) needs some to get in. */
const CLEAR_WANTED = 0.3;
/** How far round the goal (m) the seat must still be the one offered: a tap-walk stops up to ARRIVE_DIST short of it. */
const ROBUST_STEPS = [0.4, 0.3, 0.2, 0.1, 0] as const;
const APPROACH_RINGS = ROBUST_STEPS.map((radius) => Array.from({ length: 16 }, (_, i) => ({
  dx: radius * Math.cos((i * Math.PI) / 8),
  dz: radius * Math.sin((i * Math.PI) / 8),
})));

interface CachedGoal {
  bounds: Bounds;
  obstacles: readonly AABB[];
  point: { x: number; z: number } | null;
}
const goals = new WeakMap<readonly Seat[], Map<number, CachedGoal>>();

/**
 * How far round the seat point (m) an obstacle can matter to the goal search: the goal's radius, the widest ring, the
 * body and the room wanted, a grid step to spare.
 */
const NEAR_REACH = GOAL_RADIUS + ROBUST_STEPS[0] + PLAYER_RADIUS + CLEAR_WANTED + 2 * GRID;

/** The obstacles that can touch the search round (x, z): a terrace's dozen of the village's ~280 (review 2026-11-15). */
function obstaclesNear(x: number, z: number, obstacles: readonly AABB[]): AABB[] {
  return obstacles.filter((b) => b.maxX > x - NEAR_REACH && b.minX < x + NEAR_REACH && b.maxZ > z - NEAR_REACH && b.minZ < z + NEAR_REACH);
}

/**
 * Where a tap on seat `index` walks to: a spot a body stands on from which that seat is offered (worldMap approachesSeat,
 * within SEAT_REACH) — where it stays offered all round the spot a tap-walk's stop could be (it stops up to ARRIVE_DIST
 * short: ROBUST_STEPS, the widest ring that holds first), then as roomy as the terrace allows (a way round needs room to
 * get in). Another chair nearer the stop is no matter: the tapped one is preferred (seatPreference.ts). Null when there
 * is no such spot. The village and interiors share a seat list, so a cached result belongs to its map's bounds and obstacles.
 *
 * Cost (review 2026-11-15: up to 20 ms in a pointerup handler, the first tap on a porch bench): only the obstacles near the
 * seat are tested (`obstaclesNear`), which keeps one seat well under CameraRig's PLAN_SLICE_MS, and `warmSeatApproachGoals`
 * fills the cache one seat per timer tick once a map's seats are known, so a tap normally finds its goal ready.
 */
export function seatApproachGoal(seats: readonly Seat[], index: number, allObstacles: readonly AABB[], bounds: Bounds): { x: number; z: number } | null {
  let byIndex = goals.get(seats);
  if (!byIndex) goals.set(seats, (byIndex = new Map()));
  const cached = byIndex.get(index);
  if (cached?.bounds === bounds && cached.obstacles === allObstacles) return cached.point;
  const s = seats[index];
  const obstacles = obstaclesNear(s.x, s.z, allObstacles);
  let best: { x: number; z: number } | null = null;
  let bestScore = -Infinity;
  const offered = (x: number, z: number) => approachesSeat(s, x, z) && Math.hypot(x - s.x, z - s.z) <= SEAT_REACH;
  for (let dx = -GOAL_RADIUS; dx <= GOAL_RADIUS; dx += GRID) {
    for (let dz = -GOAL_RADIUS; dz <= GOAL_RADIUS; dz += GRID) {
      const x = Math.round((s.x + dx) * 1000) / 1000;
      const z = Math.round((s.z + dz) * 1000) / 1000;
      if (!isFreeSpot(x, z, obstacles, bounds) || !offered(x, z)) continue;
      let clear = 0;
      while (clear < CLEAR_WANTED && isFreeSpot(x, z, obstacles, bounds, PLAYER_RADIUS + clear + GRID)) clear += GRID;
      const standDistance = Math.hypot(x - s.standX, z - s.standZ);
      for (let k = 0; k < APPROACH_RINGS.length; k++) {
        const score = -k * 1000 + clear * 100 - standDistance;
        if (score <= bestScore) break; // every smaller ring scores lower; this point cannot improve the goal
        let ok = true;
        for (const { dx, dz } of APPROACH_RINGS[k]) {
          const px = x + dx;
          const pz = z + dz;
          if (!offered(px, pz) && isFreeSpot(px, pz, obstacles, bounds)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          bestScore = score;
          best = { x, z };
          break;
        }
      }
    }
  }
  byIndex.set(index, { bounds, obstacles: allObstacles, point: best });
  return best;
}

/** Whether seat `index` of `seats` has its goal worked out already. */
export function seatApproachGoalReady(seats: readonly Seat[], index: number, obstacles: readonly AABB[], bounds: Bounds): boolean {
  const cached = goals.get(seats)?.get(index);
  return cached?.bounds === bounds && cached.obstacles === obstacles;
}

/** The marked seats' indices in `seats` (the ones a tap can mean). */
export function markedSeatIndices(seats: readonly Seat[]): number[] {
  const ids = new Set([...FOOTPRINTS.map((f) => f.id), ...LOT_BENCH_IDS]);
  const out: number[] = [];
  seats.forEach((s, i) => {
    if (ids.has((s as { bench?: string }).bench ?? "")) out.push(i);
  });
  return out;
}

/**
 * Work out every marked seat's goal ahead of the first tap, one seat per `schedule` tick (a timer: never more than one
 * seat's search in a row on the main thread). Returns a cancel. `schedule` defaults to setTimeout(…, 0).
 */
export function warmSeatApproachGoals(
  seats: readonly Seat[],
  obstacles: readonly AABB[],
  bounds: Bounds,
  schedule: (run: () => void) => unknown = (run) => setTimeout(run, 0),
): () => void {
  const todo = markedSeatIndices(seats).filter((i) => {
    const { x, z } = seats[i];
    return x + GOAL_RADIUS >= bounds.minX && x - GOAL_RADIUS <= bounds.maxX &&
      z + GOAL_RADIUS >= bounds.minZ && z - GOAL_RADIUS <= bounds.maxZ &&
      !seatApproachGoalReady(seats, i, obstacles, bounds);
  });
  let cancelled = false;
  const step = (): void => {
    if (cancelled) return;
    const i = todo.shift();
    if (i === undefined) return;
    seatApproachGoal(seats, i, obstacles, bounds);
    if (todo.length > 0) schedule(step);
  };
  if (todo.length > 0) schedule(step);
  return () => {
    cancelled = true;
  };
}
