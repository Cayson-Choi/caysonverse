/**
 * Snapshot interpolation (pure). Remote players are rendered from a buffered
 * history of `{t, x, z, yaw}` snapshots, sampled RENDER_DELAY_MS in the past so
 * there is always a bracketing pair to interpolate between — hiding network
 * jitter and loss. No server-clock sync: `t` is the LOCAL receive time, injected
 * by the caller, so this module reads no clock and is exhaustively unit-testable.
 */

import { normalizeAngle, lerpAngle } from "./yaw";
import { EXTRAPOLATE_MAX_MS, SNAPSHOT_CAPACITY, SNAP_DISTANCE } from "./constants";

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
 * - renderT past the newest → extrapolate at the last segment's velocity for at
 *   most EXTRAPOLATE_MAX_MS, then freeze in place (speed 0 → reads as idle).
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
 * Dead-reckon past the newest snapshot using the last segment's velocity,
 * capped at EXTRAPOLATE_MAX_MS then frozen. A single snapshot (or a zero-length
 * segment) simply holds position.
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
  const capped = Math.min(ahead, EXTRAPOLATE_MAX_MS);
  const vx = (newest.x - prev.x) / span; // m per ms
  const vz = (newest.z - prev.z) / span;
  const wYaw = normalizeAngle(newest.yaw - prev.yaw) / span; // rad per ms

  const x = newest.x + vx * capped;
  const z = newest.z + vz * capped;
  const yaw = normalizeAngle(newest.yaw + wYaw * capped);
  // Within the extrapolation window we're still "moving"; once frozen past the
  // cap the avatar holds position and reads as idle.
  const speed = ahead <= EXTRAPOLATE_MAX_MS ? Math.hypot(vx, vz) * 1000 : 0;
  return { x, z, yaw, speed };
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
