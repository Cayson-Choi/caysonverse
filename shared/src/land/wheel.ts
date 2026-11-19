/**
 * 케이슨랜드 하늘 등불 바퀴 (Sky Lantern Wheel): the timeline and the seats. Browser-safe pure maths (like coaster.ts / carousel.ts): the SERVER and every
 * CLIENT evaluate the same functions of the wall clock; the server only keeps who sits where.
 *
 * Park-local frame (parkArea.ts). A wheel 44 m across stands in the plane z = WHEEL_SITE.z (x east, y up), hub at 26 m; eight enclosed lantern gondolas
 * (four seats each: seats g*4 + k) hang on arms 3.4 m SOUTH of the wheel plane (the rim trusses are behind the riders, who face south). It turns clockwise
 * seen from the south, ALWAYS and at a constant speed: one revolution takes 2 min 30 s (the bottom of the rim creeps by at 0.92 m/s), like the slow observation
 * wheels: nobody waits for it to stop. A gondola reaches the boarding platform every 18.75 s (one eighth of a turn); while its door is within 3 m of the
 * platform's middle (6.5 s) the station is BOARDING: the riders of the gondola that came round get off and the next ones step on, the gondola creeping by.
 * A rider stays one full revolution (eight passes) and is put off when the same gondola is back at the platform. The gondolas hang level (never swing or tilt).
 */

export const WHEEL_SITE = Object.freeze({ x: 205, z: -140 });
export const WHEEL_R = 22;
export const WHEEL_HUB_Y = 26;
export const WHEEL_N = 8;
export const WHEEL_SEATS_PER = 4;
export const WHEEL_SEATS = WHEEL_N * WHEEL_SEATS_PER;
export const WHEEL_STEP = (Math.PI * 2) / WHEEL_N;

/** One revolution (ms) and the time between two gondolas reaching the platform (a cycle: one eighth of a turn). */
export const WHEEL_REV_MS = 150_000;
export const WHEEL_STEP_MS = WHEEL_REV_MS / WHEEL_N;
/** The wheel's turning speed (rad/s) and the speed of the rim's lowest point (m/s). */
export const WHEEL_OMEGA = (Math.PI * 2) / (WHEEL_REV_MS / 1000);
export const WHEEL_BOTTOM_SPEED = WHEEL_OMEGA * WHEEL_R;
/** The loading window: while a gondola's pivot is within this many metres (along x) of the platform's middle, riders may step on and off. */
export const WHEEL_BOARD_REACH_M = 3;
export const WHEEL_BOARD_HALF_MS = (WHEEL_BOARD_REACH_M / WHEEL_BOTTOM_SPEED) * 1000;
/** The cycle (pass) count of one ride: a full revolution. */
export const WHEEL_RIDE_CYCLES = WHEEL_N;

/** The gondola's floor and seats, in its own frame (y down from the pivot): the same numbers as tools/land/make_wheel.py. */
export const GONDOLA_FLOOR_Y = -3.04;
export const GONDOLA_SEAT_Y = -2.53;
/** The cabin's centre lies this far south of the pivot (m; 3.4 keeps the roof's north edge 0.24 m clear of the south rim's bulbs); its bench runs along the north wall: seat k at x = (k - 1.5) * 0.75, z = CZ - 0.5, facing south. */
export const GONDOLA_CZ = 3.4;
export const GONDOLA_SEAT_DZ = -0.5;
export const GONDOLA_SEAT_DX = 0.75;

export type WheelPhase = "boarding" | "riding";
export interface WheelState {
  /** the pass count: cycle k begins when a gondola's door comes within reach of the platform (the window opens), `phase` ms later the window closes */
  cycle: number;
  /** ms since this cycle began */
  phase: number;
  /** "boarding" while a gondola is at the platform (6.5 s every 18.75 s), "riding" otherwise */
  status: WheelPhase;
  /** the wheel's angle (rad, clockwise seen from the south = increasing; it never stops) */
  angle: number;
  /** turning speed (rad/s): constant */
  omega: number;
  /** angular acceleration (rad/s^2): zero */
  alpha: number;
  /** ms to the window's close (boarding) or to the next window's opening (riding) */
  departsInMs: number;
}

const SCRATCH: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: WHEEL_OMEGA, alpha: 0, departsInMs: 0 };

export function wheelAt(nowMs: number, out: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, departsInMs: 0 }): WheelState {
  // pass k is centred on t = k * step (the gondola at the bottom, at the platform's middle); its window runs from k*step - half to k*step + half
  const shifted = nowMs + WHEEL_BOARD_HALF_MS;
  const cycle = Math.floor(shifted / WHEEL_STEP_MS);
  const phase = shifted - cycle * WHEEL_STEP_MS;
  out.cycle = cycle;
  out.phase = phase;
  out.angle = (nowMs / WHEEL_REV_MS) * Math.PI * 2;
  out.omega = WHEEL_OMEGA;
  out.alpha = 0;
  if (phase < 2 * WHEEL_BOARD_HALF_MS) {
    out.status = "boarding";
    out.departsInMs = 2 * WHEEL_BOARD_HALF_MS - phase;
  } else {
    out.status = "riding";
    out.departsInMs = WHEEL_STEP_MS - phase;
  }
  return out;
}

/** The gondola at the bottom platform in pass `cycle` (gondola g stands at angle g*step + the wheel's angle; the bottom is the angle pi). */
export function wheelBottomGondola(cycle: number): number {
  return (((WHEEL_N / 2 - cycle) % WHEEL_N) + WHEEL_N) % WHEEL_N;
}

/** The four seats a boarding rider may take at `nowMs`: the gondola at the platform (RideDef.boardingSeats). */
export function boardingSeatsOfWheel(nowMs: number): number[] {
  const g = wheelBottomGondola(wheelAt(nowMs, SCRATCH).cycle);
  return [0, 1, 2, 3].map((k) => g * WHEEL_SEATS_PER + k);
}

/** Whether `seat`'s gondola is at the platform (a rider may get off) at `nowMs` (RideDef.canLeave). */
export function wheelSeatAtPlatform(seat: number, nowMs: number): boolean {
  const s = wheelAt(nowMs, SCRATCH);
  if (s.status !== "boarding") return false;
  return Math.floor(seat / WHEEL_SEATS_PER) === wheelBottomGondola(s.cycle);
}

/** The gondola's pivot (park metres) with the wheel at `angle`. */
export function wheelPivot(g: number, angle: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const phi = g * WHEEL_STEP + angle;
  out.x = WHEEL_SITE.x + WHEEL_R * Math.sin(phi);
  out.y = WHEEL_HUB_Y + WHEEL_R * Math.cos(phi);
  out.z = WHEEL_SITE.z;
  return out;
}

/** The gondolas hang level: they never swing or tilt, for anyone, from any side (owner 2026-11-19). Kept as a function for its callers. */
export function wheelSway(_g: number, _st: WheelState): number {
  return 0;
}

const PIV = { x: 0, y: 0, z: 0 };

export interface WheelSeatPose {
  /** the seat's root (hips on the cushion), park metres */
  x: number;
  y: number;
  z: number;
  /** the facing: a unit vector on the ground (south) */
  fx: number;
  fz: number;
  /** the cabin's tilt (rad about z): always 0 */
  sway: number;
  gondola: number;
  pivotX: number;
  pivotY: number;
}

/** The seat's pose at wall-clock `nowMs`. */
export function wheelSeatPose(seat: number, nowMs: number, out: WheelSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, sway: 0, gondola: 0, pivotX: 0, pivotY: 0 }): WheelSeatPose {
  const st = wheelAt(nowMs, SCRATCH);
  const g = Math.floor(seat / WHEEL_SEATS_PER) % WHEEL_N;
  const k = seat % WHEEL_SEATS_PER;
  wheelPivot(g, st.angle, PIV);
  const p = PIV;
  const sway = wheelSway(g, st);
  const lx = (k - 1.5) * GONDOLA_SEAT_DX;
  const lz = GONDOLA_CZ + GONDOLA_SEAT_DZ;
  const ly = GONDOLA_SEAT_Y;
  const c = Math.cos(sway);
  const s = Math.sin(sway);
  out.x = p.x + lx * c - ly * s;
  out.y = p.y + lx * s + ly * c;
  out.z = p.z + lz;
  out.fx = 0;
  out.fz = 1;
  out.sway = sway;
  out.gondola = g;
  out.pivotX = p.x;
  out.pivotY = p.y;
  return out;
}
