/**
 * 케이슨랜드's rides as things a body collides with (park-local metres): every platform, flight of steps, railing, queue fence, sign and post of the
 * carousel, the wheel, the 달배 and the 구름 낙하탑. Owner 2026-11-21: "달배 난간을 캐릭터가 그냥 막 통과해버려", "구름탑에 탑승하기 앞에 난간도 캐릭터가 그냥
 * 통과해버려": until then only the platforms were solid, the fences and steps were drawn and walked through.
 *
 * The rule: whatever is DRAWN as a barrier is a box here (a body slides along it), and the only ways in are the real ones: each ride's boarding pad
 * lies on open ground at the foot of its steps, between its queue fences, reached from the fences' open end. Nobody walks on a ride's deck or steps
 * (a rider is lifted from the pad into the seat), so those are solid blocks.
 *
 * The numbers are the ones the rides are drawn with (client/src/land/CarouselWorld.tsx entranceGeometry, WheelWorld.tsx, MoonBoatWorld.tsx,
 * DropTowerWorld.tsx; the decks and steps from shared/src/land/*Geometry.ts): change one, change the other (e2e/park-railings.mjs walks into every one).
 * The coaster's station is PARK_PLATFORM in parkArea.ts.
 */
import type { AABB } from "../collision";
import { CAROUSEL_CENTER, CAROUSEL_RADIUS } from "../land/carousel";
import { WHEEL_SITE } from "../land/wheel";
import { FRAME_LEG_X, FRAME_Z_NORTH, FRAME_Z_SOUTH, PLATFORM as WHEEL_PLATFORM } from "../land/wheelGeometry";
import { MOON_BOAT_SITE, MOON_FRAME } from "../land/moonBoat";
import { MOON_DECK, MOON_STEPS } from "../land/moonBoatGeometry";
import { DROP_PLATFORM_R, DROP_SITE } from "../land/dropTower";

const box = (minX: number, maxX: number, minZ: number, maxZ: number): AABB => ({ minX, maxX, minZ, maxZ });

/** Half the thickness of a fence's box (its posts are 5 cm, its rails 3 cm: the box is a little fatter so a body never visibly touches a rail). */
export const RIDE_FENCE_HALF = 0.08;

/** The carousel's round iron fence: its radius (0.55 m outside the platform's edge) and the two gate posts south of it (the gate's own opening is the platform's edge: nobody walks onto the turning deck). */
export const CAROUSEL_FENCE_R = CAROUSEL_RADIUS + 0.55;
export const CAROUSEL_GATE_POST = Object.freeze({ dx: 2.6, dz: CAROUSEL_FENCE_R + 0.2, half: 0.22 });

/** The wheel's steps (south of the deck) and its name board on two posts east of them. */
export const WHEEL_STEPS = Object.freeze({ x0: -1.7, x1: 1.7, z0: WHEEL_PLATFORM.z1, z1: WHEEL_PLATFORM.z1 + 2.5 });
export const WHEEL_SIGN = Object.freeze({ x0: 7.5 - 2.1, x1: 7.5 + 2.1, z: 9.57 });

/** The 달배's queue fences (both sides of the steps and of the path to the pad), the two lamp posts at the steps' foot and its name board north of the path. */
export const MOON_QUEUE = Object.freeze({ z: 2.35, x0: MOON_STEPS.x0, x1: MOON_STEPS.x1 + 4.2 });
export const MOON_LAMP = Object.freeze({ x: MOON_STEPS.x1 + 0.5, z: 2.9, half: 0.12 });
export const MOON_SIGN = Object.freeze({ x: MOON_STEPS.x1 + 1.48, z0: -4.6 - 2.1, z1: -4.6 + 2.1 });
/** The lane under the swinging hull: the hull is lower than a head only within 26 degrees of the bottom, z within 20 m of the axle. */
export const MOON_LANE = Object.freeze({ halfX: 2.9, halfZ: 20 });

/** The 구름 낙하탑's steps (east of the platform), its queue fences and its name board north of the path. */
export const DROP_STEPS = Object.freeze({ x0: DROP_PLATFORM_R, x1: DROP_PLATFORM_R + 2.1, halfZ: 1.65 });
export const DROP_QUEUE = Object.freeze({ z: 1.9, x0: DROP_PLATFORM_R, x1: DROP_PLATFORM_R + 2.1 + 4.6 });
export const DROP_SIGN = Object.freeze({ x: DROP_PLATFORM_R + 3.58, z0: -4.2 - 1.6, z1: -4.2 + 1.6 });

/**
 * A round footprint as boxes that share its centre (the collision world is axis-aligned boxes): `steps` boxes, each reaching the circle at one angle
 * and as far along the other axis as the next angle, so the union covers the disc and never reaches more than about R / (2 * steps) past it at the
 * diagonals. Few, large boxes on purpose: a body slides along a flat face, and every inner corner between two boxes is a place a diagonal walk stops.
 */
export function discSolids(cx: number, cz: number, radius: number, steps = 6): AABB[] {
  const out: AABB[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    const hx = radius * Math.cos(a0);
    const hz = radius * Math.sin(a1);
    out.push(box(cx - hx, cx + hx, cz - hz, cz + hz));
  }
  return out;
}

/** The carousel: the turning platform and the round fence about it as one solid disc (the ride's pad is south of the gate), and the gate's two posts. */
export function carouselSolids(): AABB[] {
  const c = CAROUSEL_CENTER;
  const g = CAROUSEL_GATE_POST;
  const out = discSolids(c.x, c.z, CAROUSEL_FENCE_R + RIDE_FENCE_HALF);
  for (const sx of [-1, 1]) out.push(box(c.x + sx * g.dx - g.half, c.x + sx * g.dx + g.half, c.z + g.dz - g.half, c.z + g.dz + g.half));
  return out;
}

/** The wheel: the four feet of its A-frames, the boarding deck (its rails stand on it), the steps and the name board. */
export function wheelSolids(): AABB[] {
  const s = WHEEL_SITE;
  const out: AABB[] = [];
  for (const sx of [-1, 1]) for (const dz of [FRAME_Z_NORTH, FRAME_Z_SOUTH]) out.push(box(s.x + sx * FRAME_LEG_X - 1, s.x + sx * FRAME_LEG_X + 1, s.z + dz - 1, s.z + dz + 1));
  out.push(box(s.x + WHEEL_PLATFORM.x0 - 0.1, s.x + WHEEL_PLATFORM.x1 + 0.1, s.z + WHEEL_PLATFORM.z0 - 0.1, s.z + WHEEL_PLATFORM.z1 + 0.1));
  out.push(box(s.x + WHEEL_STEPS.x0, s.x + WHEEL_STEPS.x1, s.z + WHEEL_STEPS.z0, s.z + WHEEL_STEPS.z1));
  out.push(box(s.x + WHEEL_SIGN.x0, s.x + WHEEL_SIGN.x1, s.z + WHEEL_SIGN.z - RIDE_FENCE_HALF, s.z + WHEEL_SIGN.z + RIDE_FENCE_HALF));
  return out;
}

/** The 달배: the lane under the hull, the A-frames' four feet, the boarding deck (its rails stand on it), the steps, the queue fences, the lamp posts and the name board. */
export function moonBoatSolids(): AABB[] {
  const s = MOON_BOAT_SITE;
  const out: AABB[] = [];
  out.push(box(s.x - MOON_LANE.halfX, s.x + MOON_LANE.halfX, s.z - MOON_LANE.halfZ, s.z + MOON_LANE.halfZ));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(s.x + sx * MOON_FRAME.legX - 1.8, s.x + sx * MOON_FRAME.legX + 1.8, s.z + sz * MOON_FRAME.footZ - 1.8, s.z + sz * MOON_FRAME.footZ + 1.8));
  // the deck: from the lane's edge (no slit between the two) to the deck's east edge and its trim
  out.push(box(s.x + MOON_LANE.halfX, s.x + MOON_DECK.x1 + 0.1, s.z + MOON_DECK.z0 - 0.1, s.z + MOON_DECK.z1 + 0.1));
  out.push(box(s.x + MOON_STEPS.x0, s.x + MOON_STEPS.x1, s.z + MOON_STEPS.z0 - 0.05, s.z + MOON_STEPS.z1 + 0.05));
  for (const sz of [-1, 1]) {
    out.push(box(s.x + MOON_QUEUE.x0, s.x + MOON_QUEUE.x1, s.z + sz * MOON_QUEUE.z - RIDE_FENCE_HALF, s.z + sz * MOON_QUEUE.z + RIDE_FENCE_HALF));
    out.push(box(s.x + MOON_LAMP.x - MOON_LAMP.half, s.x + MOON_LAMP.x + MOON_LAMP.half, s.z + sz * MOON_LAMP.z - MOON_LAMP.half, s.z + sz * MOON_LAMP.z + MOON_LAMP.half));
  }
  out.push(box(s.x + MOON_SIGN.x - RIDE_FENCE_HALF, s.x + MOON_SIGN.x + RIDE_FENCE_HALF, s.z + MOON_SIGN.z0, s.z + MOON_SIGN.z1));
  return out;
}

/** The 구름 낙하탑: its platform (the railed deck round the car's station), the steps, the queue fences and the name board. */
export function dropTowerSolids(): AABB[] {
  const s = DROP_SITE;
  const R = DROP_PLATFORM_R;
  const out: AABB[] = [];
  out.push(box(s.x - R - 0.07, s.x + R + 0.07, s.z - R - 0.07, s.z + R + 0.07));
  out.push(box(s.x + DROP_STEPS.x0, s.x + DROP_STEPS.x1, s.z - DROP_STEPS.halfZ, s.z + DROP_STEPS.halfZ));
  for (const sz of [-1, 1]) out.push(box(s.x + DROP_QUEUE.x0, s.x + DROP_QUEUE.x1, s.z + sz * DROP_QUEUE.z - RIDE_FENCE_HALF, s.z + sz * DROP_QUEUE.z + RIDE_FENCE_HALF));
  out.push(box(s.x + DROP_SIGN.x - RIDE_FENCE_HALF, s.x + DROP_SIGN.x + RIDE_FENCE_HALF, s.z + DROP_SIGN.z0, s.z + DROP_SIGN.z1));
  return out;
}

/** Every ride's solids (the coaster's station is parkArea.ts PARK_PLATFORM). */
export function parkRideSolids(): AABB[] {
  return [...carouselSolids(), ...wheelSolids(), ...moonBoatSolids(), ...dropTowerSolids()];
}
