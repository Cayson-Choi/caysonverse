/**
 * Shared transit schedule and signal math for the village bus.
 *
 * The server can use this clock to publish an authoritative trip snapshot; the
 * client uses the same pure functions for interpolation and signal lights.
 */

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

export const TRANSIT = {
  hourMs: 60 * 60 * 1000,
  lapMs: 3 * 60 * 1000,
  boardingMs: 30 * 1000,
  signalCycleMs: 40 * 1000,
  signalGreenMs: 22 * 1000,
  signalAmberMs: 3 * 1000,
  pedestrianWalkMs: 18 * 1000,
  pedestrianFlashingMs: 4 * 1000,
  stop: { x: 34.2, z: -5.75 } as TransitPoint,
  route: [
    { x: 34.2, z: -5.75 },
    { x: 24.1, z: -24.1 },
    { x: 0, z: -34 },
    { x: -24.1, z: -24.1 },
    { x: -34, z: 0 },
    { x: -24.1, z: 24.1 },
    { x: 0, z: 34 },
    { x: 24.1, z: 24.1 },
    { x: 34.2, z: -5.75 },
  ] as readonly TransitPoint[],
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

/** The scheduled trip and bus pose at an absolute UTC timestamp. */
export function busTripAt(utcMs: number): BusTrip {
  const hour = Math.floor(utcMs / TRANSIT.hourMs) * TRANSIT.hourMs;
  const elapsed = Math.max(0, utcMs - hour);
  const nextStartMs = hour + TRANSIT.hourMs;
  if (elapsed < TRANSIT.lapMs) {
    const progress = elapsed / TRANSIT.lapMs;
    return { tripId: hour, startMs: hour, nextStartMs, status: "inTransit", progress, pose: routePoseAt(progress) };
  }
  const boardingStart = nextStartMs - TRANSIT.boardingMs;
  if (utcMs >= boardingStart) {
    return {
      tripId: nextStartMs,
      startMs: nextStartMs,
      nextStartMs: nextStartMs + TRANSIT.hourMs,
      status: "boarding",
      progress: 0,
      pose: routePoseAt(0),
    };
  }
  return { tripId: hour, startMs: hour, nextStartMs, status: "atStop", progress: 1, pose: routePoseAt(1) };
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

/** Pedestrian phase is intentionally offset from the bus phase so the two signals are visibly independent. */
export function pedestrianSignalAt(utcMs: number, offsetMs = 8_000): PedestrianSignalState {
  const elapsed = mod(utcMs + offsetMs, TRANSIT.signalCycleMs);
  if (elapsed < TRANSIT.pedestrianWalkMs) {
    return { color: "walk", remainingMs: TRANSIT.pedestrianWalkMs - elapsed, canCross: true };
  }
  if (elapsed < TRANSIT.pedestrianWalkMs + TRANSIT.pedestrianFlashingMs) {
    return { color: "flashing", remainingMs: TRANSIT.pedestrianWalkMs + TRANSIT.pedestrianFlashingMs - elapsed, canCross: false };
  }
  return { color: "stop", remainingMs: TRANSIT.signalCycleMs - elapsed, canCross: false };
}
