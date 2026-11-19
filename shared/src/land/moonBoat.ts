/**
 * 케이슨랜드 달배 (Moon Boat): the timeline and the seats. Browser-safe pure maths, like coaster.ts / carousel.ts / wheel.ts: the SERVER and every
 * CLIENT evaluate the same functions of the wall clock, so the boat is one thing everybody sees; the server only keeps who sits where.
 *
 * Park-local frame (parkArea.ts). A crescent-moon boat (cream hull, a sleeping moon-rabbit on its bow horn) hangs from a horizontal axle on a tall
 * A-frame and swings like a pendulum along its own length, in the y-z plane (z south). The axle runs east-west (along x) at PIVOT_Y above MOON_BOAT_SITE.
 * Boat frame: origin at the axle, y up, z toward the bow (south at rest), x across. The hull's two horns rise out of the keel; 32 seats stand on
 * eight flat terraces in the hull's bowl (seat = row * 4 + column, row 0 at the bow), all facing the bow.
 *
 * Ride: 5 s unloading, 29 s boarding, 6 s gate, then 110 s of swinging: the amplitude builds to 82 degrees over 70 s, holds, and is braked in the last
 * 25 s; the swing has a fixed period (a real pendulum's), so angle(t) = amplitude(t) * sin(2 pi t / period). One cycle is 150 s. The axle stands 30 m up on a steel A-frame (arm 28.4 m), the period is 11 s.
 */

export const MOON_BOAT_SITE = Object.freeze({ x: -95, z: -140 });
export const MOON_BOAT_SEATS = 32;
export const MOON_BOAT_COLS = 4;
export const MOON_BOAT_ROWS = 8;

/** The axle's height over the ground and the arm length down to the keel (m). */
export const MOON_PIVOT_Y = 30;
export const MOON_ARM_L = 28.4;
/** The hull: half length to the horn tips (z), half width (x), the keel's thickness at the middle and the horns' height over the keel. */
export const MOON_HULL = Object.freeze({ halfZ: 7.2, halfX: 2.2, keelT: 0.55, horn: 2.2 });
/** The seats: column spacing (x), row spacing (z), the front row's z, the cushion's height over the terrace. */
export const MOON_SEAT = Object.freeze({ dx: 0.85, dz: 1.0, z0: 3.6, cushion: 0.5, eye: 0.9 });
/** The frame's feet and legs. */
export const MOON_FRAME = Object.freeze({ legX: 4.7, footZ: 15, armX: 2.45, chord: 0.55, chordR: 0.2 });

export const MOON_MAX_ANGLE = (82 * Math.PI) / 180;
export const MOON_PERIOD_S = 11;
export const MOON_OMEGA = (2 * Math.PI) / MOON_PERIOD_S;
const BUILD_S = 70;
const BRAKE_S = 25;

export const MOON_UNLOAD_MS = 5000;
export const MOON_DWELL_MS = 40_000;
export const MOON_GATE_MS = 6000;
export const MOON_RIDE_MS = 110_000;
export const MOON_CYCLE_MS = MOON_DWELL_MS + MOON_RIDE_MS;
const RIDE_S = MOON_RIDE_MS / 1000;

const sstep = (u: number): number => u * u * (3 - 2 * u);
const sstep1 = (u: number): number => 6 * u * (1 - u);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The swing's amplitude (rad) and its rate of change, `t` seconds into the ride. */
export function moonAmplitude(t: number): number {
  if (t <= 0 || t >= RIDE_S) return 0;
  return MOON_MAX_ANGLE * sstep(clamp01(t / BUILD_S)) * sstep(clamp01((RIDE_S - t) / BRAKE_S));
}
function moonAmplitudeRate(t: number): number {
  if (t <= 0 || t >= RIDE_S) return 0;
  const u1 = clamp01(t / BUILD_S);
  const u2 = clamp01((RIDE_S - t) / BRAKE_S);
  const d1 = t < BUILD_S ? sstep1(u1) / BUILD_S : 0;
  const d2 = RIDE_S - t < BRAKE_S ? -sstep1(u2) / BRAKE_S : 0;
  return MOON_MAX_ANGLE * (d1 * sstep(u2) + sstep(u1) * d2);
}

export type MoonBoatPhase = "unloading" | "boarding" | "gate" | "riding";

export interface MoonBoatState {
  cycle: number;
  /** ms since this cycle began */
  phase: number;
  status: MoonBoatPhase;
  /** the swing angle (rad; positive = the keel goes toward +z, the bow rises) */
  angle: number;
  /** angular speed (rad/s) and acceleration (rad/s^2) */
  omega: number;
  alpha: number;
  /** seconds into the ride (0 while loading) */
  rideT: number;
  departsInMs: number;
}

const fresh = (): MoonBoatState => ({ cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, rideT: 0, departsInMs: 0 });

/** The boat at wall-clock `nowMs`. It hangs still while loading. */
export function moonBoatAt(nowMs: number, out: MoonBoatState = fresh()): MoonBoatState {
  const cycle = Math.floor(nowMs / MOON_CYCLE_MS);
  const phase = nowMs - cycle * MOON_CYCLE_MS;
  out.cycle = cycle;
  out.phase = phase;
  if (phase < MOON_DWELL_MS) {
    out.status = phase < MOON_UNLOAD_MS ? "unloading" : phase < MOON_DWELL_MS - MOON_GATE_MS ? "boarding" : "gate";
    out.angle = 0;
    out.omega = 0;
    out.alpha = 0;
    out.rideT = 0;
    out.departsInMs = MOON_DWELL_MS - phase;
  } else {
    const t = (phase - MOON_DWELL_MS) / 1000;
    const a = moonAmplitude(t);
    const ar = moonAmplitudeRate(t);
    const s = Math.sin(MOON_OMEGA * t);
    const c = Math.cos(MOON_OMEGA * t);
    out.status = "riding";
    out.angle = a * s;
    out.omega = ar * s + a * MOON_OMEGA * c;
    // the amplitude's own change rate is slow: its second derivative is left out (about 1 percent of the swing's)
    out.alpha = 2 * ar * MOON_OMEGA * c - a * MOON_OMEGA * MOON_OMEGA * s;
    out.rideT = t;
    out.departsInMs = MOON_CYCLE_MS - phase + MOON_DWELL_MS;
  }
  return out;
}

/** The terrace's floor (boat frame y) at `z`: the hull's inner curve. */
export function moonFloorY(z: number): number {
  const u = z / MOON_HULL.halfZ;
  return -MOON_ARM_L + MOON_HULL.keelT + (MOON_HULL.horn - MOON_HULL.keelT) * u * u;
}
/** The hull's outer (keel) curve. */
export function moonKeelY(z: number): number {
  const u = z / MOON_HULL.halfZ;
  return -MOON_ARM_L + MOON_HULL.horn * u * u;
}

/**
 * The order the rows fill: from the middle of the boat outward (row 0 is at the bow). A rider in the middle looks over the backs of the rows ahead
 * (a seat in front of you, the deck a small part of the view) and feels the swing most; the bow row, with only the bowl in front, fills late.
 */
export const MOON_ROW_ORDER: readonly number[] = Object.freeze([3, 4, 2, 5, 1, 6, 0, 7]);

/** Which row and column a seat is on (row 0 at the bow). */
export function moonSeatCell(seat: number): { row: number; col: number } {
  const s = Math.max(0, Math.min(MOON_BOAT_SEATS - 1, Math.floor(seat)));
  return { row: MOON_ROW_ORDER[Math.floor(s / MOON_BOAT_COLS)]!, col: s % MOON_BOAT_COLS };
}

/** A seat's cushion point in the boat frame (x across, y up, z toward the bow). */
export function moonSeatLocal(seat: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const { row, col } = moonSeatCell(seat);
  const z = MOON_SEAT.z0 - row * MOON_SEAT.dz;
  out[0] = (col - (MOON_BOAT_COLS - 1) / 2) * MOON_SEAT.dx;
  out[1] = moonFloorY(z) + MOON_SEAT.cushion;
  out[2] = z;
  return out;
}

/** A point of the boat frame in the park, with the boat swung by `angle` (about the axle, along x). */
export function moonToWorld(lx: number, ly: number, lz: number, angle: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.x = MOON_BOAT_SITE.x + lx;
  out.y = MOON_PIVOT_Y + ly * c + lz * s;
  out.z = MOON_BOAT_SITE.z + lz * c - ly * s;
  return out;
}

/**
 * The g-load on a rider in this swing (multiples of g, along the arm): cos(angle) + L * omega^2 / g. About 0.57 at the 55 degree turning points
 * (nearly weightless: the seat barely presses) and about 2 g through the bottom.
 */
export function moonGLoad(st: MoonBoatState): number {
  return Math.cos(st.angle) + (MOON_ARM_L * st.omega * st.omega) / 9.81;
}

export interface MoonSeatPose {
  /** the cushion point (hips), park metres */
  x: number;
  y: number;
  z: number;
  /** the facing (the bow direction, swung) and the seat's up, unit vectors */
  fy: number;
  fz: number;
  uy: number;
  uz: number;
  angle: number;
  gload: number;
}

const SCRATCH: MoonBoatState = fresh();
const LOC: [number, number, number] = [0, 0, 0];
const WP = { x: 0, y: 0, z: 0 };

/** The seat's pose at wall-clock `nowMs`. */
export function moonSeatPose(seat: number, nowMs: number, out: MoonSeatPose = { x: 0, y: 0, z: 0, fy: 0, fz: 1, uy: 1, uz: 0, angle: 0, gload: 1 }): MoonSeatPose {
  const st = moonBoatAt(nowMs, SCRATCH);
  moonSeatLocal(seat, LOC);
  moonToWorld(LOC[0], LOC[1], LOC[2], st.angle, WP);
  const c = Math.cos(st.angle);
  const s = Math.sin(st.angle);
  out.x = WP.x;
  out.y = WP.y;
  out.z = WP.z;
  // the bow direction (0,0,1) and the up (0,1,0) of the boat frame, swung
  out.fy = s;
  out.fz = c;
  out.uy = c;
  out.uz = -s;
  out.angle = st.angle;
  out.gload = moonGLoad(st);
  return out;
}

export const MOON_BOAT_BOARDING_REACH_M = 6;
