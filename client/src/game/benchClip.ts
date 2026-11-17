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
 * behind the front edge (the seat point minus `frontEdge` along the facing). Shadows follow because `clipShadows` is
 * set with the planes (three's shadow pass clips only then). The renderer needs `localClippingEnabled` (`enableBenchClipping`).
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

/**
 * The "clip nothing" pair: every point is on the positive side of both, so their intersection is empty (perf/no-hitch).
 * An avatar that is not on a bench carries these instead of no planes, so its shaders keep the same two-plane variant
 * whether it sits or not: sitting down only changes uniforms. Before, the first sit of each avatar (and every sit after
 * a stand) switched its materials to another program: a 150-500 ms compile in the middle of the frame.
 */
const NO_CLIP: Plane[] = [new Plane(new Vector3(0, 1, 0), 1e6), new Plane(new Vector3(0, 1, 0), 1e6)];

/** Clip `avatar` with `planes` (their intersection), or stop clipping it (null: the planes that clip nothing). */
export function clipAvatar(avatar: BuiltAvatar, planes: Plane[] | null): void {
  const want = planes ?? NO_CLIP;
  for (const m of avatar.materials) {
    if (m.clippingPlanes === want) continue;
    // a different program only when the variant changes (the plane count, the flags), never for the planes' values
    const variant = !m.clippingPlanes || m.clippingPlanes.length !== want.length || !m.clipIntersection || !m.clipShadows;
    m.clippingPlanes = want;
    m.clipIntersection = true;
    // Review 2026-11-10: three's shadow pass clips only when clipShadows is set, so without it the hidden cloth
    // (a long skirt's back panel inside the bench) still cast its shadow on the ground.
    m.clipShadows = true;
    if (variant) m.needsUpdate = true;
  }
}

/** Whether `avatar` is clipped by a bench now (not the planes that clip nothing). */
export function isBenchClipped(avatar: BuiltAvatar): boolean {
  const p = avatar.materials[0]?.clippingPlanes;
  return !!p && p !== NO_CLIP;
}

/** Let materials carry their own clipping planes (off by default in three). Idempotent. */
export function enableBenchClipping(gl: WebGLRenderer): void {
  if (!gl.localClippingEnabled) gl.localClippingEnabled = true;
}
