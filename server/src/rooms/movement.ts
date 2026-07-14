import {
  MOVE_SPEED,
  MOVE_SPEED_SLACK,
  MOVE_ELAPSED_FLOOR_MS,
  WORLD_BOUNDS,
  PLAYER_RADIUS,
} from "@caysonverse/shared/constants";
import { OBSTACLES } from "@caysonverse/shared/worldMap";
import { isBlocked } from "@caysonverse/shared/collision";
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
 *   4. clamp target into WORLD_BOUNDS, inset by PLAYER_RADIUS (legal-speed
 *      overshoot is clamped, not dropped)
 *   5. drop the move if the clamped target's body overlaps any OBSTACLE — the
 *      client already slides around obstacles, so this only rejects a modified
 *      client trying to walk into furniture/walls (silent-drop policy)
 *   6. normalize yaw into [-PI, PI]
 * (the per-client rate cap and applying the result live in the room.)
 *
 * Collision is enforced from the SAME `OBSTACLES` the client slides against, so
 * both sides share one source of map/collision truth.
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

  // 4. clamp the player CENTRE into bounds inset by the body radius, so a
  //    clamped edge position rests flush against the boundary wall.
  const x = clamp(p.x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS);
  const z = clamp(p.z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS);

  // 5. obstacle overlap → drop (a small epsilon in isBlocked tolerates the
  //    floating-point rounding of a legitimately wall-hugging client).
  if (isBlocked(x, z, PLAYER_RADIUS, OBSTACLES)) return null;

  // 6. normalize yaw.
  return { x, z, yaw: normalizeAngle(p.yaw) };
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
