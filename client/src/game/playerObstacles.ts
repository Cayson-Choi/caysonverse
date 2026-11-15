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
import { circleIntersectsAABB } from "@caysonverse/shared/collision";
import { forEachRemotePosition } from "./remoteStore";
import { activeMapVersion, getActiveMap } from "./activeMap";
import { getMovingBusPose } from "../net/transitSync";

/** The moving bus's body as boxes (m): its 9 m split in four pieces along its heading, each box round one piece. */
const BUS_PIECES = 4;
const BUS_HALF_LENGTH = 4.5;
const BUS_HALF_WIDTH = 1.25;

/**
 * The village bus's body while it drives (owner 2026-11-15: avatars must not walk into the moving bus): four boxes along
 * its heading, each the axis-aligned box round a quarter of the bus (2.25 x 2.5 m), so the body is covered at any yaw.
 * Written into `out` (reused boxes). Pure: tests feed a pose.
 */
export function busBodyBoxes(pose: { x: number; z: number; yaw: number }, out: MutableAABB[]): number {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  const halfPiece = BUS_HALF_LENGTH / BUS_PIECES;
  const hx = Math.abs(fx) * halfPiece + Math.abs(fz) * BUS_HALF_WIDTH;
  const hz = Math.abs(fz) * halfPiece + Math.abs(fx) * BUS_HALF_WIDTH;
  for (let i = 0; i < BUS_PIECES; i++) {
    const along = -BUS_HALF_LENGTH + halfPiece * (2 * i + 1);
    const cx = pose.x + fx * along;
    const cz = pose.z + fz * along;
    let box = out[i];
    if (!box) {
      box = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
      out[i] = box;
    }
    box.minX = cx - hx;
    box.maxX = cx + hx;
    box.minZ = cz - hz;
    box.maxZ = cz + hz;
  }
  return BUS_PIECES;
}

const busBoxes: MutableAABB[] = [];

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
  movingBus: typeof getMovingBusPose = getMovingBusPose,
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
  // The bus out on the road is solid (parked, its box is a static collider). Same escape rule: a piece the body already
  // overlaps does not block, so nobody is stuck inside it.
  const bus = movingBus();
  if (bus) {
    const n = busBodyBoxes(bus, busBoxes);
    for (let i = 0; i < n; i++) {
      const b = busBoxes[i]!;
      if (!circleIntersectsAABB(selfX, selfZ, PLAYER_RADIUS, b, 1e-6)) list.push(b);
    }
  }
  return combined;
}
