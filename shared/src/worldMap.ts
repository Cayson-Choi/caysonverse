/**
 * Shared map basics used by 케이슨 마을: the player's collision radius, the wall height the camera's spring arm
 * treats as "a wall", and the seat model (`Seat`, the reach and the pure nearest-free-seat pick) that the village's
 * benches (shared/src/village/benchSeats.ts) are built on. (The file keeps its old name: it once held the whole
 * legacy world — its rooms, maze and furniture are gone.)
 *
 * Browser-safe: imports only types — no THREE, no @colyseus/schema, no clocks.
 */

import type { AABB } from "./collision";

export type { AABB };

/** Player collision radius (m) — the circle both sides resolve against. */
export const PLAYER_RADIUS = 0.4;

/** Height (m) of a wall for the third-person camera's spring arm: a camera segment above it passes over. */
export const WALL_HEIGHT = 4;

// ───────────────────────────────── Seats ─────────────────────────────────

/**
 * Max distance (m) from the player to a seat centre at which sitting is allowed.
 * The client only shows the sit prompt within this radius; the server re-checks
 * it (a farther Sit message is a tampered client → silent drop). Single source.
 */
export const SEAT_REACH = 1.5;

/** A sittable seat: its centre, seated facing, and its clear dismount point. */
export interface Seat {
  /** Seat-centre X. */
  x: number;
  /** Seat-centre Z. */
  z: number;
  /** Seated player-yaw (the player convention `atan2(dirX, dirZ)`: the model faces +Z at yaw 0). */
  yaw: number;
  /** Dismount X: where a player standing up steps to. */
  standX: number;
  /** Dismount Z. */
  standZ: number;
  /**
   * Height (m) of the seat surface, for a seat whose sitter rests ON it (케이슨 마을's benches): the client lifts the
   * avatar so the sit pose meets it (`liftForSeatY`, sitPose.ts) and getting up steps from the seat to the dismount
   * point.
   */
  seatY?: number;
  /**
   * Distance (m) from the seat point back to the seat's front edge, along the facing. A seat that has it is sat on
   * from the FRONT only: the sit prompt is offered to a player standing in front of that edge, never behind a bench's
   * backrest. Absent: any side within reach.
   */
  frontEdge?: number;
  /**
   * Seats of one group are never taken at the same time (the two facings of one backless bench seat, which can be sat on from
   * either side). Absent: the seat is its own group.
   */
  group?: string;
  /**
   * A chair at a table (a dining or consultation chair): its front is the table, so it is also sat on from its LEFT and RIGHT —
   * anywhere up to its backrest's plane, `sidePlane` m behind the root — but never from behind the backrest (owner rule
   * 2026-11-13: a backed seat is never sat through its back). Absent: the front-edge rule (`frontEdge`) alone.
   */
  sidePlane?: number;
  /**
   * Half the width (m) of a chair with a `sidePlane`: a visitor standing clear of it to the side (further out than this plus
   * `CHAIR_SIDE_CLEAR`) is beside the chair, not behind its backrest, and may be up to `CHAIR_SIDE_BEHIND` behind the backrest's
   * plane (review 2026-11-15: the gap between the two consultation chairs is that far back, and a tap-walk stops short of the
   * plane, so neither chair could be sat on from there).
   */
  sideHalf?: number;
  /**
   * How far (m) beyond its side a visitor behind a chair's backrest plane may stand and still be offered it (`CHAIR_SIDE_FAR` when
   * absent): next to a neighbouring chair this is held to half the way to it, so from behind that neighbour's backrest this chair
   * is never offered (round 8 review: diagonally behind letter_s0 the "앉기" sat the visitor on letter_s1).
   */
  sideFar?: number;
  /**
   * How far (m) ahead of its seat point a visitor may stand and be offered a chair at a table (`sidePlane` chairs): the table is
   * in front, so farther ahead is across the table, in front of the chair opposite (round 8 review: standing behind letter_n1 the
   * "앉기" sat the visitor on letter_s1 across the table). Absent: no limit.
   */
  aheadMax?: number;
  /**
   * A chair at a desk or a table: its seat point sits deep under the desk, so it is reached this much (m) farther than
   * `SEAT_REACH` from it (`seatDistance`; round 5, 2026-11-15: from beside the second consult chair, a step short of its spot, the
   * seat point was 1.56 m away and the desk's "문의하기" came up instead). Absent: 0.
   */
  reachBonus?: number;
  /** How far (rad) a sitter leans back into a backrest (a sofa, an armchair, a chair); absent or 0: sits upright. */
  lean?: number;
}

const GROUP_MATES = new WeakMap<readonly Seat[], readonly (readonly number[])[]>();

/** For each seat, the indices of the OTHER seats of its group (computed once per list). */
function groupMates(seats: readonly Seat[]): readonly (readonly number[])[] {
  let mates = GROUP_MATES.get(seats);
  if (mates) return mates;
  const byGroup = new Map<string, number[]>();
  seats.forEach((s, i) => {
    if (s.group === undefined) return;
    const list = byGroup.get(s.group);
    if (list) list.push(i);
    else byGroup.set(s.group, [i]);
  });
  mates = seats.map((s, i) => (s.group === undefined ? [] : (byGroup.get(s.group) ?? []).filter((j) => j !== i)));
  GROUP_MATES.set(seats, mates);
  return mates;
}

/** Whether seat `index` is taken: by someone, or by someone on another seat of its group. */
export function seatTaken(seats: readonly Seat[], index: number, isOccupied: (index: number) => boolean): boolean {
  if (isOccupied(index)) return true;
  for (const j of groupMates(seats)[index] ?? []) if (isOccupied(j)) return true;
  return false;
}

/**
 * Whether a player at `(x, z)` may be offered `seat` from where they stand: always for a seat without a
 * `frontEdge`, and for a seat with one (a bench) only in front of that edge (the side the sitter faces).
 */
export function approachesSeat(seat: Seat, x: number, z: number, slack = 0): boolean {
  if (seat.frontEdge === undefined) return true;
  const sin = Math.sin(seat.yaw);
  const cos = Math.cos(seat.yaw);
  const ahead = (x - seat.x) * sin + (z - seat.z) * cos;
  if (seat.sidePlane !== undefined) {
    if (seat.aheadMax !== undefined && ahead > seat.aheadMax + slack) return false;
    if (ahead >= -seat.sidePlane - slack) return true;
    // a little behind the backrest's plane, but off to the side of the chair (not behind the backrest itself)
    if (seat.sideHalf === undefined) return false;
    const lateral = Math.abs((x - seat.x) * cos - (z - seat.z) * sin);
    return (
      lateral >= seat.sideHalf + CHAIR_SIDE_CLEAR &&
      lateral <= seat.sideHalf + (seat.sideFar ?? CHAIR_SIDE_FAR) &&
      ahead >= -seat.sidePlane - CHAIR_SIDE_BEHIND - slack
    );
  }
  return ahead >= -seat.frontEdge - slack;
}

/** How far (m) beyond a chair's side a visitor must stand to count as beside it rather than behind it (`Seat.sideHalf`). */
export const CHAIR_SIDE_CLEAR = 0.2;
/** How far (m) behind a chair's backrest plane a visitor beside the chair is still offered it (`Seat.sideHalf`). */
export const CHAIR_SIDE_BEHIND = 0.8;
/**
 * How far (m) beyond a chair's side a visitor behind its backrest's plane may still stand to be offered it: next to that chair,
 * not behind the chair beside it (round 5: from behind the second consult chair the first one, 1.7 m off, was offered).
 */
export const CHAIR_SIDE_FAR = 0.9;

/** A player's distance from `seat` for the reach and the nearest-seat pick: from its seat point, less its `reachBonus`. */
export function seatDistance(seat: Seat, x: number, z: number): number {
  return Math.hypot(x - seat.x, z - seat.z) - (seat.reachBonus ?? 0);
}

/**
 * How much (m) the server forgives the front-edge line: the client's pose runs a few cm ahead of the one the server knows, and a
 * sofa or armchair's front edge is only about 0.1 m from its root, so a visitor the client offered the seat to (standing right at
 * the edge) could be a hair behind it on the server. From behind a backrest the visitor is more than a metre behind: still refused.
 */
export const SEAT_APPROACH_SLACK = 0.15;

/**
 * Pure client proximity pick: the index of the nearest FREE seat within `reach`
 * of `(x, z)`, or null. `isOccupied(i)` reports seats taken by ANY player
 * (self + remotes, read from the schema-synced `seatIndex`). No allocation, so
 * the throttled prompt loop can call it directly. `seats` is the seat list of the
 * map the player stands in; a bench is offered only from its front (`approachesSeat`).
 */
export function nearestFreeSeat(
  x: number,
  z: number,
  isOccupied: (index: number) => boolean,
  reach: number,
  seats: readonly Seat[],
): number | null {
  let best = -1;
  let bestDist = reach;
  for (let i = 0; i < seats.length; i++) {
    if (seatTaken(seats, i, isOccupied)) continue;
    const s = seats[i];
    if (!approachesSeat(s, x, z)) continue;
    const d = seatDistance(s, x, z);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}
