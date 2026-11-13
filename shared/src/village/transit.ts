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
const ROUTE_STEPS = 72;

/**
 * Where the lap leaves the ring for the stop (rad, atan2(z, x) + 2pi on the way back): from here the bus pulls in along a
 * smooth curve that ends on the stop heading north, square to the shelter. Review r2: the last 5 degree chord ran straight
 * from the lane's middle (R 35.3) to the stop (R 34.7), 15 degrees off the chord before it and 19 off the parked heading,
 * so the bus swung in and turned on the spot as it stopped.
 */
const APPROACH_ANGLE = 0.25;
const APPROACH_STEPS = 16;
/** How far round the ring the pull-out from the stop joins the lane's middle (rad), in PULL_STEPS pieces. */
const PULL_OUT_ANGLE = 0.25;
const PULL_STEPS = 8;

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
 * middle, round the ring in 5 degree chords, and from APPROACH_ANGLE a smooth pull-in that ends on the stop heading
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
  hourMs: 60 * 60 * 1000,
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
  /** The ring road's lane the bus runs in (R 35.3, the outer lane's middle; the stop's bay is at its kerb side), as a circle of short chords. */
  route: ringRoute(),
} as const;

const mod = (n: number, d: number): number => ((n % d) + d) % d;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function lerp(a: TransitPoint, b: TransitPoint, t: number): TransitPoint {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Interpolate around the route and return a world-space pose. */
export function routePoseAt(progress: number, route: readonly TransitPoint[] = TRANSIT.route): TransitPose {
  if (route.length < 2) return { ...TRANSIT.stop, yaw: 0 };
  const p = clamp01(progress);
  const distances: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < route.length; i++) {
    const d = Math.hypot(route[i + 1]!.x - route[i]!.x, route[i + 1]!.z - route[i]!.z);
    distances.push(d);
    total += d;
  }
  let target = p * total;
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i]!;
    if (target <= d || i === distances.length - 1) {
      const a = route[i]!;
      const b = route[i + 1]!;
      const t = d > 0 ? target / d : 0;
      return { ...lerp(a, b, t), yaw: Math.atan2(b.x - a.x, b.z - a.z) };
    }
    target -= d;
  }
  const end = route[route.length - 1]!;
  return { ...end, yaw: 0 };
}

/** The parked bus: at the stop, nose north (-z), square to the stop's box and the shelter. */
const PARKED_POSE: TransitPose = { x: STOP_POINT.x, z: STOP_POINT.z, yaw: PARKED_YAW };

/** Total length of the route (m). */
export function routeLength(route: readonly TransitPoint[] = TRANSIT.route): number {
  let total = 0;
  for (let i = 0; i + 1 < route.length; i++) total += Math.hypot(route[i + 1]!.x - route[i]!.x, route[i + 1]!.z - route[i]!.z);
  return total;
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
/** Time for a bus standing on its stop line to drive its whole length past the crosswalk's far edge (ms) at `speed` m/ms. */
export function clearCrosswalkMs(speed: number): number {
  return (TRANSIT.stopLineM + CROSSWALK_HALF_M + TRANSIT.busLengthM) / speed;
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

export interface TripTimeline {
  /**
   * per hold: when the bus leaves the previous point (`fromMs`, `fromDistance`), when it reaches the stop line and when
   * it may go on. The leg up to the line is at a constant speed, normally the lap's; slower when the bus eases off for
   * a green it could not clear (see tripTimeline).
   */
  holds: { fromMs: number; fromDistance: number; arriveMs: number; releaseMs: number; distance: number }[];
  /** when the bus is back at the stop */
  endMs: number;
}

/**
 * The timeline of a trip that leaves the stop at `startMs`: constant speed, a wait at each crossing until its signal is
 * green. A bus that would reach a stop line while the green is on but too short to clear the crosswalk does not stop at
 * a green light (review r2: it stood 6 s under a green every hour while the HUD said red): like a driver who sees the
 * green is stale, it eases off on the way and reaches the line as the amber comes on, then waits for the next green.
 */
export function tripTimeline(startMs: number): TripTimeline {
  const length = routeLength();
  const speed = length / TRANSIT.lapMs; // m per ms while moving
  const clearMs = clearCrosswalkMs(speed);
  let t = startMs;
  let s = 0;
  const holds: TripTimeline["holds"] = [];
  for (const h of TRANSIT_HOLDS) {
    let arriveMs = t + (h.distance - s) / speed;
    const phase = mod(arriveMs + h.offsetMs, TRANSIT.signalCycleMs);
    if (phase >= TRANSIT.signalGreenMs - clearMs && phase < TRANSIT.signalGreenMs) arriveMs += TRANSIT.signalGreenMs - phase;
    const releaseMs = nextGreenAt(arriveMs, h.offsetMs, clearMs);
    holds.push({ fromMs: t, fromDistance: s, arriveMs, releaseMs, distance: h.distance });
    t = releaseMs;
    s = h.distance;
  }
  return { holds, endMs: t + (length - s) / speed };
}

/** Distance along the route (m) of the bus at `utcMs` during a trip from `startMs`, and whether it is waiting at a signal. */
function routeDistanceAt(utcMs: number, startMs: number): { distance: number; waiting: boolean } {
  const tl = tripTimeline(startMs);
  const length = routeLength();
  const speed = length / TRANSIT.lapMs;
  let t = startMs;
  let s = 0;
  for (const h of tl.holds) {
    if (utcMs < h.arriveMs) {
      const k = h.arriveMs > h.fromMs ? (utcMs - h.fromMs) / (h.arriveMs - h.fromMs) : 1;
      return { distance: h.fromDistance + (h.distance - h.fromDistance) * k, waiting: false };
    }
    if (utcMs < h.releaseMs) return { distance: h.distance, waiting: true };
    t = h.releaseMs;
    s = h.distance;
  }
  return { distance: Math.min(length, s + (utcMs - t) * speed), waiting: false };
}

/** The scheduled trip and bus pose at an absolute UTC timestamp. */
export function busTripAt(utcMs: number): BusTrip {
  const hour = Math.floor(utcMs / TRANSIT.hourMs) * TRANSIT.hourMs;
  const nextStartMs = hour + TRANSIT.hourMs;
  const end = tripTimeline(hour).endMs;
  if (utcMs < end) {
    const { distance, waiting } = routeDistanceAt(utcMs, hour);
    const progress = distance / routeLength();
    return { tripId: hour, startMs: hour, nextStartMs, status: "inTransit", progress, pose: routePoseAt(progress), waiting };
  }
  const boardingStart = nextStartMs - TRANSIT.boardingMs;
  if (utcMs >= boardingStart) {
    return {
      tripId: nextStartMs,
      startMs: nextStartMs,
      nextStartMs: nextStartMs + TRANSIT.hourMs,
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
