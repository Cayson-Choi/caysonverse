/**
 * Snapshot interpolation (pure). Remote players are rendered from a buffered
 * history of `{t, x, z, yaw}` snapshots, sampled RENDER_DELAY_MS in the past so
 * there is always a bracketing pair to interpolate between — hiding network
 * jitter and loss. No server-clock sync: `t` is the LOCAL receive time, injected
 * by the caller, so this module reads no clock and is exhaustively unit-testable.
 */

import { MOVE_SPEED } from "@caysonverse/shared/constants";
import { normalizeAngle, lerpAngle } from "./yaw";
import {
  EXTRAPOLATE_MAX_MS,
  EXTRAPOLATE_SETTLE_MS,
  SNAPSHOT_CAPACITY,
  SNAP_DISTANCE,
} from "./constants";

/** One received position sample. `t` is a local (client) receive timestamp. */
export interface Snapshot {
  t: number;
  x: number;
  z: number;
  yaw: number;
}

/** Result of sampling the buffer at a render time. */
export interface Sample {
  x: number;
  z: number;
  yaw: number;
  /** Interpolated ground speed (m/s) — drives the walk/idle decision. */
  speed: number;
}

/**
 * Append a snapshot, evicting the oldest beyond `capacity` (a plain array used
 * as a ring). Mutates `buf` in place — the record owns the array.
 */
export function pushSnapshot(
  buf: Snapshot[],
  snapshot: Snapshot,
  capacity: number = SNAPSHOT_CAPACITY,
): void {
  buf.push(snapshot);
  while (buf.length > capacity) buf.shift();
}

/**
 * Sample the buffer at `renderT` (already = now - RENDER_DELAY_MS; the caller
 * applies the delay). Returns null only for an empty buffer.
 *
 * - renderT before the oldest snapshot → clamp to the oldest (idle).
 * - renderT between two snapshots → linear x/z, shortest-arc yaw.
 * - renderT past the newest → extrapolate at the last segment's velocity (clamped
 *   to MOVE_SPEED) for at most EXTRAPOLATE_MAX_MS, then ease back to `newest` (the
 *   authoritative rest pose) over EXTRAPOLATE_SETTLE_MS and hold (speed 0 → idle).
 */
export function sample(snapshots: readonly Snapshot[], renderT: number): Sample | null {
  const n = snapshots.length;
  if (n === 0) return null;

  const oldest = snapshots[0];
  if (renderT <= oldest.t) {
    return { x: oldest.x, z: oldest.z, yaw: oldest.yaw, speed: 0 };
  }

  const newest = snapshots[n - 1];
  if (renderT >= newest.t) {
    return extrapolate(snapshots, renderT, newest);
  }

  // Find the bracketing pair (searching from the newest end — the common case).
  for (let i = n - 1; i > 0; i--) {
    const a = snapshots[i - 1];
    const b = snapshots[i];
    if (renderT >= a.t && renderT <= b.t) {
      const span = b.t - a.t;
      const f = span > 0 ? (renderT - a.t) / span : 0;
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const yaw = lerpAngle(a.yaw, b.yaw, f);
      const speed = span > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / (span / 1000) : 0;
      return { x, z, yaw, speed };
    }
  }

  // Unreachable given the guards above, but stay defined rather than throw.
  return { x: newest.x, z: newest.z, yaw: newest.yaw, speed: 0 };
}

/**
 * Dead-reckon past the newest snapshot using the last segment's velocity, then
 * converge back to the authoritative rest pose:
 *   - velocity is CLAMPED to MOVE_SPEED — any faster segment is receive-time
 *     jitter (a delayed-then-burst patch pair), not real motion, and must not
 *     fling the avatar (potentially through walls/furniture);
 *   - within EXTRAPOLATE_MAX_MS we dead-reckon forward (still "moving");
 *   - after the window, since a stopped remote emits no further patches, we EASE
 *     from the overshoot back to `newest` over EXTRAPOLATE_SETTLE_MS and hold —
 *     so idle avatars settle onto their server position instead of freezing ~1m
 *     past the true stop.
 * A single snapshot (or a zero-length segment) simply holds position.
 */
function extrapolate(snapshots: readonly Snapshot[], renderT: number, newest: Snapshot): Sample {
  if (snapshots.length < 2) {
    return { x: newest.x, z: newest.z, yaw: newest.yaw, speed: 0 };
  }
  const prev = snapshots[snapshots.length - 2];
  const span = newest.t - prev.t;
  if (span <= 0) {
    return { x: newest.x, z: newest.z, yaw: newest.yaw, speed: 0 };
  }

  const ahead = renderT - newest.t; // > 0 by the caller's guard

  // Last-segment velocity (m per ms), clamped in MAGNITUDE to MOVE_SPEED.
  let vx = (newest.x - prev.x) / span;
  let vz = (newest.z - prev.z) / span;
  const speedMs = Math.hypot(vx, vz); // m per ms
  const maxMs = MOVE_SPEED / 1000; // MOVE_SPEED m/s → m per ms
  if (speedMs > maxMs) {
    const k = maxMs / speedMs;
    vx *= k;
    vz *= k;
  }
  const wYaw = normalizeAngle(newest.yaw - prev.yaw) / span; // rad per ms

  // The overshoot pose at the end of the dead-reckon window (the clamped reach).
  const capped = Math.min(ahead, EXTRAPOLATE_MAX_MS);
  const overX = newest.x + vx * capped;
  const overZ = newest.z + vz * capped;
  const overYaw = normalizeAngle(newest.yaw + wYaw * capped);

  // Phase A — still within the window: dead-reckon forward, reads as moving.
  if (ahead <= EXTRAPOLATE_MAX_MS) {
    return { x: overX, z: overZ, yaw: overYaw, speed: Math.hypot(vx, vz) * 1000 };
  }

  // Phase B/C — past the window: ease the overshoot back to the authoritative
  // rest pose and hold. e goes 0→1 across the settle; at e=1 we are exactly at
  // `newest`. A settling correction reads as idle (speed 0), not a walk cycle.
  const e = Math.min((ahead - EXTRAPOLATE_MAX_MS) / EXTRAPOLATE_SETTLE_MS, 1);
  const x = overX + (newest.x - overX) * e;
  const z = overZ + (newest.z - overZ) * e;
  const yaw = lerpAngle(overYaw, newest.yaw, e);
  return { x, z, yaw, speed: 0 };
}

/**
 * True when the straight-line gap between the currently-drawn position and a
 * freshly sampled target exceeds SNAP_DISTANCE — i.e. a teleport/kick-back the
 * caller should apply instantly instead of sliding across.
 */
export function exceedsSnapDistance(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  snapDistance: number = SNAP_DISTANCE,
): boolean {
  return Math.hypot(currentX - targetX, currentZ - targetZ) > snapDistance;
}
