/**
 * Snapshot interpolation (pure). Remote players are rendered from a buffered
 * history of `{t, x, z, yaw}` snapshots, sampled at a render time that trails the
 * newest data (playout.ts decides it), so there is a bracketing pair to
 * interpolate between. `t` is on the remote's timeline — the mover's own clock
 * when the server echoes it, else the local receive time — injected by the caller,
 * so this module reads no clock and is exhaustively unit-testable.
 *
 * There is NO extrapolation: past the newest snapshot the avatar holds the newest
 * (authoritative) pose. Dead-reckoning past it is what made remote players run
 * ahead on every stop and late patch and then slide back (fix/remote-move-snapback).
 */

import { MOVE_SPEED } from "@caysonverse/shared/constants";
import { lerpAngle, normalizeAngle } from "./yaw";
import {
  RESTING_SPAN_MS,
  RESTING_SPEED,
  SNAPSHOT_CAPACITY,
  SNAP_DISTANCE,
  SPEED_LONG_MIN_MS,
  SPEED_LONG_WINDOW_MS,
  SPEED_WINDOW_MS,
  TURN_SPEED,
} from "./constants";

/** One received position sample. `t` is on the remote's timeline (see the module header). */
export interface Snapshot {
  t: number;
  x: number;
  z: number;
  yaw: number;
  /**
   * The server PUT the avatar here (a seat, a seat's dismount spot) instead of it walking here: the avatar is not
   * walked to it. It holds the previous pose (position and facing) until the render time reaches this one, and the
   * seat motion (remoteSeat.ts) carries it on from there — a glide onto a bench, a snap onto a legacy chair.
   */
  placed?: boolean;
}

/** Result of sampling the buffer at a render time. */
export interface Sample {
  x: number;
  z: number;
  yaw: number;
  /**
   * Instantaneous speed (m/s) of the bracketing segment (diagnostic: it is noisy
   * under delivery jitter). The idle/walk/run decision uses `remoteGaitSpeed`.
   */
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
 * Whether two consecutive snapshots are a RESTING stretch (a stop and the next start,
 * or a join and the first move) rather than continuous motion: slower than
 * RESTING_SPEED, or further apart than RESTING_SPAN_MS on the timeline.
 */
export function isResting(a: Snapshot, b: Snapshot): boolean {
  const span = b.t - a.t;
  if (span <= 0) return false;
  if (b.placed) return true; // nothing walks to a placed pose: the avatar stands on `a` until it
  return span > RESTING_SPAN_MS || (Math.hypot(b.x - a.x, b.z - a.z) / span) * 1000 < RESTING_SPEED;
}

/**
 * When the motion between two consecutive snapshots starts (timeline ms). A moving
 * pair moves the whole way: `a.t`. A resting pair (`isResting`) stood still at `a` and
 * stepped off at MOVE_SPEED just in time to reach `b`: `b.t - |ab| / MOVE_SPEED`
 * (never before `a.t`: a long hop simply moves the whole way). A placed `b` is not
 * walked to at all: `b.t`.
 */
export function restTailStart(a: Snapshot, b: Snapshot): number {
  if (!isResting(a, b)) return a.t;
  if (b.placed) return b.t;
  return Math.max(a.t, b.t - (Math.hypot(b.x - a.x, b.z - a.z) / MOVE_SPEED) * 1000);
}

/**
 * When the facing starts to turn between two consecutive snapshots (timeline ms). A pair of consecutive moves (one
 * send interval apart) turns across the whole pair, so a turn on the spot (pushing against a wall) stays smooth. A
 * PAUSE (a pair further apart than RESTING_SPAN_MS: a stop, then the next start) stood still facing `a.yaw` and
 * turns only before it steps off: over its step-off, or at TURN_SPEED (the rate the mover's own body turns at) if
 * the turn takes longer than that — never across the whole pause, which turned a resting avatar most of the way
 * round in the one frame the render time skipped the pause. A placed `b` holds `a.yaw` up to it.
 */
export function turnStart(a: Snapshot, b: Snapshot): number {
  if (!isResting(a, b)) return a.t;
  if (b.placed) return b.t;
  if (b.t - a.t <= RESTING_SPAN_MS) return a.t;
  const turnMs = (Math.abs(normalizeAngle(b.yaw - a.yaw)) / TURN_SPEED) * 1000;
  return Math.max(a.t, Math.min(restTailStart(a, b), b.t - turnMs));
}

/** From when on anything about the avatar (position or facing) changes between two consecutive snapshots. */
export function motionStart(a: Snapshot, b: Snapshot): number {
  return Math.min(restTailStart(a, b), turnStart(a, b));
}

/**
 * Sample the buffer at `renderT` (the playout clock's render time). Returns null
 * only for an empty buffer.
 *
 * - renderT before the oldest snapshot → clamp to the oldest (idle).
 * - renderT between two snapshots → linear x/z, shortest-arc yaw (a resting pair:
 *   the first pose, then a turn and linear x/z over its step-off — see `restTailStart`
 *   and `turnStart`; a placed second pose: the first pose up to it).
 * - renderT at/past the newest → hold the newest pose (speed 0). Never beyond it:
 *   the drawn avatar only ever stands where the server has already put it.
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
    return { x: newest.x, z: newest.z, yaw: newest.yaw, speed: 0 };
  }

  // Find the bracketing pair (searching from the newest end — the common case).
  for (let i = n - 1; i > 0; i--) {
    const a = snapshots[i - 1];
    const b = snapshots[i];
    if (renderT >= a.t && renderT <= b.t) {
      // A placed pose is not walked to: the previous pose holds up to it.
      if (b.placed) return renderT < b.t ? { x: a.x, z: a.z, yaw: a.yaw, speed: 0 } : { x: b.x, z: b.z, yaw: b.yaw, speed: 0 };
      // Facing turns across the whole of a moving pair, and only before the step-off of a resting one (turnStart);
      // the position moves from the step-off on (the whole pair unless it is a resting one).
      const turn = turnStart(a, b);
      const yaw = renderT <= turn ? a.yaw : lerpAngle(a.yaw, b.yaw, (renderT - turn) / (b.t - turn));
      const from = restTailStart(a, b);
      if (renderT <= from && from > a.t) return { x: a.x, z: a.z, yaw, speed: 0 };
      const span = b.t - from;
      const f = span > 0 ? (renderT - from) / span : 0;
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const speed = span > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / (span / 1000) : 0;
      return { x, z, yaw, speed };
    }
  }

  // Unreachable given the guards above, but stay defined rather than throw.
  return { x: newest.x, z: newest.z, yaw: newest.yaw, speed: 0 };
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

/**
 * The ground speed (m/s) travelled along the buffered path over the trailing
 * `windowMs` of render time, i.e. the length of the interpolated polyline between
 * `renderT - windowMs` and `renderT`, divided by the window (or by `minDivisorMs`
 * if the buffered part of the window is shorter than that).
 *
 * Path length rather than net displacement, so a runner circling at full speed
 * still reads as running. Only the buffered span counts: both ends of the window
 * are clipped to [oldest.t, newest.t], so time past the newest snapshot (the
 * avatar holding its last pose) contributes nothing. Dividing by the full window
 * makes the reading ramp up over it at the start of a move and decay to 0 over it
 * after a stop. Allocates nothing. The pose (`sample`) is unaffected - this only
 * feeds the gait.
 */
export function windowedSpeed(
  snapshots: readonly Snapshot[],
  renderT: number,
  windowMs: number,
  minDivisorMs: number = windowMs,
): number {
  const n = snapshots.length;
  if (n < 2 || windowMs <= 0) return 0;
  const first = snapshots[0].t;
  const last = snapshots[n - 1].t;
  const startT = renderT - windowMs;
  const from = startT < first ? first : startT > last ? last : startT;
  const to = renderT < first ? first : renderT > last ? last : renderT;
  if (to <= from) return 0;

  let length = 0;
  for (let i = 1; i < n; i++) {
    const a = snapshots[i - 1];
    const b = snapshots[i];
    const span = b.t - a.t;
    if (span <= 0 || b.t <= from || a.t >= to || b.placed) continue; // a placed pose is not walked to
    const lo = a.t > from ? a.t : from;
    const hi = b.t < to ? b.t : to;
    length += Math.hypot(b.x - a.x, b.z - a.z) * ((hi - lo) / span);
  }
  const divisor = to - from > minDivisorMs ? to - from : minDivisorMs;
  return length / (divisor / 1000);
}

/**
 * The speed (m/s) the remote idle/walk/run decision runs on: the smaller of the
 * short-window reading (responsive: ramps and decays over SPEED_WINDOW_MS) and the
 * long-window reading (SPEED_LONG_WINDOW_MS, which contains a whole stall-then-
 * catch-up burst that the short window alone reads as a sprint). A real runner
 * reads ~RUN_SPEED on both; a walker hit by a delivery burst only on the short one.
 */
export function remoteGaitSpeed(snapshots: readonly Snapshot[], renderT: number): number {
  const short = windowedSpeed(snapshots, renderT, SPEED_WINDOW_MS);
  const long = windowedSpeed(snapshots, renderT, SPEED_LONG_WINDOW_MS, SPEED_LONG_MIN_MS);
  return short < long ? short : long;
}
