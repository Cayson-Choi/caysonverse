/**
 * Remote playout clock (pure) — WHEN along its received path each remote avatar is drawn.
 *
 * Why this exists (fix/remote-move-snapback). Remote avatars used to be drawn at `now - 150 ms` on a timeline of
 * patch ARRIVAL times, and whenever that render time ran past the newest snapshot the avatar was dead-reckoned
 * forward for up to 250 ms and then eased back. The render time ran past the newest snapshot on EVERY stop (no
 * more patches come) and on every late patch, so other players visibly ran 1-1.6 m ahead and slid back ("잠깐
 * 앞으로 갔다가 뒤로 돌아오는 버그"). And it ran past often because arrival times are a poor clock: the mover
 * sends every 100-117 ms (frame-quantized), the server groups moves into 100 ms patches, and the network adds
 * jitter, so gaps of 200-400 ms and 10 ms bursts were normal — the same gaps that made a walker look jerky.
 *
 * Now:
 *  1. The timeline is the MOVER's own clock when the server echoes it (`Player.moveT`, stamped by moveSender on
 *     the frame the mover stood at the pose). Positions are then replayed at the times they really happened —
 *     patch grouping and network jitter only decide when the data arrives, not how the walk looks. A remote
 *     with no clock (an older client or server) falls back to arrival times.
 *  2. The render time never goes past the newest snapshot (no extrapolation) and never goes backwards, so the
 *     drawn avatar only ever moves forward along the server's path and stops exactly where the server says.
 *  3. The render time trails the newest data by an ADAPTIVE lag: the largest "lag needed" seen recently — for
 *     each pair of consecutive moving snapshots, the arrival of the second minus the timeline time of the first
 *     (what renderT must stay behind for the pair to be on hand when it is drawn) — plus a small margin. A clean
 *     link gets ~200 ms, a jittery one more; a hiccup raises it at once (the avatar waits instead of jumping).
 *  4. The render time follows its target smoothly: at most 10% fast / 20% slow (a time-warp nobody notices),
 *     except across the standing part of a RESTING stretch (between a stop and the next start; see
 *     `restTailStart`), which it may skip at once — nothing on screen moves there. Only a gap over a second
 *     (a long outage) is resynced in one go.
 * Everything here is driven by injected times (no clock is read), so it is exhaustively unit-testable.
 */

import { PATCH_RATE_MS } from "@caysonverse/shared/constants";
import { isResting, motionStart, pushSnapshot, remoteGaitSpeed, type Snapshot } from "./interpolation";
import {
  PLAYOUT_ARRIVAL_SPACING,
  PLAYOUT_DEFAULT_BUFFER_MS,
  PLAYOUT_HISTORY,
  PLAYOUT_HOLD_IDLE_MS,
  PLAYOUT_MARGIN_MS,
  PLAYOUT_MAX_BUFFER_MS,
  PLAYOUT_MAX_SLOWDOWN,
  PLAYOUT_MAX_SPEEDUP,
  PLAYOUT_MIN_BUFFER_MS,
  PLAYOUT_RESYNC_MS,
  PLAYOUT_SPREAD_MARGIN,
  PLAYOUT_WARMUP,
  PLAYOUT_WARP_MS,
} from "./constants";

/** One remote's playout state (owned by its store record, mutated in place). */
export interface Playout {
  /** Where on this remote's timeline (ms) it is drawn now. NaN until the first frame. */
  renderT: number;
  /** The local time of the previous `advancePlayout` (ms). NaN until the first frame. */
  lastNowMs: number;
  /**
   * How long (ms, render time) the avatar has been held at the newest snapshot because nothing newer is on hand:
   * the remote stopped, or its data is late. The gait reads it (a held avatar is not walking).
   */
  holdMs: number;
  /** The timeline is the mover's own clock (`Player.moveT`); false = local arrival times (the fallback). */
  moverClock: boolean;
  /** The newest mover clock reading taken (ms); a reading is used only if it is newer than this. */
  lastMoverT: number;
  /** Recent `arrival - timeline time` of clock-stamped snapshots (ring, newest last): their minimum is the base lag. */
  offsets: number[];
  /** Recent "lag needed" samples of consecutive moving snapshots (ring, newest last). */
  needs: number[];
}

/**
 * A fresh playout. `knownMoverT` is the remote's `moveT` at the moment it is added: it is not a timing of
 * anything we will draw (the remote may have stopped long ago), only the reading a later patch must beat.
 */
export function createPlayout(knownMoverT = 0): Playout {
  return {
    renderT: Number.NaN,
    lastNowMs: Number.NaN,
    holdMs: 0,
    moverClock: false,
    lastMoverT: Number.isFinite(knownMoverT) ? knownMoverT : 0,
    offsets: [],
    needs: [],
  };
}

function pushRing(ring: number[], value: number): void {
  ring.push(value);
  while (ring.length > PLAYOUT_HISTORY) ring.shift();
}

function minOf(ring: readonly number[]): number {
  let m = Infinity;
  for (const v of ring) if (v < m) m = v;
  return m;
}

function maxOf(ring: readonly number[]): number {
  let m = -Infinity;
  for (const v of ring) if (v > m) m = v;
  return m;
}

/**
 * Take one received pose of the remote into its buffer, stamped on its timeline. `moverT` is the synced
 * `Player.moveT` (0 / not newer than the last reading = no usable clock: a pose the server placed, or a sender
 * without one). Returns false (and stores nothing) when nothing about the pose changed — the patch was about
 * another field (connected, area …), and a duplicate would only stretch the timeline.
 *
 * `placed`: the patch also changed the remote's seat, so the server put it here (a seat, a seat's dismount spot) —
 * the snapshot is marked so that nothing walks the avatar to it (see `Snapshot.placed`), and it is stored even when
 * the pose did not change: its time is when the seat change is drawn (remoteSeat.ts).
 */
export function receivePose(
  pl: Playout,
  buf: Snapshot[],
  arrivalMs: number,
  moverT: number,
  x: number,
  z: number,
  yaw: number,
  placed = false,
): boolean {
  const fresh = Number.isFinite(moverT) && moverT > pl.lastMoverT;
  let newest = buf[buf.length - 1];
  if (newest && !fresh && !placed && newest.x === x && newest.z === z && newest.yaw === yaw) return false;

  if (fresh && !pl.moverClock) {
    // The first clock-stamped pose: move the timeline onto the mover's clock. What we already hold (arrival
    // times) is re-stamped by this pose's offset, the render time with it, so nothing on screen jumps.
    const o = arrivalMs - moverT;
    for (const s of buf) s.t -= o;
    pl.renderT -= o;
    pl.moverClock = true;
    pl.offsets.length = 0;
    pl.needs.length = 0;
  } else if (fresh && pl.offsets.length > 0 && arrivalMs - moverT > minOf(pl.offsets) + PLAYOUT_MAX_BUFFER_MS) {
    // A clock discontinuity: this pose is stamped further behind its arrival than the fastest one by more than the
    // largest buffer the playout ever keeps. The mover's clock stood still while ours ran on (a phone's screen locked
    // for a while within the reconnect window: its monotonic clock can pause), so everything measured on the old
    // offsets is stale — kept, they would put the target that far ahead of the data, and the avatar would be drawn
    // on its newest pose all the time (step-sliding) until the ring forgets them, ~4 s. Re-anchor: learn the lag
    // anew from this pose on. (The timeline itself still only moves forward, below.)
    pl.offsets.length = 0;
    pl.needs.length = 0;
  }

  // A clock-stamped pose sits at its own time; any other at its arrival, shifted by the fastest offset seen
  // (on the arrival timeline that offset is 0).
  let t = fresh ? moverT : arrivalMs - (pl.offsets.length > 0 ? minOf(pl.offsets) : 0);
  if (fresh) pl.lastMoverT = moverT;
  newest = buf[buf.length - 1];
  if (newest && t <= newest.t) t = newest.t + 1; // the timeline only moves forward
  // Without the mover's clock, patches that arrive bunched (a late one, then the ones queued behind it) are
  // spread back out to the patch rate instead of being replayed as a 10 ms lurch.
  if (newest && !pl.moverClock) t = Math.max(t, newest.t + PATCH_RATE_MS * PLAYOUT_ARRIVAL_SPACING);
  if (fresh) pushRing(pl.offsets, arrivalMs - t);

  // A moving pair (not the gap between a stop and the next start) tells how far behind the data renderT must
  // stay: this pose arrived `arrival - newest.t` after the time the pair starts at.
  const snapshot: Snapshot = placed ? { t, x, z, yaw, placed } : { t, x, z, yaw };
  if (newest && !isResting(newest, snapshot)) pushRing(pl.needs, arrivalMs - newest.t);

  pushSnapshot(buf, snapshot);
  return true;
}

/**
 * How far behind local time (ms) the render time aims to be: the base offset (the fastest arrival, on the
 * mover's clock; 0 on the arrival timeline) plus the buffer that the recent "lag needed" samples ask for.
 */
export function targetLag(pl: Playout): number {
  const base = pl.offsets.length > 0 ? minOf(pl.offsets) : 0;
  const top = maxOf(pl.needs);
  const measured =
    pl.needs.length > 0 ? top - base + PLAYOUT_MARGIN_MS + PLAYOUT_SPREAD_MARGIN * (top - minOf(pl.needs)) : 0;
  const floor = pl.needs.length < PLAYOUT_WARMUP ? PLAYOUT_DEFAULT_BUFFER_MS : PLAYOUT_MIN_BUFFER_MS;
  return base + Math.min(PLAYOUT_MAX_BUFFER_MS, Math.max(floor, measured));
}

/**
 * Until when (timeline ms) the avatar stands still from `t` on: when the resting stretch `t` lies in starts to turn
 * or step off (`motionStart`), or the first snapshot's time before it. NaN when `t` is where it moves (a moving
 * segment, a turn, a step-off) or at/after the newest snapshot.
 */
function restingUntil(buf: readonly Snapshot[], t: number): number {
  const n = buf.length;
  if (n === 0 || t >= buf[n - 1].t) return Number.NaN;
  if (t < buf[0].t) return buf[0].t;
  for (let i = n - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (t >= a.t && t < b.t) {
      const from = motionStart(a, b);
      return t < from ? from : Number.NaN;
    }
  }
  return Number.NaN;
}

/**
 * Advance the remote's render time to local time `nowMs` and return it (NaN for an empty buffer). Never past
 * the newest snapshot, never backwards; see the module header for how it follows its target.
 */
export function advancePlayout(pl: Playout, buf: readonly Snapshot[], nowMs: number): number {
  const n = buf.length;
  if (n === 0) return Number.NaN;
  const newestT = buf[n - 1].t;
  const target = nowMs - targetLag(pl);
  const dt = Number.isFinite(pl.lastNowMs) ? Math.max(0, nowMs - pl.lastNowMs) : 0;
  pl.lastNowMs = nowMs;

  const prev = pl.renderT;
  let r: number;
  if (!Number.isFinite(prev)) {
    r = target;
  } else {
    r = prev + dt;
    const err = target - r; // > 0: further behind than the target → catch up; < 0: too close → ease off
    if (err > PLAYOUT_RESYNC_MS) {
      r = target; // a long outage (or a long rest): join the target in one go — forward only
    } else if (err > 0) {
      const restEnd = restingUntil(buf, r);
      if (Number.isFinite(restEnd)) r = Math.min(target, restEnd); // nothing moves on a resting stretch: skip it
      else r += Math.min(err / PLAYOUT_WARP_MS, PLAYOUT_MAX_SPEEDUP) * dt;
    } else if (err < 0) {
      r += Math.max(err / PLAYOUT_WARP_MS, -PLAYOUT_MAX_SLOWDOWN) * dt;
    }
  }

  if (r > newestT) {
    pl.holdMs += dt; // nothing newer on hand: hold on the newest pose (no dead reckoning)
    r = newestT;
  } else {
    pl.holdMs = 0;
  }
  if (Number.isFinite(prev) && r < prev) r = prev; // never backwards
  pl.renderT = r;
  return r;
}

/**
 * The speed (m/s) the remote's idle/walk/run decision runs on: `remoteGaitSpeed` at the render time pushed on by
 * the time it has been held (so it decays once the avatar stops), and 0 once it has been held for
 * PLAYOUT_HOLD_IDLE_MS — an avatar standing still on screen is not walking.
 */
export function playoutGaitSpeed(pl: Playout, buf: readonly Snapshot[]): number {
  if (!Number.isFinite(pl.renderT) || pl.holdMs >= PLAYOUT_HOLD_IDLE_MS) return 0;
  return remoteGaitSpeed(buf, pl.renderT + pl.holdMs);
}
