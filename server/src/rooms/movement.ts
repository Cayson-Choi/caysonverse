import {
  MOVE_SPEED,
  MOVE_SPEED_SLACK,
  MOVE_ELAPSED_FLOOR_MS,
  WORLD_BOUNDS,
} from "@caysonverse/shared/constants";
import type { MovePayload } from "@caysonverse/shared/messages";

/**
 * Pure, clock-free movement validation.
 *
 * Given the player's current authoritative position, a raw client payload, and
 * the time elapsed since that client's last ACCEPTED move, decide the new
 * position/facing — or return `null` when the message must be dropped.
 *
 * The room owns all timing (it computes `elapsedMs` and does rate limiting); by
 * keeping this function free of `Date.now()`/clocks the speed/bounds/NaN/yaw
 * rules are exhaustively unit-testable without time mocking.
 *
 * Pipeline (invalid messages are dropped whole — never partially applied):
 *   1. payload must be an object with finite x, z, yaw
 *   3. displacement from `current` must fit the speed budget for `elapsedMs`
 *   4. clamp target into WORLD_BOUNDS (legal-speed overshoot is clamped, not dropped)
 *   5. normalize yaw into [-PI, PI]
 * (step 2, the per-client rate cap, and step 6, applying the result, live in the room.)
 */
export function validateMove(
  current: { x: number; z: number },
  payload: unknown,
  elapsedMs: number,
): MovePayload | null {
  // 1. shape
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.z) || !isFiniteNumber(p.yaw)) {
    return null;
  }

  // 3. displacement / speed. Floor elapsed so a burst (elapsed ~= 0) still
  //    grants a small budget instead of collapsing every step to zero.
  const elapsed = Math.max(elapsedMs, MOVE_ELAPSED_FLOOR_MS);
  const maxDist = MOVE_SPEED * (elapsed / 1000) * MOVE_SPEED_SLACK;
  const dx = p.x - current.x;
  const dz = p.z - current.z;
  if (Math.hypot(dx, dz) > maxDist) return null;

  // 4. clamp into bounds. 5. normalize yaw.
  return {
    x: clamp(p.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX),
    z: clamp(p.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ),
    yaw: normalizeAngle(p.yaw),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Normalize a radian angle into the half-open-ish range [-PI, PI]. */
function normalizeAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}
