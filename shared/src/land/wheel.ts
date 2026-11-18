/**
 * 케이슨랜드 하늘 등불 바퀴 (Sky Lantern Wheel): the timeline and the seats. Browser-safe pure maths (like coaster.ts / carousel.ts): the SERVER and every
 * CLIENT evaluate the same functions of the wall clock; the server only keeps who sits where.
 *
 * Park-local frame (parkArea.ts). A wheel 44 m across stands in the plane z = WHEEL_SITE.z (x east, y up), hub at 26 m; eight enclosed lantern gondolas
 * (four seats each: seats g*4 + k) hang on arms 3.2 m SOUTH of the wheel plane (the rim trusses are behind the riders, who face south). It turns
 * clockwise seen from the south, in STEPS of one gondola (45 degrees): each step lasts 18 s: 1.5 s unloading, 6.5 s boarding, 1.5 s gate, then 8.5 s turning
 * (eased) to the next gondola. The gondola at the bottom platform (east side) takes the next riders; a rider rides one full revolution (8 steps, 2 min 24 s)
 * and is put off when the same gondola is back at the platform.
 */

export const WHEEL_SITE = Object.freeze({ x: 205, z: -140 });
export const WHEEL_R = 22;
export const WHEEL_HUB_Y = 26;
export const WHEEL_N = 8;
export const WHEEL_SEATS_PER = 4;
export const WHEEL_SEATS = WHEEL_N * WHEEL_SEATS_PER;
export const WHEEL_STEP = (Math.PI * 2) / WHEEL_N;

export const WHEEL_STEP_MS = 18_000;
export const WHEEL_UNLOAD_MS = 1500;
export const WHEEL_BOARD_END_MS = 8000;
export const WHEEL_GATE_END_MS = 9500;
/** The cycle (step) count of one ride: a full revolution. */
export const WHEEL_RIDE_CYCLES = WHEEL_N;
const MOVE_S = (WHEEL_STEP_MS - WHEEL_GATE_END_MS) / 1000;

/** The gondola's floor and seats, in its own frame (y down from the pivot): the same numbers as tools/land/make_wheel.py. */
export const GONDOLA_FLOOR_Y = -3.04;
export const GONDOLA_SEAT_Y = -2.53;
/** The cabin's centre lies this far south of the pivot (m; 3.4 keeps the roof's north edge 0.24 m clear of the south rim's bulbs); its bench runs along the north wall: seat k at x = (k - 1.5) * 0.75, z = CZ - 0.5, facing south. */
export const GONDOLA_CZ = 3.4;
export const GONDOLA_SEAT_DZ = -0.5;
export const GONDOLA_SEAT_DX = 0.75;

export type WheelPhase = "unloading" | "boarding" | "gate" | "riding";
export interface WheelState {
  /** the step count since the epoch (the cycle) */
  cycle: number;
  /** ms since this step began */
  phase: number;
  status: WheelPhase;
  /** the wheel's angle (rad, clockwise seen from the south = increasing) */
  angle: number;
  /** turning speed (rad/s) */
  omega: number;
  /** angular acceleration (rad/s^2) */
  alpha: number;
  /** ms to the next departure (the turn's start) */
  departsInMs: number;
}

// the turn's ease: f in [0,1] -> a smoothstep (position), its first and second derivatives
const ease = (f: number): number => f * f * (3 - 2 * f);
const ease1 = (f: number): number => 6 * f * (1 - f);
const ease2 = (f: number): number => 6 - 12 * f;

const SCRATCH: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, departsInMs: 0 };

export function wheelAt(nowMs: number, out: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, departsInMs: 0 }): WheelState {
  const cycle = Math.floor(nowMs / WHEEL_STEP_MS);
  const phase = nowMs - cycle * WHEEL_STEP_MS;
  out.cycle = cycle;
  out.phase = phase;
  if (phase < WHEEL_GATE_END_MS) {
    out.status = phase < WHEEL_UNLOAD_MS ? "unloading" : phase < WHEEL_BOARD_END_MS ? "boarding" : "gate";
    out.angle = (cycle % WHEEL_N) * WHEEL_STEP;
    out.omega = 0;
    out.alpha = 0;
    out.departsInMs = WHEEL_GATE_END_MS - phase;
  } else {
    const f = (phase - WHEEL_GATE_END_MS) / (WHEEL_STEP_MS - WHEEL_GATE_END_MS);
    out.status = "riding";
    out.angle = ((cycle % WHEEL_N) + ease(f)) * WHEEL_STEP;
    out.omega = (WHEEL_STEP * ease1(f)) / MOVE_S;
    out.alpha = (WHEEL_STEP * ease2(f)) / (MOVE_S * MOVE_S);
    out.departsInMs = WHEEL_STEP_MS - phase + WHEEL_GATE_END_MS;
  }
  return out;
}

/** The gondola at the bottom platform at rest in step `cycle` (gondola g stands at angle g*step + the wheel's angle; the bottom is the angle pi). */
export function wheelBottomGondola(cycle: number): number {
  return (((WHEEL_N / 2 - cycle) % WHEEL_N) + WHEEL_N) % WHEEL_N;
}

/** The four seats a boarding rider may take at `nowMs`: the bottom gondola's (RideDef.boardingSeats). */
export function boardingSeatsOfWheel(nowMs: number): number[] {
  const g = wheelBottomGondola(Math.floor(nowMs / WHEEL_STEP_MS));
  return [0, 1, 2, 3].map((k) => g * WHEEL_SEATS_PER + k);
}

/** Whether `seat`'s gondola stands at the platform (a rider may get off) at `nowMs` (RideDef.canLeave). */
export function wheelSeatAtPlatform(seat: number, nowMs: number): boolean {
  const s = wheelAt(nowMs, SCRATCH);
  if (s.status === "riding") return false;
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

/** How far a gondola swings (rad about the z axis; positive = the cabin goes to +x): the pendulum lags the pivot's acceleration. */
export function wheelSway(g: number, st: WheelState): number {
  const phi = g * WHEEL_STEP + st.angle;
  const ax = WHEEL_R * Math.cos(phi) * st.alpha;
  return Math.max(-0.12, Math.min(0.12, (-ax / 9.81) * 0.9));
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
  /** the cabin's swing (rad about z) */
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
