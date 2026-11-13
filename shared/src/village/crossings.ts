/**
 * The ring road's two signalised crosswalks and their signal poles, as data (fix/crosswalk-signals).
 *
 * Each crossing is ONE straight zebra, perpendicular to the road, painted into the road texture (art/village/tools/
 * make_textures.py crosswalk_mask: 5 bars of 0.5 m, 0.55 m apart, 4 m long along the road). Its signal poles stand on
 * both kerbs, at the crossing's two ends, on the pedestrian's right-hand side of the far end (as the traffic signal
 * manual draws them): the pole carries the vehicle head on a cantilever arm over the lane and the pedestrian head
 * facing across the road, as one unit (`village_signals.glb`, art/village/tools/build_signals.py).
 *
 * Review r3: the school lane (lane_plot_e) meets the ring 8 m south of the bus crossing, where the bus waits at its stop
 * line; it has no zebra of its own (make_textures.py XW_SKIP): its walkers cross at the signalised one.
 *
 * A crossing has a local frame: x outward from the plaza (radial), z along the road in the direction of increasing
 * angle (the side the bus approaches from, as it runs clockwise seen from above), origin on the ring's middle line.
 */

import type { AABB } from "../collision";

/** Where each lane's first leg crosses the ring road's middle (R 34): the crossings' angles (rad, atan2(z, x)). */
export interface SignalCrossing {
  id: "bus" | "north";
  /** angle of the crosswalk's centre on the ring (rad, atan2(z, x)) */
  angle: number;
  /** crosswalk length along the road (m) */
  length: number;
}

export const RING_MIDDLE_R = 34;
export const CROSSWALK_LENGTH = 4;

export const SIGNAL_CROSSINGS: readonly SignalCrossing[] = [
  // lane_bus runs along +x at z = 1 (the lane to the bus stop's pad): R 34 at x = sqrt(34^2 - 1)
  { id: "bus", angle: Math.atan2(1, Math.sqrt(RING_MIDDLE_R ** 2 - 1)), length: CROSSWALK_LENGTH },
  // lane_plot_n runs along -z at x = 0
  { id: "north", angle: -Math.PI / 2, length: CROSSWALK_LENGTH },
];

/** The signal units of one crossing in its local frame: the outer pole (sidewalk) and the inner pole (verge). */
export const SIGNAL_POLES = [
  // outer: east end of the bus crossing; vehicle head faces +z (south, to the approaching bus), pedestrian head faces -x
  { id: "outer", x: 3.55, z: 2.9, yaw: 0 },
  // inner: the same unit turned half a turn, on the diagonally opposite corner
  { id: "inner", x: -3.55, z: -2.9, yaw: Math.PI },
] as const;

export interface CrossingFrame {
  centre: { x: number; z: number };
  /** unit outward (radial) direction: the local +x */
  radial: { x: number; z: number };
  /** unit direction along the road, toward the approaching bus: the local +z */
  along: { x: number; z: number };
  /** the group's y rotation (three.js) that maps the local axes onto the world's */
  yaw: number;
}

export function crossingFrame(c: SignalCrossing): CrossingFrame {
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  return {
    centre: { x: RING_MIDDLE_R * cos, z: RING_MIDDLE_R * sin },
    radial: { x: cos, z: sin },
    along: { x: -sin, z: cos },
    yaw: -c.angle,
  };
}

/** A local point of a crossing, in world coordinates. */
export function crossingPoint(c: SignalCrossing, lx: number, lz: number): { x: number; z: number } {
  const f = crossingFrame(c);
  return { x: f.centre.x + lx * f.radial.x + lz * f.along.x, z: f.centre.z + lx * f.radial.z + lz * f.along.z };
}

/** World position and y rotation of every signal pole. */
export function signalPoleSpots(): { crossing: SignalCrossing["id"]; pole: (typeof SIGNAL_POLES)[number]["id"]; x: number; z: number; yaw: number }[] {
  const out = [];
  for (const c of SIGNAL_CROSSINGS) {
    const f = crossingFrame(c);
    for (const p of SIGNAL_POLES) {
      const w = crossingPoint(c, p.x, p.z);
      out.push({ crossing: c.id, pole: p.id, x: w.x, z: w.z, yaw: f.yaw + p.yaw });
    }
  }
  return out;
}

/** The pole's footing as a collider: a 0.32 m box (the post is 0.22 m at the base; the head and arm are overhead). */
export const SIGNAL_POLE_COLLIDER = 0.32;

export function signalPoleColliders(): AABB[] {
  const h = SIGNAL_POLE_COLLIDER / 2;
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return signalPoleSpots().map((s) => ({ minX: r(s.x - h), maxX: r(s.x + h), minZ: r(s.z - h), maxZ: r(s.z + h) }));
}
