import { SEAT_APPROACH_SLACK, SEAT_REACH, approachesSeat, seatDistance, seatTaken, type Seat } from "@caysonverse/shared/worldMap";
import { standsClear } from "@caysonverse/shared/village/benchSeats";
import { BODY_APART, pickStandSpot } from "@caysonverse/shared/village/standSpot";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { villageWalkArea } from "@caysonverse/shared/village/fallsWalk";
import { houseFloorBounds, parseHouseFloorArea } from "@caysonverse/shared/village/houseAreas";
import { PARK_BOUNDS, parkGeometry } from "@caysonverse/shared/village/parkArea";

/**
 * Pure, clock-free sit validation (mirrors movement.ts / emoji.ts discipline).
 *
 * Given the player's authoritative position + current seat, a raw client
 * payload, the live seat→sessionId occupancy, and the caller's session id,
 * decide the outcome — WITHOUT reading any clock or mutating state (the room
 * owns timing and applies the result).
 *
 * Three outcomes (binding policy):
 *   - `null`         → SILENT drop. Malformed/cheat-shaped or physically
 *                      impossible for an honest client: bad payload, an already
 *                      seated sender (the UI never offers it), or a seat beyond
 *                      SEAT_REACH (the prompt only shows in range → a farther
 *                      request is a tampered client), or one from behind a bench's
 *                      back rest (the prompt is only offered in front of it).
 *   - `{ reason }`   → REJECT with a personal Korean notice. The ONE non-silent
 *                      case: a first-come race where the seat was taken by
 *                      someone else between prompt and click.
 *   - `{ seatIndex }`→ ACCEPT. The room snaps the player onto the seat.
 *
 * `seats` is the seat list of the map the player stands in; a map without seats
 * passes `[]`, so every Sit there is a silent drop (no index is in range).
 */

/** Personal Korean notice for the occupied-seat race (mirrors ChatRejected). */
export const SEAT_OCCUPIED = "이미 사용 중인 자리예요";

export function validateSit(
  player: { x: number; z: number; seatIndex: number },
  payload: unknown,
  occupancy: ReadonlyMap<number, string>,
  sessionId: string,
  seats: readonly Seat[],
): { seatIndex: number } | { reason: string } | null {
  // 1. shape: an object carrying an integer seatIndex in range → else silent drop.
  if (typeof payload !== "object" || payload === null) return null;
  const seatIndex = (payload as Record<string, unknown>).seatIndex;
  if (typeof seatIndex !== "number" || !Number.isInteger(seatIndex)) return null;
  if (seatIndex < 0 || seatIndex >= seats.length) return null;

  // 2. already seated → silent drop (client UI never offers sit while seated).
  if (player.seatIndex >= 0) return null;

  // 3. distance gate: honest clients only see the prompt within SEAT_REACH, so a
  //    farther Sit is a tampered client → silent drop (not a user-facing reason).
  const seat = seats[seatIndex];
  if (seatDistance(seat, player.x, player.z) > SEAT_REACH) return null;

  // 3b. a backed seat (a sofa, an armchair, a bench with a back) is sat on from the front only: from behind the prompt is never
  //     shown, so a request from there is a tampered client → silent drop.
  if (!approachesSeat(seat, player.x, player.z, SEAT_APPROACH_SLACK)) return null;

  // 4. occupancy: taken by SOMEONE ELSE (the seat itself or another facing of the same bench seat) → personal rejection
  //    notice (the race).
  const heldByOther = (i: number): boolean => {
    const holder = occupancy.get(i);
    return holder !== undefined && holder !== sessionId;
  };
  if (seatTaken(seats, seatIndex, heldByOther)) return { reason: SEAT_OCCUPIED };

  return { seatIndex };
}

/**
 * Where a sitter on `seat` stands up to (owner 2026-11-17: "일어서면 의자 앞에 서고", never behind the backrest): its stand point, else
 * front-left / front-right of the seat, else a little further forward (standSpot.ts `standCandidates`) — the first clear of the
 * furniture (`standsClear`, the area's rectangle) and of every other body in the area (`others`, BODY_APART). Null: none is free, the
 * sitter stays seated (the caller sends STAND_BLOCKED).
 */
export function chooseStandSpot(
  seat: Seat,
  area: string,
  others: ReadonlyArray<{ x: number; z: number }>,
): { x: number; z: number } | null {
  // 케이슨랜드 benches: the park rectangle and the park colliders
  if (area === "park") return pickStandSpot(seat, (x, z) => standsClear(x, z, PARK_BOUNDS, parkGeometry) && others.every((o) => Math.hypot(o.x - x, o.z - z) >= BODY_APART));
  const house = parseHouseFloorArea(area);
  // the open village's walkable rectangle reaches past areas.village to the waterfall's rest area (fallsWalk.ts: its stone seats)
  const bounds = house ? houseFloorBounds(house.n, house.floor) : area === "village" ? villageWalkArea(VILLAGE_LAYOUT) : (VILLAGE_LAYOUT.areas as Record<string, (typeof VILLAGE_LAYOUT.areas)["village"]>)[area];
  if (!bounds) return { x: seat.standX, z: seat.standZ };
  return pickStandSpot(seat, (x, z) => standsClear(x, z, bounds) && others.every((o) => Math.hypot(o.x - x, o.z - z) >= BODY_APART));
}
