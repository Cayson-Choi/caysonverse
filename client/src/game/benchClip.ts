/**
 * What of a bench sitter must not show: the part of the avatar INSIDE the bench — below the seat surface and behind
 * the seat's front edge. The sit pose (character.glb, Sit_Chair_Idle) hangs some clothes straight down from the
 * butt: the long skirt's back panel reaches 0.24 m below it, a robe's tails and a tall boot's cuff a little. On a
 * chair of the legacy world that is under the cushion; through a park bench's slats, a stone block or the hall's thin
 * board it showed as cloth passing through the seat. The GLB is not changed (no sit variant of the skirt exists):
 * while the avatar sits on a bench its materials clip that region away, and nothing else — the legs and a skirt's
 * front drape hang IN FRONT of the edge and stay whole.
 *
 * Two world-space planes with `clipIntersection` (three clips only where a point is behind BOTH): below `seatY`, and
 * behind the front edge (the seat point minus `frontEdge` along the facing). Shadows follow (three's shadow pass
 * copies a material's planes). The renderer needs `localClippingEnabled` (`enableBenchClipping`).
 */

import { Plane, Vector3, type WebGLRenderer } from "three";
import type { Seat } from "@caysonverse/shared/worldMap";
import type { BuiltAvatar } from "./characterAvatar";

/** The planes that clip the inside of `seat`'s bench (both on their negative side), or null for a chair. */
export function benchClipPlanes(seat: Seat | undefined): Plane[] | null {
  if (!seat || seat.seatY === undefined || seat.frontEdge === undefined) return null;
  const fx = Math.sin(seat.yaw);
  const fz = Math.cos(seat.yaw);
  const edgeX = seat.x - fx * seat.frontEdge;
  const edgeZ = seat.z - fz * seat.frontEdge;
  return [
    new Plane(new Vector3(0, 1, 0), -seat.seatY), // negative below the seat surface
    new Plane(new Vector3(fx, 0, fz), -(fx * edgeX + fz * edgeZ)), // negative behind the front edge
  ];
}

/** Clip `avatar` with `planes` (their intersection), or stop clipping it (null). Recompiles only on a change. */
export function clipAvatar(avatar: BuiltAvatar, planes: Plane[] | null): void {
  for (const m of avatar.materials) {
    if (m.clippingPlanes === planes) continue;
    m.clippingPlanes = planes;
    m.clipIntersection = planes !== null;
    m.needsUpdate = true;
  }
}

/** Let materials carry their own clipping planes (off by default in three). Idempotent. */
export function enableBenchClipping(gl: WebGLRenderer): void {
  if (!gl.localClippingEnabled) gl.localClippingEnabled = true;
}
