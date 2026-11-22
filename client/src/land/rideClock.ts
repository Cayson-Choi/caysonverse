/**
 * The clock the rides are DRAWN on (rides audit 2026-11-20): the village's live clock (the server's, villageClock.liveMs), with two things added.
 *
 *  - One instant per frame. The vehicle (each *World.tsx), my avatar in its seat (LocalPlayer via rideSeats.ts), the other riders (RemotePlayer)
 *    and my first-person eye (each *Ride.ts) each used to read the clock in their own useFrame; a busy frame put up to ~10 ms between them, and on
 *    the moon boat my avatar was measured 9 cm off its seat against the drawn hull (the coaster at 30 m/s: 30 cm). Now every reader in one frame
 *    gets the same instant: the frame is told by `document.timeline.currentTime`, which stays the same through one frame's callbacks.
 *  - No jumps. A new ServerTime (every 5 minutes, and on a reconnect) moves the offset by a few tens of milliseconds (measured: 36 ms); applied at
 *    once the train or the boat skips (at 30 m/s, a metre). Here it is eased in at 5 % (50 ms per second). A move of more than a second (the
 *    first sync, a device clock changed) is taken at once.
 * The server's boarding and unloading decisions and the panel's countdown keep the raw live clock; the eased one is never more than a few tens of
 * milliseconds from it.
 */
import { villageClock } from "../village/villageClock";

const SLEW = 0.05;
const SNAP_MS = 1000;
let applied = NaN;
let lastPerf = 0;
let frameKey: number | null = null;
let frameMs = 0;

/** The eased live clock now (no per-frame latch). `perfNow` and `offset` are seams for the tests. */
export function easedLiveMs(perfNow: number = performance.now(), offset: number = villageClock.offsetMs(), deviceNow: number = Date.now()): number {
  if (!Number.isFinite(applied) || Math.abs(offset - applied) > SNAP_MS) applied = offset;
  else {
    const step = Math.max(0, perfNow - lastPerf) * SLEW;
    applied += Math.max(-step, Math.min(step, offset - applied));
  }
  lastPerf = perfNow;
  return deviceNow + applied;
}

function currentFrame(): number | null {
  if (typeof document === "undefined") return null;
  const t = document.timeline?.currentTime;
  const n = typeof t === "number" ? t : t == null ? null : Number(t);
  // a hidden tab draws no frames (the timeline stands still): no latch then, the clock runs on. The bound is generous: one slow frame on a
  // loaded machine was measured spending well over 100 ms in its callbacks, and the latch must hold across all of them.
  if (n === null || !Number.isFinite(n) || Math.abs(performance.now() - n) > 2000) return null;
  return n;
}

let override: (() => number) | null = null;
/** Tests only: drive the ride clock by hand (null: the real one again). */
export function setRideClockForTests(fn: (() => number) | null): void {
  override = fn;
}

/** The ride clock: the same value for every reader within one frame. */
export function rideMs(): number {
  if (override) return override();
  const key = currentFrame();
  if (key !== null && key === frameKey) return frameMs;
  frameMs = easedLiveMs();
  frameKey = key;
  return frameMs;
}

/** Tests only: forget the eased offset and the latched frame. */
export function resetRideClock(): void {
  applied = NaN;
  lastPerf = 0;
  frameKey = null;
  frameMs = 0;
  override = null;
}
