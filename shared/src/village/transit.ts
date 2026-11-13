/**
 * Shared transit schedule and signal math for the village bus.
 *
 * The server can use this clock to publish an authoritative trip snapshot; the
 * client uses the same pure functions for interpolation and signal lights.
 */

import { SIGNAL_CROSSINGS } from "./crossings";

export interface TransitPoint {
  x: number;
  z: number;
}

export interface TransitPose extends TransitPoint {
  yaw: number;
}

export type BusTripStatus = "inTransit" | "atStop" | "boarding";

export interface BusTrip {
  tripId: number;
  startMs: number;
  nextStartMs: number;
  status: BusTripStatus;
  /** 0 at the stop, 1 just before returning to the stop. */
  progress: number;
  pose: TransitPose;
  /** true while the bus waits at a crosswalk for its signal */
  waiting: boolean;
}

export type SignalColor = "green" | "amber" | "red";

export interface SignalState {
  color: SignalColor;
  remainingMs: number;
  canBusProceed: boolean;
}

export type PedestrianSignalColor = "walk" | "flashing" | "stop";

export interface PedestrianSignalState {
  color: PedestrianSignalColor;
  remainingMs: number;
  canCross: boolean;
}

// review r1: the stop moved 0.85 m north (-z) so the parked bus's tail is 1.1 m clear of the crosswalk's stripes
const STOP_POINT: TransitPoint = { x: 34.1, z: -6.5 };
/** The bus runs in the middle of the outer lane (the ring road's lane is R 34..37; the bus is 2.5 m wide), not on the stop's own radius. */
export const ROUTE_RADIUS = 35.3;
const ROUTE_START_ANGLE = Math.atan2(STOP_POINT.z, STOP_POINT.x);
/** The ring is sampled every 0.5 degree (0.3 m chords): the pose is read from this table, with the heading blended between its points, so the bus never turns in steps. */
const ROUTE_STEPS = 720;

/**
 * Where the lap leaves the ring for the stop (rad, atan2(z, x) + 2pi on the way back): from here the bus pulls in along a
 * smooth curve that ends on the stop heading north, square to the shelter. Review r2: the last 5 degree chord ran straight
 * from the lane's middle (R 35.3) to the stop (R 34.7), 15 degrees off the chord before it and 19 off the parked heading,
 * so the bus swung in and turned on the spot as it stopped.
 */
const APPROACH_ANGLE = 0.25;
const APPROACH_STEPS = 96;
/** How far round the ring the pull-out from the stop joins the lane's middle (rad), in PULL_STEPS pieces. */
const PULL_OUT_ANGLE = 0.25;
const PULL_STEPS = 48;

/** The parked bus's heading: nose north (-z), the way the model, its box and the shelter are laid out. */
const PARKED_YAW = Math.PI;

/** A cubic Hermite from `a` (heading `ta`) to `b` (heading `tb`), sampled in `n` steps, without its first point. */
function hermite(a: TransitPoint, ta: TransitPoint, b: TransitPoint, tb: TransitPoint, n: number): TransitPoint[] {
  const out: TransitPoint[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    out.push({ x: h00 * a.x + h10 * ta.x + h01 * b.x + h11 * tb.x, z: h00 * a.z + h10 * ta.z + h01 * b.z + h11 * tb.z });
  }
  return out;
}

/**
 * One clockwise lap (seen from above, angle decreasing) from the stop back to the stop: out of the stop onto the lane's
 * middle, round the ring in 0.5 degree chords, and from APPROACH_ANGLE a smooth pull-in that ends on the stop heading
 * north (no turn on the spot at the end).
 */
function ringRoute(): readonly TransitPoint[] {
  const step = (Math.PI * 2) / ROUTE_STEPS;
  const ring = (a: TransitPoint["x"]): TransitPoint => ({ x: ROUTE_RADIUS * Math.cos(a), z: ROUTE_RADIUS * Math.sin(a) });
  // clockwise along the ring the heading is (sin a, -cos a); parked it is PARKED_YAW's, (sin, cos)
  const along = (a: number, m: number): TransitPoint => ({ x: Math.sin(a) * m, z: -Math.cos(a) * m });
  const parked = (m: number): TransitPoint => ({ x: Math.sin(PARKED_YAW) * m, z: Math.cos(PARKED_YAW) * m });
  const pts: TransitPoint[] = [{ ...STOP_POINT }];
  // pull out: a smooth curve from the stop onto the lane's middle (review r2: the first chord turned 16 degrees at once)
  const out = ROUTE_START_ANGLE - PULL_OUT_ANGLE;
  const outSpan = Math.hypot(ring(out).x - STOP_POINT.x, ring(out).z - STOP_POINT.z);
  pts.push(...hermite(STOP_POINT, parked(outSpan), ring(out), along(out, outSpan), PULL_STEPS));
  let a = out - step;
  const last = APPROACH_ANGLE - Math.PI * 2;
  for (; a >= last; a -= step) pts.push(ring(a));
  // pull in: from the ring onto the stop, heading north at the end (no turn on the spot)
  const fa = a + step;
  const from = pts[pts.length - 1]!;
  const span = Math.hypot(STOP_POINT.x - from.x, STOP_POINT.z - from.z);
  pts.push(...hermite(from, along(fa, span), STOP_POINT, parked(span), APPROACH_STEPS));
  pts[pts.length - 1] = { ...STOP_POINT };
  return pts;
}

export const TRANSIT = {
  departureEveryMs: 10 * 60 * 1000, // every 10 minutes (owner 2026-11-13, for testing rides; was 30)
  lapMs: 3 * 60 * 1000,
  boardingMs: 30 * 1000,
  /** One cycle of the crossing signals: vehicles green 0-20 s, amber 20-23, red 23-40; pedestrians stop 0-24, walk 24-34, flashing 34-38, stop 38-40. */
  signalCycleMs: 40 * 1000,
  signalGreenMs: 20 * 1000,
  signalAmberMs: 3 * 1000,
  pedestrianStartMs: 24 * 1000,
  pedestrianWalkMs: 10 * 1000,
  pedestrianFlashingMs: 4 * 1000,
  /** Where the bus's nose stops before a crosswalk's centre when the signal is not green (m along the road): 2 m of crosswalk + 3.6 m. */
  stopLineM: 5.6,
  busLengthM: 9,
  stop: { x: 34.1, z: -6.5 } as TransitPoint,
  /** The ring road's lane the bus runs in (R 35.3, the outer lane's middle; the stop's bay is at its kerb side), as a circle of 0.3 m chords (the pose blends their headings, see routePoseAt). */
  route: ringRoute(),
} as const;

const mod = (n: number, d: number): number => ((n % d) + d) % d;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function lerp(a: TransitPoint, b: TransitPoint, t: number): TransitPoint {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** A route's distance table and per-point headings, cached by the route array. */
interface RouteTable {
  /** distance (m) along the route of each point */
  cum: Float64Array;
  total: number;
  /** the heading at each point: the chord's direction through it (the one-sided chord at the ends; the parked heading at the stop) */
  yaw: Float64Array;
}
const routeTables = new WeakMap<readonly TransitPoint[], RouteTable>();

function routeTable(route: readonly TransitPoint[]): RouteTable {
  const hit = routeTables.get(route);
  if (hit) return hit;
  const n = route.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.z - route[i - 1]!.z);
  const yaw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = route[Math.max(0, i - 1)]!;
    const b = route[Math.min(n - 1, i + 1)]!;
    yaw[i] = n > 1 ? Math.atan2(b.x - a.x, b.z - a.z) : 0;
  }
  // the lap leaves and returns to the stop heading north, as the parked bus stands (no turn on the spot at either end)
  if (n > 1 && route === TRANSIT.route) {
    yaw[0] = PARKED_YAW;
    yaw[n - 1] = PARKED_YAW;
  }
  const table = { cum, total: n > 0 ? cum[n - 1]! : 0, yaw };
  routeTables.set(route, table);
  return table;
}

/** Blend two headings (rad) the short way round. */
function lerpYaw(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * The pose after `distance` metres along the route: the point between two table entries with the heading blended between
 * theirs (a smooth tangent: the route is a round arc with eased entries, not a polygon), so the pose moves and turns
 * without any step. The timeline gives the distance; the pose is read straight off it.
 */
export function routePoseAtDistance(distance: number, route: readonly TransitPoint[] = TRANSIT.route): TransitPose {
  if (route.length < 2) return { ...TRANSIT.stop, yaw: 0 };
  const table = routeTable(route);
  const d = Math.max(0, Math.min(table.total, distance));
  // the last table entry at or before d
  let lo = 0;
  let hi = route.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (table.cum[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = route[lo]!;
  const b = route[lo + 1]!;
  const len = table.cum[lo + 1]! - table.cum[lo]!;
  const t = len > 0 ? (d - table.cum[lo]!) / len : 0;
  return { ...lerp(a, b, t), yaw: lerpYaw(table.yaw[lo]!, table.yaw[lo + 1]!, t) };
}

/** Interpolate around the route and return a world-space pose. */
export function routePoseAt(progress: number, route: readonly TransitPoint[] = TRANSIT.route): TransitPose {
  if (route.length < 2) return { ...TRANSIT.stop, yaw: 0 };
  return routePoseAtDistance(clamp01(progress) * routeTable(route).total, route);
}

/** The parked bus: at the stop, nose north (-z), square to the stop's box and the shelter. */
const PARKED_POSE: TransitPose = { x: STOP_POINT.x, z: STOP_POINT.z, yaw: PARKED_YAW };

/** Total length of the route (m). */
export function routeLength(route: readonly TransitPoint[] = TRANSIT.route): number {
  return route.length < 2 ? 0 : routeTable(route).total;
}

/** A place where the bus must wait for green: its distance along the route (centre of the bus) and the crossing's signal offset. */
export interface TransitHold {
  id: string;
  /** route distance (m) of the bus's centre when its nose is on the stop line */
  distance: number;
  offsetMs: number;
}

/** The first moment at or after `utcMs` when the crossing's signal is green. */
export function nextGreenAt(utcMs: number, offsetMs = 0, clearMs = 0): number {
  const phase = mod(utcMs + offsetMs, TRANSIT.signalCycleMs);
  // a bus that needs `clearMs` to get its tail off the crosswalk may only start while that much green is left, so it is
  // never on the crosswalk when the pedestrians' walk begins (review r1: 14 s of crawling at 1.2 m/s)
  return phase < TRANSIT.signalGreenMs - clearMs ? utcMs : utcMs + (TRANSIT.signalCycleMs - phase);
}

/** Half the crosswalk's depth along the road as the bus's tail must clear it (the zebra is 4.7 m deep; a little spare). */
const CROSSWALK_HALF_M = 2.5;
/** Time for a bus standing on its stop line to drive its whole length past the crosswalk's far edge (ms): it pulls away from rest (BUS_RAMP_MS), so half a ramp longer than at the cruise `speed` m/ms. */
export function clearCrosswalkMs(speed: number): number {
  return (TRANSIT.stopLineM + CROSSWALK_HALF_M + TRANSIT.busLengthM) / speed + BUS_RAMP_MS / 2;
}

/** Distance along the route (m) where it first crosses the ray at `angle` (rad, atan2(z, x)) from the plaza's centre. */
export function routeDistanceAtAngle(angle: number, route: readonly TransitPoint[] = TRANSIT.route): number {
  let s = 0;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    // signed side of the ray's line for each end; a sign change in front of the centre is the crossing
    const da = Math.sin(angle) * a.x - Math.cos(angle) * a.z;
    const db = Math.sin(angle) * b.x - Math.cos(angle) * b.z;
    if (da !== db && (da === 0 || Math.sign(da) !== Math.sign(db))) {
      const t = da / (da - db);
      const p = lerp(a, b, t);
      if (p.x * Math.cos(angle) + p.z * Math.sin(angle) > 0) return s + len * t;
    }
    s += len;
  }
  return s;
}

/**
 * The signalised crossings on the route, in the order the bus meets them (it runs clockwise, angle decreasing): each is
 * where the route crosses the crossing's centre line, and the bus waits that far short of it minus the stop line's
 * distance (the nose `stopLineM` before the crosswalk's centre, the bus's centre half a bus further).
 */
export const TRANSIT_HOLDS: readonly TransitHold[] = SIGNAL_CROSSINGS.map((c) => ({
  id: c.id,
  distance: routeDistanceAtAngle(c.angle) - (TRANSIT.stopLineM + TRANSIT.busLengthM / 2),
  offsetMs: 0,
})).sort((x, y) => x.distance - y.distance);

/**
 * The time (ms) the bus takes to ease its speed up from a standstill to the cruise (and down again): the speed follows a
 * raised cosine, v = vp (1 - cos(pi t / T)) / 2, so the speed AND the acceleration are continuous (no jerk at either
 * end): it pulls away from the stop and from a red light gently, and rolls to a halt at a stop line or at the stop.
 */
export const BUS_RAMP_MS = 4000;

export interface TripLeg {
  /** it starts at rest at `fromMs`, `fromDistance` (m along the route), ends at rest at `toMs`, `toDistance` */
  fromMs: number;
  fromDistance: number;
  toMs: number;
  toDistance: number;
  /** the leg's cruising speed (m/ms): the lap's, or a little less where the bus eases off for a light it could not clear */
  speed: number;
}

export interface TripTimeline {
  /**
   * per hold: when the bus last left rest before it (`fromMs`, `fromDistance`), when it reaches the stop line and when it
   * may go on. A hold it can drive through at speed (green with enough time left to clear the crosswalk) has
   * `arriveMs === releaseMs` and `stops: false`: the bus does not slow down for it.
   */
  holds: { fromMs: number; fromDistance: number; arriveMs: number; releaseMs: number; distance: number; stops: boolean }[];
  /** the rest-to-rest legs of the trip, in order; between one leg's end and the next one's start the bus waits at a signal */
  legs: TripLeg[];
  /** when the bus is back at the stop */
  endMs: number;
}

/** Distance (m) a leg's bus has covered `tau` ms after leaving rest (`dur` the leg's whole time, `speed` its cruise, m/ms). */
export function legDistanceAt(leg: Pick<TripLeg, "speed" | "fromMs" | "toMs" | "fromDistance" | "toDistance">, utcMs: number): number {
  const T = BUS_RAMP_MS;
  const dur = leg.toMs - leg.fromMs;
  const tau = Math.max(0, Math.min(dur, utcMs - leg.fromMs));
  const ramp = (x: number): number => leg.speed * (x / 2 - (T / (2 * Math.PI)) * Math.sin((Math.PI * x) / T));
  if (tau < T) return leg.fromDistance + ramp(tau);
  const left = dur - tau;
  if (left < T) return leg.toDistance - ramp(left);
  return leg.fromDistance + (leg.speed * T) / 2 + leg.speed * (tau - T);
}

/** The speed (m/ms) of a leg's bus `tau` after it left rest. */
export function legSpeedAt(leg: Pick<TripLeg, "speed" | "fromMs" | "toMs">, utcMs: number): number {
  const T = BUS_RAMP_MS;
  const dur = leg.toMs - leg.fromMs;
  const tau = utcMs - leg.fromMs;
  if (tau <= 0 || tau >= dur) return 0;
  const eased = (x: number): number => (leg.speed * (1 - Math.cos((Math.PI * x) / T))) / 2;
  if (tau < T) return eased(tau);
  if (dur - tau < T) return eased(dur - tau);
  return leg.speed;
}

/** How long a rest-to-rest leg of `distance` m takes at cruise `speed` (m/ms): both ramps, and the cruise between them. */
function legDuration(distance: number, speed: number): number {
  return distance >= speed * BUS_RAMP_MS ? distance / speed + BUS_RAMP_MS : 2 * BUS_RAMP_MS;
}

const timelines = new Map<number, TripTimeline>();

/**
 * The timeline of a trip that leaves the stop at `startMs`: it eases away from rest to the lap's cruising speed, keeps it,
 * and eases to a halt at each crossing whose signal is not green for it, waits there until the signal is green, and goes
 * on; at the end it eases to a halt at the stop. A hold it can drive through (green, and enough green left for the bus's
 * whole length to clear the crosswalk) costs it nothing: it does not slow down at a green light. A bus that would reach
 * a stop line while the green is on but too short to clear the crosswalk does not stop under a green (review r2: it stood
 * 6 s under a green every hour while the HUD said red): like a driver who sees the green is stale, it cruises a little
 * slower on the way and reaches the line as the amber comes on, then waits for the next green.
 */
export function tripTimeline(startMs: number): TripTimeline {
  const hit = timelines.get(startMs);
  if (hit) return hit;
  const tl = buildTimeline(startMs);
  if (timelines.size >= 16) timelines.delete(timelines.keys().next().value as number);
  timelines.set(startMs, tl);
  return tl;
}

function buildTimeline(startMs: number): TripTimeline {
  const length = routeLength();
  const cruise = length / TRANSIT.lapMs; // m per ms
  const T = BUS_RAMP_MS;
  const cycle = TRANSIT.signalCycleMs;
  const holdsOut: TripTimeline["holds"] = [];
  const legs: TripLeg[] = [];
  const H = TRANSIT_HOLDS;
  /** drive-through test: the bus reaches the line at `arrive` at speed `v`; the green must outlast its clearing the crosswalk */
  const canPass = (h: TransitHold, arrive: number, v: number): boolean =>
    mod(arrive + h.offsetMs, cycle) < TRANSIT.signalGreenMs - (TRANSIT.stopLineM + CROSSWALK_HALF_M + TRANSIT.busLengthM) / v;

  let t = startMs;
  let s = 0;
  let i = 0; // the next hold the bus has not yet dealt with
  while (true) {
    // the first hold from here the bus cannot drive through at the cruise (or the end of the route)
    let j = i;
    for (; j < H.length; j++) {
      const h = H[j]!;
      if (!canPass(h, t + (h.distance - s) / cruise + T / 2, cruise)) break;
    }
    let to: { distance: number; arrive: number; speed: number };
    for (;;) {
      const distance = j < H.length ? H[j]!.distance : length;
      const D = distance - s;
      let speed = cruise;
      let arrive = t + legDuration(D, cruise);
      if (j < H.length) {
        const h = H[j]!;
        // from a standstill at the line the bus needs a little longer to clear the crosswalk than at speed
        const clearMs = clearCrosswalkMs(cruise);
        const phase = mod(arrive + h.offsetMs, cycle);
        if (phase >= TRANSIT.signalGreenMs - clearMs && phase < TRANSIT.signalGreenMs) {
          arrive += TRANSIT.signalGreenMs - phase;
          speed = D / (Math.max(arrive - t, 2 * T) - T); // the slower cruise that makes the leg take that long
        }
      }
      // the holds it drives through on this leg are met at this leg's own speed: the slower one may not clear them any more
      let bad = -1;
      for (let k = i; k < j && bad < 0; k++) {
        const h = H[k]!;
        if (!canPass(h, t + (h.distance - s) / speed + T / 2, speed)) bad = k;
      }
      if (bad < 0) {
        to = { distance, arrive, speed };
        break;
      }
      j = bad; // stop there instead
    }
    // the passed holds
    for (let k = i; k < j; k++) {
      const h = H[k]!;
      const at = t + (h.distance - s) / to.speed + T / 2;
      holdsOut.push({ fromMs: t, fromDistance: s, arriveMs: at, releaseMs: at, distance: h.distance, stops: false });
    }
    legs.push({ fromMs: t, fromDistance: s, toMs: to.arrive, toDistance: to.distance, speed: to.speed });
    if (j >= H.length) return { holds: holdsOut, legs, endMs: to.arrive };
    const h = H[j]!;
    const clearMs = clearCrosswalkMs(cruise);
    const releaseMs = nextGreenAt(to.arrive, h.offsetMs, clearMs);
    holdsOut.push({ fromMs: t, fromDistance: s, arriveMs: to.arrive, releaseMs, distance: h.distance, stops: true });
    t = releaseMs;
    s = h.distance;
    i = j + 1;
  }
}

/** Distance along the route (m) of the bus at `utcMs` during a trip from `startMs`, its speed (m/s), and whether it is waiting at a signal. */
export function busMotionAt(utcMs: number, startMs: number): { distance: number; speed: number; waiting: boolean } {
  const tl = tripTimeline(startMs);
  let prev: TripLeg | null = null;
  for (const leg of tl.legs) {
    if (utcMs < leg.fromMs) return { distance: prev ? prev.toDistance : 0, speed: 0, waiting: prev !== null };
    if (utcMs < leg.toMs) return { distance: legDistanceAt(leg, utcMs), speed: legSpeedAt(leg, utcMs) * 1000, waiting: false };
    prev = leg;
  }
  return { distance: routeLength(), speed: 0, waiting: false };
}

/** The scheduled trip and bus pose at an absolute UTC timestamp. */
export function busTripAt(utcMs: number): BusTrip {
  const hour = Math.floor(utcMs / TRANSIT.departureEveryMs) * TRANSIT.departureEveryMs;
  const nextStartMs = hour + TRANSIT.departureEveryMs;
  const end = tripTimeline(hour).endMs;
  if (utcMs < end) {
    const { distance, waiting } = busMotionAt(utcMs, hour);
    const length = routeLength();
    return { tripId: hour, startMs: hour, nextStartMs, status: "inTransit", progress: distance / length, pose: routePoseAtDistance(distance), waiting };
  }
  const boardingStart = nextStartMs - TRANSIT.boardingMs;
  if (utcMs >= boardingStart) {
    return {
      tripId: nextStartMs,
      startMs: nextStartMs,
      nextStartMs: nextStartMs + TRANSIT.departureEveryMs,
      status: "boarding",
      progress: 0,
      pose: PARKED_POSE,
      waiting: false,
    };
  }
  return { tripId: hour, startMs: hour, nextStartMs, status: "atStop", progress: 1, pose: PARKED_POSE, waiting: false };
}

/** A deterministic signal cycle. offsetMs lets nearby crossings change out of phase. */
export function signalAt(utcMs: number, offsetMs = 0): SignalState {
  const elapsed = mod(utcMs + offsetMs, TRANSIT.signalCycleMs);
  const redMs = TRANSIT.signalCycleMs - TRANSIT.signalGreenMs - TRANSIT.signalAmberMs;
  if (elapsed < TRANSIT.signalGreenMs) {
    return { color: "green", remainingMs: TRANSIT.signalGreenMs - elapsed, canBusProceed: true };
  }
  if (elapsed < TRANSIT.signalGreenMs + TRANSIT.signalAmberMs) {
    return {
      color: "amber",
      remainingMs: TRANSIT.signalGreenMs + TRANSIT.signalAmberMs - elapsed,
      canBusProceed: false,
    };
  }
  return {
    color: "red",
    remainingMs: redMs - (elapsed - TRANSIT.signalGreenMs - TRANSIT.signalAmberMs),
    canBusProceed: false,
  };
}

/**
 * The pedestrian phase of the same cycle (walk only while the vehicles are red): stop until 24 s, the walking figure for
 * 10 s, the flashing figure for 4 s (finish crossing, do not start), then stop for the last 2 s while the vehicles'
 * red is still on. Never overlaps the vehicles' green or amber.
 */
export function pedestrianSignalAt(utcMs: number, offsetMs = 0): PedestrianSignalState {
  const e = mod(utcMs + offsetMs, TRANSIT.signalCycleMs);
  const walkEnd = TRANSIT.pedestrianStartMs + TRANSIT.pedestrianWalkMs;
  const flashEnd = walkEnd + TRANSIT.pedestrianFlashingMs;
  if (e >= TRANSIT.pedestrianStartMs && e < walkEnd) return { color: "walk", remainingMs: walkEnd - e, canCross: true };
  if (e >= walkEnd && e < flashEnd) return { color: "flashing", remainingMs: flashEnd - e, canCross: false };
  // stop: until the walk starts (this cycle or the next one)
  const untilWalk = e < TRANSIT.pedestrianStartMs ? TRANSIT.pedestrianStartMs - e : TRANSIT.signalCycleMs - e + TRANSIT.pedestrianStartMs;
  return { color: "stop", remainingMs: untilWalk, canCross: false };
}
