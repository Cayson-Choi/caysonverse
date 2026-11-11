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
 *     while the lawn farther across walked to the same bank. A raised surface is never moved. Furniture whose box
 *     covers more ground than the piece itself (a plaza bench turned to face the fountain: a 1.9 x 0.66 m bench in a
 *     2.0 x 1.34 m box — the walk's collision is boxes only) is no wall: visible ground inside its box moves out up to
 *     FURNITURE_MAX_PUSH (round 5 review: seated, the paving right behind the backrest did nothing). The nearest spot
 *     may lie in a gap no body reaches: the nearest one the avatar walks to is taken (freeSpotsNear).
 *  3. The walk there is simulated: the same steer, collision slide, bounds clamp and no-progress release as
 *     LocalPlayer + stepClickMove. Arriving straight (a slide round a bench or a corner included), the ring goes on the
 *     click. Not arriving, a way round is looked for (findDetour — round 4 review: round the bench a seated player gets
 *     up from, whose paving behind it did nothing; over the creek's bridge, where the ring used to sit 2.6 m ahead,
 *     behind the avatar's own back): found and walked to the end, the ring still goes on the click and the walk
 *     follows the way's corners (`via`), which keep DETOUR_VIA_CLEAR clear of what they go round, more than the walk
 *     turns early for them (VIA_REACH; round 5 review: corners hugging the grown faces, the walk cut into them and
 *     stuck). No way round within DETOUR_MAX_RATIO of the straight line, the ring goes where
 *     the straight walk toward the click first meets the obstacle (WalkResult.contact) and the avatar walks there —
 *     straight toward the cursor, stopping at the obstacle, the ring on its way to the cursor. Not where the slide
 *     would end: across the creek that carried the stop 18-25 m along the bank, off the screen, and walked the avatar
 *     17.7 m away from where the player was looking (round 3 review). The walk to that spot is checked to arrive too.
 *     One that cannot get going (MIN_TRIP: already against the obstacle) takes a longer way round (DETOUR_FAR_RATIO)
 *     rather than nothing; with none at all it is refused. So the ring is never shown where the avatar will not go.
 *  4. And the ring must be on the screen (requireSeen): its centre in front of the camera and inside the screen, or
 *     the click does nothing at all — no ring and no walk, as for a click on a wall (round 3 review: a stop off the
 *     screen walked with a ring nobody could see, the very "동그라미가 안 나타남" this is about). What covers part of
 *     it no longer hides it: ClickMarker draws the covered part through what is in front, fainter (a crown, a bench's
 *     back, the avatar's own body). Round 3 also asked 30 % of a ring on the click and 50 % of a moved one to be in
 *     plain view; with the see-through pass that refused rings the player does see whole (round 4 review: the paving
 *     right behind a bench, tapped from its seat, 22 % in plain view behind the bench's back — the tap did nothing).
 *
 * Other players are not in the simulation (they move): one in the way still stops the walk early, and the
 * no-progress rule releases it as before.
 */

import { MOVE_SPEED } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { resolveCollision, type AABB } from "@caysonverse/shared/collision";
import type { Bounds } from "@caysonverse/shared/school/geometry";
import { ARRIVE_DIST, STUCK_MIN_DIST, STUCK_STEP_MAX_SEC, STUCK_WINDOW_SEC, VIA_REACH, viaPassed } from "./clickMove";

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

/**
 * ...and inside a piece of furniture's box (planClickMove's `furniture`), this far (m): a plaza bench turned to face the
 * fountain is a 1.9 x 0.66 m footprint whose collider is the 2.0 x 1.34 m box round it (the walk's collision,
 * LocalPlayer's and the server's, is boxes only), so the paving right behind its backrest or beside its end is in plain
 * view yet up to 1.3 m inside what the body slides along (round 5 review: seated, a tap there did nothing — no free spot
 * within MAX_PUSH, and the walk toward it could not get going). The ring goes where the body can stand nearest the
 * click, and the avatar walks there.
 */
export const FURNITURE_MAX_PUSH = 2.5;

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
  return freeSpotsNear(x, z, obstacles, bounds, maxPush, r)[0] ?? null;
}

/**
 * Every free spot nearestFreeSpot weighs, nearest first: (x, z) itself when it is free, else the points out of the
 * grown obstacles across their faces. The nearest may lie in a gap no body reaches (round 5 review: the 7 cm between
 * a bench's grown box and a planter's): the plan takes the nearest it can walk to.
 */
export function freeSpotsNear(
  x: number,
  z: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  maxPush = MAX_PUSH,
  r = PLAYER_RADIUS,
): Array<{ x: number; z: number }> {
  if (isFreeSpot(x, z, obstacles, bounds, r)) return [{ x, z }];
  let frontier: Array<{ x: number; z: number }> = [{ x, z }];
  const found: Array<{ x: number; z: number; d: number }> = [];
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
        if (isFreeSpot(m.x, m.z, obstacles, bounds, r)) found.push({ x: m.x, z: m.z, d });
        else next.push(m);
      }
    }
    frontier = next;
  }
  found.sort((a, b) => a.d - b.d);
  return found.map((f) => ({ x: f.x, z: f.z }));
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
 * the next of the `via` corners not yet passed (clickMove.ts viaPassed), then to the target (stepClickMove), moved at
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
  const local = nearbyBoxes(near, loX - pad, hiX + pad, loZ - pad, hiZ + pad, r + step + 0.01);
  const maxSteps = Math.ceil(((legs / MOVE_SPEED) * 1.25 + SIM_EXTRA_SEC) / SIM_DT);
  let x = fromX;
  let z = fromZ;
  let anchorX = x;
  let anchorZ = z;
  let windowSec = 0;
  let contact: { x: number; z: number } | null = null;
  let k = 0; // the next via corner not yet passed
  let legX = fromX; // where the leg toward it began (viaPassed)
  let legZ = fromZ;
  for (let i = 0; i < maxSteps; i++) {
    if (Math.hypot(toX - x, toZ - z) < ARRIVE_DIST) return { x, z, arrived: true, contact };
    while (k < via.length && viaPassed(x, z, via[k], legX, legZ)) {
      legX = via[k].x;
      legZ = via[k].z;
      k++;
    }
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
    const next = resolveCollision(x, z, sx, sz, r, local(x, z));
    const nx = Math.min(Math.max(next.x, bounds.minX + r), bounds.maxX - r);
    const nz = Math.min(Math.max(next.z, bounds.minZ + r), bounds.maxZ - r);
    if (!contact && Math.hypot(nx - (x + sx), nz - (z + sz)) > CONTACT_EPS) contact = { x: nx, z: nz };
    x = nx;
    z = nz;
  }
  return { x, z, arrived: false, contact };
}

/** The cell (m) of simulateWalk's box lookup, and how many boxes make one worth building. */
const SIM_BUCKET = 4;
const SIM_BUCKET_MIN = 16;

/**
 * The boxes a step from (x, z) can meet, looked up by where it starts: each of `boxes` filed under the cells of the
 * rectangle that its box grown by `reach` (the radius plus a step) overlaps. resolveCollision only ever stops a step at
 * a box whose grown face the step crosses — a box whose grown box holds the step's start — and it takes the nearest such
 * face whatever their order, so the cell's list answers exactly as the whole list does. A long walk across the village
 * (5,000 steps past 100 boxes) took 10 ms with the whole list each step.
 */
function nearbyBoxes(
  boxes: readonly AABB[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  reach: number,
): (x: number, z: number) => readonly AABB[] {
  if (boxes.length < SIM_BUCKET_MIN) return () => boxes;
  const nx = Math.max(1, Math.ceil((maxX - minX) / SIM_BUCKET));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / SIM_BUCKET));
  const cells: AABB[][] = Array.from({ length: nx * nz }, () => []);
  const col = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / SIM_BUCKET)));
  const row = (z: number) => Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / SIM_BUCKET)));
  for (const b of boxes) {
    for (let j = row(b.minZ - reach); j <= row(b.maxZ + reach); j++) {
      for (let i = col(b.minX - reach); i <= col(b.maxX + reach); i++) cells[j * nx + i].push(b);
    }
  }
  return (x, z) => cells[row(z) * nx + col(x)];
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

/**
 * ...or up to this many times, plus DETOUR_FAR_SLACK, and up to DETOUR_FAR_MARGIN (m) either side of the straight line,
 * when the click would otherwise do nothing at all: the walk toward it cannot get going (already against what is in the
 * way — the far creek bank tapped from the water's edge, its bridge 25 m off to the side).
 */
export const DETOUR_FAR_RATIO = 4;
export const DETOUR_FAR_SLACK = 10;
export const DETOUR_FAR_MARGIN = 40;

/** The search grid's cell (m); grown when the region would hold more than DETOUR_MAX_CELLS (a cross-map click). */
const DETOUR_CELL = 0.5;
const DETOUR_MAX_CELLS = 40000;

/** Cells this close (m) past the clearance kept cost DETOUR_NEAR_COST times more: the way keeps off the faces. */
const DETOUR_CLEAR = 0.2;
const DETOUR_NEAR_COST = 2;

/**
 * How far (m) a way round keeps past the grown faces of what it goes round — its corners and its legs between them —
 * where there is room (a narrow gap gets less: DETOUR_CLEAR_TIERS). More than VIA_REACH, how early the walk turns for
 * the next corner: the turned leg then runs at most that much nearer than the way itself, never into a face (round 5
 * review: the corners lay 0.02-0.04 m off the grown faces and the walk turned 0.2 m before them, into a bench's or the
 * bridge's corner, where it stuck — a ring on the click, an avatar stopped short of it).
 */
export const DETOUR_VIA_CLEAR = 0.25;

/** The clearances tried in turn: the full one, a narrower one for a narrow gap, none (the grown faces themselves). */
const DETOUR_CLEAR_TIERS: readonly number[] = [DETOUR_VIA_CLEAR, 0];

/**
 * How far past a corner (m) a walk may get before it turns for the next one: one step of a run (RUN_SPEED 6.4 m/s) in a
 * 30 fps frame. The way checks its legs from there too (and from VIA_REACH before the corner).
 */
const VIA_LATE = 0.22;

/** How far (cells) round its two ends the search starts and ends: a body at a bench's face sees open cells a step off. */
const DETOUR_END_CELLS = 3;

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
 * A slow computation in slices: each `next()` runs a part of it and the last one returns its answer. A plan's way round
 * is one (finishClickPlanSteps): CameraRig spreads it over a few moments after the click, so neither the click's event
 * nor a frame waits for a long grid search (round 5 review: 15 ms in the pointerup handler, 40-60 ms on a slower CPU).
 */
export type Steps<T> = Generator<void, T, unknown>;

/** Runs `steps` to its end at once and returns the answer. */
export function runSteps<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** How many cells a way round's grid search takes between two slices (Steps): a few ms on a phone. */
const DETOUR_SLICE_CELLS = 1024;

/** How long a way round may be, and how far either side of the straight line it is looked for. */
export interface DetourLimits {
  /** At most this many times the straight distance (default DETOUR_MAX_RATIO)... */
  ratio?: number;
  /** ...plus this (m, default DETOUR_SLACK). */
  slack?: number;
  /** The search region: the two ends' rectangle grown by this (m, default DETOUR_MARGIN). */
  margin?: number;
}

/**
 * A way for a body from (fromX, fromZ) to (toX, toZ) round the colliders (rule 3), as the corners to walk by in order
 * (the ends left out), or null when there is none within DETOUR_MARGIN of the straight line and DETOUR_MAX_RATIO of its
 * length (or the `limits` given). Looked for with the full clearance first (DETOUR_VIA_CLEAR past every grown face),
 * then with none for a narrow gap (detourWithClearance).
 */
export function findDetour(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  r = PLAYER_RADIUS,
  limits: DetourLimits = {},
): GroundPoint[] | null {
  return runSteps(findDetourSteps(fromX, fromZ, toX, toZ, obstacles, bounds, r, limits));
}

/** findDetour in slices (Steps). */
export function* findDetourSteps(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  r = PLAYER_RADIUS,
  limits: DetourLimits = {},
): Steps<GroundPoint[] | null> {
  for (const clear of DETOUR_CLEAR_TIERS) {
    const via = yield* detourSteps(fromX, fromZ, toX, toZ, obstacles, bounds, r, clear, limits);
    if (via) return via;
  }
  return null;
}

/**
 * findDetour keeping `clear` (m) past the colliders grown by the radius. A grid search (A*, eight neighbours, no corner
 * cutting) over the region round the two ends — a cell is shut when its centre lies inside a collider grown by the
 * radius plus `clear`, dearer within DETOUR_CLEAR past that — then pulled tight: from each corner the farthest cell of
 * the way the body walks to with no slide, keeping `clear` (the radius alone on the legs from the start and to the
 * destination, which may stand closer), checked from the corner itself and from where the walk really turns there
 * (VIA_REACH before it, VIA_LATE past it: clickMove.ts viaPassed). Both ends must be free spots (the start is where the
 * body stands).
 */
export function detourWithClearance(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  r = PLAYER_RADIUS,
  clear = DETOUR_VIA_CLEAR,
  limits: DetourLimits = {},
): GroundPoint[] | null {
  return runSteps(detourSteps(fromX, fromZ, toX, toZ, obstacles, bounds, r, clear, limits));
}

/** detourWithClearance in slices (Steps): it pauses every DETOUR_SLICE_CELLS cells of its grid search. */
function* detourSteps(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacles: readonly AABB[],
  bounds: Bounds,
  r: number,
  clear: number,
  limits: DetourLimits,
): Steps<GroundPoint[] | null> {
  const margin = limits.margin ?? DETOUR_MARGIN;
  const straight = Math.hypot(toX - fromX, toZ - fromZ);
  const maxLen = straight * (limits.ratio ?? DETOUR_MAX_RATIO) + (limits.slack ?? DETOUR_SLACK);
  const rc = r + clear;
  const x0 = Math.max(Math.min(fromX, toX) - margin, bounds.minX + r);
  const x1 = Math.min(Math.max(fromX, toX) + margin, bounds.maxX - r);
  const z0 = Math.max(Math.min(fromZ, toZ) - margin, bounds.minZ + r);
  const z1 = Math.min(Math.max(fromZ, toZ) + margin, bounds.maxZ - r);
  if (!(x1 > x0 && z1 > z0)) return null;
  const cell = Math.max(DETOUR_CELL, Math.sqrt(((x1 - x0) * (z1 - z0)) / DETOUR_MAX_CELLS));
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const boxes = obstacles.filter((b) => b.maxX + rc > x0 && b.minX - rc < x1 && b.maxZ + rc > z0 && b.minZ - rc < z1);
  const centreX = (i: number) => x0 + (i + 0.5) * cell;
  const centreZ = (j: number) => z0 + (j + 0.5) * cell;
  // 0 open, 1 near a face (dearer), 2 shut — and the area's own edge kept at the clearance too
  const grid = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const cz = centreZ(j);
    for (let i = 0; i < nx; i++) {
      const cx = centreX(i);
      if (cx < bounds.minX + rc || cx > bounds.maxX - rc || cz < bounds.minZ + rc || cz > bounds.maxZ - rc) grid[j * nx + i] = 2;
    }
  }
  for (const b of boxes) {
    for (const [grow, mark] of [
      [rc + DETOUR_CLEAR, 1],
      [rc, 2],
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
  // The two ends are free spots, but their cells' centres may lie inside the clearance (a body standing at a bench's
  // face): the search starts from the open cells round the start that the body walks to straight from it, and ends at
  // the first cell round the destination it walks straight from to there (round 4: a goal cell inside the bench,
  // entered on a diagonal, cut the bench's corner).
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
  const reach = DETOUR_END_CELLS;
  for (let j = Math.max(0, sj - reach); j <= Math.min(nz - 1, sj + reach); j++) {
    for (let i = Math.max(0, si - reach); i <= Math.min(nx - 1, si + reach); i++) {
      const c = j * nx + i;
      if (grid[c] === 2 || !segmentClear(fromX, fromZ, centreX(i), centreZ(j), boxes, r)) continue;
      g[c] = Math.hypot(centreX(i) - fromX, centreZ(j) - fromZ);
      open.push(c, g[c] + h(c));
    }
  }
  // The search ends at a cell round the destination the body walks on to it from — turning there for it as the walk
  // does (turnsClear, from the direction it came in); the first cell it merely sees it from is kept in case none does.
  let last = -1;
  let seesGoal = -1;
  let taken = 0;
  while (open.size > 0) {
    if (open.minKey > maxLen * DETOUR_NEAR_COST) break; // every way left is longer than any taken
    const c = open.pop();
    if (closed[c]) continue;
    if (++taken % DETOUR_SLICE_CELLS === 0) yield;
    const ci = c % nx;
    const cj = Math.floor(c / nx);
    if (Math.abs(ci - gi) <= reach && Math.abs(cj - gj) <= reach && segmentClear(centreX(ci), centreZ(cj), toX, toZ, boxes, r)) {
      if (seesGoal === -1) seesGoal = c;
      const p = from[c];
      const px = p === -1 ? fromX : centreX(p % nx);
      const pz = p === -1 ? fromZ : centreZ(Math.floor(p / nx));
      const len = Math.hypot(centreX(ci) - px, centreZ(cj) - pz);
      if (len < 1e-9 || turnsClear(centreX(ci), centreZ(cj), (centreX(ci) - px) / len, (centreZ(cj) - pz) / len, toX, toZ, boxes, r)) {
        last = c;
        break;
      }
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
  if (last === -1) last = seesGoal;
  if (last === -1) return null;
  // The way's points: the start itself, the centres of its cells, the destination itself. Two neighbouring open cells'
  // centres see each other with the clearance while a cell is no wider than a body (a box grown that far is wider than
  // a cell, so one between them would cover a centre; the diagonals skip shut corners).
  const cells: number[] = [];
  for (let c = last; c !== -1; c = from[c]) cells.push(c);
  cells.reverse();
  const pts: GroundPoint[] = [{ x: fromX, z: fromZ }, ...cells.map((c) => ({ x: centreX(c % nx), z: centreZ(Math.floor(c / nx)) })), { x: toX, z: toZ }];
  const end = pts.length - 1;
  // Pulled tight: from each corner, the farthest point of the way walked to with no slide — keeping the clearance
  // between corners (the radius alone from the start and to the destination), and seen from where the walk really
  // turns there too (turnsClear) — or, where no point is seen so, the farthest one seen from the corner itself.
  let inX = 0; // the unit direction the walk comes into the corner `at` along (none at the start)
  let inZ = 0;
  const sees = (a: number, k: number): boolean =>
    segmentClear(pts[a].x, pts[a].z, pts[k].x, pts[k].z, boxes, a === 0 || k === end ? r : rc);
  const via: GroundPoint[] = [];
  let at = 0;
  let length = 0;
  while (at < end) {
    let next = -1;
    let plain = -1;
    for (let k = at + 1; k <= end; k++) {
      if (sees(at, k)) {
        plain = k;
        if (at === 0 || turnsClear(pts[at].x, pts[at].z, inX, inZ, pts[k].x, pts[k].z, boxes, r)) next = k;
      } else if (plain !== -1 && k - plain > 6) break; // well past the last clear one: the view is shut
    }
    if (next === -1) next = plain;
    if (next === -1) return null; // not even the next point: the grid passed where a body does not
    const leg = Math.hypot(pts[next].x - pts[at].x, pts[next].z - pts[at].z);
    length += leg;
    if (leg > 1e-9) {
      inX = (pts[next].x - pts[at].x) / leg;
      inZ = (pts[next].z - pts[at].z) / leg;
    }
    if (next < end) via.push(pts[next]);
    at = next;
  }
  return length <= maxLen ? via : null;
}

/**
 * Whether a walk that comes into the corner (ax, az) along the unit direction (inX, inZ) and turns there for (kx, kz)
 * goes on to it with no slide (radius `r`) from wherever it really turns: VIA_REACH before the corner (clickMove.ts
 * viaPassed: it turns that early) and VIA_LATE past it (a long step carries it on before it turns).
 */
function turnsClear(ax: number, az: number, inX: number, inZ: number, kx: number, kz: number, boxes: readonly AABB[], r: number): boolean {
  return (
    segmentClear(ax - inX * VIA_REACH, az - inZ * VIA_REACH, kx, kz, boxes, r) &&
    segmentClear(ax + inX * VIA_LATE, az + inZ * VIA_LATE, kx, kz, boxes, r)
  );
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

/** What a plan knows of the map beyond its colliders and its area. */
export interface PlanOptions {
  /**
   * Furniture whose real shape covers less ground than its collider box (the plaza benches, turned to face the
   * fountain — activeMap.ts): visible ground inside one of these boxes moves out up to FURNITURE_MAX_PUSH, not MAX_PUSH.
   */
  furniture?: readonly AABB[];
}

/**
 * A click whose walk does not get there straight: the way round is still to be looked for (finishClickPlan) — the slow
 * part of a plan (a grid search), which the click's handler leaves for a moment later (CameraRig; round 5 review: a
 * click across the fountain took 15 ms in the pointerup handler). Everything here was settled by startClickPlan.
 */
export interface PendingDetour {
  fromX: number;
  fromZ: number;
  /**
   * Where the ring may go, nearest the click first: the spot clicked, or the free spots out of the colliders' margins
   * round it (freeSpotsNear). The first the avatar walks to — straight or round — is taken. Never empty.
   */
  spots: ReadonlyArray<{ x: number; z: number }>;
  /** The clicked surface: its height (the ring's), and where it is (a spot anywhere else was moved: "pushed"). */
  surface: SurfacePoint;
  seated: boolean;
  /** The straight walk toward the first spot: where it meets the obstacle is the fallback (rule 3's "stopped"). */
  walk: WalkResult;
  obstacles: readonly AABB[];
  bounds: Bounds;
}

/** startClickPlan's answer: the plan itself, or a way round to look for first. */
export type PlanStart = { plan: ClickPlan; detour?: undefined } | { plan?: undefined; detour: PendingDetour };

/** How many of the free spots round a click a plan tries (freeSpotsNear), nearest first. */
const PLAN_SPOTS = 4;

/** Whether (x, z) lies inside one of `boxes` grown by `r`. */
function insideGrown(x: number, z: number, boxes: readonly AABB[], r = PLAYER_RADIUS): boolean {
  for (const b of boxes) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
  return false;
}

/**
 * Rules 1-3 for a click on `surface` (null: nothing — the sky) by a player whose walk starts at (fromX, fromZ)
 * (walkStart). A moved destination keeps the clicked surface's height; the caller may look the ground up there
 * instead (clickPick.ts surfaceHeightAt). `seated`: the ground at the start itself is still a walk (get up, stand
 * there), where standing it means "stop here". The same as startClickPlan then finishClickPlan.
 */
export function planClickMove(
  fromX: number,
  fromZ: number,
  surface: SurfacePoint | null,
  obstacles: readonly AABB[],
  bounds: Bounds,
  seated = false,
  options: PlanOptions = {},
): ClickPlan {
  const start = startClickPlan(fromX, fromZ, surface, obstacles, bounds, seated, options);
  return start.plan ?? finishClickPlan(start.detour);
}

/**
 * planClickMove up to the way round: everything but the grid search — the surface, the spot to stand on, the straight
 * walk there (most clicks end here), or toward the click up to what is in the way when there is nowhere to stand.
 */
export function startClickPlan(
  fromX: number,
  fromZ: number,
  surface: SurfacePoint | null,
  obstacles: readonly AABB[],
  bounds: Bounds,
  seated = false,
  options: PlanOptions = {},
): PlanStart {
  const kind = surface ? surfaceKind(surface, obstacles, bounds) : "none";
  if (!surface || kind === "none") return { plan: { ok: false, reason: "not-ground" } };
  // Low ground may be pushed out of a collider's margin — farther out of a piece of furniture's box; an open surface is
  // already a free spot, taken as it is.
  let spots = kind === "ground" ? freeSpotsNear(surface.x, surface.z, obstacles, bounds) : [{ x: surface.x, z: surface.z }];
  if (spots.length === 0 && options.furniture && insideGrown(surface.x, surface.z, options.furniture)) {
    spots = freeSpotsNear(surface.x, surface.z, obstacles, bounds, FURNITURE_MAX_PUSH);
  }
  if (spots.length === 0) {
    // Nowhere to stand there (deep in a collider, past the area's edge): toward it, up to what is in the way (rule 2).
    const toward = simulateWalk(fromX, fromZ, surface.x, surface.z, obstacles, bounds);
    return { plan: stoppedOnTheWay(fromX, fromZ, toward, surface.y, obstacles, bounds) };
  }
  spots = spots.slice(0, PLAN_SPOTS);
  const first = straightTo(fromX, fromZ, spots[0], surface, seated, obstacles, bounds);
  if (first.plan) return { plan: first.plan };
  // Not straight there: a way round, walked to the end (rule 3) — looked for by finishClickPlan.
  return { detour: { fromX, fromZ, spots, surface, seated, walk: first.walk, obstacles, bounds } };
}

/**
 * The rest of a plan startClickPlan left open: the nearest of its spots the avatar walks to (round what is in the way,
 * or — past the first — straight), else where the walk stops on the way.
 */
export function finishClickPlan(d: PendingDetour): ClickPlan {
  return runSteps(finishClickPlanSteps(d));
}

/** finishClickPlan in slices (Steps): CameraRig runs it a few ms at a time after the click. */
export function* finishClickPlanSteps(d: PendingDetour): Steps<ClickPlan> {
  const { fromX, fromZ, surface, obstacles, bounds } = d;
  for (let i = 0; i < d.spots.length; i++) {
    const spot = d.spots[i];
    if (i > 0) {
      const straight = straightTo(fromX, fromZ, spot, surface, d.seated, obstacles, bounds);
      if (straight.plan) return straight.plan;
      yield;
    }
    const round = yield* roundToSteps(fromX, fromZ, spot, surface, obstacles, bounds);
    if (round) return round;
  }
  const stopped = stoppedOnTheWay(fromX, fromZ, d.walk, surface.y, obstacles, bounds);
  if (stopped.ok) return stopped;
  // Already against what is in the way, and no way round within DETOUR_MAX_RATIO: rather than nothing at all for a
  // click on ground in plain view (the far creek bank tapped from the water's edge), a longer way round.
  const far = { ratio: DETOUR_FAR_RATIO, slack: DETOUR_FAR_SLACK, margin: DETOUR_FAR_MARGIN };
  return (yield* roundToSteps(fromX, fromZ, d.spots[0], surface, obstacles, bounds, far)) ?? stopped;
}

/** The plan to `spot` when the avatar walks straight there (or already stands on it), else that straight walk. */
function straightTo(
  fromX: number,
  fromZ: number,
  spot: { x: number; z: number },
  surface: SurfacePoint,
  seated: boolean,
  obstacles: readonly AABB[],
  bounds: Bounds,
): { plan: ClickPlan; walk?: undefined } | { plan?: undefined; walk: WalkResult } {
  const adjusted = spot.x !== surface.x || spot.z !== surface.z ? "pushed" : "none";
  if (Math.hypot(spot.x - fromX, spot.z - fromZ) < ARRIVE_DIST) {
    return { plan: seated ? { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted } : { ok: false, reason: "here" } };
  }
  const walk = simulateWalk(fromX, fromZ, spot.x, spot.z, obstacles, bounds);
  if (walk.arrived) return { plan: { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted } };
  return { walk };
}

/** The plan to `spot` round what is in the way (findDetour), when that way is walked to the end; else null. In slices. */
function* roundToSteps(
  fromX: number,
  fromZ: number,
  spot: { x: number; z: number },
  surface: SurfacePoint,
  obstacles: readonly AABB[],
  bounds: Bounds,
  limits: DetourLimits = {},
): Steps<ClickPlan | null> {
  const via = yield* findDetourSteps(fromX, fromZ, spot.x, spot.z, obstacles, bounds, PLAYER_RADIUS, limits);
  if (!via) return null;
  yield;
  if (!simulateWalk(fromX, fromZ, spot.x, spot.z, obstacles, bounds, PLAYER_RADIUS, via).arrived) return null;
  const adjusted = spot.x !== surface.x || spot.z !== surface.z ? "pushed" : "none";
  return { ok: true, x: spot.x, z: spot.z, y: surface.y, adjusted, via };
}

/**
 * Stopped on the way: the ring goes where the straight walk toward the click meets the obstacle (rule 3) — when that is
 * a real trip and the walk to it arrives.
 */
function stoppedOnTheWay(fromX: number, fromZ: number, walk: WalkResult, y: number, obstacles: readonly AABB[], bounds: Bounds): ClickPlan {
  const stop = walk.contact ?? walk;
  if (Math.hypot(stop.x - fromX, stop.z - fromZ) < MIN_TRIP) return { ok: false, reason: "unreachable" };
  const again = simulateWalk(fromX, fromZ, stop.x, stop.z, obstacles, bounds);
  if (!again.arrived) return { ok: false, reason: "unreachable" };
  return { ok: true, x: stop.x, z: stop.z, y, adjusted: "stopped" };
}

/** How a ring at a plan's spot would look from the camera (clickPick.ts ringView). */
export interface RingView {
  /** Its centre projects inside the screen (in front of the camera). */
  onScreen: boolean;
  /**
   * The share of its on-screen area that reaches the screen past what stands in front (0..1; bodies do not count) —
   * measured only as far as a `need` asked of ringView. Not a condition any more (rule 4): what covers the ring, the
   * ring is drawn through.
   */
  seen: number;
}

/** Rule 4: `plan` when its ring would be on the screen, else "unseen". */
export function requireSeen(plan: ClickPlan, view: RingView): ClickPlan {
  if (!plan.ok) return plan;
  return view.onScreen ? plan : { ok: false, reason: "unseen" };
}
