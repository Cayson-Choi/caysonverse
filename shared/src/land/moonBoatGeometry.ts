/**
 * The 달배's solids as plain numbers (the same ones client/src/land/MoonBoatWorld.tsx builds), so a unit test can prove that the boat never touches
 * its A-frame, the platform or the ground at ANY angle of the swing, and that a rider's eye never sits inside the hull. The boat is sampled as
 * surface points (boat frame), the frame and platform as capsules and boxes (park frame relative to MOON_BOAT_SITE: x east, y up, z south).
 */
import { MOON_ARM_L, MOON_FRAME, MOON_HULL, MOON_PIVOT_Y, MOON_SEAT, MOON_BOAT_SEATS, moonFloorY, moonKeelY, moonSeatLocal } from "./moonBoat";

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

/** The platform: a deck east of the hull, flush with the hull's floor at the middle at rest, a gap of DECK_GAP from the hull's side. */
export const MOON_DECK_Y = MOON_PIVOT_Y - MOON_ARM_L + MOON_HULL.keelT;
export const MOON_DECK = Object.freeze({ x0: MOON_HULL.halfX + 0.9, x1: MOON_HULL.halfX + 0.9 + 4.6, z0: -4.2, z1: 4.2 });
export const MOON_STEPS = Object.freeze({ x0: MOON_DECK.x1, x1: MOON_DECK.x1 + 3.6, z0: -1.8, z1: 1.8 });
/** The boarding pad: on the grass at the foot of the steps (the rider is lifted into the seat; the avatar never walks on the deck). */
export const MOON_PAD_DX = MOON_STEPS.x1 + 1.6;

export const MOON_PLATFORM_BOXES: readonly Box[] = Object.freeze([
  { name: "deck", min: [MOON_DECK.x0, 0, MOON_DECK.z0], max: [MOON_DECK.x1, MOON_DECK_Y, MOON_DECK.z1] },
  { name: "steps", min: [MOON_STEPS.x0, 0, MOON_STEPS.z0], max: [MOON_STEPS.x1, MOON_DECK_Y * 0.6, MOON_STEPS.z1] },
  { name: "rail north", min: [MOON_DECK.x0, MOON_DECK_Y, MOON_DECK.z0], max: [MOON_DECK.x1, MOON_DECK_Y + 1.05, MOON_DECK.z0 + 0.08] },
  { name: "rail south", min: [MOON_DECK.x0, MOON_DECK_Y, MOON_DECK.z1 - 0.08], max: [MOON_DECK.x1, MOON_DECK_Y + 1.05, MOON_DECK.z1] },
  { name: "rail west north", min: [MOON_DECK.x0, MOON_DECK_Y, MOON_DECK.z0], max: [MOON_DECK.x0 + 0.08, MOON_DECK_Y + 1.05, -2.4] },
  { name: "rail west south", min: [MOON_DECK.x0, MOON_DECK_Y, 2.4], max: [MOON_DECK.x0 + 0.08, MOON_DECK_Y + 1.05, MOON_DECK.z1] },
]);

/** The A-frames' legs and the axle (the boat swings between the two A-frames; each frame is a pair of legs leaning together to the axle). */
export function moonFrameCapsules(): Capsule[] {
  const out: Capsule[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (const c of [-MOON_FRAME.chord, MOON_FRAME.chord]) out.push({ a: [sx * MOON_FRAME.legX + c, 0.2, sz * MOON_FRAME.footZ], b: [sx * MOON_FRAME.legX + c, MOON_PIVOT_Y + 0.5, sz * 0.5], r: MOON_FRAME.chordR + 0.04, name: "leg" });
  out.push({ a: [-MOON_FRAME.legX - MOON_FRAME.chord - 0.3, MOON_PIVOT_Y, 0], b: [MOON_FRAME.legX + MOON_FRAME.chord + 0.3, MOON_PIVOT_Y, 0], r: 0.3, name: "axle" });
  return out;
}

/** Surface points of the boat in its own frame: the keel and the inner curve, the horn tips' lantern/rabbit, the two arms. */
export function moonBoatPoints(step = 0.2): { p: V3; name: string }[] {
  const out: { p: V3; name: string }[] = [];
  const hx = MOON_HULL.halfX;
  const hz = MOON_HULL.halfZ;
  for (let x = -hx; x <= hx + 1e-6; x += step)
    for (let z = -hz; z <= hz + 1e-6; z += step) {
      out.push({ p: [x, moonKeelY(z), z], name: "keel" });
      out.push({ p: [x, moonFloorY(z), z], name: "bowl" });
    }
  // the gunwales: the two side rails over the bowl, 0.9 m high
  for (const sx of [-hx, hx])
    for (let z = -hz; z <= hz + 1e-6; z += step) out.push({ p: [sx, moonFloorY(z) + 0.9, z], name: "gunwale" });
  // the sleeping rabbit on the bow horn and the lantern on the stern horn (about 1.3 m tall and wide)
  for (let x = -0.7; x <= 0.7; x += 0.35)
    for (let y = 0; y <= 1.3; y += 0.325)
      for (let z = -0.6; z <= 0.6; z += 0.3) {
        out.push({ p: [x, moonKeelY(hz) + 1.1 + y, hz + z - 0.4], name: "rabbit" });
        out.push({ p: [x * 0.4, moonKeelY(-hz) + 1.1 + y, -hz - z * 0.4 + 0.4], name: "lantern" });
      }
  // the two arms, from the hull's gunwale to the axle
  for (const sx of [-MOON_FRAME.armX, MOON_FRAME.armX])
    for (const sz of [-1, 1]) for (let f = 0; f <= 1.001; f += 0.1) out.push({ p: [sx, -0.15 + (-MOON_ARM_L + 1.45 + 0.15) * f, sz * (0.12 + 0.83 * f)], name: "arm" });
  return out;
}

export function pointSegDistance(p: V3, a: V3, b: V3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t), p[2] - (a[2] + abz * t));
}

export function pointBoxDistance(p: V3, b: Box): number {
  const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
  const dy = Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]);
  const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** A boat-frame point in the park frame relative to MOON_BOAT_SITE (x east, y up, z south), the boat swung by `angle`. */
export function moonPointAt(p: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0], MOON_PIVOT_Y + p[1] * c + p[2] * s, p[2] * c - p[1] * s];
}

export const MOON_SEATS = MOON_BOAT_SEATS;
export { MOON_SEAT, moonSeatLocal };
