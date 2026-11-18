/**
 * The 하늘 등불 바퀴's solids as plain numbers (the same ones tools/land/make_wheel.py builds), so a unit test can prove that nothing passes through a gondola
 * at ANY angle of the turn (owner 2026-11-18, night screenshots: the platform's deck and rail ran through the bottom gondola, the frame's bars crossed
 * its roof). Boxes are axis-aligned in their own frame (y up); segments are capsules (a line with a radius).
 *
 * Frames: the rotor's own (hub at the origin, plane x-y, z the axle: south positive), the gondola's (origin at its pivot, hanging down), and the park's
 * (WHEEL_SITE at the foot of the hub: platform and frame are given relative to it, x east, z south).
 */
import { GONDOLA_CZ, WHEEL_HUB_Y, WHEEL_N, WHEEL_R, WHEEL_STEP, WHEEL_SITE, wheelPivot } from "./wheel";

export type V3 = readonly [number, number, number];
export interface Capsule {
  a: V3;
  b: V3;
  r: number;
  name: string;
}
export interface Box {
  min: V3;
  max: V3;
  name: string;
}

export const RIM_Z = 1.9;
/** The gondola's boxes in its own frame (the same numbers as make_wheel.py: FLOOR -3.1, TOP -0.75, half size 2.0 x 0.9, centre CZ south of the pivot). */
export const GONDOLA_BOXES: readonly Box[] = Object.freeze([
  { name: "plinth", min: [-2.1, -3.47, GONDOLA_CZ - 0.96], max: [2.1, -3.04, GONDOLA_CZ + 0.96] },
  { name: "cabin", min: [-2.04, -3.04, GONDOLA_CZ - 0.94], max: [2.04, -0.75, GONDOLA_CZ + 0.94] },
  { name: "roof", min: [-2.3, -0.75, GONDOLA_CZ - 1.05], max: [2.3, 0.1, GONDOLA_CZ + 1.05] },
  { name: "globe", min: [-0.2, 0.1, GONDOLA_CZ - 0.2], max: [0.2, 0.56, GONDOLA_CZ + 0.2] },
]);

const rim = (z: number, r: number, n: number, tube: number, name: string): Capsule[] => {
  const out: Capsule[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    out.push({ a: [Math.sin(a0) * r, Math.cos(a0) * r, z], b: [Math.sin(a1) * r, Math.cos(a1) * r, z], r: tube, name });
  }
  return out;
};

/** Everything of the rotor that reaches near a gondola, in the rotor's frame at rest (the hub drum and its caps are far from the gondolas and left out). */
export function rotorCapsules(): Capsule[] {
  const out: Capsule[] = [];
  for (const z of [-RIM_Z, RIM_Z]) {
    out.push(...rim(z, WHEEL_R, 120, 0.22, "rim"));
    out.push(...rim(z, WHEEL_R + 0.34, 96, 0.13, "bulbs"));
    out.push(...rim(z, WHEEL_R - 2.4, 120, 0.13, "inner ring"));
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * Math.PI * 2;
      const a1 = ((i + 1) / 48) * Math.PI * 2;
      const [r0, r1] = i % 2 === 0 ? [WHEEL_R, WHEEL_R - 2.4] : [WHEEL_R - 2.4, WHEEL_R];
      out.push({ a: [Math.sin(a0) * r0, Math.cos(a0) * r0, z], b: [Math.sin(a1) * r1, Math.cos(a1) * r1, z], r: 0.05, name: "lattice" });
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      out.push({ a: [Math.sin(a) * 1.9, Math.cos(a) * 1.9, z], b: [Math.sin(a) * (WHEEL_R - 2.4), Math.cos(a) * (WHEEL_R - 2.4), z], r: 0.085, name: "spoke" });
      const b = a + Math.PI / 20;
      out.push({ a: [Math.sin(b) * 1.9, Math.cos(b) * 1.9, z * 0.7], b: [Math.sin(b) * WHEEL_R, Math.cos(b) * WHEEL_R, z], r: 0.025, name: "cable" });
    }
  }
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    out.push({ a: [Math.sin(a) * WHEEL_R, Math.cos(a) * WHEEL_R, -RIM_Z], b: [Math.sin(a) * WHEEL_R, Math.cos(a) * WHEEL_R, RIM_Z], r: 0.06, name: "tie" });
  }
  return out;
}

/** The fixed frame's legs (the two A-frames' four ... eight legs, with their feet): capsules in the park frame relative to WHEEL_SITE (x, y, z). */
export const FRAME_LEG_X = 11;
export const FRAME_Z_NORTH = -2.75;
export const FRAME_Z_SOUTH = 5.7;
export function frameCapsules(): Capsule[] {
  const out: Capsule[] = [];
  for (const z of [FRAME_Z_NORTH, FRAME_Z_SOUTH])
    for (const sx of [-1, 1]) out.push({ a: [sx * FRAME_LEG_X, 0.2, z], b: [sx * 0.9, WHEEL_HUB_Y - 0.6, z], r: 0.62, name: `leg z${z}` });
  return out;
}

/** The boarding platform's boxes relative to WHEEL_SITE: the deck on the SOUTH side of the bottom gondola (its door), flush with the cabin floor, a small gap from it. */
export const DECK_Y = 0.96;
export const PLATFORM = Object.freeze({ x0: -3.4, x1: 3.4, z0: 4.55, z1: 8.7 });
export const PLATFORM_BOXES: readonly Box[] = Object.freeze([
  { name: "deck", min: [PLATFORM.x0, 0, PLATFORM.z0], max: [PLATFORM.x1, DECK_Y, PLATFORM.z1] },
  { name: "deck trim", min: [PLATFORM.x0 - 0.1, DECK_Y - 0.14, PLATFORM.z0 - 0.1], max: [PLATFORM.x1 + 0.1, DECK_Y - 0.06, PLATFORM.z1 + 0.1] },
  // the rails stand on the deck's east and west ends and its south side (the steps' opening aside); the cabin side is open across the door's width
  { name: "rail west", min: [PLATFORM.x0, DECK_Y, PLATFORM.z0], max: [PLATFORM.x0 + 0.08, DECK_Y + 1.1, PLATFORM.z1] },
  { name: "rail east", min: [PLATFORM.x1 - 0.08, DECK_Y, PLATFORM.z0], max: [PLATFORM.x1, DECK_Y + 1.1, PLATFORM.z1] },
  { name: "rail north west", min: [PLATFORM.x0, DECK_Y, PLATFORM.z0], max: [-2.35, DECK_Y + 1.1, PLATFORM.z0 + 0.08] },
  { name: "rail north east", min: [2.35, DECK_Y, PLATFORM.z0], max: [PLATFORM.x1, DECK_Y + 1.1, PLATFORM.z0 + 0.08] },
  { name: "steps", min: [-1.7, 0, PLATFORM.z1], max: [1.7, 0.7, PLATFORM.z1 + 2.5] },
]);

// ───────────────────────────── distances ─────────────────────────────

/** Distance from point p to the box (0 inside). */
export function pointBoxDistance(p: V3, b: Box): number {
  const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
  const dy = Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]);
  const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** Distance from a capsule's AXIS to the box, sampled every `step` m (the distance of a convex set along a segment is convex: a fine sampling is within `step`). */
export function capsuleBoxClearance(c: Capsule, b: Box, step = 0.1): number {
  const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]);
  const n = Math.max(1, Math.ceil(len / step));
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p: V3 = [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t, c.a[2] + (c.b[2] - c.a[2]) * t];
    best = Math.min(best, pointBoxDistance(p, b));
  }
  return best - c.r;
}

/** Gap between two boxes (negative: how far they overlap along the thinnest axis). */
export function boxGap(a: Box, b: Box): number {
  const gx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const gy = Math.max(a.min[1] - b.max[1], b.min[1] - a.max[1]);
  const gz = Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.max(gx, gy, gz);
}

/** A box moved by (x, y, z). */
export const moved = (b: Box, d: V3): Box => ({ name: b.name, min: [b.min[0] + d[0], b.min[1] + d[1], b.min[2] + d[2]], max: [b.max[0] + d[0], b.max[1] + d[1], b.max[2] + d[2]] });

/** The gondola's boxes of gondola `g` with the wheel at `angle`, in the park frame relative to WHEEL_SITE (swing `sway` ignored: the boxes are inflated by its sweep). */
export function gondolaBoxesAt(g: number, angle: number, sway = 0): Box[] {
  const p = wheelPivot(g, angle);
  const px = p.x - WHEEL_SITE.x;
  const py = p.y;
  const pz = 0;
  const grow = Math.abs(sway) * 3.6; // a swing of `sway` rad moves the cabin's lowest edge 3.6 m below the pivot by about this much sideways
  return GONDOLA_BOXES.map((b) => {
    const m = moved(b, [px, py, pz]);
    return { name: b.name, min: [m.min[0] - grow, m.min[1], m.min[2]], max: [m.max[0] + grow, m.max[1], m.max[2]] } as Box;
  });
}

/** A rotor capsule at `angle`, in the park frame relative to WHEEL_SITE. */
export function rotorCapsuleAt(c: Capsule, angle: number): Capsule {
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const rot = (v: V3): V3 => [v[0] * ca - v[1] * sa, v[0] * sa + v[1] * ca + WHEEL_HUB_Y, v[2]];
  return { a: rot(c.a), b: rot(c.b), r: c.r, name: c.name };
}

export { WHEEL_N, WHEEL_STEP };
