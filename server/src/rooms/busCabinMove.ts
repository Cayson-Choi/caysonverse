import type { BusMovePayload, BusSitPayload } from "@caysonverse/shared/messages";
import { MOVE_ELAPSED_CEIL_MS, MOVE_ELAPSED_FLOOR_MS, MOVE_SPEED_SLACK, RUN_SPEED } from "@caysonverse/shared/constants";
import {
  BUS_WALK_RADIUS,
  BUS_RIDER_APART_SERVER,
  BUS_SEATS,
  type BusLocalPoint,
  crowdBlocks,
  BUS_SEAT_COUNT,
  busSeatNumber,
  cabinBlocked,
  normalizeYaw,
  seatApproachOk,
} from "@caysonverse/shared/village/busCabin";

/**
 * Validation of a rider's actions inside the bus (shared village/busCabin.ts): a step in the bus's own frame, sitting in a
 * seat. Pure: the room keeps who sits where and applies the result.
 */

export type BusMoveDecision =
  | { ok: true; ahead: number; right: number; yaw: number }
  | { ok: false; reason: "drop" };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A step while aboard and free: the point must be finite, inside the cabin (not in a wall, a seat or a solid) and within
 * what the walk could have covered since the last accepted step (RUN_SPEED with the world's slack and the same elapsed
 * clamp), the segment checked every 0.1 m so nobody passes through a seat. A refused step is dropped silently (the room
 * echoes the authoritative point, as the world's Move does).
 */
export function validateBusMove(
  from: { busSeat: number; ahead: number; right: number },
  payload: unknown,
  elapsedMs: number,
  others?: ReadonlyArray<BusLocalPoint>,
): BusMoveDecision {
  if (from.busSeat !== 0) return { ok: false, reason: "drop" };
  if (payload === null || typeof payload !== "object") return { ok: false, reason: "drop" };
  const p = payload as Partial<BusMovePayload>;
  if (!isNum(p.ahead) || !isNum(p.right) || !isNum(p.yaw)) return { ok: false, reason: "drop" };
  if (cabinBlocked(p.ahead, p.right)) return { ok: false, reason: "drop" };
  const dt = Math.min(Math.max(elapsedMs, MOVE_ELAPSED_FLOOR_MS), MOVE_ELAPSED_CEIL_MS);
  const allowed = (RUN_SPEED * MOVE_SPEED_SLACK * dt) / 1000 + 0.05;
  const dist = Math.hypot(p.ahead - from.ahead, p.right - from.right);
  if (dist > allowed) return { ok: false, reason: "drop" };
  // Nobody walks into another rider (the client predicts with a slightly stricter rule, so an honest step is never refused here).
  if (crowdBlocks(from, { ahead: p.ahead, right: p.right }, others, BUS_RIDER_APART_SERVER)) return { ok: false, reason: "drop" };
  // The segment, at half the walk radius: the client slides along seats and wheel housings (checker r1: 4 % of honest steps along
  // a seat's edge were refused by a full-radius straight-line test and the two sides drifted apart), so a straight line that
  // only grazes a solid's rim is honest; one that goes through a seat, a housing or a post (all deeper than the radius) is not.
  const n = Math.ceil(dist / 0.1);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (cabinBlocked(from.ahead + (p.ahead - from.ahead) * t, from.right + (p.right - from.right) * t, BUS_WALK_RADIUS * 0.5)) return { ok: false, reason: "drop" };
  }
  return { ok: true, ahead: p.ahead, right: p.right, yaw: normalizeYaw(p.yaw) };
}

export type BusSitDecision =
  | { ok: true; busSeat: number; kind: "seat"; index: number }
  | { ok: false; notice: string };

export const BUS_SEAT_TAKEN_NOTICE = "다른 사람이 앉아 있어요.";
export const BUS_SEAT_FRONT_NOTICE = "의자 앞쪽에서 앉을 수 있어요.";
export const BUS_SEAT_FAR_NOTICE = "의자 가까이 가서 눌러 주세요.";

/**
 * Sitting in a free seat from where the rider stands (aboard and free): the seat must be free (`taken`: the busSeat numbers
 * other riders hold), the rider within reach of it and in front of it (every seat is backed). Bus v3: there are no hold places
 * any more (no poles); a `kind` other than "seat" is dropped silently.
 */
export function validateBusSit(
  from: { busSeat: number; ahead: number; right: number },
  payload: unknown,
  taken: ReadonlySet<number>,
): BusSitDecision {
  if (from.busSeat !== 0) return { ok: false, notice: "" };
  if (payload === null || typeof payload !== "object") return { ok: false, notice: "" };
  const p = payload as Partial<BusSitPayload>;
  if (p.kind !== "seat" || !Number.isInteger(p.index)) return { ok: false, notice: "" };
  const index = p.index as number;
  if (index < 0 || index >= BUS_SEAT_COUNT) return { ok: false, notice: "" };
  const number = busSeatNumber(index);
  if (taken.has(number)) return { ok: false, notice: BUS_SEAT_TAKEN_NOTICE };
  const seat = BUS_SEATS[index]!;
  if (!seatApproachOk(seat, from.ahead, from.right)) {
    // close enough but on the wrong side: say so; too far: say that
    const d = Math.hypot(from.ahead - seat.ahead, from.right - seat.right);
    return { ok: false, notice: d < 1.6 ? BUS_SEAT_FRONT_NOTICE : BUS_SEAT_FAR_NOTICE };
  }
  return { ok: true, busSeat: number, kind: "seat", index };
}
