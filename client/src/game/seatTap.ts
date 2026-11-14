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
import { CHAIR_BACK_BEHIND, CHAIR_HALF_WIDTH } from "@caysonverse/shared/village/benchSeats";
import { VILLAGE_SEAT_MARKERS } from "@caysonverse/shared/village/generated/villageSeatMarkers";

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

const FOOTPRINTS: readonly Footprint[] = VILLAGE_SEAT_MARKERS.map((m) => ({
  id: m.id,
  x: m.x,
  z: m.z,
  yaw: FACING_YAW[m.facing],
  front: m.frontEdge,
  back: m.approach === "side" ? CHAIR_BACK_BEHIND : 0.3,
  half: m.approach === "side" ? CHAIR_HALF_WIDTH : (m.length ?? 1) / 2,
}));

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
  return best;
}

/** How far from the seat point (m) a tap's goal is looked for: the seat's own reach (worldMap SEAT_REACH). */
const GOAL_RADIUS = SEAT_REACH;
const GRID = 0.05;
/** Room past the body's edge (m) a goal is preferred to have: the walk's way round (clickPlan.ts) needs some to get in. */
const CLEAR_WANTED = 0.3;
/** How far round the goal (m) the seat must still be the one offered: a tap-walk stops up to ARRIVE_DIST short of it. */
const ROBUST_STEPS = [0.4, 0.3, 0.2, 0.1, 0] as const;

const goals = new WeakMap<readonly Seat[], Map<number, { x: number; z: number } | null>>();

/**
 * Where a tap on seat `index` walks to: a spot a body stands on from which that seat is offered (worldMap approachesSeat,
 * within SEAT_REACH) — where it stays offered all round the spot a tap-walk's stop could be (it stops up to ARRIVE_DIST
 * short: ROBUST_STEPS, the widest ring that holds first), then as roomy as the terrace allows (a way round needs room to
 * get in). Another chair nearer the stop is no matter: the tapped one is preferred (seatPreference.ts). Null when there
 * is no such spot. Cached per seat list.
 */
export function seatApproachGoal(seats: readonly Seat[], index: number, obstacles: readonly AABB[], bounds: Bounds): { x: number; z: number } | null {
  let byIndex = goals.get(seats);
  if (!byIndex) goals.set(seats, (byIndex = new Map()));
  if (byIndex.has(index)) return byIndex.get(index) ?? null;
  const s = seats[index];
  let best: { x: number; z: number } | null = null;
  let bestScore = -Infinity;
  const offered = (x: number, z: number) => approachesSeat(s, x, z) && Math.hypot(x - s.x, z - s.z) <= SEAT_REACH;
  for (let dx = -GOAL_RADIUS; dx <= GOAL_RADIUS; dx += GRID) {
    for (let dz = -GOAL_RADIUS; dz <= GOAL_RADIUS; dz += GRID) {
      const x = Math.round((s.x + dx) * 1000) / 1000;
      const z = Math.round((s.z + dz) * 1000) / 1000;
      if (!isFreeSpot(x, z, obstacles, bounds) || !offered(x, z)) continue;
      let robust = -1;
      for (let k = 0; k < ROBUST_STEPS.length && robust < 0; k++) {
        const rr = ROBUST_STEPS[k];
        let ok = true;
        for (let a = 0; a < 16 && ok; a++) {
          const px = x + rr * Math.cos((a * Math.PI) / 8);
          const pz = z + rr * Math.sin((a * Math.PI) / 8);
          if (isFreeSpot(px, pz, obstacles, bounds) && !offered(px, pz)) ok = false;
        }
        if (ok) robust = k;
      }
      let clear = 0;
      while (clear < CLEAR_WANTED && isFreeSpot(x, z, obstacles, bounds, PLAYER_RADIUS + clear + GRID)) clear += GRID;
      const score = -robust * 1000 + clear * 100 - Math.hypot(x - s.standX, z - s.standZ);
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  }
  byIndex.set(index, best);
  return best;
}
