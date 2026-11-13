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
}

/**
 * Whether a player at `(x, z)` may be offered `seat` from where they stand: always for a seat without a
 * `frontEdge`, and for a seat with one (a bench) only in front of that edge (the side the sitter faces).
 */
export function approachesSeat(seat: Seat, x: number, z: number): boolean {
  if (seat.frontEdge === undefined) return true;
  const ahead = (x - seat.x) * Math.sin(seat.yaw) + (z - seat.z) * Math.cos(seat.yaw);
  return ahead >= -seat.frontEdge;
}

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
    if (isOccupied(i)) continue;
    const s = seats[i];
    if (!approachesSeat(s, x, z)) continue;
    const d = Math.hypot(x - s.x, z - s.z);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}
