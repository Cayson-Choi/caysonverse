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
 *  1. Only what a body can stand on takes a walk (surfaceKind): low GROUND — facing up (n.y >= WALKABLE_MIN_NY) and
 *     no higher than WALKABLE_MAX_Y; or, out in the open (no collider there), a raised surface facing up no higher than
 *     a step (RAISED_MAX_Y: the bridge's deck, the memorial's steps, a flower bed's top) or the low side of a curb.
 *     The avatar's feet stay at y = 0 and walk over all of those. A bench seat or the fountain's rim (raised, inside a
 *     collider), another avatar, a wall, a roof, the sky: no walk and no ring. (The player's own avatar is looked
 *     through: clickPick.ts.)
 *  2. The spot must be one a body can stand on: inside the area the player is in and clear of every collider grown by
 *     the player's radius, as LocalPlayer's slide sees them. Visible low ground just inside that margin (at a wall's
 *     foot, under a bench) moves out to the nearest free point when that is within MAX_PUSH. Deeper (the creek's water
 *     and its banks, the fountain's basin, past the area's edge) there is no spot to stand on: the walk goes toward it
 *     and stops at what is in the way (rule 3's "stopped") — round 4 review: the grass band at the water did nothing
 *     while the lawn farther across walked to the same bank. A raised surface is never moved.
 *  3. The walk there is simulated: the same steer, collision slide, bounds clamp and no-progress release as
 *     LocalPlayer + stepClickMove. Arriving straight (a slide round a bench or a corner included), the ring goes on the
 *     click. Not arriving, a way round is looked for (findDetour — round 4 review: round the bench a seated player gets
 *     up from, whose paving behind it did nothing; over the creek's bridge, where the ring used to sit 2.6 m ahead,
 *     behind the avatar's own back): found and walked to the end, the ring still goes on the click and the walk
 *     follows the way's corners (`via`). No way round within DETOUR_MAX_RATIO of the straight line, the ring goes where
 *     the straight walk toward the click first meets the obstacle (WalkResult.contact) and the avatar walks there —
 *     straight toward the cursor, stopping at the obstacle, the ring on its way to the cursor. Not where the slide
 *     would end: across the creek that carried the stop 18-25 m along the bank, off the screen, and walked the avatar
 *     17.7 m away from where the player was looking (round 3 review). The walk to that spot is checked to arrive too.
 *     One that cannot get going (MIN_TRIP: already against the obstacle) is refused. So the ring is never shown where
 *     the avatar will not go.
 *  4. And the player must see the ring (requireSeen; round 3 review: the stop under a cherry's crown, the stop off the
 *     screen, the lawn seen through a pinhole in a crown — each walked with a ring nobody could see, the very
 *     "동그라미가 안 나타남" this is about). The CameraRig measures how much of the ring would reach the screen from the
 *     camera (clickPick.ts ringView); too little, or its centre off the screen, and the click does nothing at all: no
 *     ring and no walk, as for a click on a wall.
 *
 * Other players are not in the simulation (they move): one in the way still stops the walk early, and the
 * no-progress rule releases it as before.
 */

import { MOVE_SPEED } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { resolveCollision, type AABB } from "@caysonverse/shared/collision";
import type { Bounds } from "@caysonverse/shared/school/geometry";
import { ARRIVE_DIST, STUCK_MIN_DIST, STUCK_STEP_MAX_SEC, STUCK_WINDOW_SEC, VIA_REACH } from "./clickMove";

/** A surface is ground when its normal is at least this upright (about 37 degrees of slope at most). */
export const WALKABLE_MIN_NY = 0.8;

/**
 * ...and it lies no higher than this (m) to be low ground, the kind a click at a collider's foot may be pushed out of.
 * The village's ground layers top out at 3 cm (the forecourt) and its curbs at 5 and 11 cm, the escape hall's rugs at
 * 3.6 cm. Below it, an upright face out in the open (a curb's side) counts too.
 */
export const WALKABLE_MAX_Y = 0.12;

/**
 * A surface facing up out in the open (no collider) is walked to up to this high (m): the bridge's deck (its crown
 * 13-15 cm, round 2 review: the creek's only crossing refused a click), the memorial's steps (30 / 45 cm), a flower
 * bed's top (38 cm). Higher (a table, a sill, a bench's back) is not a floor; a bench seat (45 cm) and the fountain's
 * rim lie inside their colliders and are refused there.
 */
export const RAISED_MAX_Y = 0.46;

/** Visible ground inside a collider's margin moves out to the nearest free point when that is at most this far (m). */
export const MAX_PUSH = 0.75;

/** A walk the simulation stops sooner than this (m) from where it starts does not get going: refused. */
export const MIN_TRIP = 0.5;

/** The simulation's step (s): a 60 Hz frame. */
export const SIM_DT = 1 / 60;

/**
 * How much longer than its own legs need a simulated walk may take (s). Its time is the legs' length along the two
 * axes at MOVE_SPEED (a step moves each axis toward its aim, so even a slide walks no farther), plus a quarter, plus
 * this. A fixed 90 s cap (written for 4 m/s) stopped a 2 m/s walk after 180 m: a clear click across the 190 x 190 m
 * village "stopped" 74 m short of it (round 4 review).
 */
export const SIM_EXTRA_SEC = 2;

/** How far past a collider's grown face a pushed-out point lands (m), so it is clear of it, not on it. */
const PUSH_EPS = 0.02;

/** The surface under the cursor: a point and how upright its (camera-facing) normal is. */
export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
  /** World normal's y, flipped toward the camera (1 = flat ground seen from above). */
  ny: number;
  /**
   * For an upright face clicked low: whether the face rises past WALKABLE_MAX_Y (a step's riser, a planter's side —
   * clickPick.ts faceIsTall), so it is no curb's side. Unmeasured (undefined): taken as a curb's.
   */
  faceTall?: boolean;
}

/** Low ground (rule 1): facing up and no higher than WALKABLE_MAX_Y — walked to, or pushed out of a collider's margin. */
export function isWalkableSurface(s: { y: number; ny: number }): boolean {
  return s.ny >= WALKABLE_MIN_NY && s.y <= WALKABLE_MAX_Y;
}

/**
 * What a clicked surface is to the walk (rule 1): "ground" (low ground, may be pushed out of a collider's margin);
 * "open" (out in the open: a raised surface facing up no higher than RAISED_MAX_Y, or a face no higher than
 * WALKABLE_MAX_Y above the ground — a curb's side; walked to exactly as clicked); "none" (nothing to walk to).
 * A face is a curb's side only where the face itself ends below WALKABLE_MAX_Y (`faceTall` false): the low part of the
 * memorial step's 30 cm riser put the ring's centre on the riser and its far half inside the step (round 3 review).
 */
export function surfaceKind(s: SurfacePoint, obstacles: readonly AABB[], bounds: Bounds): "ground" | "open" | "none" {
  if (isWalkableSurface(s)) return "ground";
  const raised = s.ny >= WALKABLE_MIN_NY && s.y <= RAISED_MAX_Y;
  const curbSide = s.y > 0 && s.y <= WALKABLE_MAX_Y && !s.faceTall;
  if (!raised && !curbSide) return "none";
  return isFreeSpot(s.x, s.z, obstacles, bounds) ? "open" : "none";
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
  /**
   * Where the straight walk first met something (a collider's grown face, the area's edge): the body after the first
   * step the slide or the clamp changed. Null when nothing ever changed a step (it arrived straight, or ran out of time).
   */
  contact: { x: number; z: number } | null;
}

/** A point on the ground (m). */
export interface GroundPoint {
  x: number;
  z: number;
}

const NO_VIA: readonly GroundPoint[] = [];

/**
 * The click-move walk from (fromX, fromZ) toward (toX, toZ), step by step as the game walks it: the unit direction to
 * the next of the `via` corners not yet passed (within VIA_REACH), then to the target (stepClickMove), moved at
 * MOVE_SPEED through resolveCollision against `obstacles` and clamped a radius inside `bounds` (LocalPlayer), released
 * on arrival or when the net displacement over STUCK_WINDOW_SEC falls under STUCK_MIN_DIST (stepClickMove's
 * no-progress rule).
 */
export function simulateWalk(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  r = PLAYER_RADIUS,
  via: readonly GroundPoint[] = NO_VIA,
): WalkResult {
  // Each axis only ever moves toward its aim (the slide clamps, never reverses), so each leg stays inside the
  // rectangle spanned by its two ends: only the obstacles near those rectangles can touch the walk.
  const pad = r + 0.05;
  let loX = Math.min(fromX, toX);
  let hiX = Math.max(fromX, toX);
  let loZ = Math.min(fromZ, toZ);
  let hiZ = Math.max(fromZ, toZ);
  let legs = 0; // the legs' length along the two axes (m)
  let px = fromX;
  let pz = fromZ;
  for (const p of [...via, { x: toX, z: toZ }]) {
    loX = Math.min(loX, p.x);
    hiX = Math.max(hiX, p.x);
    loZ = Math.min(loZ, p.z);
    hiZ = Math.max(hiZ, p.z);
    legs += Math.abs(p.x - px) + Math.abs(p.z - pz);
    px = p.x;
    pz = p.z;
  }
  const near = obstacles.filter((b) => b.maxX > loX - pad && b.minX < hiX + pad && b.maxZ > loZ - pad && b.minZ < hiZ + pad);

  const step = MOVE_SPEED * SIM_DT;
  const maxSteps = Math.ceil(((legs / MOVE_SPEED) * 1.25 + SIM_EXTRA_SEC) / SIM_DT);
  let x = fromX;
  let z = fromZ;
  let anchorX = x;
  let anchorZ = z;
  let windowSec = 0;
  let contact: { x: number; z: number } | null = null;
  let k = 0; // the next via corner not yet passed
  for (let i = 0; i < maxSteps; i++) {
    if (Math.hypot(toX - x, toZ - z) < ARRIVE_DIST) return { x, z, arrived: true, contact };
    while (k < via.length && Math.hypot(via[k].x - x, via[k].z - z) < VIA_REACH) k++;
    const dx = (k < via.length ? via[k].x : toX) - x;
    const dz = (k < via.length ? via[k].z : toZ) - z;
    const len = Math.hypot(dx, dz);
    windowSec += Math.min(SIM_DT, STUCK_STEP_MAX_SEC);
    if (windowSec >= STUCK_WINDOW_SEC) {
      if (Math.hypot(x - anchorX, z - anchorZ) < STUCK_MIN_DIST) return { x, z, arrived: false, contact };
      anchorX = x;
      anchorZ = z;
      windowSec = 0;
    }
    const sx = (dx / len) * step;
    const sz = (dz / len) * step;
    const next = resolveCollision(x, z, sx, sz, r, near);
    const nx = Math.min(Math.max(next.x, bounds.minX + r), bounds.maxX - r);
    const nz = Math.min(Math.max(next.z, bounds.minZ + r), bounds.maxZ - r);
    if (!contact && Math.hypot(nx - (x + sx), nz - (z + sz)) > CONTACT_EPS) contact = { x: nx, z: nz };
    x = nx;
    z = nz;
  }
  return { x, z, arrived: false, contact };
}

/** A step the slide or the clamp moved by more than this (m) met something (simulateWalk's `contact`). */
const CONTACT_EPS = 1e-6;

// ───────────────────────────── a way round (rule 3) ─────────────────────────────

/**
 * How far either side of the straight line (m) a way round is looked for: past a bench or a house, and along the
 * creek's bank to its bridge (18 m from the far bank's lawn the round 4 review clicked).
 */
export const DETOUR_MARGIN = 20;

/** A way round is taken only up to this many times the straight distance, plus DETOUR_SLACK (m). */
export const DETOUR_MAX_RATIO = 2.5;
export const DETOUR_SLACK = 6;

/** The search grid's cell (m); grown when the region would hold more than DETOUR_MAX_CELLS (a cross-map click). */
const DETOUR_CELL = 0.5;
const DETOUR_MAX_CELLS = 40000;

/** Cells this close (m) past a collider's grown face cost DETOUR_NEAR_COST times more: the way keeps off the faces. */
const DETOUR_CLEAR = 0.2;
const DETOUR_NEAR_COST = 2;

/**
 * Whether the segment a→b passes through the inside of the box (open: running along a face or touching a corner is
 * outside — the slide lets a body move along a grown face).
 */
function segmentEntersBox(ax: number, az: number, bx: number, bz: number, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  // Liang-Barsky: p·t < q for each of the four open half-planes
  const ps = [-dx, dx, -dz, dz];
  const qs = [ax - minX, maxX - ax, az - minZ, maxZ - az];
  for (let i = 0; i < 4; i++) {
    const p = ps[i];
    const q = qs[i];
    if (Math.abs(p) < 1e-12) {
      if (q <= 0) return false; // parallel and on or outside this side
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t1 - t0 <= 1e-9) return false;
  }
  return true;
}

/** Whether a body walks the segment a→b without touching any of `boxes` grown by `r` (so with no slide at all). */
export function segmentClear(ax: number, az: number, bx: number, bz: number, boxes: readonly AABB[], r = PLAYER_RADIUS): boolean {
  for (const b of boxes) {
    if (segmentEntersBox(ax, az, bx, bz, b.minX - r, b.maxX + r, b.minZ - r, b.maxZ + r)) return false;
  }
  return true;
}

/** A small binary min-heap of grid cells, each pushed with its f score (a cell pushed again keeps both entries). */
class CellHeap {
  private cells: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.cells.length;
  }
  /** The smallest key in the heap (Infinity when empty). */
  get minKey(): number {
    return this.keys.length > 0 ? this.keys[0] : Infinity;
  }
  private swap(i: number, j: number): void {
    [this.cells[i], this.cells[j]] = [this.cells[j], this.cells[i]];
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
  }
  push(c: number, key: number): void {
    this.cells.push(c);
    this.keys.push(key);
    let i = this.cells.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }
  pop(): number {
    const top = this.cells[0];
    const lastCell = this.cells.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.cells.length > 0) {
      this.cells[0] = lastCell;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }
}

/**
 * A way for a body from (fromX, fromZ) to (toX, toZ) round the colliders (rule 3), as the corners to walk by in order
 * (the ends left out), or null when there is none within DETOUR_MARGIN of the straight line and DETOUR_MAX_RATIO of
 * its length. A grid search (A*, eight neighbours, no corner cutting) over the region round the two ends — a cell is
 * shut when its centre lies inside a collider grown by the radius, dearer within DETOUR_CLEAR past it — then pulled
 * tight: from each corner the farthest cell of the way the body walks to with no slide (segmentClear) is the next.
 * Both ends must be free spots (the start is where the body stands).
 */
export function findDetour(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  r = PLAYER_RADIUS,
): GroundPoint[] | null {
  const straight = Math.hypot(toX - fromX, toZ - fromZ);
  const maxLen = straight * DETOUR_MAX_RATIO + DETOUR_SLACK;
  const x0 = Math.max(Math.min(fromX, toX) - DETOUR_MARGIN, bounds.minX + r);
  const x1 = Math.min(Math.max(fromX, toX) + DETOUR_MARGIN, bounds.maxX - r);
  const z0 = Math.max(Math.min(fromZ, toZ) - DETOUR_MARGIN, bounds.minZ + r);
  const z1 = Math.min(Math.max(fromZ, toZ) + DETOUR_MARGIN, bounds.maxZ - r);
  if (!(x1 > x0 && z1 > z0)) return null;
  const cell = Math.max(DETOUR_CELL, Math.sqrt(((x1 - x0) * (z1 - z0)) / DETOUR_MAX_CELLS));
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const boxes = obstacles.filter((b) => b.maxX + r > x0 && b.minX - r < x1 && b.maxZ + r > z0 && b.minZ - r < z1);
  const centreX = (i: number) => x0 + (i + 0.5) * cell;
  const centreZ = (j: number) => z0 + (j + 0.5) * cell;
  // 0 open, 1 near a face (dearer), 2 shut
  const grid = new Uint8Array(nx * nz);
  for (const b of boxes) {
    for (const [grow, mark] of [
      [r + DETOUR_CLEAR, 1],
      [r, 2],
    ] as const) {
      const iLo = Math.max(0, Math.floor((b.minX - grow - x0) / cell));
      const iHi = Math.min(nx - 1, Math.ceil((b.maxX + grow - x0) / cell));
      const jLo = Math.max(0, Math.floor((b.minZ - grow - z0) / cell));
      const jHi = Math.min(nz - 1, Math.ceil((b.maxZ + grow - z0) / cell));
      for (let j = jLo; j <= jHi; j++) {
        const cz = centreZ(j);
        if (!(cz > b.minZ - grow && cz < b.maxZ + grow)) continue;
        for (let i = iLo; i <= iHi; i++) {
          const cx = centreX(i);
          if (cx > b.minX - grow && cx < b.maxX + grow && grid[j * nx + i] < mark) grid[j * nx + i] = mark;
        }
      }
    }
  }
  const cellOf = (x: number, z: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell)));
    const j = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / cell)));
    return j * nx + i;
  };
  // The two ends are free spots, but their cells' centres may lie inside a collider's grown box (a body standing at a
  // bench's face): the search starts from the open cells round the start that the body walks to straight from it, and
  // ends at the first cell round the destination it walks straight from to there (round 4: a goal cell inside the
  // bench, entered on a diagonal, cut the bench's corner).
  const start = cellOf(fromX, fromZ);
  const goal = cellOf(toX, toZ);
  const si = start % nx;
  const sj = Math.floor(start / nx);
  const gi = goal % nx;
  const gj = Math.floor(goal / nx);
  const g = new Float64Array(nx * nz).fill(Infinity);
  const from = new Int32Array(nx * nz).fill(-1);
  const closed = new Uint8Array(nx * nz);
  const h = (c: number) => {
    const di = Math.abs((c % nx) - gi);
    const dj = Math.abs(Math.floor(c / nx) - gj);
    return (Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj)) * cell;
  };
  const open = new CellHeap();
  for (let j = Math.max(0, sj - 1); j <= Math.min(nz - 1, sj + 1); j++) {
    for (let i = Math.max(0, si - 1); i <= Math.min(nx - 1, si + 1); i++) {
      const c = j * nx + i;
      if (grid[c] === 2 || !segmentClear(fromX, fromZ, centreX(i), centreZ(j), boxes, r)) continue;
      g[c] = Math.hypot(centreX(i) - fromX, centreZ(j) - fromZ);
      open.push(c, g[c] + h(c));
    }
  }
  let last = -1;
  while (open.size > 0) {
    if (open.minKey > maxLen * DETOUR_NEAR_COST) break; // every way left is longer than any taken
    const c = open.pop();
    if (closed[c]) continue;
    const ci = c % nx;
    const cj = Math.floor(c / nx);
    if (Math.abs(ci - gi) <= 1 && Math.abs(cj - gj) <= 1 && segmentClear(centreX(ci), centreZ(cj), toX, toZ, boxes, r)) {
      last = c;
      break;
    }
    closed[c] = 1;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const n = j * nx + i;
        if (closed[n] || grid[n] === 2) continue;
        // no cutting a shut cell's corner on a diagonal
        if (di !== 0 && dj !== 0 && (grid[cj * nx + i] === 2 || grid[j * nx + ci] === 2)) continue;
        const cost = (di !== 0 && dj !== 0 ? Math.SQRT2 : 1) * cell * (grid[n] === 1 ? DETOUR_NEAR_COST : 1);
        const t = g[c] + cost;
        if (t < g[n]) {
          g[n] = t;
          from[n] = c;
          open.push(n, t + h(n));
        }
      }
    }
  }
  if (last === -1) return null;
  // The way's points: the start itself, the centres of its cells, the destination itself. Two neighbouring open cells'
  // centres see each other while a cell is no wider than a body (a grown box is 2r wide at least, so one between them
  // would cover a centre; the diagonals skip shut corners): pulling it tight below always finds a next point.
  const cells: number[] = [];
  for (let c = last; c !== -1; c = from[c]) cells.push(c);
  cells.reverse();
  const pts: GroundPoint[] = [{ x: fromX, z: fromZ }, ...cells.map((c) => ({ x: centreX(c % nx), z: centreZ(Math.floor(c / nx)) })), { x: toX, z: toZ }];
  // pulled tight: from each corner, the farthest point of the way walked to with no slide
  const via: GroundPoint[] = [];
  let at = 0;
  let length = 0;
  while (at < pts.length - 1) {
    let next = -1;
    for (let k = at + 1; k < pts.length; k++) {
      if (segmentClear(pts[at].x, pts[at].z, pts[k].x, pts[k].z, boxes, r)) next = k;
      else if (next !== -1 && k - next > 6) break; // well past the last clear one: the view is shut
    }
    if (next === -1) return null; // not even the next cell: the grid passed where a body does not
    length += Math.hypot(pts[next].x - pts[at].x, pts[next].z - pts[at].z);
    if (next < pts.length - 1) via.push(pts[next]);
    at = next;
  }
  return length <= maxLen ? via : null;
}

/**
 * Why a click takes no walk (for the dev hook and the tests). "here": the ground at the avatar's own feet — that one
 * still means something: stop (it used to set a target the avatar had already reached). "unseen": the ring would not
 * be seen (rule 4). "unreachable": the walk toward it cannot get going (already against what is in the way).
 */
export type RefuseReason = "not-ground" | "here" | "unreachable" | "unseen";

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
      /** A way round (rule 3, findDetour): the corners the walk goes by, in order, before the destination. */
      via?: readonly GroundPoint[];
    }
  | { ok: false; reason: RefuseReason };

/** What a click does: walk to its plan, stop where the avatar stands (a click at its own feet), or nothing at all. */
export function clickIntent(plan: ClickPlan): "walk" | "stop" | "ignore" {
  if (plan.ok) return "walk";
  return plan.reason === "here" ? "stop" : "ignore";
}

/**
 * Where a click's walk starts: where the avatar stands — or, seated, the seat's dismount point (`standX/standZ`):
 * a click first gets the body up, and getting up puts it there (the seat itself lies inside the bench's collider) —
 * or, while a glide carries the body (getting up: the stand-up clip moves it off the seat, LocalPlayer), where that
 * glide lands (`landing`): the walk waits for it there. Round 2 review: planned from the gliding pose, inside the
 * bench's collider, the simulated walk slid through the bench and put the ring behind it.
 */
export function walkStart(
  x: number,
  z: number,
  seat: { standX: number; standZ: number } | undefined,
  landing: { x: number; z: number } | null = null,
): { x: number; z: number } {
  if (seat) return { x: seat.standX, z: seat.standZ };
  return landing ? { x: landing.x, z: landing.z } : { x, z };
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
  const kind = surface ? surfaceKind(surface, obstacles, bounds) : "none";
  if (!surface || kind === "none") return { ok: false, reason: "not-ground" };
  // low ground may be pushed out of a collider's margin; an open surface is already a free spot, taken as it is
  const spot = kind === "ground" ? nearestFreeSpot(surface.x, surface.z, obstacles, bounds) : { x: surface.x, z: surface.z };
  let walk: WalkResult;
  if (spot) {
    const pushed = spot.x !== surface.x || spot.z !== surface.z;
    const adjusted = pushed ? "pushed" : "none";
    if (Math.hypot(spot.x - fromX, spot.z - fromZ) < ARRIVE_DIST) {
      if (!seated) return { ok: false, reason: "here" };
      return { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted };
    }
    walk = simulateWalk(fromX, fromZ, spot.x, spot.z, obstacles, bounds);
    if (walk.arrived) return { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted };
    // Not straight there: a way round, walked to the end (rule 3).
    const via = findDetour(fromX, fromZ, spot.x, spot.z, obstacles, bounds);
    if (via && simulateWalk(fromX, fromZ, spot.x, spot.z, obstacles, bounds, PLAYER_RADIUS, via).arrived) {
      return { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted, via };
    }
  } else {
    // Nowhere to stand there (deep in a collider, past the area's edge): toward it, up to what is in the way (rule 2).
    walk = simulateWalk(fromX, fromZ, surface.x, surface.z, obstacles, bounds);
  }
  // Stopped on the way: the ring goes where the straight walk toward the click meets the obstacle (rule 3) — when that
  // is a real trip and the walk to it arrives.
  const stop = walk.contact ?? walk;
  if (Math.hypot(stop.x - fromX, stop.z - fromZ) < MIN_TRIP) return { ok: false, reason: "unreachable" };
  const again = simulateWalk(fromX, fromZ, stop.x, stop.z, obstacles, bounds);
  if (!again.arrived) return { ok: false, reason: "unreachable" };
  return { ok: true, x: stop.x, z: stop.z, y: surface.y, adjusted: "stopped" };
}

/**
 * Rule 4: the share of a ring on the click itself (its drawn area on the screen) that must reach the screen. Less is
 * ground seen through a pinhole — a gap between a crown's leaves, the ring hidden by the crown all round it: a click on
 * the crown (round 3 review: 2-17 % of the ring drawn, the avatar walking under the tree). Leaves the camera sits in
 * (a crown around the lens, faded but dithered) leave a third of the ring and more: still a walk.
 */
export const RING_SEEN_AT_CLICK = 0.3;

/**
 * ...and of a ring moved off the click (out of a margin, or to where the walk stops): the player did not pick that
 * spot, so the ring must show it plainly — and its centre must be on the screen.
 */
export const RING_SEEN_MOVED = 0.5;

/** How a ring at a plan's spot would look from the camera (clickPick.ts ringView). */
export interface RingView {
  /** Its centre projects inside the screen (in front of the camera). */
  onScreen: boolean;
  /** The share of its on-screen area that reaches the screen past what stands in front (0..1; bodies do not count: they move off it, and ClickMarker draws the ring through them). */
  seen: number;
}

/** Rule 4: `plan` when its ring would be seen enough (RING_SEEN_AT_CLICK / RING_SEEN_MOVED), else "unseen". */
export function requireSeen(plan: ClickPlan, view: RingView): ClickPlan {
  if (!plan.ok) return plan;
  const need = plan.adjusted === "none" ? RING_SEEN_AT_CLICK : RING_SEEN_MOVED;
  return view.onScreen && view.seen >= need - 1e-9 ? plan : { ok: false, reason: "unseen" };
}
