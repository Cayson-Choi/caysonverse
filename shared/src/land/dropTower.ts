/**
 * 케이슨랜드 구름 낙하탑 (Cloud Drop Tower): the timeline and the seats. Browser-safe pure maths, like coaster.ts / carousel.ts / wheel.ts: the SERVER and every
 * CLIENT evaluate the same functions of the wall clock; the server only keeps who sits where.
 *
 * Park-local frame (parkArea.ts). A square tower (2 m across, 52 m tall, a sculpted cloud crown on top) stands at DROP_SITE. A ring-shaped car rides up its
 * four faces: sixteen seats, four to a face (seat = face * 4 + k), each rider facing OUT over the park, legs dangling, shoulder harness down. Face 0 looks
 * east (toward the boarding pad), then south, west, north.
 *
 * One cycle is 60 s: 4 s unloading, 26 s boarding, 6 s gate, then 24 s of ride: a slow lift (14 s, eased) to 42 m, a hold (4.5 s: the pause that makes your
 * stomach drop), a true free fall (2.17 s at g: weightless), magnetic braking (1.66 s at 1.3 g) to the station, and a settling rest. The height is
 * the seat's hip height; everything is a pure function of the clock.
 */

export const DROP_SITE = Object.freeze({ x: -75, z: -88 });
export const DROP_TOWER_H = 52;
export const DROP_SEATS = 16;
export const DROP_SEATS_PER_FACE = 4;

/** The hip height of a seat at the station (the car's floor is flush with the platform deck, 0.9 m) and at the top hold. */
export const DROP_STATION_Y = 1.4;
export const DROP_TOP_Y = 42;
/** Where the free fall ends and the magnetic brakes take over (hip height, m). */
export const DROP_BRAKE_Y = 19;
export const DROP_G = 9.81;

/** The car: hips' radius from the tower's axis, the sideways spacing of seats on a face, the car floor under the hips, the tower's half width. */
export const DROP_CAR = Object.freeze({ hipR: 2.75, dx: 0.8, floorBelow: 0.5, towerHalf: 1.0, floorInner: 2.05, floorOuter: 3.55 });
export const DROP_DECK_Y = 0.9;
export const DROP_PLATFORM_R = 7.4;
export const DROP_PLATFORM_INNER = 3.85;

export const DROP_UNLOAD_MS = 4000;
export const DROP_DWELL_MS = 36_000;
export const DROP_GATE_MS = 6000;
export const DROP_RIDE_MS = 24_000;
export const DROP_CYCLE_MS = DROP_DWELL_MS + DROP_RIDE_MS;

export const DROP_LIFT_S = 14;
export const DROP_HOLD_S = 4.5;
/** The free fall's length (s) and its end speed (m/s), the brake's deceleration (m/s^2) and length (s). */
export const DROP_FALL_S = Math.sqrt((2 * (DROP_TOP_Y - DROP_BRAKE_Y)) / DROP_G);
export const DROP_FALL_V = DROP_G * DROP_FALL_S;
export const DROP_BRAKE_A = (DROP_FALL_V * DROP_FALL_V) / (2 * (DROP_BRAKE_Y - DROP_STATION_Y));
export const DROP_BRAKE_S = DROP_FALL_V / DROP_BRAKE_A;
const T_HOLD = DROP_LIFT_S;
const T_FALL = T_HOLD + DROP_HOLD_S;
const T_BRAKE = T_FALL + DROP_FALL_S;
const T_REST = T_BRAKE + DROP_BRAKE_S;

export type DropStage = "idle" | "lift" | "hold" | "fall" | "brake" | "rest";
export type DropPhase = "unloading" | "boarding" | "gate" | "riding";

export interface DropState {
  cycle: number;
  /** ms since this cycle began */
  phase: number;
  status: DropPhase;
  stage: DropStage;
  /** the seats' hip height (m), vertical speed (m/s, + up) and acceleration (m/s^2) */
  y: number;
  v: number;
  a: number;
  /** seconds into the ride (0 while loading) */
  rideT: number;
  departsInMs: number;
}

const fresh = (): DropState => ({ cycle: 0, phase: 0, status: "boarding", stage: "idle", y: DROP_STATION_Y, v: 0, a: 0, rideT: 0, departsInMs: 0 });

const smooth = (u: number): number => u * u * (3 - 2 * u);
const smooth1 = (u: number): number => 6 * u * (1 - u);
const smooth2 = (u: number): number => 6 - 12 * u;

/** The ride's motion `t` seconds in: height, speed, acceleration, stage. */
export function dropMotion(t: number, out: { y: number; v: number; a: number; stage: DropStage }): void {
  const span = DROP_TOP_Y - DROP_STATION_Y;
  if (t <= 0) {
    out.y = DROP_STATION_Y;
    out.v = 0;
    out.a = 0;
    out.stage = "idle";
  } else if (t < T_HOLD) {
    const u = t / DROP_LIFT_S;
    out.y = DROP_STATION_Y + span * smooth(u);
    out.v = (span * smooth1(u)) / DROP_LIFT_S;
    out.a = (span * smooth2(u)) / (DROP_LIFT_S * DROP_LIFT_S);
    out.stage = "lift";
  } else if (t < T_FALL) {
    out.y = DROP_TOP_Y;
    out.v = 0;
    out.a = 0;
    out.stage = "hold";
  } else if (t < T_BRAKE) {
    const s = t - T_FALL;
    out.y = DROP_TOP_Y - 0.5 * DROP_G * s * s;
    out.v = -DROP_G * s;
    out.a = -DROP_G;
    out.stage = "fall";
  } else if (t < T_REST) {
    const s = t - T_BRAKE;
    out.y = DROP_BRAKE_Y - DROP_FALL_V * s + 0.5 * DROP_BRAKE_A * s * s;
    out.v = -DROP_FALL_V + DROP_BRAKE_A * s;
    out.a = DROP_BRAKE_A;
    out.stage = "brake";
  } else {
    out.y = DROP_STATION_Y;
    out.v = 0;
    out.a = 0;
    out.stage = "rest";
  }
}

/** The tower at wall-clock `nowMs`. The car waits at the station while loading. */
export function dropAt(nowMs: number, out: DropState = fresh()): DropState {
  const cycle = Math.floor(nowMs / DROP_CYCLE_MS);
  const phase = nowMs - cycle * DROP_CYCLE_MS;
  out.cycle = cycle;
  out.phase = phase;
  if (phase < DROP_DWELL_MS) {
    out.status = phase < DROP_UNLOAD_MS ? "unloading" : phase < DROP_DWELL_MS - DROP_GATE_MS ? "boarding" : "gate";
    out.stage = "idle";
    out.y = DROP_STATION_Y;
    out.v = 0;
    out.a = 0;
    out.rideT = 0;
    out.departsInMs = DROP_DWELL_MS - phase;
  } else {
    const t = (phase - DROP_DWELL_MS) / 1000;
    out.status = "riding";
    dropMotion(t, out);
    out.rideT = t;
    out.departsInMs = DROP_CYCLE_MS - phase + DROP_DWELL_MS;
  }
  return out;
}

/** The g-load on a rider (multiples of g, along the body): 1 + a/g. 0 in the free fall, about 1.3 in the brakes. */
export function dropGLoad(st: { a: number }): number {
  return 1 + st.a / DROP_G;
}

/** Whether `seat` may get off now: only with the car at the station (RideDef.canLeave). */
export function dropCanLeave(_seat: number, nowMs: number): boolean {
  const s = dropAt(nowMs, SCRATCH);
  return s.status !== "riding" || s.stage === "rest";
}

/** Which face (0..3) and place on it (0..3) a seat is on. */
export function dropSeatCell(seat: number): { face: number; k: number } {
  const s = Math.max(0, Math.min(DROP_SEATS - 1, Math.floor(seat)));
  return { face: Math.floor(s / DROP_SEATS_PER_FACE), k: s % DROP_SEATS_PER_FACE };
}

/** The outward direction of a face: 0 east (+x), 1 south (+z), 2 west (-x), 3 north (-z). */
export function dropFaceDir(face: number): { x: number; z: number } {
  const a = (face % 4) * (Math.PI / 2);
  return { x: Math.cos(a), z: Math.sin(a) };
}

/** A seat's hip point in the car frame (relative to the tower's axis at the car's height 0): x, z in the park axes. */
export function dropSeatLocal(seat: number, out: [number, number] = [0, 0]): [number, number] {
  const { face, k } = dropSeatCell(seat);
  const n = dropFaceDir(face);
  // the tangent runs clockwise seen from above: (-nz, nx)
  const off = (k - (DROP_SEATS_PER_FACE - 1) / 2) * DROP_CAR.dx;
  out[0] = n.x * DROP_CAR.hipR - n.z * off;
  out[1] = n.z * DROP_CAR.hipR + n.x * off;
  return out;
}

export interface DropSeatPose {
  /** the hip point on the cushion, park metres */
  x: number;
  y: number;
  z: number;
  /** the facing: a unit vector on the ground (out over the park) */
  fx: number;
  fz: number;
  face: number;
  vy: number;
  gload: number;
  stage: DropStage;
}

const SCRATCH: DropState = fresh();
const LOC: [number, number] = [0, 0];

/** The seat's pose at wall-clock `nowMs`. */
export function dropSeatPose(seat: number, nowMs: number, out: DropSeatPose = { x: 0, y: 0, z: 0, fx: 1, fz: 0, face: 0, vy: 0, gload: 1, stage: "idle" }): DropSeatPose {
  const st = dropAt(nowMs, SCRATCH);
  dropSeatLocal(seat, LOC);
  const { face } = dropSeatCell(seat);
  const n = dropFaceDir(face);
  out.x = DROP_SITE.x + LOC[0];
  out.z = DROP_SITE.z + LOC[1];
  out.y = st.y;
  out.fx = n.x;
  out.fz = n.z;
  out.face = face;
  out.vy = st.v;
  out.gload = dropGLoad(st);
  out.stage = st.stage;
  return out;
}

export const DROP_BOARD_REACH_M = 6;
