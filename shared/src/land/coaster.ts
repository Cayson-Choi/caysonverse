/**
 * 케이슨랜드 — 별똥별 급행 (Shooting Star Express), the park's steel roller coaster: the track, the physics and the schedule.
 * Browser-safe, pure maths (no three.js): the SERVER and every CLIENT evaluate the same functions, so a ride is one timeline
 * everyone sees, not a stream of positions.
 *
 *  - TRACK: a closed circuit built from analytic pieces by a turtle (station, chain lift, crest, 60 degree drop, pull-out, an
 *    airtime hill, a vertical loop, a banked 180 degree turn, camelback hills, a second turn, the brake run). It closes exactly
 *    (the lift's length and the return straight's are solved), then is resampled by arc length and lightly smoothed.
 *    An ORIGINAL layout; it copies no real park's ride.
 *  - FRAME: tangent / up / right per sample. Up is parallel-transported (so a loop never flips), plus a bank roll that makes the
 *    lateral force vanish at the nominal speed, plus a linear twist so the up vector closes.
 *  - SPEED: energy (lift chain, then free roll with rolling + air loss), a launch ramp out of the station and a brake profile
 *    into it (a backward pass), then a time table over the arc length.
 *  - SCHEDULE: one train, one lap per CYCLE_MS on the wall clock (the village clock the server sends): unload, load, ride.
 *
 * Seat ids are NOT used here; ride seats are `Player.rideSeat` (0 .. COASTER_SEATS-1), see docs/designs/caysonland/DESIGN.md.
 */

export const G = 9.81;

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const rad = (d: number): number => (d * Math.PI) / 180;

// ───────────────────────────────────────── the layout (turtle) ─────────────────────────────────────────

/** Where the platform's rail is above the ground (m). */
export const STATION_Y = 1.5;
/** The loop and the turns (m). */
const LOOP = { R: 12, d: 2.83, w: 4 } as const;
const TURN1_R = 30;
const TURN2_R = TURN1_R + LOOP.w / 2;
/** The brake run's length from the second turn's exit to the station's middle (m). */
const BRAKE_RUN = 92;

interface Turtle {
  p: V3;
  yaw: number; // 0 = +x, positive turns toward +z (a right turn, looking along +x)
  pitch: number;
  pts: V3[];
  /** named places on the circuit (positions), found again on the resampled ring */
  marks: { name: string; p: V3 }[];
}

function forward(t: Turtle): V3 {
  return [Math.cos(t.pitch) * Math.cos(t.yaw), Math.sin(t.pitch), Math.cos(t.pitch) * Math.sin(t.yaw)];
}

/** `length` m along the arc, the pitch and yaw changing linearly by dPitch / dYaw (radians) over it. */
function seg(t: Turtle, length: number, dPitch = 0, dYaw = 0): void {
  if (length <= 0) return;
  const n = Math.max(1, Math.ceil(length / 0.25));
  const ds = length / n;
  const every = Math.max(1, Math.round(2.5 / ds));
  for (let i = 0; i < n; i++) {
    // midpoint integration
    t.pitch += (dPitch / n) / 2;
    t.yaw += (dYaw / n) / 2;
    t.p = add(t.p, mul(forward(t), ds));
    t.pitch += (dPitch / n) / 2;
    t.yaw += (dYaw / n) / 2;
    if ((i + 1) % every === 0 || i === n - 1) t.pts.push([t.p[0], t.p[1], t.p[2]]);
  }
}
const straight = (t: Turtle, l: number): void => seg(t, l);
/** A vertical arc of radius `r` changing the pitch by `deg`. */
const pitchArc = (t: Turtle, r: number, deg: number): void => seg(t, r * Math.abs(rad(deg)), rad(deg), 0);
/** A level or climbing turn of radius `r` (measured on the plan), right for positive `deg`. */
const turn = (t: Turtle, r: number, deg: number): void => seg(t, (r * Math.abs(rad(deg))) / Math.max(0.2, Math.cos(t.pitch)), 0, rad(deg));

/** A camelback / airtime hill: up at `a` degrees, crest radius `rc`, down, level again. Net height change zero. */
function hill(t: Turtle, a: number, ramp: number, rr: number, rc: number): void {
  pitchArc(t, rr, a);
  straight(t, ramp);
  pitchArc(t, rc, -2 * a);
  straight(t, ramp);
  pitchArc(t, rr, a);
}

/** The vertical loop, local frame (x ahead, y up, z to the right), placed at the turtle's pose (it is level, heading `yaw`). */
function loop(t: Turtle): void {
  const { R, d, w } = LOOP;
  const c = Math.cos(t.yaw);
  const s = Math.sin(t.yaw);
  const o = t.p;
  const n = 96;
  for (let i = 1; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    const lx = d * th + R * Math.sin(th);
    const ly = R * (1 - Math.cos(th));
    const lz = (w * (th - Math.sin(th))) / (Math.PI * 2);
    t.pts.push([o[0] + lx * c - lz * s, o[1] + ly, o[2] + lx * s + lz * c]);
  }
  const lx = d * Math.PI * 2;
  t.p = [o[0] + lx * c - w * s, o[1], o[2] + lx * s + w * c];
}

/** The lift's pitch (27.5 degrees) and the drop's (60). */
const LIFT_DEG = 27.5;
const DROP_DEG = 60;
const DROP_LEN = 11;

function mark(t: Turtle, name: string): void {
  t.marks.push({ name, p: [t.p[0], t.p[1], t.p[2]] });
}

function layout(liftLen: number, filler: number): Turtle {
  const t: Turtle = { p: [0, STATION_Y, 0], yaw: 0, pitch: 0, pts: [[0, STATION_Y, 0]], marks: [] };
  straight(t, 22); // the station's last half and the run-out
  pitchArc(t, 60, LIFT_DEG); // onto the chain lift
  straight(t, liftLen);
  pitchArc(t, 18, -(LIFT_DEG + DROP_DEG)); // the crest
  straight(t, DROP_LEN); // the 60 degree drop
  pitchArc(t, 28, DROP_DEG); // the pull-out
  straight(t, 30);
  hill(t, 19, 7, 36, 48); // the airtime hill
  straight(t, 22);
  mark(t, "loopFrom");
  loop(t);
  mark(t, "loopTo");
  straight(t, 12);
  mark(t, "trimFrom"); // the mid-course trim brake: the return is run at a comfortable speed
  straight(t, 12);
  turn(t, TURN1_R, 180); // banked turn one, heading back west
  straight(t, 14);
  hill(t, 24, 9, 30, 22); // camelback one
  straight(t, 12);
  hill(t, 16, 6, 30, 24); // camelback two
  straight(t, filler);
  turn(t, TURN2_R, 180); // banked turn two, heading east again
  mark(t, "trimTo");
  straight(t, BRAKE_RUN); // the brake run into the station
  return t;
}

/** The turtle's start is the station's middle; the circuit closes when it returns there (the lift's length closes y, the filler's x). */
function solveLayout(): { pts: V3[]; marks: Turtle["marks"] } {
  let filler = 10;
  const y0 = layout(0, filler).p[1];
  const lift = (STATION_Y - y0) / Math.sin(rad(LIFT_DEG));
  // x(end) falls 1:1 with the filler straight (the return runs west): bisect it to 0
  let lo = 0;
  let hi = 600;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (layout(lift, mid).p[0] > 0) lo = mid;
    else hi = mid;
  }
  filler = (lo + hi) / 2;
  const t = layout(lift, filler);
  return { pts: t.pts, marks: t.marks };
}

// ───────────────────────────────────────── the sampled track ─────────────────────────────────────────

export interface CoasterTrack {
  /** Samples round the circuit (index 0 is the stop point of the train's head). */
  n: number;
  /** Spacing (m). */
  ds: number;
  /** Circuit length (m). */
  length: number;
  pos: Float32Array; // 3n
  tan: Float32Array;
  up: Float32Array;
  /** Speed (m/s) at each sample, and the ride's clock (s) at each sample (n + 1 entries, the last is the end). */
  speed: Float32Array;
  time: Float32Array;
  /** First / last sample of the chain lift and the crest, for audio and the HUD. */
  liftFrom: number;
  liftTo: number;
  /** Ride duration (s), start to stop. */
  duration: number;
  /** Named places as sample indexes: loopFrom, loopTo (the vertical loop), trimFrom, trimTo (the mid-course trim and the two turns). */
  marks: Record<string, number>;
  /** The track's bounding box (x0, y0, z0, x1, y1, z1). */
  box: [number, number, number, number, number, number];
}

const SAMPLE_DS = 0.5;
const LIFT_SPEED = 3.4;
const LAUNCH_ACCEL = 0.9;
const BRAKE_DECEL = 4.2;
const FRICTION = 0.012;
const TRIM_SPEED = 20;
const STOP_AT_X = 9.6; // the head's stop: the six cars sit across the platform (x -9 .. 9.6)

function chord(a: V3, b: V3): number {
  return Math.sqrt(len(sub(a, b)));
}

/** Centripetal Catmull-Rom through the closed point ring, resampled at `ds` by arc length. */
function resample(ring: V3[], ds: number): V3[] {
  const m = ring.length;
  // a dense evaluation first (8 per span), then walk it by arc length
  const dense: V3[] = [];
  for (let i = 0; i < m; i++) {
    const p0 = ring[(i - 1 + m) % m]!;
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % m]!;
    const p3 = ring[(i + 2) % m]!;
    const t0 = 0;
    const t1 = t0 + chord(p0, p1);
    const t2 = t1 + chord(p1, p2);
    const t3 = t2 + chord(p2, p3);
    const span = Math.max(1, Math.ceil(len(sub(p2, p1)) / 0.4));
    for (let k = 0; k < span; k++) {
      const t = t1 + ((t2 - t1) * k) / span;
      const lerp = (a: V3, b: V3, ta: number, tb: number): V3 => mul(add(mul(a, tb - t), mul(b, t - ta)), 1 / (tb - ta || 1));
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      dense.push(lerp(b1, b2, t1, t2));
    }
  }
  const total = (() => {
    let s = 0;
    for (let i = 0; i < dense.length; i++) s += len(sub(dense[(i + 1) % dense.length]!, dense[i]!));
    return s;
  })();
  const n = Math.round(total / ds);
  const step = total / n;
  const out: V3[] = [];
  let acc = 0;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = i * step;
    while (j < dense.length && acc + len(sub(dense[(j + 1) % dense.length]!, dense[j]!)) < target) {
      acc += len(sub(dense[(j + 1) % dense.length]!, dense[j]!));
      j++;
    }
    const a = dense[j % dense.length]!;
    const b = dense[(j + 1) % dense.length]!;
    const l = len(sub(b, a)) || 1;
    out.push(add(a, mul(sub(b, a), (target - acc) / l)));
  }
  return out;
}

/** A few passes of a moving average round the ring (kills the curvature steps at the pieces' joints; keeps the circuit closed). */
function smoothRing(p: V3[], half: number, passes: number): V3[] {
  let cur = p;
  const n = p.length;
  for (let k = 0; k < passes; k++) {
    const next: V3[] = [];
    for (let i = 0; i < n; i++) {
      let s: V3 = [0, 0, 0];
      for (let j = -half; j <= half; j++) s = add(s, cur[(i + j + n) % n]!);
      next.push(mul(s, 1 / (2 * half + 1)));
    }
    cur = next;
  }
  return cur;
}

let cached: CoasterTrack | null = null;

/** The track (built once, ~10 ms). */
export function coasterTrack(): CoasterTrack {
  if (cached) return cached;
  const solved = solveLayout();
  const ring = solved.pts;
  // the last point is the start again: drop the duplicate before the ring closes
  const last = ring[ring.length - 1]!;
  if (len(sub(last, ring[0]!)) < 1.5) ring.pop();
  const raw = resample(ring, SAMPLE_DS);
  const sm = smoothRing(raw, 3, 3);
  const n = sm.length;
  const ds = (() => {
    let s = 0;
    for (let i = 0; i < n; i++) s += len(sub(sm[(i + 1) % n]!, sm[i]!));
    return s / n;
  })();
  const length = ds * n;

  // start the circuit at the head's stop: the sample nearest (STOP_AT_X, STATION_Y, 0) on the station straight
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const p = sm[i]!;
    const d = Math.abs(p[0] - STOP_AT_X) + Math.abs(p[2]) * 4 + Math.abs(p[1] - STATION_Y);
    if (d < best) {
      best = d;
      start = i;
    }
  }
  const P: V3[] = [];
  for (let i = 0; i < n; i++) P.push(sm[(start + i) % n]!);

  // tangents
  const T: V3[] = P.map((_, i) => norm(sub(P[(i + 1) % n]!, P[(i - 1 + n) % n]!)));

  // speed: lift chain, free roll, launch ramp and brake profile
  const pitchAt = (i: number): number => Math.asin(Math.max(-1, Math.min(1, T[i]![1])));
  // the chain lift: from where the pitch first passes 24 degrees going up, to the highest point (the crest)
  let liftFrom = -1;
  for (let i = 0; i < n && liftFrom < 0; i++) if (pitchAt(i) > rad(LIFT_DEG - 3)) liftFrom = i;
  let crest = 0;
  for (let i = 0; i < n; i++) if (P[i]![1] > P[crest]![1]) crest = i;
  const nearest = (p: V3): number => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = len(sub(P[i]!, p));
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  };
  const trimFrom = nearest(solved.marks.find((m) => m.name === "trimFrom")!.p);
  const trimTo = nearest(solved.marks.find((m) => m.name === "trimTo")!.p);
  const v2 = new Float64Array(n + 1);
  v2[0] = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % n]!;
    const dh = b[1] - a[1];
    let next: number;
    if (i < liftFrom - 1) next = v2[i]! + 2 * LAUNCH_ACCEL * ds; // out of the station
    else if (i < crest) next = LIFT_SPEED * LIFT_SPEED; // the chain
    else next = v2[i]! - 2 * G * dh - 2 * FRICTION * G * ds;
    // the launch / chain never exceed the lift speed; the free roll never stalls
    if (i < crest) next = Math.min(next, LIFT_SPEED * LIFT_SPEED);
    if (i + 1 >= trimFrom && i + 1 <= trimTo) next = Math.min(next, TRIM_SPEED * TRIM_SPEED);
    v2[i + 1] = Math.max(next, 2.5 * 2.5);
  }
  v2[n] = 0;
  // the brake: speed at the end must fall to zero; a backward pass of the allowed speed
  for (let i = n - 1; i >= 0; i--) {
    const cap = v2[i + 1]! + 2 * BRAKE_DECEL * ds;
    v2[i] = Math.min(v2[i]!, cap);
  }
  // the first samples: v = 0 at the very start, ramp
  v2[0] = 0;
  const speed = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) speed[i] = Math.sqrt(Math.max(0, v2[i]!));
  const time = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const va = Math.max(speed[i]!, 0.3);
    const vb = Math.max(speed[i + 1]!, 0.3);
    time[i + 1] = time[i]! + (2 * ds) / (va + vb);
  }

  // up: parallel transport, then bank, then close the twist
  const U: V3[] = new Array(n);
  U[0] = [0, 1, 0];
  U[0] = norm(sub(U[0], mul(T[0]!, dot(U[0], T[0]!))));
  for (let i = 1; i < n; i++) {
    const ax = cross(T[i - 1]!, T[i]!);
    const sinA = len(ax);
    let u = U[i - 1]!;
    if (sinA > 1e-9) {
      const k = mul(ax, 1 / sinA);
      const ang = Math.asin(Math.min(1, sinA));
      u = add(add(mul(u, Math.cos(ang)), mul(cross(k, u), Math.sin(ang))), mul(k, dot(k, u) * (1 - Math.cos(ang))));
    }
    U[i] = norm(sub(u, mul(T[i]!, dot(u, T[i]!))));
  }
  // twist closing the circuit: the angle (about T0) from the transported end-up to the start up
  const endUp = (() => {
    const ax = cross(T[n - 1]!, T[0]!);
    const sinA = len(ax);
    let u = U[n - 1]!;
    if (sinA > 1e-9) {
      const k = mul(ax, 1 / sinA);
      const ang = Math.asin(Math.min(1, sinA));
      u = add(add(mul(u, Math.cos(ang)), mul(cross(k, u), Math.sin(ang))), mul(k, dot(k, u) * (1 - Math.cos(ang))));
    }
    return norm(sub(u, mul(T[0]!, dot(u, T[0]!))));
  })();
  const twist = Math.atan2(dot(cross(endUp, U[0]!), T[0]!), dot(endUp, U[0]!));

  // bank: lateral acceleration of the turn at the real speed (a plan curvature), eased, none where the track is steep
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = T[(i - 1 + n) % n]!;
    const b = T[(i + 1) % n]!;
    const kh = (a[0] * b[2] - a[2] * b[0]) / (2 * ds); // plan curvature, + = a right turn (the yaw grows)
    const v = (speed[i]! + speed[i + 1]!) / 2;
    const steep = Math.abs(T[i]![1]);
    const flat = Math.max(0, 1 - steep / 0.5);
        bank[i] = Math.atan((v * v * kh) / G) * 0.9 * flat;
  }
  const bsm = new Float64Array(n);
  const half = 8;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -half; j <= half; j++) s += bank[(i + j + n) % n]!;
    bsm[i] = Math.max(-1.15, Math.min(1.15, s / (2 * half + 1)));
  }

  const up = new Float32Array(3 * n);
  const pos = new Float32Array(3 * n);
  const tan = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const Ti = T[i]!;
    const roll = bsm[i]! + (twist * i) / n;
    // lean toward the right by `roll`: right = T x U
    const right = cross(Ti, U[i]!);
    const u = add(mul(U[i]!, Math.cos(roll)), mul(right, Math.sin(roll)));
    const un = norm(u);
    up.set(un, 3 * i);
    pos.set(P[i]!, 3 * i);
    tan.set(Ti, 3 * i);
  }
  const box: CoasterTrack["box"] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of P) {
    box[0] = Math.min(box[0], p[0]);
    box[1] = Math.min(box[1], p[1]);
    box[2] = Math.min(box[2], p[2]);
    box[3] = Math.max(box[3], p[0]);
    box[4] = Math.max(box[4], p[1]);
    box[5] = Math.max(box[5], p[2]);
  }
  const marks: Record<string, number> = {};
  for (const m of solved.marks) marks[m.name] = nearest(m.p);
  cached = { n, ds, length, pos, tan, up, speed, time, liftFrom, liftTo: crest, duration: time[n]!, marks, box };
  return cached;
}

// ───────────────────────────────────────── the train ─────────────────────────────────────────

export const COASTER_CARS = 6;
export const COASTER_SEATS = COASTER_CARS * 2;
/** Spacing of the cars' centres along the track (m). */
export const CAR_PITCH = 3.1;
/** Where the rider's seat is: height of the seat's top over the track's centre line, and the eye over it (m). */
export const SEAT_TOP = 0.52;
export const EYE_ABOVE_SEAT = 0.86;
export const SEAT_HALF_GAP = 0.42;

export interface CarFrame {
  /** Centre line point, tangent, up, right (= tangent x up) */
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  ux: number;
  uy: number;
  uz: number;
  rx: number;
  ry: number;
  rz: number;
}

/** The frame at arc length `s` (wraps round the circuit), interpolated between samples. */
export function frameAt(track: CoasterTrack, s: number, out: CarFrame = emptyFrame()): CarFrame {
  const L = track.length;
  let u = (((s % L) + L) % L) / track.ds;
  const i0 = Math.floor(u) % track.n;
  const i1 = (i0 + 1) % track.n;
  const f = u - Math.floor(u);
  const a = track.pos;
  const t = track.tan;
  const g = track.up;
  out.x = a[3 * i0]! + (a[3 * i1]! - a[3 * i0]!) * f;
  out.y = a[3 * i0 + 1]! + (a[3 * i1 + 1]! - a[3 * i0 + 1]!) * f;
  out.z = a[3 * i0 + 2]! + (a[3 * i1 + 2]! - a[3 * i0 + 2]!) * f;
  let tx = t[3 * i0]! + (t[3 * i1]! - t[3 * i0]!) * f;
  let ty = t[3 * i0 + 1]! + (t[3 * i1 + 1]! - t[3 * i0 + 1]!) * f;
  let tz = t[3 * i0 + 2]! + (t[3 * i1 + 2]! - t[3 * i0 + 2]!) * f;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  let ux = g[3 * i0]! + (g[3 * i1]! - g[3 * i0]!) * f;
  let uy = g[3 * i0 + 1]! + (g[3 * i1 + 1]! - g[3 * i0 + 1]!) * f;
  let uz = g[3 * i0 + 2]! + (g[3 * i1 + 2]! - g[3 * i0 + 2]!) * f;
  const d = ux * tx + uy * ty + uz * tz;
  ux -= tx * d;
  uy -= ty * d;
  uz -= tz * d;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  out.tx = tx;
  out.ty = ty;
  out.tz = tz;
  out.ux = ux;
  out.uy = uy;
  out.uz = uz;
  // right = T x U
  out.rx = ty * uz - tz * uy;
  out.ry = tz * ux - tx * uz;
  out.rz = tx * uy - ty * ux;
  return out;
}

export function emptyFrame(): CarFrame {
  return { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0 };
}

/** Speed (m/s) at arc length `s` of the ride (0 .. length). */
export function speedAt(track: CoasterTrack, s: number): number {
  const u = Math.max(0, Math.min(track.n, s / track.ds));
  const i = Math.min(track.n - 1, Math.floor(u));
  const f = u - i;
  return track.speed[i]! + (track.speed[i + 1]! - track.speed[i]!) * f;
}

/** The arc length (m) reached `t` seconds into the ride (binary search on the time table). */
export function arcAtRideTime(track: CoasterTrack, t: number): number {
  if (t <= 0) return 0;
  if (t >= track.duration) return track.length;
  let lo = 0;
  let hi = track.n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.time[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const t0 = track.time[lo]!;
  const t1 = track.time[lo + 1]!;
  return (lo + (t1 > t0 ? (t - t0) / (t1 - t0) : 0)) * track.ds;
}

// ───────────────────────────────────────── the schedule ─────────────────────────────────────────

/** The station's stops: the first 5 s unload, then boarding until 6 s before departure. */
export const COASTER_UNLOAD_MS = 5000;
export const COASTER_DWELL_MS = 40_000;
export const COASTER_GATE_MS = 6000;
/** The ride's time, rounded up to a whole second plus one (the last second is the train rolling to rest). */
export const COASTER_RIDE_MS = Math.ceil(coasterTrack().duration + 1) * 1000;
export const COASTER_CYCLE_MS = COASTER_DWELL_MS + COASTER_RIDE_MS;

export type CoasterPhase = "unloading" | "boarding" | "gate" | "riding";

export interface CoasterState {
  cycle: number;
  /** ms since this cycle began */
  phase: number;
  status: CoasterPhase;
  /** arc length (m) of the train's HEAD (0 while in the station) */
  s: number;
  /** ms until the doors close (boarding), or until the next departure */
  departsInMs: number;
}

/** Where the one train is at wall-clock `nowMs` (the village clock the server sends). */
export function coasterAt(nowMs: number, out: CoasterState = { cycle: 0, phase: 0, status: "boarding", s: 0, departsInMs: 0 }): CoasterState {
  const cycle = Math.floor(nowMs / COASTER_CYCLE_MS);
  const phase = nowMs - cycle * COASTER_CYCLE_MS;
  out.cycle = cycle;
  out.phase = phase;
  if (phase < COASTER_DWELL_MS) {
    out.status = phase < COASTER_UNLOAD_MS ? "unloading" : phase < COASTER_DWELL_MS - COASTER_GATE_MS ? "boarding" : "gate";
    out.s = 0;
    out.departsInMs = COASTER_DWELL_MS - phase;
  } else {
    out.status = "riding";
    out.s = arcAtRideTime(coasterTrack(), (phase - COASTER_DWELL_MS) / 1000);
    out.departsInMs = COASTER_CYCLE_MS - phase + COASTER_DWELL_MS;
  }
  return out;
}

/** Whether a rider may get on now (the server's rule): in the boarding window. */
export function coasterBoardingOpen(nowMs: number): boolean {
  return coasterAt(nowMs).status === "boarding";
}

/**
 * Which car (0 = the front) and which side (0 = left, 1 = right) seat `seat` is. Seats fill from the FRONT (owner 2026-11-18: "맨 앞자리에 앉도록"):
 * seats 0 and 1 are the front row of the front car (a lone rider sees the open track ahead), then row by row to the back. The server hands out
 * the lowest free seat, and a reserved seat (자리 맡기) is given the same way when the ride next loads.
 */
export function seatCar(seat: number): { car: number; side: 0 | 1 } {
  return { car: Math.floor(seat / 2) % COASTER_CARS, side: (seat % 2) as 0 | 1 };
}

/** Arc length of car `car`'s centre when the head is at `s`. */
export function carArc(headS: number, car: number): number {
  // the head's centre is half a car behind the head's reference
  return headS - car * CAR_PITCH;
}

/** Forces on a rider in the car's own frame, in g: lateral (+ right), vertical (+ pressed into the seat), longitudinal (+ forward). */
export function rideGForce(track: CoasterTrack, s: number, out: { lat: number; vert: number; long: number } = { lat: 0, vert: 1, long: 0 }): { lat: number; vert: number; long: number } {
  const a = frameAt(track, s - 1.0);
  const b = frameAt(track, s + 1.0);
  const f = frameAt(track, s);
  const v = speedAt(track, s);
  const vf = speedAt(track, s + 2);
  const vb = speedAt(track, Math.max(0, s - 2));
  const along = (vf * vf - vb * vb) / 8; // dv/dt = d(v^2)/ds / 2, over 4 m
  // what the car must push the rider with: v^2 dT/ds + dv/dt T + g up(world)
  const ax = ((b.tx - a.tx) / 2) * v * v + along * f.tx;
  const ay = ((b.ty - a.ty) / 2) * v * v + along * f.ty + G;
  const az = ((b.tz - a.tz) / 2) * v * v + along * f.tz;
  out.lat = (ax * f.rx + ay * f.ry + az * f.rz) / G;
  out.vert = (ax * f.ux + ay * f.uy + az * f.uz) / G;
  out.long = (ax * f.tx + ay * f.ty + az * f.tz) / G;
  return out;
}
