/**
 * Where a click (or a tap) sends the avatar, and so where its destination ring goes — pure, no three.js: the scene
 * raycast (clickPick.ts) finds the first visible surface under the cursor and hands it here.
 *
 * Owner 2026-11-10: "찍은 부분의 동그라미가 간혹 안 나타나거나 제대로 표시가 안 된다". Besides the ring losing the depth
 * test to the village's offset ground (ClickMarker.tsx), the target used to be the ray's hit on the plane y = 0, never
 * the surface actually clicked: a click on a wall, a bench, the fountain or the own avatar put the ring behind or
 * under it (hidden) and walked the avatar into it until the no-progress rule dropped it; a click past the area slid
 * along its edge, away from the cursor. The rules now, the same for a mouse and a finger:
 *
 *  1. Only GROUND takes a walk: the surface must face up (n.y >= WALKABLE_MIN_NY) and lie no higher than
 *     WALKABLE_MAX_Y — the avatar's feet stay at y = 0, so a bench seat, the fountain's rim, a step or a roof is not
 *     somewhere to walk to. An avatar, a wall, a roof, the sky: no walk and no ring.
 *  2. The spot must be one a body can stand on: inside the area the player is in and clear of every collider grown by
 *     the player's radius, as LocalPlayer's slide sees them. Visible ground just inside that margin (at a wall's foot,
 *     under a bench) moves out to the nearest free point when that is within MAX_PUSH; anything deeper (the creek's
 *     banks, the fountain's basin, past the area's edge) is refused.
 *  3. The walk there is simulated: the same straight steer, collision slide, bounds clamp and no-progress release as
 *     LocalPlayer + stepClickMove. Arriving, the ring goes on the click. Stopped on the way (a bench, a wall, the creek
 *     bank in between), the ring goes where the avatar will stop — the walk to that spot is checked to arrive too. One
 *     that cannot get going (MIN_TRIP) is refused. So the ring is never shown where the avatar will not go.
 *
 * Other players are not in the simulation (they move): one in the way still stops the walk early, and the
 * no-progress rule releases it as before.
 */

import { MOVE_SPEED } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { resolveCollision, type AABB } from "@caysonverse/shared/collision";
import type { Bounds } from "@caysonverse/shared/school/geometry";
import { ARRIVE_DIST, STUCK_MIN_DIST, STUCK_WINDOW_SEC } from "./clickMove";

/** A surface is ground when its normal is at least this upright (about 37 degrees of slope at most). */
export const WALKABLE_MIN_NY = 0.8;

/**
 * ...and it lies no higher than this (m). The village's ground layers top out at 3 cm (the forecourt) and the curbs at
 * 5 cm, the escape hall's rugs at 3.6 cm; the lowest thing the avatar cannot stand on is far higher (steps 30 cm, a
 * bench seat 45 cm).
 */
export const WALKABLE_MAX_Y = 0.12;

/** Visible ground inside a collider's margin moves out to the nearest free point when that is at most this far (m). */
export const MAX_PUSH = 0.75;

/** A walk the simulation stops sooner than this (m) from where it starts does not get going: refused. */
export const MIN_TRIP = 0.5;

/** The simulation's step (s): a 60 Hz frame. */
export const SIM_DT = 1 / 60;

/** The longest walk simulated (s): far past anything clickable on the largest map (190 m at 4 m/s is 48 s). */
export const SIM_MAX_SEC = 90;

/** How far past a collider's grown face a pushed-out point lands (m), so it is clear of it, not on it. */
const PUSH_EPS = 0.02;

/** The surface under the cursor: a point and how upright its (camera-facing) normal is. */
export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
  /** World normal's y, flipped toward the camera (1 = flat ground seen from above). */
  ny: number;
}

/** Ground the avatar can walk to (rule 1). */
export function isWalkableSurface(s: { y: number; ny: number }): boolean {
  return s.ny >= WALKABLE_MIN_NY && s.y <= WALKABLE_MAX_Y;
}

/**
 * Whether a body centred at (x, z) stands clear: inside `bounds` shrunk by `r` (LocalPlayer's backstop clamp) and
 * outside every obstacle grown by `r` on each side — the square growth resolveCollision slides along, so a point inside
 * it is never reached from outside.
 */
export function isFreeSpot(x: number, z: number, obstacles: readonly AABB[], bounds: Bounds, r = PLAYER_RADIUS): boolean {
  if (x < bounds.minX + r || x > bounds.maxX - r || z < bounds.minZ + r || z > bounds.maxZ - r) return false;
  for (const b of obstacles) {
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
  }
  return true;
}

/**
 * The free spot nearest (x, z) within `maxPush` (rule 2), or null. Out of each grown obstacle the point is in, across
 * each of its four faces, and into the bounds — repeated so a point between two overlapping boxes finds its way out.
 */
export function nearestFreeSpot(
  x: number,
  z: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  maxPush = MAX_PUSH,
  r = PLAYER_RADIUS,
): { x: number; z: number } | null {
  if (isFreeSpot(x, z, obstacles, bounds, r)) return { x, z };
  let frontier: Array<{ x: number; z: number }> = [{ x, z }];
  let best: { x: number; z: number; d: number } | null = null;
  const seen = new Set<string>();
  for (let round = 0; round < 3 && frontier.length > 0; round++) {
    const next: Array<{ x: number; z: number }> = [];
    for (const p of frontier) {
      const moves: Array<{ x: number; z: number }> = [];
      // into the bounds
      const bx = Math.min(Math.max(p.x, bounds.minX + r + PUSH_EPS), bounds.maxX - r - PUSH_EPS);
      const bz = Math.min(Math.max(p.z, bounds.minZ + r + PUSH_EPS), bounds.maxZ - r - PUSH_EPS);
      if (bx !== p.x || bz !== p.z) moves.push({ x: bx, z: bz });
      for (const b of obstacles) {
        if (!(p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r)) continue;
        moves.push(
          { x: b.minX - r - PUSH_EPS, z: p.z },
          { x: b.maxX + r + PUSH_EPS, z: p.z },
          { x: p.x, z: b.minZ - r - PUSH_EPS },
          { x: p.x, z: b.maxZ + r + PUSH_EPS },
        );
      }
      for (const m of moves) {
        const d = Math.hypot(m.x - x, m.z - z);
        if (d > maxPush) continue; // every later move only goes farther from a point already too far
        const key = `${m.x.toFixed(4)},${m.z.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (isFreeSpot(m.x, m.z, obstacles, bounds, r)) {
          if (!best || d < best.d) best = { x: m.x, z: m.z, d };
        } else next.push(m);
      }
    }
    frontier = next;
  }
  return best ? { x: best.x, z: best.z } : null;
}

/** Where a simulated walk ended and whether it arrived (within ARRIVE_DIST of where it was going). */
export interface WalkResult {
  x: number;
  z: number;
  arrived: boolean;
}

/**
 * The click-move walk from (fromX, fromZ) toward (toX, toZ), step by step as the game walks it: the unit direction to
 * the target each step (stepClickMove), moved at MOVE_SPEED through resolveCollision against `obstacles` and clamped
 * a radius inside `bounds` (LocalPlayer), released on arrival or when the net displacement over STUCK_WINDOW_SEC
 * falls under STUCK_MIN_DIST (stepClickMove's no-progress rule).
 */
export function simulateWalk(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  r = PLAYER_RADIUS,
): WalkResult {
  // Each axis only ever moves toward the target (the slide clamps, never reverses), so the walk stays inside the
  // rectangle spanned by its two ends: only the obstacles near that rectangle can touch it.
  const pad = r + 0.05;
  const loX = Math.min(fromX, toX) - pad;
  const hiX = Math.max(fromX, toX) + pad;
  const loZ = Math.min(fromZ, toZ) - pad;
  const hiZ = Math.max(fromZ, toZ) + pad;
  const near = obstacles.filter((b) => b.maxX > loX && b.minX < hiX && b.maxZ > loZ && b.minZ < hiZ);

  const step = MOVE_SPEED * SIM_DT;
  const maxSteps = Math.ceil(SIM_MAX_SEC / SIM_DT);
  let x = fromX;
  let z = fromZ;
  let anchorX = x;
  let anchorZ = z;
  let windowSec = 0;
  for (let i = 0; i < maxSteps; i++) {
    const dx = toX - x;
    const dz = toZ - z;
    const len = Math.hypot(dx, dz);
    if (len < ARRIVE_DIST) return { x, z, arrived: true };
    windowSec += SIM_DT;
    if (windowSec >= STUCK_WINDOW_SEC) {
      if (Math.hypot(x - anchorX, z - anchorZ) < STUCK_MIN_DIST) return { x, z, arrived: false };
      anchorX = x;
      anchorZ = z;
      windowSec = 0;
    }
    const next = resolveCollision(x, z, (dx / len) * step, (dz / len) * step, r, near);
    x = Math.min(Math.max(next.x, bounds.minX + r), bounds.maxX - r);
    z = Math.min(Math.max(next.z, bounds.minZ + r), bounds.maxZ - r);
  }
  return { x, z, arrived: false };
}

/**
 * Why a click takes no walk (for the dev hook and the tests). "here": the ground at the avatar's own feet — that one
 * still means something: stop (it used to set a target the avatar had already reached).
 */
export type RefuseReason = "not-ground" | "blocked" | "here" | "unreachable";

/** The outcome of a click: where the avatar goes (and the ring with it), or why nothing happens. */
export type ClickPlan =
  | {
      ok: true;
      x: number;
      z: number;
      /** The surface height the ring lies on (the clicked surface's; see `adjusted`). */
      y: number;
      /** "none": on the click; "pushed": out of a collider's margin; "stopped": where the walk stops on the way. */
      adjusted: "none" | "pushed" | "stopped";
    }
  | { ok: false; reason: RefuseReason };

/** What a click does: walk to its plan, stop where the avatar stands (a click at its own feet), or nothing at all. */
export function clickIntent(plan: ClickPlan): "walk" | "stop" | "ignore" {
  if (plan.ok) return "walk";
  return plan.reason === "here" ? "stop" : "ignore";
}

/**
 * Where a click's walk starts: where the avatar stands — or, seated, the seat's dismount point (`standX/standZ`):
 * a click first gets the body up, and getting up puts it there (the seat itself lies inside the bench's collider).
 */
export function walkStart(
  x: number,
  z: number,
  seat: { standX: number; standZ: number } | undefined,
): { x: number; z: number } {
  return seat ? { x: seat.standX, z: seat.standZ } : { x, z };
}

/**
 * Rules 1-3 for a click on `surface` (null: nothing — the sky) by a player whose walk starts at (fromX, fromZ)
 * (walkStart). A moved destination keeps the clicked surface's height; the caller may look the ground up there
 * instead (clickPick.ts surfaceHeightAt). `seated`: the ground at the start itself is still a walk (get up, stand
 * there), where standing it means "stop here".
 */
export function planClickMove(
  fromX: number,
  fromZ: number,
  surface: SurfacePoint | null,
  obstacles: readonly AABB[],
  bounds: Bounds,
  seated = false,
): ClickPlan {
  if (!surface || !isWalkableSurface(surface)) return { ok: false, reason: "not-ground" };
  const spot = nearestFreeSpot(surface.x, surface.z, obstacles, bounds);
  if (!spot) return { ok: false, reason: "blocked" };
  const pushed = spot.x !== surface.x || spot.z !== surface.z;
  if (Math.hypot(spot.x - fromX, spot.z - fromZ) < ARRIVE_DIST) {
    if (!seated) return { ok: false, reason: "here" };
    return { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted: pushed ? "pushed" : "none" };
  }
  const walk = simulateWalk(fromX, fromZ, spot.x, spot.z, obstacles, bounds);
  if (walk.arrived) return { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted: pushed ? "pushed" : "none" };
  // Stopped on the way: the ring goes where the avatar stops — when that is a real trip and the walk to it arrives.
  if (Math.hypot(walk.x - fromX, walk.z - fromZ) < MIN_TRIP) return { ok: false, reason: "unreachable" };
  const again = simulateWalk(fromX, fromZ, walk.x, walk.z, obstacles, bounds);
  if (!again.arrived) return { ok: false, reason: "unreachable" };
  return { ok: true, x: walk.x, z: walk.z, y: surface.y, adjusted: "stopped" };
}
