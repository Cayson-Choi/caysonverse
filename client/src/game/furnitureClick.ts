/**
 * A click or a tap on a piece of furniture (round 8 review, 2026-11-15).
 *
 * The walk takes floor only (clickPlan.ts rule 1): a click on a sofa's cushion, an armchair, a letter chair, a bench — or on
 * the floor behind one, hidden by it on screen — met the furniture's face and was "not-ground": nothing happened, no walk and no
 * "앉기". A first-time visitor taps the seat to sit. So here, for a click that is not ground:
 *   - on a seat (within `SEAT_PICK` of its spot, no higher than `FURNITURE_TOP`): the walk goes to that seat's approach — its
 *     dismount spot, which is in front of a sofa or an armchair, beside a chair at a table, and for a backless bench on the side
 *     nearer the player (its two facings are two seats of one group) — and the seat is named so the walk can sit on arrival;
 *   - on other furniture (a table, a cabinet, a sofa's end): the floor right under the click, which the plan then moves out to the
 *     nearest spot the body can stand (FURNITURE_MAX_PUSH, as for a bench's box).
 * Pure: no three.js; CameraRig looks the floor's height up.
 */

import { approachesSeat, seatDistance, SEAT_REACH, type Seat } from "@caysonverse/shared/worldMap";
import type { SurfacePoint } from "./clickPlan";

/** A click this near (m, across the floor) a seat's cushion is a click on that seat. */
export const SEAT_PICK = 0.55;
/** A seat's cushion centre lies this far (m) behind its front edge (`Seat.frontEdge` back from the seat spot). */
const CUSHION_IN = 0.2;
/** Furniture is no higher than this (m): a click higher up (a wall, a shelf, the louvres) is still nothing. */
export const FURNITURE_TOP = 1.3;

/** What a furniture click becomes: the floor point to walk to, and the seat to sit on there (or null). */
export interface FurnitureClick {
  surface: SurfacePoint;
  seatIndex: number | null;
}

/**
 * For a click on `pick` that is no ground (the caller checked): the seat it is on, or the floor under it. `seats` is the active
 * map's whole list (an index is the server's); `area` the player's area (only its seats count); `taken(i)` a seat someone sits on
 * (then the click is just furniture); `from` where the walk starts; `floorY` the floor's height.
 */
export function furnitureClick(
  pick: { x: number; y: number; z: number } | null,
  seats: readonly Seat[],
  area: string | undefined,
  taken: (index: number) => boolean,
  from: { x: number; z: number },
  floorY: number,
  /** Whether a click on furniture that is no seat walks next to it (the hall); otherwise it stays nothing. */
  otherFurniture: boolean,
): FurnitureClick | null {
  if (!pick || pick.y > FURNITURE_TOP) return null;
  const areaOf = (s: Seat) => (s as { area?: string }).area;
  const offered = (i: number): boolean => {
    const s = seats[i]!;
    if (area !== undefined && areaOf(s) !== undefined && areaOf(s) !== area) return false;
    if (taken(i)) return false;
    // its approach must offer it (a chair's side spot, a sofa's front) — never a spot behind a backrest
    return approachesSeat(s, s.standX, s.standZ) && seatDistance(s, s.standX, s.standZ) <= SEAT_REACH;
  };
  // the seat whose cushion is nearest the click (a click on the cushion or the backrest is near it; a chair's seat spot itself lies
  // under the table, its cushion behind it)
  let best = -1;
  let bestD = SEAT_PICK;
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i]!;
    const back = (s.frontEdge ?? 0) + CUSHION_IN;
    const d = Math.hypot(pick.x - (s.x - Math.sin(s.yaw) * back), pick.z - (s.z - Math.cos(s.yaw) * back));
    if (d <= bestD && offered(i)) {
      best = i;
      bestD = d;
    }
  }
  // of the facings of one backless seat (one group), the one whose approach is nearer the player: sat from either side
  if (best >= 0 && seats[best]!.group !== undefined) {
    const g = seats[best]!.group;
    let bestFrom = Infinity;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i]!;
      if (s.group !== g || !offered(i)) continue;
      const fromD = Math.hypot(s.standX - from.x, s.standZ - from.z);
      if (fromD < bestFrom) {
        bestFrom = fromD;
        best = i;
      }
    }
  }
  if (best >= 0) {
    const s = seats[best]!;
    return { surface: { x: s.standX, y: floorY, z: s.standZ, ny: 1 }, seatIndex: best };
  }
  if (!otherFurniture) return null;
  return { surface: { x: pick.x, y: floorY, z: pick.z, ny: 1 }, seatIndex: null };
}
