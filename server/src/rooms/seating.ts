import { SEATS, SEAT_REACH } from "@caysonverse/shared/worldMap";

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
 *                      request is a tampered client).
 *   - `{ reason }`   → REJECT with a personal Korean notice. The ONE non-silent
 *                      case: a first-come race where the seat was taken by
 *                      someone else between prompt and click.
 *   - `{ seatIndex }`→ ACCEPT. The room snaps the player onto the seat.
 */

/** Personal Korean notice for the occupied-seat race (mirrors ChatRejected). */
export const SEAT_OCCUPIED = "이미 사용 중인 자리예요";

export function validateSit(
  player: { x: number; z: number; seatIndex: number },
  payload: unknown,
  occupancy: ReadonlyMap<number, string>,
  sessionId: string,
): { seatIndex: number } | { reason: string } | null {
  // 1. shape: an object carrying an integer seatIndex in range → else silent drop.
  if (typeof payload !== "object" || payload === null) return null;
  const seatIndex = (payload as Record<string, unknown>).seatIndex;
  if (typeof seatIndex !== "number" || !Number.isInteger(seatIndex)) return null;
  if (seatIndex < 0 || seatIndex >= SEATS.length) return null;

  // 2. already seated → silent drop (client UI never offers sit while seated).
  if (player.seatIndex >= 0) return null;

  // 3. distance gate: honest clients only see the prompt within SEAT_REACH, so a
  //    farther Sit is a tampered client → silent drop (not a user-facing reason).
  const seat = SEATS[seatIndex];
  if (Math.hypot(player.x - seat.x, player.z - seat.z) > SEAT_REACH) return null;

  // 4. occupancy: taken by SOMEONE ELSE → personal rejection notice (the race).
  const holder = occupancy.get(seatIndex);
  if (holder !== undefined && holder !== sessionId) return { reason: SEAT_OCCUPIED };

  return { seatIndex };
}
