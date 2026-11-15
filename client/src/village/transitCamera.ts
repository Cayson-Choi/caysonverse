import type { TransitPose } from "@caysonverse/shared/village/transit";
import { busPlace } from "@caysonverse/shared/village/busSeats";

export interface TransitCameraPose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

/**
 * A modest passenger eye point, just behind the front half of the cabin, aimed
 * through the right-side window. The bus route yaw uses the same `atan2(dx,dz)`
 * convention as this helper, so the view follows a moving bus without a snap.
 */
export function transitWindowCamera(pose: TransitPose, eyeHeight = 1.62): TransitCameraPose {
  const forwardX = Math.sin(pose.yaw);
  const forwardZ = Math.cos(pose.yaw);
  const rightX = Math.cos(pose.yaw);
  const rightZ = -Math.sin(pose.yaw);
  const x = pose.x + forwardX * 0.8;
  const z = pose.z + forwardZ * 0.8;
  return {
    x,
    y: eyeHeight,
    z,
    targetX: x + rightX * 9,
    targetY: eyeHeight - 0.08,
    targetZ: z + rightZ * 9,
  };
}


/** The rider's lens (vertical degrees): wider than the village's 55 in the small cabin, wider still on a portrait phone. */
export function riderFov(aspect: number): number {
  return aspect < 1 ? 78 : 68;
}

/** A thin thing in the cabin (bus-local m: `ahead` of the bus's centre, `right` towards the doors, then up) as a segment. */
interface CabinBar {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
}

/** build_bus.py's xf (m back from the nose) → ahead of the bus's centre. */
const aheadOf = (xf: number) => 4.5 - xf;

/**
 * The cabin's stanchions, ceiling rails and hand straps (art/village/tools/build_bus.py, "stanchions, ceiling rails and
 * hand straps"): what the rider's camera must not look through (checker r2: a rail and straps cut across the avatar's
 * shoulders and neck). Bus-local segments.
 */
export const CABIN_BARS: readonly CabinBar[] = (() => {
  const bars: CabinBar[] = [];
  const poles: Array<[number, number]> = [
    [1.0, 0.45], [1.0, 1.45], [-0.33, 1.32], [1.0, 4.33], [1.0, 5.77], [0.32, 3.2], [0.32, 6.12], [-0.32, 6.12], [0.32, 7.05], [-0.32, 7.05],
  ];
  for (const [X, xf] of poles) bars.push({ a: [aheadOf(xf), X, xf < 6 ? 0.34 : 0.75], b: [aheadOf(xf), X, 2.5] });
  // the fare terminals by both doors (a post and its reader, up to ~1.6 m) and the driver's screen's post
  bars.push({ a: [aheadOf(0.95), 0.25, 0.34], b: [aheadOf(0.95), 0.25, 1.62] });
  bars.push({ a: [aheadOf(5.83), 0.8, 0.34], b: [aheadOf(5.83), 0.8, 1.62] });
  bars.push({ a: [aheadOf(1.32), -0.33, 0.34], b: [aheadOf(1.32), -0.33, 1.75] });
  for (const s of [1, -1]) {
    bars.push({ a: [aheadOf(1.5), s * 0.42, 2.5], b: [aheadOf(1.6), s * 0.42, 2.0] }); // the rail's bend up to the ceiling
    bars.push({ a: [aheadOf(1.6), s * 0.42, 2.0], b: [aheadOf(8.0), s * 0.42, 2.0] });
    bars.push({ a: [aheadOf(8.0), s * 0.42, 2.0], b: [aheadOf(8.1), s * 0.42, 2.5] });
    for (let k = 0; k < 8; k++) {
      const xf = 1.9 + k * 0.5;
      bars.push({ a: [aheadOf(xf), s * 0.42, 1.67], b: [aheadOf(xf), s * 0.42, 2.0] });
    }
  }
  return bars;
})();

/** A box in the cabin (bus-local: ahead, right, height ranges). */
interface CabinBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * The seats' backrests (build_bus.py cabin() "seats": each `seat(xf, X, floor)` has its backrest 0.185 m behind the
 * cushion, 0.43 m wide, up to its grab handle ~1.08 m over its floor). A sight line through one is hidden by it.
 */
export const SEAT_BACKS: readonly CabinBox[] = (() => {
  const boxes: CabinBox[] = [];
  const add = (xf: number, X: number, floor: number) =>
    boxes.push({ min: [aheadOf(xf + 0.26), X - 0.215, floor + 0.4], max: [aheadOf(xf + 0.12), X + 0.215, floor + 1.08] });
  add(1.02, -0.62, 0.34); // the driver's
  for (const X of [0.97, -0.97]) add(2.35, X, 0.8);
  for (const X of [0.97, 0.55]) add(3.55, X, 0.34);
  for (const xf of [3.35, 4.05]) for (const X of [-0.97, -0.55]) add(xf, X, 0.34);
  // the two side-facing seats on the wheelchair bay: their backs against the wall
  for (const xf of [4.75, 5.25]) boxes.push({ min: [aheadOf(xf + 0.215), -1.2, 0.74], max: [aheadOf(xf - 0.215), -1.07, 1.42] });
  for (const xf of [6.65, 7.4]) for (const X of [0.97, 0.55, -0.55, -0.97]) add(xf, X, Math.abs(X) > 0.8 ? 0.86 : 0.75);
  for (const X of [-0.9, -0.45, 0, 0.45, 0.9]) add(8.35, X, 0.75);
  return boxes;
})();

/** Does the segment p-q pass through the box (slab test)? */
export function segmentHitsBox(p: readonly number[], q: readonly number[], box: CabinBox): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = q[i]! - p[i]!;
    if (Math.abs(d) < 1e-12) {
      if (p[i]! < box.min[i]! || p[i]! > box.max[i]!) return false;
      continue;
    }
    let a = (box.min[i]! - p[i]!) / d;
    let b = (box.max[i]! - p[i]!) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** Distance from a point to a box (0 inside). */
function boxDistance(p: readonly number[], box: CabinBox): number {
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const v = p[i]!;
    const e = v < box.min[i]! ? box.min[i]! - v : v > box.max[i]! ? v - box.max[i]! : 0;
    d2 += e * e;
  }
  return Math.sqrt(d2);
}

/** The cabin floor (m) under a bus-local spot: the raised rear (xf >= 6), the front wheel-arch platforms, else low. */
function cabinFloor(ahead: number, right: number): number {
  const xf = 4.5 - ahead;
  if (xf >= 6.0) return 0.75;
  if (xf >= 1.9 && xf <= 2.8 && Math.abs(right) > 0.5) return 0.8;
  return 0.34;
}

/** Closest distance between segments p1-q1 and p2-q2 (3D). */
export function segmentDistance(p1: readonly number[], q1: readonly number[], p2: readonly number[], q2: readonly number[]): number {
  const d1 = [q1[0]! - p1[0]!, q1[1]! - p1[1]!, q1[2]! - p1[2]!];
  const d2 = [q2[0]! - p2[0]!, q2[1]! - p2[1]!, q2[2]! - p2[2]!];
  const r = [p1[0]! - p2[0]!, p1[1]! - p2[1]!, p1[2]! - p2[2]!];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const c = dot(d1, r);
  const b = dot(d1, d2);
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) return Math.hypot(r[0]!, r[1]!, r[2]!);
  if (a <= 1e-12) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else if (e <= 1e-12) {
    t = 0;
    s = Math.min(1, Math.max(0, -c / a));
  } else {
    const denom = a * e - b * b;
    s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
    t = (b * s + f) / e;
    if (t < 0) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else if (t > 1) {
      t = 1;
      s = Math.min(1, Math.max(0, (b - c) / a));
    }
  }
  return Math.hypot(r[0]! + d1[0]! * s - d2[0]! * t, r[1]! + d1[1]! * s - d2[1]! * t, r[2]! + d1[2]! * s - d2[2]! * t);
}

/** The rider's camera in the bus's own frame: where it stands and what it looks at, each [ahead, right, height]. */
export interface RiderShot {
  eye: [number, number, number];
  look: [number, number, number];
  /** the rider's head and chest it keeps in clear sight */
  head: [number, number, number];
  chest: [number, number, number];
  /** the clear space (m) its sight lines keep from every pole, rail and strap */
  clearance: number;
}

/** How far (m) the lens keeps from every pole, rail and strap (review r3: a rail 0.13 m off it crossed the frame). */
export const RIDER_EYE_CLEARANCE = 0.35;

/** Clear space (m) kept between the camera's sight lines to the rider and every pole, rail and strap. */
export const RIDER_SIGHT_CLEARANCE = 0.12;

const shotCache = new Map<string, RiderShot>();

/**
 * Where the rider's camera goes for place `slot` (bus-local; cached per slot and orientation). Checker r2: from behind
 * the seat the toy figure's big head and the seat back filled a third of the frame, and a ceiling rail and its straps cut
 * across the avatar's shoulders. Now the camera stands in the aisle IN FRONT of the rider at a passenger's eye height
 * (under the straps, over the seat backs), mostly across the aisle, and looks back at them: their face and body in their
 * seat (or standing in the aisle) with their side's window and the village going by behind them, like a friend turned
 * round in the seat in front. The spot is searched over the cabin — inside its walls, over its floor, not in a pole, with
 * clear sight lines to the rider's head and chest (no pole, rail or strap in between); a place near the nose (no room in
 * front) gets the same search from behind. A portrait phone stands a little further off (its narrow view).
 */
export function riderShot(slot: number, portrait = false): RiderShot {
  const key = `${slot}:${portrait ? 1 : 0}`;
  const hit = shotCache.get(key);
  if (hit) return hit;
  const place = busPlace(slot);
  const seatTop = place.floor + (place.seated ? 0.452 : 0);
  const head: [number, number, number] = [place.ahead, place.right, seatTop + (place.seated ? 0.95 : 1.25)];
  const chest: [number, number, number] = [place.ahead, place.right, seatTop + (place.seated ? 0.45 : 0.85)];
  const shoulders: [number, number, number] = [place.ahead, place.right, (head[2] * 2 + chest[2]) / 3];
  const side = place.right < -0.05 ? -1 : 1;
  const want = portrait ? 2.4 : 2.2;
  const look: [number, number, number] = [place.ahead, place.right + side * 0.25, (head[2] + chest[2]) / 2];
  let best: { score: number; eye: [number, number, number] } | null = null;
  // the full clearance where the cabin allows it; a standing place among the straps takes a little less
  let clearance = RIDER_SIGHT_CLEARANCE;
  for (const c of [RIDER_SIGHT_CLEARANCE, 0.07, 0.03]) {
    clearance = c;
    best = searchShot(place, head, chest, shoulders, side, want, c);
    if (best) break;
  }
  const eye: [number, number, number] = best?.eye ?? [Math.max(place.ahead - 2.2, -4.15), -side * 0.15, 2.0];
  const shot: RiderShot = { eye, look, head, chest, clearance };
  shotCache.set(key, shot);
  return shot;
}

function searchShot(
  place: ReturnType<typeof busPlace>,
  head: [number, number, number],
  chest: [number, number, number],
  shoulders: [number, number, number],
  side: number,
  want: number,
  sight: number,
): { score: number; eye: [number, number, number] } | null {
  let best: { score: number; eye: [number, number, number] } | null = null;
  for (let k = -30; k <= 30; k++) {
    const da = k / 10;
    if (Math.abs(da) < 1.2) continue;
    const ahead = place.ahead + da;
    if (ahead > 3.5 || ahead < -4.15) continue; // behind the windscreen; in front of the back wall
    for (let j = -19; j <= 19; j++) {
      const right = j / 20;
      // the driver's place is behind its screen (xf 1.32, X -1.17..-0.35): only the front door's side is open further on
      if (ahead > 3.05 && right < -0.2) continue;
      const floor = cabinFloor(ahead, right);
      for (const y of [1.45, 1.55, 1.65, 1.8, 1.95, 2.05, 2.15, 2.25]) {
        if (y < floor + 1.15) continue; // over the seat backs
        const eye: [number, number, number] = [ahead, right, y];
        const dist = Math.hypot(da, right - place.right, y - head[2]);
        if (dist < 1.6) continue; // the toy figure's big head would fill the view
        let clear = true;
        for (const bar of CABIN_BARS) {
          if (
            segmentDistance(eye, eye, bar.a, bar.b) < RIDER_EYE_CLEARANCE ||
            segmentDistance(eye, head, bar.a, bar.b) < sight ||
            segmentDistance(eye, chest, bar.a, bar.b) < sight
          ) {
            clear = false;
            break;
          }
        }
        // the face and shoulders over every seat back (the chest may sit behind the seat in front, as in a real bus)
        if (clear) for (const box of SEAT_BACKS) if (segmentHitsBox(eye, head, box) || segmentHitsBox(eye, shoulders, box)) clear = false;
        if (!clear) continue;
        const chestHidden = SEAT_BACKS.some((box) => segmentHitsBox(eye, chest, box));
        // a seat right in front of the lens fills half the frame (review r3): keep over a metre from every one
        let crowd = 0;
        for (const box of SEAT_BACKS) crowd += Math.max(0, 1.2 - boxDistance(eye, box));
        const score =
          (chestHidden ? 0.5 : 0) +
          Math.abs(dist - want) +
          crowd * 1.5 +
          (da < 0 ? 1.5 : 0) + // from behind only when nothing in front works
          (right * side > 0.2 ? 0.2 : 0) + // across the aisle: their window in view behind them
          Math.abs(y - 1.8) * 0.3;
        if (!best || score < best.score) best = { score, eye };
      }
    }
  }
  return best;
}

/**
 * The rider's own view (owner 2026-11-15: the rider is in the bus now, busSeats.ts), from riderShot: a passenger's eye
 * in the aisle in front of them, looking back at them with their window behind, clear of the cabin's poles and straps.
 */
export function transitRiderCamera(bus: TransitPose, slot: number, aspect = 16 / 10): TransitCameraPose {
  const { eye, look } = riderShot(slot, aspect < 1);
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  const rx = -fz; // the bus's right (doors)
  const rz = fx;
  return {
    x: bus.x + fx * eye[0] + rx * eye[1],
    y: eye[2],
    z: bus.z + fz * eye[0] + rz * eye[1],
    targetX: bus.x + fx * look[0] + rx * look[1],
    targetY: look[2],
    targetZ: bus.z + fz * look[0] + rz * look[1],
  };
}
