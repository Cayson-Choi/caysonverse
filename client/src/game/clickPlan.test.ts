import { describe, it, expect } from "vitest";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import type { AABB } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import {
  MAX_PUSH,
  RAISED_MAX_Y,
  WALKABLE_MAX_Y,
  WALKABLE_MIN_NY,
  isFreeSpot,
  clickIntent,
  isWalkableSurface,
  nearestFreeSpot,
  planClickMove,
  simulateWalk,
  surfaceKind,
  walkStart,
} from "./clickPlan";
import { ARRIVE_DIST } from "./clickMove";

const R = PLAYER_RADIUS;
const BOUNDS = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
/** A 2 x 2 m box at the origin (a bench, a fountain, a house corner). */
const BOX: AABB = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
const ground = (x: number, z: number, y = 0.01) => ({ x, y, z, ny: 1 });

describe("clickPlan — what is ground (rule 1)", () => {
  it("an upright, low surface is ground; a wall, a slope past ~37 degrees, a seat or a step is not", () => {
    expect(isWalkableSurface({ y: 0.01, ny: 1 })).toBe(true); // plaza paving
    expect(isWalkableSurface({ y: 0.036, ny: 1 })).toBe(true); // the escape hall's rug
    expect(isWalkableSurface({ y: WALKABLE_MAX_Y, ny: WALKABLE_MIN_NY })).toBe(true); // both limits inclusive
    expect(isWalkableSurface({ y: 1.2, ny: 0 })).toBe(false); // a wall
    expect(isWalkableSurface({ y: 0.01, ny: WALKABLE_MIN_NY - 0.01 })).toBe(false); // a steep bank
    expect(isWalkableSurface({ y: 0.45, ny: 1 })).toBe(false); // a bench seat
    expect(isWalkableSurface({ y: 0.3, ny: 1 })).toBe(false); // the memorial's step
  });

  it("surfaceKind: low ground (may be pushed out of a margin); a raised flat or a curb's side out in the open (as clicked); else nothing", () => {
    const at = (y: number, ny: number, x = 0, z = 5) => ({ x, y, z, ny });
    expect(surfaceKind(at(0.01, 1), [BOX], BOUNDS)).toBe("ground");
    expect(surfaceKind(at(0.01, 1, 0, 1.2), [BOX], BOUNDS)).toBe("ground"); // at a collider's foot: still ground (pushed out)
    // the bridge's deck crown (0.13-0.15 m), the memorial's steps (0.30 / 0.45 m): free spots, walked to as clicked
    expect(surfaceKind(at(0.15, 1), [BOX], BOUNDS)).toBe("open");
    expect(surfaceKind(at(0.45, 1), [BOX], BOUNDS)).toBe("open");
    expect(surfaceKind(at(RAISED_MAX_Y, WALKABLE_MIN_NY), [BOX], BOUNDS)).toBe("open"); // both limits inclusive
    // a curb's side (a low upright face out in the open) is ground there
    expect(surfaceKind(at(0.06, 0), [BOX], BOUNDS)).toBe("open");
    // a bench seat is raised flat INSIDE its collider: never pushed out to the bench's foot — nothing
    expect(surfaceKind(at(0.45, 1, 0, 0), [BOX], BOUNDS)).toBe("none");
    expect(surfaceKind(at(0.06, 0, 0, 1.2), [BOX], BOUNDS)).toBe("none"); // a wall's foot (in its collider)
    expect(surfaceKind(at(RAISED_MAX_Y + 0.01, 1), [BOX], BOUNDS)).toBe("none"); // a table, a sill: higher than a step
    expect(surfaceKind(at(0.3, 0), [BOX], BOUNDS)).toBe("none"); // a riser's upper part, a trunk: an upright face above a curb
    expect(surfaceKind(at(-0.2, 0.5), [BOX], BOUNDS)).toBe("none"); // a steep bank below the ground (the creek)
  });

  it("a raised surface out in the open is walked to as clicked, its height kept; one in a collider is refused, not pushed", () => {
    expect(planClickMove(0, 10, { x: 3, y: 0.14, z: -4, ny: 1 }, [BOX], BOUNDS)).toEqual({ ok: true, x: 3, z: -4, y: 0.14, adjusted: "none" });
    expect(planClickMove(0, 10, { x: 0, y: 0.45, z: 0.9, ny: 1 }, [BOX], BOUNDS)).toEqual({ ok: false, reason: "not-ground" });
  });

  it("refuses a click on nothing or on what is not ground: no walk, no ring", () => {
    expect(planClickMove(0, 5, null, [], BOUNDS)).toEqual({ ok: false, reason: "not-ground" });
    expect(planClickMove(0, 5, { x: 0, y: 1.5, z: -3, ny: 0 }, [], BOUNDS)).toEqual({ ok: false, reason: "not-ground" });
  });
});

describe("clickPlan — where a body can stand (rule 2)", () => {
  it("free: inside the bounds less a radius and outside every collider grown by it", () => {
    expect(isFreeSpot(0, 5, [BOX], BOUNDS)).toBe(true);
    expect(isFreeSpot(0, 1 + R + 0.01, [BOX], BOUNDS)).toBe(true);
    expect(isFreeSpot(0, 1 + R - 0.01, [BOX], BOUNDS)).toBe(false);
    expect(isFreeSpot(20 - R + 0.01, 0, [], BOUNDS)).toBe(false);
  });

  it("ground at a collider's foot moves out across the nearest face, just clear of it", () => {
    const p = nearestFreeSpot(0.3, 1.2, [BOX], BOUNDS)!;
    expect(p.x).toBeCloseTo(0.3, 9);
    expect(p.z).toBeGreaterThan(1 + R);
    expect(p.z).toBeLessThan(1 + R + 0.05);
  });

  it("a point deep in a collider (the creek, the fountain basin) is refused, not slid somewhere else", () => {
    const big: AABB = { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };
    expect(nearestFreeSpot(0, 0, [big], BOUNDS)).toBeNull();
    expect(planClickMove(0, 12, ground(0, 0), [big], BOUNDS)).toEqual({ ok: false, reason: "blocked" });
  });

  it("past the bounds is refused unless it is within MAX_PUSH of the edge (no more sliding along the edge)", () => {
    expect(planClickMove(0, 0, ground(35, 4), [], BOUNDS)).toEqual({ ok: false, reason: "blocked" });
    const edge = planClickMove(0, 0, ground(20 - R + 0.2, 4), [], BOUNDS);
    expect(edge.ok).toBe(true);
    if (edge.ok) {
      expect(edge.x).toBeLessThanOrEqual(20 - R);
      expect(edge.z).toBe(4); // pushed straight in, not along the edge
      expect(edge.adjusted).toBe("pushed");
    }
  });

  it("two overlapping colliders: the way out clears both", () => {
    const a: AABB = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const b: AABB = { minX: 0.8, maxX: 1.6, minZ: -1, maxZ: 1 };
    const p = nearestFreeSpot(1.0, 1.25, [a, b], BOUNDS, MAX_PUSH)!;
    expect(p).not.toBeNull();
    expect(isFreeSpot(p.x, p.z, [a, b], BOUNDS)).toBe(true);
  });
});

describe("clickPlan — the walk (rule 3)", () => {
  it("open ground: the ring goes exactly on the click and the surface height is kept", () => {
    expect(planClickMove(0, 10, ground(3, -4, 0.017), [BOX], BOUNDS)).toEqual({ ok: true, x: 3, z: -4, y: 0.017, adjusted: "none" });
  });

  it("a click on the avatar's own spot is no walk (it would arrive at once) but still stops one in progress", () => {
    const plan = planClickMove(2, 2, ground(2 + ARRIVE_DIST / 2, 2), [], BOUNDS);
    expect(plan).toEqual({ ok: false, reason: "here" });
    expect(clickIntent(plan)).toBe("stop");
    expect(clickIntent(planClickMove(2, 2, ground(8, 2), [], BOUNDS))).toBe("walk");
    for (const reason of ["not-ground", "blocked", "unreachable"] as const) expect(clickIntent({ ok: false, reason })).toBe("ignore");
  });

  it("a collider off the line is slid round, as the game walks it: the ring stays on the click", () => {
    // the target lies past the box's grown edge (x > 1 + R): the slide along its face reaches the corner and goes on
    const plan = planClickMove(0.6, 6, ground(2.2, -6), [BOX], BOUNDS);
    expect(plan).toEqual({ ok: true, x: 2.2, z: -6, y: 0.01, adjusted: "none" });
    expect(simulateWalk(0.6, 6, 2.2, -6, [BOX], BOUNDS).arrived).toBe(true);
  });

  it("a collider square in the way: the ring goes where the avatar stops, and the walk there arrives", () => {
    const plan = planClickMove(0, 6, ground(0, -6), [BOX], BOUNDS);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjusted).toBe("stopped");
    expect(plan.x).toBeCloseTo(0, 6);
    expect(plan.z).toBeCloseTo(1 + R, 2); // in front of the box's near face
    expect(simulateWalk(0, 6, plan.x, plan.z, [BOX], BOUNDS).arrived).toBe(true);
  });

  it("pressed against that collider already: the walk cannot get going, so no ring", () => {
    expect(planClickMove(0, 1 + R + 0.05, ground(0, -6), [BOX], BOUNDS)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("seated, the walk starts from the seat's dismount point (where getting up puts the body), not the seat", () => {
    expect(walkStart(3, 4, undefined)).toEqual({ x: 3, z: 4 });
    expect(walkStart(3, 4, { standX: 3, standZ: 5.2 })).toEqual({ x: 3, z: 5.2 });
    // the seat is inside the bench's collider: planned from there, the walk would cross the bench
    const bench: AABB = { minX: -1, maxX: 1, minZ: -0.3, maxZ: 0.3 };
    const from = walkStart(0, 0, { standX: 0, standZ: 1.2 });
    const plan = planClickMove(from.x, from.z, ground(0, 6), [bench], BOUNDS, true);
    expect(plan).toEqual({ ok: true, x: 0, z: 6, y: 0.01, adjusted: "none" });
  });

  it("getting up (the stand-up glide off a bench), the walk starts where the glide lands, not inside the bench", () => {
    expect(walkStart(0, 0.1, undefined, { x: 0, z: 1.2 })).toEqual({ x: 0, z: 1.2 });
    expect(walkStart(3, 4, undefined, null)).toEqual({ x: 3, z: 4 });
    expect(walkStart(3, 4, { standX: 3, standZ: 5.2 }, { x: 9, z: 9 })).toEqual({ x: 3, z: 5.2 }); // seated: the seat's
    // from inside the bench's collider the slide lets the simulated walk through it ("arrived" behind the bench) —
    // planned from the landing, the bench stops it and the ring goes where the avatar really stops
    const bench: AABB = { minX: -1, maxX: 1, minZ: -0.3, maxZ: 0.3 };
    const from = walkStart(0, 0.1, undefined, { x: 0, z: 1.6 });
    const plan = planClickMove(from.x, from.z, ground(0, -6), [bench], BOUNDS);
    expect(plan.ok && plan.adjusted).toBe("stopped");
    if (plan.ok) expect(plan.z).toBeGreaterThan(0.3 + R - 0.01);
  });

  it("seated, the ground at the dismount point itself still means: get up and stand there (standing, it means stop)", () => {
    const at = ground(0.1, 1.2);
    expect(planClickMove(0, 1.2, at, [], BOUNDS)).toEqual({ ok: false, reason: "here" });
    expect(planClickMove(0, 1.2, at, [], BOUNDS, true)).toEqual({ ok: true, x: 0.1, z: 1.2, y: 0.01, adjusted: "none" });
  });

  it("the simulated walk stops on the no-progress rule like stepClickMove (pinned in a corner)", () => {
    const wallN: AABB = { minX: -5, maxX: 5, minZ: -3, maxZ: -2.5 };
    const end = simulateWalk(0, 0, 0, -10, [wallN], BOUNDS);
    expect(end.arrived).toBe(false);
    expect(end.z).toBeCloseTo(-2.5 + R, 6);
  });
});

describe("clickPlan — 케이슨 마을's real colliders", () => {
  const obstacles = villageGeometry.obstacles;
  const village = VILLAGE_LAYOUT.areas.village;
  const hall = VILLAGE_LAYOUT.areas.hall;

  it("the fountain's water (the middle of its collider) is refused from the plaza", () => {
    expect(planClickMove(0, 16, ground(2, 3, 0.1), obstacles, village)).toEqual({ ok: false, reason: "blocked" });
  });

  it("the far creek bank: the avatar stops at the near bank, and that is where the ring goes", () => {
    const plan = planClickMove(-12, 64, ground(-12, 84, 0.001), obstacles, village);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjusted).toBe("stopped");
    expect(plan.z).toBeCloseTo(69 - R, 1); // the creek's collider starts at z = 69
    expect(plan.x).toBeCloseTo(-12, 1);
  });

  it("past the village's edge (a far hill, the lake) is refused", () => {
    expect(planClickMove(-12, 64, ground(-12, 130, 0), obstacles, village)).toEqual({ ok: false, reason: "blocked" });
    expect(planClickMove(-12, 64, ground(-42, 430, 0), obstacles, village)).toEqual({ ok: false, reason: "blocked" });
  });

  it("the hall: floor beyond the central bench puts the ring at the bench, where the walk ends", () => {
    const plan = planClickMove(300.6, 1.5, ground(300.6, -4, 0), obstacles, hall);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjusted).toBe("stopped");
    expect(plan.z).toBeCloseTo(-1.39 + R, 1); // the bench's collider ends at z = -1.39
    expect(simulateWalk(300.6, 1.5, plan.x, plan.z, obstacles, hall).arrived).toBe(true);
  });

  it("the bridge's deck (its crown 0.13-0.15 m up) is walked to as clicked, the creek's only crossing", () => {
    const plan = planClickMove(-24, 68, { x: -24, y: 0.14, z: 75, ny: 1 }, obstacles, village);
    expect(plan).toMatchObject({ ok: true, x: -24, z: 75, y: 0.14, adjusted: "none" });
  });

  it("the memorial's step is walked to as clicked", () => {
    expect(planClickMove(0, -46, { x: 0, y: 0.3, z: -52.3, ny: 1 }, obstacles, village)).toMatchObject({ ok: true, adjusted: "none", y: 0.3 });
  });

  it("the hall: open floor is walked to as clicked", () => {
    expect(planClickMove(300, 1.5, ground(302.6, -3.6, 0), obstacles, hall)).toMatchObject({ ok: true, x: 302.6, z: -3.6, adjusted: "none" });
  });
});
