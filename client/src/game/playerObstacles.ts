/**
 * Solid players + NPC (design 33): the local slide resolves against the STATIC
 * map OBSTACLES (which already include the NPC's box, shared with the server)
 * PLUS a per-frame dynamic box for every connected remote player, so other
 * characters block movement exactly like desks and sofas.
 *
 * Client-side only by design: the server keeps validating against the static
 * OBSTACLES. Blocking moves server-side on other players' interpolated
 * positions would rubber-band two people walking toward each other — the
 * documented v1 philosophy is lenient server validation, strict local feel.
 *
 * Per-frame allocation-free: one reusable combined array (static prefix +
 * dynamic tail) and a pool of mutable boxes.
 *
 * ESCAPE RULE: a remote you are ALREADY overlapping does not block. Sliding
 * prevents ever walking INTO someone, so overlap only arises from spawn
 * stacking, portals or seat transitions — and in those states every move would
 * otherwise be rejected, leaving both players permanently stuck.
 */

import { OBSTACLES, PLAYER_RADIUS, type AABB } from "@caysonverse/shared/worldMap";
import { forEachRemotePosition } from "./remoteStore";

interface MutableAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const boxPool: MutableAABB[] = [];
const combined: AABB[] = [...OBSTACLES];

/**
 * Pure escape-rule predicate: does the remote at (rx, rz) block the local
 * player at (selfX, selfZ)? False only when the local circle ALREADY overlaps
 * the remote's box (then it must be free to walk out).
 */
export function remoteBlocks(
  selfX: number,
  selfZ: number,
  rx: number,
  rz: number,
  radius: number = PLAYER_RADIUS,
): boolean {
  // Closest point of the remote's box to the local centre.
  const cx = Math.max(rx - radius, Math.min(selfX, rx + radius));
  const cz = Math.max(rz - radius, Math.min(selfZ, rz + radius));
  return Math.hypot(selfX - cx, selfZ - cz) >= radius - 1e-9;
}

/**
 * The obstacle list for THIS frame: static map obstacles + one player-sized box
 * per connected, non-overlapped remote. The returned array is reused between
 * calls — consume it synchronously (resolveCollision does), never store it.
 * `forEach` is injectable for tests; production uses the remote store.
 */
export function collectObstacles(
  selfX: number,
  selfZ: number,
  forEach: typeof forEachRemotePosition = forEachRemotePosition,
): readonly AABB[] {
  const list = combined as MutableAABB[];
  list.length = OBSTACLES.length;
  let used = 0;
  forEach((x, z, connected) => {
    // Ghosts (disconnected, 50% opacity) are not really there — walk through.
    if (!connected) return;
    if (!remoteBlocks(selfX, selfZ, x, z)) return;
    let box = boxPool[used];
    if (!box) {
      box = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
      boxPool[used] = box;
    }
    box.minX = x - PLAYER_RADIUS;
    box.maxX = x + PLAYER_RADIUS;
    box.minZ = z - PLAYER_RADIUS;
    box.maxZ = z + PLAYER_RADIUS;
    list.push(box);
    used++;
  });
  return combined;
}
