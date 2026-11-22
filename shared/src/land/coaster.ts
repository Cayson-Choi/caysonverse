/**
 * 케이슨랜드 — 별똥별 급행 (Shooting Star Express), the park's steel roller coaster: the track, the physics and the schedule.
 * Browser-safe, pure maths (no three.js): the SERVER and every CLIENT evaluate the same functions, so a ride is one timeline
 * everyone sees, not a stream of positions.
 *
 *  - TRACK (2026-11-19, owner: "아주 높이 올라가게", "뒷 부분은 그냥 밋밋해"): a closed circuit built by a turtle from eased pieces
 *    (no curvature step at any joint): the station, a jog south, a 45 degree chain lift to a 67.8 m crest, an 80 degree drop and its
 *    pull-out, a camelback onto a high banked turnaround, a block brake, then the back half: a dive, a teardrop vertical loop, a zero-g
 *    heartline roll, three bunny hops, a climb into a 540 degree ground helix whose top lap passes over its bottom lap and the brake
 *    run, and the tunnel on the brake run. Vertical curves are shaped by FORCE (curvature = A shape(u) g / v^2 with the speed the
 *    train will have there), so the g-forces follow a chosen profile at any speed. It closes exactly (the lift's length tops out at
 *    CREST_Y, the back half's spacing puts the helix at HELIX_X, the helix comes down to the station's height, the brake run steps
 *    onto the station's line), then is resampled by arc length and lightly smoothed. An ORIGINAL layout; it copies no real park's ride.
 *  - FRAME: tangent / up / right per sample. Up is parallel-transported (so a loop never flips), corrected onto the no-roll frame
 *    wherever the track is not steep (so it closes), plus the heartline roll and a bank that makes the lateral force vanish at the
 *    real speed, turned about the riders' heartline (the rail swings out under them).
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
/** The chain lift's pitch, the first drop's (degrees) and the crest's rail height over the ground (m). Owner 2026-11-19: "아주 높이". */
export const LIFT_DEG = 45;
export const DROP_DEG = 80;
export const CREST_Y = 68;
/** The chain's speed (m/s), the rolling + air loss (a fraction of g), the mid-course block brake's speed (m/s). */
const LIFT_SPEED = 4.0;
const FRICTION = 0.012;
const TRIM_SPEED = 13.5;
/** Rail height in the valleys (m) and at the elevated turnaround (m). */
const GROUND_Y = 2.2;
const TURN_Y = 26;
/** The vertical loop's length (m) and the tunnel's (m). */
const LOOP_LEN = 105;
const TUNNEL_LEN = 30;
/** The vertical loop's sideways step (m) and the heartline roll's radius (the rider's heart over the rail, m). */
const LOOP_W = 4.5;
/** How far over the rail the riders' hearts are (m): the roll and the banks turn about it, and the g-forces are measured there. */
export const RIDER_HEART = 1.1;
const HEART_H = RIDER_HEART;
/** The ground helix: where it starts (x, heading west), its outer and inner radius (m) and its rail height at the top (m). */
const HELIX_X = -84;
const HELIX_R1 = 26;
const HELIX_R2 = 21;
const HELIX_Y = 10.5;
/** The helix ends this much over the station's height (its banked bottom lap swings the rail down under the riders' hearts). */
const HELIX_END_UP = 1.0;

interface Turtle {
  p: V3;
  yaw: number; // 0 = +x, positive turns toward +z (a right turn, looking along +x)
  pitch: number;
  /** the speed estimate (v^2): the chain's while `chain`, then energy with the same losses as the physics below */
  v2: number;
  chain: boolean;
  trim: boolean;
  /** dry runs (solving a piece's size) draw nothing */
  draw: boolean;
  pts: V3[];
  /** named places on the circuit (positions), found again on the resampled ring */
  marks: { name: string; p: V3 }[];
}

const S = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** A rate profile over a piece (u 0..1): eased in over `e` of it and out over `e` (smoothstep ramps), flat between. Its mean is 1 - e. */
const bell =
  (e: number) =>
  (u: number): number =>
    e <= 0 ? 1 : Math.min(S(u / e), S((1 - u) / e));

function forward(t: Turtle): V3 {
  return [Math.cos(t.pitch) * Math.cos(t.yaw), Math.sin(t.pitch), Math.cos(t.pitch) * Math.sin(t.yaw)];
}
/** The horizontal right of the heading, and the up in the vertical plane of the heading. */
const rightH = (yaw: number): V3 => [-Math.sin(yaw), 0, Math.cos(yaw)];
const upLocal = (t: Turtle): V3 => [-Math.sin(t.pitch) * Math.cos(t.yaw), Math.cos(t.pitch), -Math.sin(t.pitch) * Math.sin(t.yaw)];

function copyTurtle(t: Turtle): Turtle {
  return { ...t, p: [t.p[0], t.p[1], t.p[2]], pts: [], marks: [], draw: false };
}

/**
 * The core step: `length` m along the arc, the pitch and the yaw turning at `rate(u, v2)` (radians per metre each), the drawn points shifted by
 * `offset(u)` (a sideways step, a heartline roll), `endShift` made permanent at the end. Midpoint integration every 0.25 m, a point every metre.
 */
function walk(t: Turtle, length: number, rate: (u: number, v2: number) => [number, number], offset?: (u: number, t: Turtle) => V3, endShift?: V3): void {
  if (length <= 0) return;
  const n = Math.max(1, Math.ceil(length / 0.25));
  const ds = length / n;
  for (let i = 0; i < n; i++) {
    const [rp, ry] = rate((i + 0.5) / n, t.v2);
    t.pitch += (rp * ds) / 2;
    t.yaw += (ry * ds) / 2;
    const f = forward(t);
    t.p = add(t.p, mul(f, ds));
    if (t.chain) t.v2 = LIFT_SPEED * LIFT_SPEED;
    else t.v2 = t.v2 - 2 * G * f[1] * ds - 2 * FRICTION * G * ds;
    if (t.trim) t.v2 = Math.min(t.v2, TRIM_SPEED * TRIM_SPEED);
    t.v2 = Math.max(t.v2, 2.5 * 2.5);
    t.pitch += (rp * ds) / 2;
    t.yaw += (ry * ds) / 2;
    // the chain lets go at the crest's top
    if (t.chain && t.pitch <= 0 && rp < 0) t.chain = false;
    if (t.draw && ((i + 1) % 4 === 0 || i === n - 1)) {
      const o = offset ? offset((i + 1) / n, t) : ([0, 0, 0] as V3);
      t.pts.push([t.p[0] + o[0], t.p[1] + o[1], t.p[2] + o[2]]);
    }
  }
  if (endShift) t.p = add(t.p, endShift);
}

const straight = (t: Turtle, l: number): void => walk(t, l, () => [0, 0]);
/** Pitch and yaw changed by dPitch / dYaw over `length`, eased in and out (curvature rises and falls smoothly: no step at a joint). */
function ease(t: Turtle, length: number, dPitch: number, dYaw: number, e = 0.5): void {
  const w = bell(e);
  const k = 1 / ((1 - e) * length);
  walk(t, length, (u) => [dPitch * w(u) * k, dYaw * w(u) * k]);
}
/**
 * A vertical curve shaped by FORCE, not by radius: the curvature is A * shape(u) * g / v^2 (v the speed the train will have there), so the
 * push it gives a rider, A * shape(u) g on top of gravity, follows `shape` whatever the speed. A is solved so the pitch turns by `dPitch`.
 * `vmin` (m/s) keeps a slow crest from folding into a kink; `roll` turns the heartline roll over the piece (turns, + = to the right);
 * `step` steps the piece sideways by that many metres (the loop: its way out runs beside its way in).
 */
function gCurve(t: Turtle, length: number, dPitch: number, shape: (u: number) => number, opts: { vmin?: number; roll?: number; step?: number; geo?: boolean } = {}): number {
  const vmin2 = (opts.vmin ?? 0) ** 2;
  const sgn = Math.sign(dPitch);
  // `geo`: the shape is the CURVATURE's (a loop: its size must not hang on the speed it is entered at)
  const rate =
    (A: number) =>
    (u: number, v2: number): [number, number] => [(sgn * A * shape(u) * G) / (opts.geo ? 400 : Math.max(v2, vmin2, 1)), 0];
  // fixed point on A (the turn grows nearly in proportion to it)
  let A = 1;
  for (let k = 0; k < 40; k++) {
    const c = copyTurtle(t);
    const p0 = c.pitch;
    walk(c, length, rate(A));
    const got = (c.pitch - p0) / dPitch;
    if (Math.abs(got - 1) < 1e-7) break;
    A /= got;
  }
  const p0 = t.pitch;
  const yaw0 = t.yaw;
  let offset: ((u: number, tt: Turtle) => V3) | undefined;
  let endShift: V3 | undefined;
  if (opts.roll) {
    const turns = opts.roll;
    offset = (u, tt) => {
      const phi = 2 * Math.PI * turns * S(u);
      const ul = upLocal(tt);
      const r = rightH(tt.yaw);
      return sub(mul(ul, HEART_H), add(mul(ul, HEART_H * Math.cos(phi)), mul(r, HEART_H * Math.sin(phi))));
    };
  } else if (opts.step) {
    const r = rightH(yaw0);
    const w = opts.step;
    offset = (u) => mul(r, w * S(u));
    endShift = mul(r, w);
  }
  walk(t, length, rate(A), offset, endShift);
  t.pitch = p0 + dPitch;
  return A;
}

/** A straight at the present pitch sized (by a few dry runs) so that `then` ends at rail height `y` (or, with `top`, peaks at it). */
function straightTo(t: Turtle, y: number, then: (tt: Turtle) => void, top = false): void {
  const s = Math.sin(t.pitch);
  const err = (d: number): number => {
    const c = copyTurtle(t);
    straight(c, d);
    c.draw = top;
    then(c);
    return (top ? Math.max(...c.pts.map((p) => p[1])) : c.p[1]) - y;
  };
  // secant steps (the piece after the straight grows with the speed the straight gives it, so a plain step can crawl)
  let d0 = 0;
  let e0 = err(d0);
  let d1 = Math.max(0, -e0 / s);
  let e1 = err(d1);
  for (let k = 0; k < 30 && Math.abs(e1) > 1e-4 && d1 > 0; k++) {
    const slope = (e1 - e0) / (d1 - d0 || 1e-9);
    const d2 = Math.max(0, d1 - e1 / (Math.abs(slope) > 1e-6 ? slope : s));
    d0 = d1;
    e0 = e1;
    d1 = d2;
    e1 = err(d1);
  }
  straight(t, d1);
  then(t);
}

/**
 * A helix of `deg` degrees (right), its radius easing from r1 to r2, eased in and out, coming down by `descent` m: the pitch eases into a
 * steady slope and back to level (the slope solved by dry runs).
 */
function helix(t: Turtle, r1: number, r2: number, deg: number, descent: number): void {
  const dYaw = rad(deg);
  const w = bell(0.16);
  const R = (u: number): number => r1 + (r2 - r1) * u;
  let mean = 0;
  for (let i = 0; i < 400; i++) mean += w((i + 0.5) / 400) / R((i + 0.5) / 400) / 400;
  const pw = bell(0.2);
  const dp = (u: number): number => {
    const a = Math.max(0, u - 1e-4);
    const b = Math.min(1, u + 1e-4);
    return (pw(b) - pw(a)) / (b - a);
  };
  // the length: where the profile is flat the yaw rate is 1/R(u)
  const L = dYaw / mean;
  const rate =
    (q: number) =>
    (u: number): [number, number] => [(-q * dp(u)) / L, (dYaw * w(u)) / R(u) / (mean * L)];
  let q = descent / (L * 0.8);
  for (let k = 0; k < 20; k++) {
    const c = copyTurtle(t);
    walk(c, L, rate(q));
    const got = t.p[1] - c.p[1];
    if (Math.abs(got - descent) < 1e-5) break;
    q *= descent / got;
  }
  walk(t, L, rate(q));
  t.pitch = 0;
}

function mark(t: Turtle, name: string): void {
  t.marks.push({ name, p: [t.p[0], t.p[1], t.p[2]] });
}

/** The loop's curvature profile: eased in, gentle in its lower half, tightest over the top (a clothoid-like teardrop). */
const loopShape = (u: number): number => bell(0.18)(u) * (1 + 1.5 * Math.exp(-(((u - 0.5) / 0.17) ** 2)));
const B = bell(0.5);

/** The force factor each g-shaped piece came out with (for the tests and tuning). */
export const LAYOUT_DEBUG: Record<string, number> = {};

function layout(filler: number, draw: boolean): Turtle {
  const t: Turtle = { p: [0, STATION_Y, 0], yaw: 0, pitch: 0, v2: 0, chain: false, trim: false, draw, pts: draw ? [[0, STATION_Y, 0]] : [], marks: [] };
  const dbg = (k: string, a: number): void => {
    if (draw) LAYOUT_DEBUG[k] = a;
  };
  straight(t, 12); // the station's east half and the run-out
  // a jog to the south: the tall lift's lattice feet stand clear of the park's lawn (its south edge is z -2.2)
  ease(t, 20, 0, rad(18));
  straight(t, 4);
  ease(t, 20, 0, -rad(18));
  t.chain = true;
  ease(t, 34, rad(LIFT_DEG), 0); // onto the chain lift
  // the lift's straight: the crest (whose shape does not depend on its height) tops out at CREST_Y
  const crest = (tt: Turtle): number => gCurve(tt, 40, -rad(LIFT_DEG + DROP_DEG), B, { vmin: 12 });
  {
    const probe = copyTurtle(t);
    probe.draw = true;
    const y0 = probe.p[1];
    crest(probe);
    let top = y0;
    for (const p of probe.pts) top = Math.max(top, p[1]);
    straight(t, (CREST_Y - (top - y0) - t.p[1]) / Math.sin(rad(LIFT_DEG)));
  }
  mark(t, "crestFrom");
  dbg("crest", crest(t)); // over the top and into the 80 degree drop (a pop of airtime on the way over)
  // the drop and its pull-out, bottoming out at the valley's height
  straightTo(t, GROUND_Y, (tt) => dbg("pullout", gCurve(tt, 92, rad(DROP_DEG), B)));
  mark(t, "dropTo");
  straight(t, 2);
  // the camelback: a big airtime hill whose top levels out onto the high turnaround
  dbg("camelUp", gCurve(t, 50, rad(33), B));
  straightTo(t, TURN_Y, (tt) => dbg("camelCrest", gCurve(tt, 53, -rad(33), B)));
  // the high turnaround (banked by the physics below), then the block brake on top
  mark(t, "turnFrom");
  ease(t, 95, 0, Math.PI, 0.3);
  mark(t, "turnTo");
  straight(t, 2);
  mark(t, "trimFrom");
  t.trim = true;
  straight(t, 16);
  t.trim = false;
  mark(t, "trimTo");
  straight(t, 2);
  // ── the back half (owner 2026-11-19: "뒷 부분은 그냥 밋밋해") ──
  // the dive off the block brake
  dbg("diveCrest", gCurve(t, 20, -rad(38), B, { vmin: 10 }));
  straightTo(t, GROUND_Y, (tt) => dbg("diveOut", gCurve(tt, 36, rad(38), B)));
  straight(t, 2 + filler * 0.3);
  // the vertical loop (a teardrop: the force is eased off over the top), stepping LOOP_W to the left (south)
  mark(t, "loopFrom");
  dbg("loop", gCurve(t, LOOP_LEN, 2 * Math.PI, loopShape, { step: -LOOP_W, geo: true }));
  mark(t, "loopTo");
  straight(t, 1 + filler * 0.3);
  // the zero-g roll: a hill whose top the train rolls through upside down, weightless, round the riders' heartline
  dbg("rollUp", gCurve(t, 20, rad(20), B));
  mark(t, "rollFrom");
  dbg("roll", gCurve(t, 50, -rad(40), B, { roll: 1 }));
  mark(t, "rollTo");
  dbg("rollOut", gCurve(t, 20, rad(20), B));
  straight(t, 2 + filler * 0.2);
  // three bunny hops (airtime, smaller each time)
  mark(t, "hopsFrom");
  for (const [a, lc] of [[12, 28], [11, 26], [10, 24]] as const) {
    gCurve(t, 9, rad(a), B);
    dbg(`hop${a}`, gCurve(t, lc, -rad(2 * a), B));
    gCurve(t, 9, rad(a), B);
    straight(t, 2);
  }
  mark(t, "hopsTo");
  straight(t, 2 + filler * 0.2);
  // up into the ground helix (540 degrees, coming down to the brake run's height; its top lap passes over its bottom one)
  gCurve(t, 16, rad(16), B);
  straightTo(t, HELIX_Y, (tt) => gCurve(tt, 16, -rad(16), B));
  mark(t, "helixFrom");
  helix(t, HELIX_R1, HELIX_R2, 540, t.p[1] - STATION_Y - HELIX_END_UP);
  mark(t, "helixTo");
  // the brake run: under the helix's top lap (a head-chopper), stepping onto the station's line, then through the tunnel at speed, its
  // floor dipping the last HELIX_END_UP metres to the station's height (the helix's banked bottom lap stays clear of the grass)
  {
    const w = -t.p[2];
    const r = rightH(t.yaw);
    const L = 74;
    const bump = bell(0.5);
    const dbump = (u: number): number => {
      const a0 = Math.max(0, u - 1e-4);
      const b0 = Math.min(1, u + 1e-4);
      return (bump(b0) - bump(a0)) / (b0 - a0);
    };
    const side = (from: number, len: number) => (u: number): V3 => mul(r, w * S((from + u * len) / L));
    walk(t, 8, () => [0, 0], side(0, 8));
    mark(t, "tunnelFrom");
    const tunnel = (tt: Turtle, q: number): void => walk(tt, TUNNEL_LEN, (u) => [(-q * dbump(u)) / TUNNEL_LEN, 0], side(8, TUNNEL_LEN));
    let q = HELIX_END_UP / (TUNNEL_LEN * 0.5);
    for (let k = 0; k < 20; k++) {
      const c = copyTurtle(t);
      tunnel(c, q);
      const got = t.p[1] - c.p[1];
      if (Math.abs(got - HELIX_END_UP) < 1e-5) break;
      q *= HELIX_END_UP / got;
    }
    tunnel(t, q);
    t.pitch = 0;
    t.p[1] = STATION_Y;
    mark(t, "tunnelTo");
    walk(t, L - 8 - TUNNEL_LEN, () => [0, 0], side(8 + TUNNEL_LEN, L - 8 - TUNNEL_LEN), mul(r, w));
  }
  straight(t, Math.max(0, -t.p[0]));
  return t;
}

/**
 * The circuit closes on the station's middle: the back half's spacing (`filler`) puts the helix's start at HELIX_X, the helix comes down
 * to the station's height, the brake run steps onto the station's line and runs to x = 0.
 */
function solveLayout(): { pts: V3[]; marks: Turtle["marks"] } {
  // x at the helix's start falls 1:1 with the filler (the back half runs west): bisect it
  const xAtHelix = (f: number): number => {
    const t = layout(f, false);
    return t.marks.find((m) => m.name === "helixFrom")?.p[0] ?? 0;
  };
  // secant steps (the speeds, and so the g-shaped pieces, change a little with the spacing)
  let f0 = 0;
  let x0 = xAtHelix(f0);
  let f1 = x0 - HELIX_X;
  let x1 = xAtHelix(f1);
  for (let k = 0; k < 8 && Math.abs(x1 - HELIX_X) > 1e-4; k++) {
    const slope = (x1 - x0) / (f1 - f0 || 1e-9);
    const f2 = f1 + (HELIX_X - x1) / (Math.abs(slope) > 1e-6 ? slope : -1);
    f0 = f1;
    x0 = x1;
    f1 = f2;
    x1 = xAtHelix(f1);
  }
  const filler = f1;
  LAYOUT_DEBUG.filler = filler;
  const t = layout(filler, true);
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
/** The most a turn is banked (rad): 77 degrees, the helix and the turnaround are steeply banked. */
const BANK_MAX = 1.35;
const LAUNCH_ACCEL = 0.9;
const BRAKE_DECEL = 4.2;
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

  // up: parallel transport (a loop never flips), then a correction that keeps it on the "no roll" frame (world up projected off the
  // tangent) wherever the track is not steep (interpolated across the steep and inverted runs, where that frame is undefined), then the
  // bank and the heartline roll. Nothing is left to twist at the join: the station's up is world up both ways round.
  const transport = (u: V3, a: V3, b: V3): V3 => {
    const ax = cross(a, b);
    const sinA = len(ax);
    let o = u;
    if (sinA > 1e-9) {
      const k = mul(ax, 1 / sinA);
      const ang = Math.atan2(sinA, dot(a, b));
      o = add(add(mul(u, Math.cos(ang)), mul(cross(k, u), Math.sin(ang))), mul(k, dot(k, u) * (1 - Math.cos(ang))));
    }
    return norm(sub(o, mul(b, dot(o, b))));
  };
  const U: V3[] = new Array(n);
  U[0] = norm(sub([0, 1, 0], mul(T[0]!, T[0]![1])));
  for (let i = 1; i < n; i++) U[i] = transport(U[i - 1]!, T[i - 1]!, T[i]!);
  const corr = new Float64Array(n);
  const good = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const Ti = T[i]!;
    if (Math.abs(Ti[1]) > 0.5) continue;
    const N = norm(sub([0, 1, 0], mul(Ti, Ti[1])));
    if (dot(U[i]!, N) < 0.5) continue; // upside down (the loop's top): that frame would flip it
    corr[i] = Math.atan2(dot(cross(U[i]!, N), Ti), dot(U[i]!, N));
    good[i] = 1;
  }
  // unwrap along the circuit over the good samples, then fill the steep runs linearly
  {
    let prev = -1;
    for (let i = 0; i < n; i++) {
      if (!good[i]) continue;
      if (prev >= 0) {
        while (corr[i]! - corr[prev]! > Math.PI) corr[i] = corr[i]! - 2 * Math.PI;
        while (corr[i]! - corr[prev]! < -Math.PI) corr[i] = corr[i]! + 2 * Math.PI;
        for (let j = prev + 1; j < i; j++) corr[j] = corr[prev]! + ((corr[i]! - corr[prev]!) * (j - prev)) / (i - prev);
      }
      prev = i;
    }
    // and eased (a 10 m moving average: no roll step where a steep run ends)
    const c0 = Float64Array.from(corr);
    for (let i = 0; i < n; i++) {
      let s = 0;
      let k = 0;
      for (let j = Math.max(0, i - 10); j <= Math.min(n - 1, i + 10); j++) {
        s += c0[j]!;
        k++;
      }
      corr[i] = s / k;
    }
  }

  // the heartline roll: one full turn over the roll's crest, eased
  const rollFrom = nearest(solved.marks.find((m) => m.name === "rollFrom")!.p);
  const rollTo = nearest(solved.marks.find((m) => m.name === "rollTo")!.p);
  const rollAt = (i: number): number => (i <= rollFrom || i >= rollTo ? 0 : 2 * Math.PI * S((i - rollFrom) / (rollTo - rollFrom)));
  // no physics bank in the roll (its heartline wiggle is not a turn) or the loop (its sideways step is not one either), eased over 6 m
  const loopFrom = nearest(solved.marks.find((m) => m.name === "loopFrom")!.p);
  const loopTo = nearest(solved.marks.find((m) => m.name === "loopTo")!.p);
  const near = (i: number, a: number, b: number): number => 1 - S((i < a ? a - i : i > b ? i - b : 0) / 12);
  const rollMask = (i: number): number => Math.max(near(i, rollFrom, rollTo), near(i, loopFrom, loopTo));

  // bank: lateral acceleration of the turn at the real speed (a plan curvature), eased, none where the track is steep
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = T[(i - 1 + n) % n]!;
    const b = T[(i + 1) % n]!;
    const kh = (a[0] * b[2] - a[2] * b[0]) / (2 * ds); // plan curvature, + = a right turn (the yaw grows)
    const v = (speed[i]! + speed[i + 1]!) / 2;
    const steep = Math.abs(T[i]![1]);
    const flat = Math.min(1, Math.max(0, 1 - (steep - 0.15) / 0.35));
    bank[i] = Math.atan((v * v * kh) / G) * flat * (1 - rollMask(i));
  }
  const bsm = new Float64Array(n);
  const half = 8;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -half; j <= half; j++) s += bank[(i + j + n) % n]!;
    bsm[i] = Math.max(-BANK_MAX, Math.min(BANK_MAX, s / (2 * half + 1)));
  }

  const up = new Float32Array(3 * n);
  const pos = new Float32Array(3 * n);
  const tan = new Float32Array(3 * n);
  // banked about the riders' heartline: the laid-out path is where the riders' hearts go (RIDER_HEART over the rail when level); a bank
  // swings the rail out under them instead of swinging them over the rail (no sideways jerk rolling into a turn)
  const lean = (i: number, roll: number): V3 => {
    const right = cross(T[i]!, U[i]!);
    return norm(add(mul(U[i]!, Math.cos(roll)), mul(right, Math.sin(roll))));
  };
  const Q: V3[] = new Array(n);
  const UB: V3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const plain = lean(i, corr[i]! + rollAt(i));
    const banked = lean(i, corr[i]! + bsm[i]! + rollAt(i));
    UB[i] = banked;
    Q[i] = add(P[i]!, mul(sub(plain, banked), RIDER_HEART));
  }
  for (let i = 0; i < n; i++) {
    const Ti = norm(sub(Q[(i + 1) % n]!, Q[(i - 1 + n) % n]!));
    const u = UB[i]!;
    up.set(norm(sub(u, mul(Ti, dot(u, Ti)))), 3 * i);
    pos.set(Q[i]!, 3 * i);
    tan.set(Ti, 3 * i);
  }
  const box: CoasterTrack["box"] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of Q) {
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
  const a = frameAt(track, s - 1.0, gfA);
  const b = frameAt(track, s + 1.0, gfB);
  const f = frameAt(track, s, gfF);
  const v = speedAt(track, s);
  const vf = speedAt(track, s + 2);
  const vb = speedAt(track, Math.max(0, s - 2));
  const along = (vf * vf - vb * vb) / 8; // dv/dt = d(v^2)/ds / 2, over 4 m
  // the rider's point (over the rail along up) at s - 1, s, s + 1: its velocity is v dP/ds, its acceleration v^2 d2P/ds2 + dv/dt dP/ds
  const h = RIDER_HEART;
  const px = (fr: CarFrame): number => fr.x + fr.ux * h;
  const py = (fr: CarFrame): number => fr.y + fr.uy * h;
  const pz = (fr: CarFrame): number => fr.z + fr.uz * h;
  const d1x = (px(b) - px(a)) / 2;
  const d1y = (py(b) - py(a)) / 2;
  const d1z = (pz(b) - pz(a)) / 2;
  const d1 = Math.hypot(d1x, d1y, d1z) || 1;
  // the rider's path is a little longer or shorter than the rail's (the speed is the rail's): scale to the rider's own arc
  const k = 1 / d1;
  const ax = (px(b) - 2 * px(f) + px(a)) * v * v * k * k + along * d1x * k;
  const ay = (py(b) - 2 * py(f) + py(a)) * v * v * k * k + along * d1y * k + G;
  const az = (pz(b) - 2 * pz(f) + pz(a)) * v * v * k * k + along * d1z * k;
  out.lat = (ax * f.rx + ay * f.ry + az * f.rz) / G;
  out.vert = (ax * f.ux + ay * f.uy + az * f.uz) / G;
  out.long = (ax * f.tx + ay * f.ty + az * f.tz) / G;
  return out;
}
const gfA = emptyFrame();
const gfB = emptyFrame();
const gfF = emptyFrame();
