/**
 * 케이슨랜드 달빛 회전목마 (Moonlight Carousel): the timeline and the seats. Browser-safe pure maths, like coaster.ts: the SERVER and every CLIENT
 * evaluate the same functions of the wall clock, so the carousel is one thing everybody sees; the server only keeps who sits where.
 *
 * Park-local frame (parkArea.ts). A round platform of radius 12.5 m turns clockwise seen from above; its three rings carry 24 seats:
 *   ring 0 (outer, radius 9.6 m):   12 horses, seats 0..11
 *   ring 1 (middle, radius 6.6 m):   8 horses, seats 12..19
 *   ring 2 (inner, radius 3.8 m):    2 carriages of two seats, seats 20..23
 * The horses rise and fall on brass poles (alternate ones in step), faster with the turning. The ride: 5 s unloading, 19 s boarding, 6 s gate,
 * then 110 s: 10 s getting up to speed, 85 s at 4 rpm, 15 s slowing; one cycle is 140 s.
 */

export const CAROUSEL_CENTER = Object.freeze({ x: 110, z: -135 });
export const CAROUSEL_RADIUS = 12.5;
/** The platform's deck height (m) and the canopy's rim height. */
export const CAROUSEL_DECK_Y = 0.55;
export const CAROUSEL_CANOPY_Y = 8.6;
export const CAROUSEL_OMEGA_MAX = (4 * 2 * Math.PI) / 60; // 4 rpm (rad/s)

export const CAROUSEL_RINGS = Object.freeze([
  { radius: 9.6, seats: 12, first: 0, kind: "horse" as const },
  { radius: 6.6, seats: 8, first: 12, kind: "horse" as const },
  { radius: 3.8, seats: 4, first: 20, kind: "carriage" as const },
]);
export const CAROUSEL_SEATS = 24;

export const CAROUSEL_UNLOAD_MS = 5000;
export const CAROUSEL_DWELL_MS = 30_000;
export const CAROUSEL_GATE_MS = 6000;
export const CAROUSEL_RIDE_MS = 110_000;
export const CAROUSEL_CYCLE_MS = CAROUSEL_DWELL_MS + CAROUSEL_RIDE_MS;
const RAMP_UP_S = 10;
const RAMP_DOWN_S = 15;
const RIDE_S = CAROUSEL_RIDE_MS / 1000;

/** The bobbing: amplitude (m) and period (s). */
export const HORSE_BOB = Object.freeze({ amp: 0.34, period: 4.2 });

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Turning speed (rad/s) `t` seconds into the ride. */
export function carouselOmega(t: number): number {
  if (t <= 0 || t >= RIDE_S) return 0;
  return CAROUSEL_OMEGA_MAX * smooth(t / RAMP_UP_S) * smooth((RIDE_S - t) / RAMP_DOWN_S);
}

/** The angle (rad) turned `t` seconds into the ride: the integral of the speed (closed form of the two smoothstep ramps and the plateau, numerically exact enough: 50 ms steps, cached). */
const STEP = 0.05;
const TABLE: Float64Array = (() => {
  const n = Math.ceil(RIDE_S / STEP) + 1;
  const a = new Float64Array(n);
  for (let i = 1; i < n; i++) a[i] = a[i - 1]! + 0.5 * (carouselOmega((i - 1) * STEP) + carouselOmega(i * STEP)) * STEP;
  return a;
})();
export const CAROUSEL_RIDE_ANGLE = TABLE[TABLE.length - 1]!;

export function carouselAngleInRide(t: number): number {
  if (t <= 0) return 0;
  if (t >= RIDE_S) return CAROUSEL_RIDE_ANGLE;
  const f = t / STEP;
  const i = Math.floor(f);
  return TABLE[i]! + (TABLE[i + 1]! - TABLE[i]!) * (f - i);
}

export type CarouselPhase = "unloading" | "boarding" | "gate" | "riding";

export interface CarouselState {
  cycle: number;
  /** ms since this cycle began */
  phase: number;
  status: CarouselPhase;
  /** the platform's angle (rad, clockwise from above = increasing) */
  angle: number;
  /** turning speed (rad/s) */
  omega: number;
  /** seconds into the ride (0 while loading) */
  rideT: number;
  departsInMs: number;
}

/** The carousel at wall-clock `nowMs`. At rest between rides it stands where the last ride left it (a whole number of rides turned). */
export function carouselAt(nowMs: number, out: CarouselState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, rideT: 0, departsInMs: 0 }): CarouselState {
  const cycle = Math.floor(nowMs / CAROUSEL_CYCLE_MS);
  const phase = nowMs - cycle * CAROUSEL_CYCLE_MS;
  const base = (cycle * CAROUSEL_RIDE_ANGLE) % (Math.PI * 2);
  out.cycle = cycle;
  out.phase = phase;
  if (phase < CAROUSEL_DWELL_MS) {
    out.status = phase < CAROUSEL_UNLOAD_MS ? "unloading" : phase < CAROUSEL_DWELL_MS - CAROUSEL_GATE_MS ? "boarding" : "gate";
    out.angle = base;
    out.omega = 0;
    out.rideT = 0;
    out.departsInMs = CAROUSEL_DWELL_MS - phase;
  } else {
    const t = (phase - CAROUSEL_DWELL_MS) / 1000;
    out.status = "riding";
    out.angle = base + carouselAngleInRide(t);
    out.omega = carouselOmega(t);
    out.rideT = t;
    out.departsInMs = CAROUSEL_CYCLE_MS - phase + CAROUSEL_DWELL_MS;
  }
  return out;
}

export interface CarouselSeatPose {
  /** world (park-local) position of the seat's root (where the rider sits: the saddle), metres */
  x: number;
  y: number;
  z: number;
  /** the facing: the direction of travel, a unit vector on the ground */
  fx: number;
  fz: number;
  /** pitch of the horse (rad, + = nose up) and its bob phase, for the avatar and camera */
  pitch: number;
  /** the angle (rad) of the seat on its ring now */
  theta: number;
  ring: 0 | 1 | 2;
}

/** Which ring and index a seat is on. */
export function carouselSeatRing(seat: number): { ring: 0 | 1 | 2; i: number } {
  if (seat < 12) return { ring: 0, i: seat };
  if (seat < 20) return { ring: 1, i: seat - 12 };
  return { ring: 2, i: seat - 20 };
}

/** The bob (m) of seat `seat` at time `tSec` since the ride began, scaled by how fast the carousel turns (still when it stands). */
export function carouselBob(seat: number, tSec: number, omega: number): number {
  const { ring, i } = carouselSeatRing(seat);
  if (ring === 2) return 0.04 * Math.sin(tSec * 1.3 + i) * (omega / CAROUSEL_OMEGA_MAX); // the carriages only sway
  const phase = (i % 2) * Math.PI + ring * 1.1;
  return HORSE_BOB.amp * (omega / CAROUSEL_OMEGA_MAX) * Math.sin((2 * Math.PI * tSec) / HORSE_BOB.period + phase);
}

const SADDLE_Y = 1.05; // a horse's saddle over the deck (m)
const CARRIAGE_SEAT_Y = 0.62;

/** The seat's pose at wall-clock `nowMs`. */
const SCRATCH_ST: CarouselState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, rideT: 0, departsInMs: 0 };

export function carouselSeatPose(seat: number, nowMs: number, out: CarouselSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, pitch: 0, theta: 0, ring: 0 }): CarouselSeatPose {
  const st = carouselAt(nowMs, SCRATCH_ST);
  const { ring, i } = carouselSeatRing(seat);
  const r = CAROUSEL_RINGS[ring]!;
  // carriages: two of two seats; a carriage's centre is at its ring angle, its two seats side by side across it
  let theta: number;
  let radius = r.radius;
  if (ring === 2) {
    const car = Math.floor(i / 2);
    theta = st.angle + car * Math.PI;
    radius = r.radius;
  } else theta = st.angle + (i / r.seats) * Math.PI * 2;
  // clockwise from above: x = cx + R sin(theta), z = cz - R cos(theta) (theta 0 = north, increasing to the east)
  const sx = Math.sin(theta);
  const sz = -Math.cos(theta);
  // the tangent (direction of travel, clockwise): (cos theta, sin theta)
  const tx = Math.cos(theta);
  const tz = Math.sin(theta);
  let x = CAROUSEL_CENTER.x + sx * radius;
  let z = CAROUSEL_CENTER.z + sz * radius;
  // a horse's brass pole passes through its withers: the saddle (the rider's seat) is 0.3 m behind the pole, which stands at the ring's radius
  if (ring !== 2) {
    x -= tx * 0.3;
    z -= tz * 0.3;
  }
  if (ring === 2) {
    const side = i % 2 === 0 ? -0.38 : 0.38; // across the carriage (along the radius)
    x += sx * side;
    z += sz * side;
  }
  const tSec = st.rideT;
  const bob = carouselBob(seat, tSec, st.omega);
  out.x = x;
  out.z = z;
  out.y = CAROUSEL_DECK_Y + (ring === 2 ? CARRIAGE_SEAT_Y : SADDLE_Y) + bob;
  out.fx = tx;
  out.fz = tz;
  // the horse's nose rises as it rises: the bob's slope
  const dt = 0.05;
  out.pitch = ring === 2 ? 0 : (carouselBob(seat, tSec + dt, st.omega) - bob) / dt * 0.18;
  out.theta = theta;
  out.ring = ring;
  return out;
}

/** Whether boarding is open at `nowMs` (the server's rule). */
export function carouselBoardingOpen(nowMs: number): boolean {
  return carouselAt(nowMs).status === "boarding";
}
