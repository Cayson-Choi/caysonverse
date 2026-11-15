/**
 * Solid players + NPC (design 33): the local slide resolves against the STATIC
 * obstacles of the ACTIVE map (activeMap.ts — in the world they already include the NPC's
 * box, shared with the server)
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

import { PLAYER_RADIUS, type AABB } from "@caysonverse/shared/worldMap";
import { isBlocked } from "@caysonverse/shared/collision";
import { pushOutOfBus } from "@caysonverse/shared/village/busBody";
import { forEachRemotePosition } from "./remoteStore";
import { activeMapVersion, getActiveMap } from "./activeMap";
import { getMovingBusPose } from "../net/transitSync";
import { localArea } from "../village/villageArea";

interface MutableAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const boxPool: MutableAABB[] = [];
/**
 * The active map's static obstacles followed by this frame's remote boxes. Rebuilt only when
 * the active map changes (`activeMapVersion`) — the one allocation, once per switch.
 */
let combined: AABB[] = [];
let staticCount = 0;
let builtFor = -1;

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
 * The obstacle list for THIS frame: the active map's static obstacles + one player-sized box
 * per connected, non-overlapped remote. The returned array is reused between
 * calls — consume it synchronously (resolveCollision does), never store it.
 * `forEach` is injectable for tests; production uses the remote store.
 */
export function collectObstacles(
  selfX: number,
  selfZ: number,
  forEach: typeof forEachRemotePosition = forEachRemotePosition,
): readonly AABB[] {
  if (builtFor !== activeMapVersion()) {
    builtFor = activeMapVersion();
    combined = [...getActiveMap().geometry.obstacles];
    staticCount = combined.length;
  }
  const list = combined as MutableAABB[];
  list.length = staticCount;
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

/** A spot the body may be put on by the bus's push: not inside a static collider of the active map. */
function staticFree(x: number, z: number): boolean {
  return isBlocked(x, z, PLAYER_RADIUS, getActiveMap().geometry.obstacles);
}

/**
 * The moving bus is solid (owner 2026-11-15; checker r2: walking at the side of the driving bus went straight into its
 * body). Every frame, after the walk's slide, the local body is put back outside the bus's body if it overlaps it
 * (shared busBody.ts pushOutOfBus: the nearest free side, never its front): a walk into the flank slides along it, and
 * the bus's body reaching me (at the kerb as it passes) shoves me out at its pace. The server does the same with every
 * avatar (VillageRoom), so the pose I send agrees with it. Returns the new spot, or null when I am clear (or not on the
 * village's road: parked, the bus is a static collider). Injectable for tests.
 */
export function pushOutOfMovingBus(
  x: number,
  z: number,
  movingBus: typeof getMovingBusPose = getMovingBusPose,
  inVillage: () => boolean = () => localArea() === "village",
  blocked: (x: number, z: number) => boolean = staticFree,
): { x: number; z: number } | null {
  const bus = movingBus();
  if (!bus || !inVillage()) return null;
  return pushOutOfBus(bus, x, z, PLAYER_RADIUS, blocked);
}
