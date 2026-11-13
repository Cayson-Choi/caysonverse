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

/** One clockwise lap (seen from above, angle decreasing) from the stop back to the stop, in 5 degree chords. */
function ringRoute(): readonly TransitPoint[] {
  const pts: TransitPoint[] = [];
  for (let i = 0; i <= ROUTE_STEPS; i++) {
    const a = ROUTE_START_ANGLE - (i / ROUTE_STEPS) * Math.PI * 2;
    pts.push(i === 0 || i === ROUTE_STEPS ? { ...STOP_POINT } : { x: ROUTE_RADIUS * Math.cos(a), z: ROUTE_RADIUS * Math.sin(a) });
  }
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
const PARKED_POSE: TransitPose = { x: STOP_POINT.x, z: STOP_POINT.z, yaw: Math.PI };

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

/**
 * The signalised crossings on the route, in the order the bus meets them. The bus runs clockwise (angle decreasing), so a
 * crossing at angle a is reached `((start - a) mod 2pi) * R` metres into the lap, and the bus waits that far short of it
 * minus the stop line's distance (the nose `stopLineM` before the crosswalk's centre, the bus's centre half a bus further).
 */
export const TRANSIT_HOLDS: readonly TransitHold[] = SIGNAL_CROSSINGS.map((c) => {
  const start = Math.atan2(TRANSIT.stop.z, TRANSIT.stop.x);
  const arc = mod(start - c.angle, Math.PI * 2) * ROUTE_RADIUS;
  return { id: c.id, distance: arc - (TRANSIT.stopLineM + TRANSIT.busLengthM / 2), offsetMs: 0 };
}).sort((x, y) => x.distance - y.distance);

export interface TripTimeline {
  /** per hold: when the bus arrives at the stop line and when it may go on */
  holds: { arriveMs: number; releaseMs: number; distance: number }[];
  /** when the bus is back at the stop */
  endMs: number;
}

/** The timeline of a trip that leaves the stop at `startMs`: constant speed, a wait at each crossing until its signal is green. */
export function tripTimeline(startMs: number): TripTimeline {
  const length = routeLength();
  const speed = length / TRANSIT.lapMs; // m per ms while moving
  let t = startMs;
  let s = 0;
  const holds: TripTimeline["holds"] = [];
  for (const h of TRANSIT_HOLDS) {
    t += (h.distance - s) / speed;
    const arriveMs = t;
    t = nextGreenAt(t, h.offsetMs, clearCrosswalkMs(speed));
    holds.push({ arriveMs, releaseMs: t, distance: h.distance });
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
    if (utcMs < h.arriveMs) return { distance: s + (utcMs - t) * speed, waiting: false };
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
