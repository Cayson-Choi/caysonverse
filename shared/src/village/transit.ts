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

/**
 * The bus's lane on the ring road: the road is R 31..37 with its yellow centre line at R 34, so the bus's lane (the outer
 * one, where the stop is: it runs clockwise, keeping right) is R 34..37 and its kerb's face is at R 37. The bus (2.5 x 9 m,
 * a straight box on a curve) runs and stops with its centre on this circle: its inner side's middle is 0.15 m off the
 * centre line's middle (0.075 m clear of the paint), its door side's middle 0.35 m off the kerb, its rear and front
 * corners 0.075 m off it (owner 2026-11-15: "버스가 도로 폭에 맞게 잘 정지한 상태로 있도록 해": the bus stood axis-aligned
 * on the curve, its rear 1.1 m over the centre line). `busFootprint` / transit.test.ts check it.
 */
export const BUS_LANE_RADIUS = 35.4;
/** Kept for the route's callers: the bus runs on its lane's circle. */
export const ROUTE_RADIUS = BUS_LANE_RADIUS;
/**
 * Where the stop is on the ring (rad, atan2(z, x)): the parked bus's tail 1 m short of the bus crossing's zebra (review
 * r1), its doors on the waiting pad (villageLayout.ts BUS_STOP_PAD), parallel to the kerb.
 */
export const BUS_STOP_ANGLE = -0.19;
/** A point on the bus's lane circle at `angle`, heading clockwise along it (the heading (sin a, -cos a): yaw = atan2 of it). */
export function laneAt(angle: number, radius: number = BUS_LANE_RADIUS): TransitPose {
  return { x: radius * Math.cos(angle), z: radius * Math.sin(angle), yaw: Math.atan2(Math.sin(angle), -Math.cos(angle)) };
}
const STOP_POSE = laneAt(BUS_STOP_ANGLE);
const STOP_POINT: TransitPoint = { x: STOP_POSE.x, z: STOP_POSE.z };
/** The ring is sampled every 0.5 degree (0.31 m chords): the pose is read from this table, with the heading blended between its points, so the bus never turns in steps. */
const ROUTE_STEPS = 720;

/** The parked bus's heading: along the lane at the stop, parallel to the kerb (nose north-north-west, the way it runs). */
const PARKED_YAW = STOP_POSE.yaw;

/**
 * One clockwise lap (seen from above, angle decreasing) from the stop back to the stop, on the lane's circle in 0.5 degree
 * chords. The stop is on that circle and the parked bus heads along it, so the bus pulls away and rolls in along its lane
 * with no swing and no turn on the spot (review r2), and never leaves the lane.
 */
function ringRoute(): readonly TransitPoint[] {
  const step = (Math.PI * 2) / ROUTE_STEPS;
  const pts: TransitPoint[] = [];
  for (let i = 0; i <= ROUTE_STEPS; i++) {
    const p = laneAt(BUS_STOP_ANGLE - i * step);
    pts.push({ x: p.x, z: p.z });
  }
  pts[0] = { ...STOP_POINT };
  pts[pts.length - 1] = { ...STOP_POINT };
  return pts;
}

/**
 * The bus's footprint (its body's plan rectangle, 2.5 x 9 m) at a pose: four corners, front-left, front-right,
 * rear-right, rear-left (right = the door side). `grow` widens it on every side.
 */
export function busFootprint(pose: TransitPose, size: { x: number; z: number } = { x: 2.5, z: 9 }, grow = 0): TransitPoint[] {
  const f = { x: Math.sin(pose.yaw), z: Math.cos(pose.yaw) }; // forward
  const r = { x: -f.z, z: f.x }; // the bus's right (doors): forward turned a quarter clockwise seen from above
  const hl = size.z / 2 + grow;
  const hw = size.x / 2 + grow;
  const at = (a: number, b: number): TransitPoint => ({ x: pose.x + f.x * a + r.x * b, z: pose.z + f.z * a + r.z * b });
  return [at(hl, -hw), at(hl, hw), at(-hl, hw), at(-hl, -hw)];
}

export const TRANSIT = {
  departureEveryMs: 10 * 60 * 1000, // every 10 minutes (owner 2026-11-13, for testing rides; was 30)
  lapMs: 50 * 1000, // ~4.4 m/s (16 km/h) cruise on the ring (owner 2026-11-13: smooth, real bus pace)
  /**
   * Boarding opens this long before each departure (owner 2026-11-15: "버스 탑승은 출발 3분전부터 탑승이 가능하도록 하자";
   * it was 30 s). The lap (signal waits and ramps included, under 2.5 min at worst) brings the bus back to the stop long
   * before this window opens, so the bus stands parked at the stop, doors open, through all of it.
   */
  boardingMs: 3 * 60 * 1000,
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
  /** Where the parked bus's centre stands (on its lane's circle, BUS_STOP_ANGLE). */
  stop: STOP_POINT,
  /** The parked bus: at the stop, along its lane (parallel to the kerb). */
  parked: { x: STOP_POINT.x, z: STOP_POINT.z, yaw: PARKED_YAW } as TransitPose,
  /** The bus's lane (R 35.4) as a circle of 0.31 m chords from the stop round to the stop (the pose blends their headings, see routePoseAt). */
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
  // the lap leaves and returns to the stop heading along the lane, as the parked bus stands (no turn on the spot at either end)
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

/** The parked bus: at the stop, along its lane, parallel to the kerb. */
export const PARKED_POSE: TransitPose = TRANSIT.parked;

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
export const BUS_RAMP_MS = 5000;

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

const timelines = new Map<string, TripTimeline>();

/**
 * The timeline of a trip that leaves the stop at `startMs`: it eases away from rest to the lap's cruising speed, keeps it,
 * and eases to a halt at each crossing whose signal is not green for it, waits there until the signal is green, and goes
 * on; at the end it eases to a halt at the stop. A hold it can drive through (green, and enough green left for the bus's
 * whole length to clear the crosswalk) costs it nothing: it does not slow down at a green light. A bus that would reach
 * a stop line while the green is on but too short to clear the crosswalk does not stop under a green (review r2: it stood
 * 6 s under a green every hour while the HUD said red): like a driver who sees the green is stale, it cruises a little
 * slower on the way and reaches the line as the amber comes on, then waits for the next green.
 */
export function tripTimeline(startMs: number, fromDistance = 0): TripTimeline {
  const key = fromDistance === 0 ? String(startMs) : `${startMs}:${fromDistance}`;
  const hit = timelines.get(key);
  if (hit) return hit;
  const tl = buildTripTimeline(startMs, fromDistance);
  if (timelines.size >= 16) timelines.delete(timelines.keys().next().value as string);
  timelines.set(key, tl);
  return tl;
}

/** Where a bus standing within this of a hold's stop line counts as standing on it (m). */
const AT_LINE_M = 0.05;

/**
 * The timeline (uncached) of a bus that leaves rest at `startMs`, `fromDistance` m along the lap (0: the stop), and drives
 * the rest of the lap to the stop by the same rules. A bus held up on its way (busDrive.ts: someone on the road) goes on
 * from where it stood with this; standing on a hold's stop line it waits there for the green first.
 */
export function buildTripTimeline(startMs: number, fromDistance = 0): TripTimeline {
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
  let s = Math.max(0, Math.min(length, fromDistance));
  let i = 0; // the next hold the bus has not yet dealt with
  while (i < H.length && H[i]!.distance < s - AT_LINE_M) i++;
  if (length - s < AT_LINE_M) return { holds: holdsOut, legs, endMs: t };
  while (true) {
    // standing on the next hold's stop line already: wait there for a green it can clear the crosswalk in
    if (i < H.length && H[i]!.distance - s < AT_LINE_M) {
      const h = H[i]!;
      const releaseMs = nextGreenAt(t, h.offsetMs, clearCrosswalkMs(cruise));
      holdsOut.push({ fromMs: t, fromDistance: s, arriveMs: t, releaseMs, distance: h.distance, stops: releaseMs > t });
      t = releaseMs;
      s = Math.max(s, h.distance);
      i++;
      continue;
    }
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
      // a leg too short to reach the cruise in both ramps (the last one) peaks lower
      let speed = D >= cruise * T ? cruise : D / T;
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
export function busMotionAt(utcMs: number, startMs: number, fromDistance = 0): { distance: number; speed: number; waiting: boolean } {
  const tl = tripTimeline(startMs, fromDistance);
  let prev: TripLeg | null = null;
  for (const leg of tl.legs) {
    if (utcMs < leg.fromMs) return { distance: prev ? prev.toDistance : fromDistance, speed: 0, waiting: prev !== null || fromDistance > 0 };
    if (utcMs < leg.toMs) return { distance: legDistanceAt(leg, utcMs), speed: legSpeedAt(leg, utcMs) * 1000, waiting: false };
    prev = leg;
  }
  return { distance: routeLength(), speed: 0, waiting: false };
}

/** Where the bus driving a plan from rest at (`startMs`, `fromDistance`) next comes to rest after `utcMs` (m along the lap): a red light's stop line or the stop. */
export function nextRestDistance(utcMs: number, startMs: number, fromDistance = 0): number {
  const tl = tripTimeline(startMs, fromDistance);
  for (const leg of tl.legs) if (utcMs < leg.toMs) return leg.toDistance;
  return routeLength();
}

/**
 * How long before a departure boarding opens, in the words the UI and the server's notices use: "3분" (whole minutes) or
 * "30초" (under a minute).
 */
export function boardingOpensWords(boardingMs: number = TRANSIT.boardingMs): string {
  const s = Math.round(boardingMs / 1000);
  return s >= 60 && s % 60 === 0 ? `${s / 60}분` : s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
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
