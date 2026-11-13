import {
  RUN_SPEED,
  MOVE_SPEED_SLACK,
  MOVE_ELAPSED_FLOOR_MS,
  PLAYER_RADIUS,
} from "@caysonverse/shared/constants";
import { isBlocked } from "@caysonverse/shared/collision";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
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
 *   4. clamp target into the map's bounds, inset by PLAYER_RADIUS (legal-speed
 *      overshoot is clamped, not dropped)
 *   5. drop the move if the clamped target's body overlaps any of the map's
 *      obstacles — the client already slides around obstacles, so this only
 *      rejects a modified client trying to walk into furniture/walls
 *      (silent-drop policy)
 *   6. normalize yaw into [-PI, PI]
 *   7. pass the sender's clock reading `t` through when it is a whole number of ms in uint32 range (the
 *      `Player.moveT` the viewers time the walk by); anything else is left out, never a reason to drop
 * (the per-client rate cap, the move budget and applying the result live in the room.)
 *
 * Collision is enforced from the SAME obstacles the client slides against, so
 * both sides share one source of map/collision truth. `geo` is the map the
 * player stands in.
 *
 * 기준 속도 = 달리기 속도 (controls-ux §5): the client never reports walk/run, so
 * the speed budget is sized for RUN_SPEED (6.4 m/s; the walk is MOVE_SPEED, 2 m/s since 2026-11-10 — a tab still
 * walking at the old 4 m/s is well inside it).
 */
export function validateMove(
  current: { x: number; z: number },
  payload: unknown,
  elapsedMs: number,
  geo: MapGeometry,
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
  const maxDist = RUN_SPEED * (elapsed / 1000) * MOVE_SPEED_SLACK;
  const dx = p.x - current.x;
  const dz = p.z - current.z;
  if (Math.hypot(dx, dz) > maxDist) return null;

  // 4. clamp the player CENTRE into bounds inset by the body radius, so a
  //    clamped edge position rests flush against the boundary wall.
  const { bounds } = geo;
  const x = clamp(p.x, bounds.minX + PLAYER_RADIUS, bounds.maxX - PLAYER_RADIUS);
  const z = clamp(p.z, bounds.minZ + PLAYER_RADIUS, bounds.maxZ - PLAYER_RADIUS);

  // 5. obstacle overlap → drop (a small epsilon in isBlocked tolerates the
  //    floating-point rounding of a legitimately wall-hugging client).
  if (isBlocked(x, z, PLAYER_RADIUS, geo.obstacles)) return null;

  // 6. normalize yaw. 7. the sender's clock, if it is a usable one.
  const yaw = normalizeAngle(p.yaw);
  return isMoveClock(p.t) ? { x, z, yaw, t: p.t } : { x, z, yaw };
}

/** Largest `MovePayload.t` the uint32 `Player.moveT` can carry. */
const MOVE_T_MAX = 0xffffffff;

/** A usable sender clock reading: a whole number of ms in 1..uint32 max (0 means "unknown"). */
function isMoveClock(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MOVE_T_MAX;
}

/**
 * The move budget after an ACCEPTED step (pure; the room stores the result as `lastAcceptedAt`).
 *
 * The budget is `min(now - lastAcceptedAt, MOVE_ELAPSED_CEIL_MS)` ms of RUN_SPEED × slack travel. The step
 * spends only what it used: `stepM / (RUN_SPEED × slack)` seconds of it, and the rest is kept by moving the
 * baseline to `now - (budgetMs - spent)` instead of to `now`. Why (fix/remote-move-snapback): moves are sent
 * at 10 Hz, but a phone's link delivers them bunched — a late frame, then the ones queued behind it a few
 * ms apart. Resetting the baseline to `now` on every accepted move gave each of those queued moves a ~0
 * budget, so the server dropped them all, fell metres behind, and the mover was yanked back by its own
 * large-divergence snap (and everyone else saw the mover freeze, then jump). Kept budget absorbs the burst.
 *
 * Nothing gets looser: one step is still at most `MOVE_ELAPSED_CEIL_MS` worth (4.8 m — the wall thickness
 * the maps are built for), and over any stretch of time the accepted travel is still at most RUN_SPEED ×
 * slack × (that time + MOVE_ELAPSED_CEIL_MS). A step longer than the budget (only reached through the
 * elapsed floor) leaves nothing, exactly as before; a teleport/reconnect still sets the baseline to now.
 */
export function moveBaselineAfter(nowMs: number, budgetMs: number, stepM: number): number {
  const spentMs = (stepM / (RUN_SPEED * MOVE_SPEED_SLACK)) * 1000;
  return nowMs - Math.max(0, budgetMs - spentMs);
}

/**
 * A spawn point: uniform over the disk of `radius` around (cx, cz), then clamped
 * into `geo`'s bounds inset by PLAYER_RADIUS (the same clamp as validateMove's
 * step 4), so joiners don't stack yet always land in-bounds. Obstacles are not
 * checked — each map keeps its spawn disk clear (the map data tests pin that).
 *
 * `random` draws the radius first, then the angle (the original order);
 * it is Math.random except in tests.
 */
export function spawnInDisk(
  cx: number,
  cz: number,
  radius: number,
  geo: MapGeometry,
  random: () => number = Math.random,
): { x: number; z: number } {
  const r = radius * Math.sqrt(random()); // sqrt → uniform over the area, not the radius
  const angle = random() * Math.PI * 2;
  const { bounds } = geo;
  return {
    x: clamp(cx + r * Math.cos(angle), bounds.minX + PLAYER_RADIUS, bounds.maxX - PLAYER_RADIUS),
    z: clamp(cz + r * Math.sin(angle), bounds.minZ + PLAYER_RADIUS, bounds.maxZ - PLAYER_RADIUS),
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
