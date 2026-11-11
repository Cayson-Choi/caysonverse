import { describe, it, expect } from "vitest";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import type { AABB } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import {
  DETOUR_MAX_RATIO,
  DETOUR_VIA_CLEAR,
  FURNITURE_MAX_PUSH,
  MAX_PUSH,
  RAISED_MAX_Y,
  WALKABLE_MAX_Y,
  WALKABLE_MIN_NY,
  findDetour,
  finishClickPlan,
  finishClickPlanSteps,
  freeSpotsNear,
  isFreeSpot,
  startClickPlan,
  clickIntent,
  isWalkableSurface,
  nearestFreeSpot,
  planClickMove,
  requireSeen,
  segmentClear,
  simulateWalk,
  surfaceKind,
  walkStart,
} from "./clickPlan";
import { ARRIVE_DIST, VIA_REACH } from "./clickMove";
import { VILLAGE_FURNITURE } from "./activeMap";

const R = PLAYER_RADIUS;
const BOUNDS = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
/** A 2 x 2 m box at the origin (a bench, a fountain, a house corner). */
const BOX: AABB = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
/** A wall across the whole area: no way round it. */
const WALL: AABB = { minX: -21, maxX: 21, minZ: -1, maxZ: 1 };
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

  it("a point deep in a collider (the creek, the fountain basin): no spot there — the walk goes toward it and stops at the collider (round 4 review)", () => {
    const big: AABB = { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };
    expect(nearestFreeSpot(0, 0, [big], BOUNDS)).toBeNull();
    const plan = planClickMove(0, 12, ground(0, 0), [big], BOUNDS);
    expect(plan.ok && plan.adjusted).toBe("stopped");
    if (!plan.ok) return;
    expect(plan.x).toBeCloseTo(0, 6);
    expect(plan.z).toBeCloseTo(6 + R, 6); // at the collider's grown face, on the line to the click
    expect(plan.via).toBeUndefined();
    // already against it: nowhere to go
    expect(planClickMove(0, 6 + R + 0.1, ground(0, 0), [big], BOUNDS)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("past the bounds: toward it, up to the edge, on the line to the click (no sliding along the edge); within MAX_PUSH of the edge, pushed in", () => {
    const past = planClickMove(0, 0, ground(35, 4), [], BOUNDS);
    expect(past.ok && past.adjusted).toBe("stopped");
    if (past.ok) {
      expect(past.x).toBeCloseTo(20 - R, 6);
      expect(past.z).toBeCloseTo((4 * (20 - R)) / 35, 1);
    }
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
    for (const reason of ["not-ground", "unreachable", "unseen"] as const) expect(clickIntent({ ok: false, reason })).toBe("ignore");
  });

  it("a collider off the line is slid round, as the game walks it: the ring stays on the click", () => {
    // the target lies past the box's grown edge (x > 1 + R): the slide along its face reaches the corner and goes on
    const plan = planClickMove(0.6, 6, ground(2.2, -6), [BOX], BOUNDS);
    expect(plan).toEqual({ ok: true, x: 2.2, z: -6, y: 0.01, adjusted: "none" });
    expect(simulateWalk(0.6, 6, 2.2, -6, [BOX], BOUNDS).arrived).toBe(true);
  });

  it("a collider square in the way: the walk goes round it (via its corners) and the ring stays on the click (round 4 review)", () => {
    expect(simulateWalk(0, 6, 0, -6, [BOX], BOUNDS).arrived).toBe(false); // straight, it is pinned on the box's face
    const plan = planClickMove(0, 6, ground(0, -6), [BOX], BOUNDS);
    expect(plan).toMatchObject({ ok: true, x: 0, z: -6, adjusted: "none" });
    if (!plan.ok) return;
    expect(plan.via!.length).toBeGreaterThan(0);
    for (const p of plan.via!) expect(isFreeSpot(p.x, p.z, [BOX], BOUNDS)).toBe(true);
    const walk = simulateWalk(0, 6, plan.x, plan.z, [BOX], BOUNDS, R, plan.via);
    expect(walk.arrived).toBe(true);
    // and a body pressed against it already goes round too
    const pressed = planClickMove(0, 1 + R + 0.05, ground(0, -6), [BOX], BOUNDS);
    expect(pressed.ok && !!pressed.via).toBe(true);
  });

  it("a wall with no way round: the ring goes where the avatar stops, and the walk there arrives; pressed against it, no ring", () => {
    const plan = planClickMove(0, 6, ground(0, -6), [WALL], BOUNDS);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjusted).toBe("stopped");
    expect(plan.via).toBeUndefined();
    expect(plan.x).toBeCloseTo(0, 6);
    expect(plan.z).toBeCloseTo(1 + R, 2); // in front of the wall's near face
    expect(simulateWalk(0, 6, plan.x, plan.z, [WALL], BOUNDS).arrived).toBe(true);
    expect(planClickMove(0, 1 + R + 0.05, ground(0, -6), [WALL], BOUNDS)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("a way round much longer than the straight line is not taken (DETOUR_MAX_RATIO): the walk stops at the obstacle", () => {
    // a 30 m wall 1 m in front, its ends 15 m off: a 31 m way for a 2 m step
    const wall: AABB = { minX: -15, maxX: 15, minZ: -0.5, maxZ: 0.5 };
    expect(findDetour(0, 1.5, 0, -1.5, [wall], BOUNDS)).toBeNull();
    const plan = planClickMove(0, 2, ground(0, -2), [wall], BOUNDS);
    expect(plan.ok && plan.adjusted).toBe("stopped");
    if (plan.ok) expect(plan.z).toBeCloseTo(0.5 + R, 6);
    // the same wall, 5 m long: a short way round its end
    const short: AABB = { minX: -2.5, maxX: 2.5, minZ: -0.5, maxZ: 0.5 };
    const via = findDetour(0, 1.5, 0, -1.5, [short], BOUNDS)!;
    expect(via).not.toBeNull();
    expect(simulateWalk(0, 1.5, 0, -1.5, [short], BOUNDS, R, via).arrived).toBe(true);
    expect(DETOUR_MAX_RATIO).toBeGreaterThan(1);
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
    // planned from the landing, the bench is in the way: the walk goes round it, never through it
    const bench: AABB = { minX: -1, maxX: 1, minZ: -0.3, maxZ: 0.3 };
    const from = walkStart(0, 0.1, undefined, { x: 0, z: 1.6 });
    expect(simulateWalk(from.x, from.z, 0, -6, [bench], BOUNDS).arrived).toBe(false);
    const plan = planClickMove(from.x, from.z, ground(0, -6), [bench], BOUNDS);
    expect(plan).toMatchObject({ ok: true, x: 0, z: -6, adjusted: "none" });
    if (!plan.ok) return;
    const legs = [from, ...plan.via!, { x: plan.x, z: plan.z }];
    for (let i = 1; i < legs.length; i++) expect(segmentClear(legs[i - 1].x, legs[i - 1].z, legs[i].x, legs[i].z, [bench])).toBe(true);
  });

  it("seated, the paving right behind the bench: up, round the bench's end, to the click (round 4 review: it did nothing)", () => {
    // plaza_5's seat 8 (the review's taps): planned from its dismount point, in front of the bench
    const s = VILLAGE_SEATS[8];
    const obstacles = villageGeometry.obstacles;
    const village = VILLAGE_LAYOUT.areas.village;
    for (const [x, z] of [
      [-3.63, 11.24],
      [-5.79, 10.86],
    ]) {
      expect(simulateWalk(s.standX, s.standZ, x, z, obstacles, village).arrived).toBe(false);
      const plan = planClickMove(s.standX, s.standZ, ground(x, z), obstacles, village, true);
      expect(plan).toMatchObject({ ok: true, x, z, adjusted: "none" });
      if (!plan.ok) continue;
      expect(simulateWalk(s.standX, s.standZ, x, z, obstacles, village, R, plan.via).arrived).toBe(true);
    }
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

  it("the fountain's water (the middle of its collider): the walk goes toward it and stops at the rim's foot", () => {
    const plan = planClickMove(0, 16, ground(2, 3, 0.1), obstacles, village);
    expect(plan.ok && plan.adjusted).toBe("stopped");
    if (!plan.ok) return;
    expect(isFreeSpot(plan.x, plan.z, obstacles, village)).toBe(true);
    expect(Math.hypot(plan.x - 2, plan.z - 3)).toBeLessThan(Math.hypot(0 - 2, 16 - 3)); // on its way to the click
    expect(simulateWalk(0, 16, plan.x, plan.z, obstacles, village).arrived).toBe(true);
  });

  it("the far creek bank: over the bridge, the ring on the click (round 4 review: it sat 2.6 m ahead, behind the avatar's back)", () => {
    for (const [from, to] of [
      [
        { x: -12, z: 64 },
        { x: -12, z: 84 },
      ],
      [
        { x: -6, z: 65.7 },
        { x: -6, z: 85 },
      ], // the review's case
    ]) {
      const plan = planClickMove(from.x, from.z, ground(to.x, to.z, 0.001), obstacles, village);
      expect(plan).toMatchObject({ ok: true, x: to.x, z: to.z, adjusted: "none" });
      if (!plan.ok) continue;
      // the way crosses at the bridge (its gap in the creek's collider, x -26..-22)
      expect(plan.via!.some((p) => p.x > -26 + R && p.x < -22 - R)).toBe(true);
      expect(simulateWalk(from.x, from.z, to.x, to.z, obstacles, village, R, plan.via).arrived).toBe(true);
    }
  });

  it("the grass band at the water and the water itself (inside the creek's collider): toward them, the ring at the bank (round 4 review)", () => {
    for (const z of [69.5, 76]) {
      const plan = planClickMove(-6, 66, ground(-6, z, 0.01), obstacles, village);
      expect(plan).toMatchObject({ ok: true, adjusted: "stopped" });
      if (!plan.ok) continue;
      expect(plan.x).toBeCloseTo(-6, 6);
      expect(plan.z).toBeCloseTo(69 - R, 6); // the creek's collider starts at z = 69
    }
  });

  it("past the village's edge (a far hill, the lake): toward it, up to what is first in the way (the creek)", () => {
    for (const [x, z] of [
      [-12, 130],
      [-42, 430],
    ]) {
      const plan = planClickMove(-12, 64, ground(x, z, 0), obstacles, village);
      expect(plan).toMatchObject({ ok: true, adjusted: "stopped" });
      if (plan.ok) expect(plan.z).toBeCloseTo(69 - R, 6);
    }
  });

  it("the hall: floor beyond the central bench is walked to round the bench", () => {
    expect(simulateWalk(300.6, 1.5, 300.6, -4, obstacles, hall).arrived).toBe(false);
    const plan = planClickMove(300.6, 1.5, ground(300.6, -4, 0), obstacles, hall);
    expect(plan).toMatchObject({ ok: true, x: 300.6, z: -4, adjusted: "none" });
    if (!plan.ok) return;
    expect(simulateWalk(300.6, 1.5, plan.x, plan.z, obstacles, hall, R, plan.via).arrived).toBe(true);
  });

  it("a clear click across the whole village arrives (round 4 review: a 90 s cap stopped a 2 m/s walk after 180 m)", () => {
    const walk = simulateWalk(-90, -90, 90, 90, [], village);
    expect(walk.arrived).toBe(true);
    expect(planClickMove(-90, -90, ground(90, 90), [], village)).toMatchObject({ ok: true, x: 90, z: 90, adjusted: "none" });
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

describe("clickPlan — a curb's side is a face no higher than a curb (round 3 review: the memorial step's riser)", () => {
  it("the low part of a face that rises past WALKABLE_MAX_Y (a step's riser, 30 cm) is no curb: nothing — its ring sank into the step", () => {
    const riser = { x: 0, y: 0.047, z: 5, ny: 0, faceTall: true };
    expect(surfaceKind(riser, [BOX], BOUNDS)).toBe("none");
    expect(planClickMove(0, 10, riser, [BOX], BOUNDS)).toEqual({ ok: false, reason: "not-ground" });
    // a real curb's side (its face ends at 11 cm) is still walked to as clicked
    expect(surfaceKind({ ...riser, faceTall: false }, [BOX], BOUNDS)).toBe("open");
    // a face whose height was not measured keeps the old reading (the low side of a curb)
    expect(surfaceKind({ x: 0, y: 0.047, z: 5, ny: 0 }, [BOX], BOUNDS)).toBe("open");
  });
});

describe("clickPlan — a walk needs its ring on the screen (round 3 review: a stop off the screen)", () => {
  const atClick = { ok: true as const, x: 1, z: 2, y: 0.01, adjusted: "none" as const };
  const stopped = { ok: true as const, x: 1, z: 2, y: 0.01, adjusted: "stopped" as const };
  const pushed = { ok: true as const, x: 1, z: 2, y: 0.01, adjusted: "pushed" as const };

  it("a ring whose centre is off the screen (or behind the camera) is no walk: no ring, no walk", () => {
    for (const plan of [atClick, stopped, pushed]) {
      expect(requireSeen(plan, { onScreen: false, seen: 1 })).toEqual({ ok: false, reason: "unseen" });
    }
  });

  it("covered in part or most (a crown, a bench's back, a body), a ring on the screen still walks: it is drawn through what covers it (round 4 review)", () => {
    for (const plan of [atClick, stopped, pushed]) {
      expect(requireSeen(plan, { onScreen: true, seen: 0.22 })).toBe(plan); // the paving behind a bench, from its seat
      expect(requireSeen(plan, { onScreen: true, seen: 0 })).toBe(plan);
    }
  });

  it("an unseen ring is no walk at all (not a stop either); a refusal passes through unchanged", () => {
    expect(clickIntent({ ok: false, reason: "unseen" })).toBe("ignore");
    const refused = { ok: false as const, reason: "unreachable" as const };
    expect(requireSeen(refused, { onScreen: false, seen: 0 })).toBe(refused);
  });
});

describe("clickPlan — a walk that cannot arrive stops where it meets the obstacle, toward the click (round 3 review: the creek)", () => {
  it("a long wall crossed at a slant: the ring is where the straight walk meets it, not 15 m along it where the slide ends", () => {
    const wall: AABB = { minX: -21, maxX: 21, minZ: -3, maxZ: -2.5 }; // across the whole area: no way round
    const raw = simulateWalk(0, 0, 16, -8, [wall], BOUNDS);
    expect(raw.arrived).toBe(false);
    expect(raw.x).toBeGreaterThan(12); // the slide along the wall's face ends near the click's x
    const plan = planClickMove(0, 0, ground(16, -8), [wall], BOUNDS);
    expect(plan.ok && plan.adjusted).toBe("stopped");
    if (!plan.ok) return;
    expect(plan.z).toBeCloseTo(-2.5 + R, 6); // at the wall's grown face...
    expect(plan.x).toBeCloseTo((16 * (2.5 - R)) / 8, 1); // ...on the line from the avatar to the click
    expect(simulateWalk(0, 0, plan.x, plan.z, [wall], BOUNDS).arrived).toBe(true);
  });

  it("simulateWalk reports the first contact (null when nothing was in the way)", () => {
    expect(simulateWalk(0, 0, 5, 5, [], BOUNDS).contact).toBeNull();
    const c = simulateWalk(0, 6, 0, -6, [BOX], BOUNDS).contact!;
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.z).toBeCloseTo(1 + R, 6);
  });

  it("the real creek: the lawn across it seen from the bridge's head is walked to over the bridge, not 18 m along the bank", () => {
    const obstacles = villageGeometry.obstacles;
    const village = VILLAGE_LAYOUT.areas.village;
    const from = { x: -24, z: 66 };
    const click = ground(-43.6, 92.8, 0.001);
    const raw = simulateWalk(from.x, from.z, click.x, click.z, obstacles, village);
    expect(Math.hypot(raw.x - from.x, raw.z - from.z)).toBeGreaterThan(15); // where the slide along the bank ends
    const plan = planClickMove(from.x, from.z, click, obstacles, village);
    expect(plan).toMatchObject({ ok: true, x: click.x, z: click.z, adjusted: "none" });
    if (!plan.ok) return;
    expect(simulateWalk(from.x, from.z, click.x, click.z, obstacles, village, R, plan.via).arrived).toBe(true);
  });

  it("with no way round, a slanted walk at the creek stops on the near bank toward the click, not along it", () => {
    // a creek with no bridge, across the whole area: the stop is where the straight walk meets its collider
    const creek: AABB = { minX: -200, maxX: 200, minZ: 69, maxZ: 81 };
    const village = VILLAGE_LAYOUT.areas.village;
    const from = { x: -24, z: 66 };
    const click = ground(-30, 92.8, 0.001);
    const plan = planClickMove(from.x, from.z, click, [creek], village);
    expect(plan.ok && plan.adjusted).toBe("stopped");
    if (!plan.ok) return;
    expect(plan.z).toBeCloseTo(69 - R, 6);
    const ux = click.x - from.x;
    const uz = click.z - from.z;
    const off = Math.abs((plan.x - from.x) * uz - (plan.z - from.z) * ux) / Math.hypot(ux, uz);
    expect(off).toBeLessThan(0.1); // on the line toward the click
  });

  it("segmentClear: a walk along a grown face or touching its corner is clear; one through the inside is not", () => {
    expect(segmentClear(-5, 1 + R, 5, 1 + R, [BOX])).toBe(true); // along the grown face
    expect(segmentClear(-5, 1 + R - 0.01, 5, 1 + R - 0.01, [BOX])).toBe(false);
    expect(segmentClear(1 + R, 3, 1 + R + 2, 1 + R, [BOX])).toBe(true); // a corner touched from outside
    expect(segmentClear(0, 5, 0, -5, [BOX])).toBe(false);
    expect(segmentClear(-5, 5, 5, 5, [BOX])).toBe(true);
  });
});

describe("clickPlan — round 5 review: ways round keep clear of corners, benches' boxes, nothing-happens", () => {
  /** How far (m) (x, z) is outside `b` grown by the radius (negative: inside). */
  const outside = (x: number, z: number, b: AABB) => Math.max(b.minX - R - x, x - (b.maxX + R), b.minZ - R - z, z - (b.maxZ + R));

  it("a way round keeps DETOUR_VIA_CLEAR past the grown faces at its corners, more than the walk turns early (VIA_REACH)", () => {
    expect(VIA_REACH).toBeLessThan(DETOUR_VIA_CLEAR);
    for (const [from, to] of [
      [
        { x: 0, z: 6 },
        { x: 0, z: -6 },
      ],
      [
        { x: 0.3, z: 3 },
        { x: -0.4, z: -2.5 },
      ],
      [
        { x: 4, z: 1 },
        { x: -4, z: -1.2 },
      ],
    ]) {
      const via = findDetour(from.x, from.z, to.x, to.z, [BOX], BOUNDS)!;
      expect(via.length).toBeGreaterThan(0);
      for (const p of via) expect(outside(p.x, p.z, BOX)).toBeGreaterThanOrEqual(DETOUR_VIA_CLEAR - 1e-9);
      expect(simulateWalk(from.x, from.z, to.x, to.z, [BOX], BOUNDS, R, via).arrived).toBe(true);
    }
  });

  it("a gap narrower than the clearance is still gone through, with none (the grown faces themselves)", () => {
    // two boxes 0.9 m apart: room for a body (0.8 m) but not for the clearance either side
    const a: AABB = { minX: -6, maxX: -0.45, minZ: -0.5, maxZ: 0.5 };
    const b: AABB = { minX: 0.45, maxX: 6, minZ: -0.5, maxZ: 0.5 };
    const wallW: AABB = { minX: -21, maxX: -6, minZ: -0.5, maxZ: 0.5 };
    const wallE: AABB = { minX: 6, maxX: 21, minZ: -0.5, maxZ: 0.5 };
    const boxes = [a, b, wallW, wallE];
    const plan = planClickMove(0.6, 4, ground(-0.6, -4), boxes, BOUNDS);
    expect(plan).toMatchObject({ ok: true, x: -0.6, z: -4, adjusted: "none" });
    if (plan.ok) expect(simulateWalk(0.6, 4, -0.6, -4, boxes, BOUNDS, R, plan.via).arrived).toBe(true);
  });

  it("a click on the ground inside a bench's box moves out up to FURNITURE_MAX_PUSH — only for furniture", () => {
    // a 2 x 1.34 m box round a turned bench; the ground 0.1 m off its middle is in plain view behind the backrest
    const bench: AABB = { minX: -1, maxX: 1, minZ: -0.67, maxZ: 0.67 };
    const click = ground(0, 0.1);
    expect(nearestFreeSpot(0, 0.1, [bench], BOUNDS)).toBeNull(); // nothing within MAX_PUSH
    expect(planClickMove(0, 5, click, [bench], BOUNDS)).toMatchObject({ ok: true, adjusted: "stopped" }); // a wall: up to it
    const plan = planClickMove(0, 5, click, [bench], BOUNDS, false, { furniture: [bench] });
    expect(plan).toMatchObject({ ok: true, adjusted: "pushed" });
    if (!plan.ok) return;
    expect(plan.z).toBeCloseTo(0.67 + R + 0.02, 6); // the nearest place a body stands, on the clicked side
    expect(Math.hypot(plan.x - 0, plan.z - 0.1)).toBeLessThanOrEqual(FURNITURE_MAX_PUSH);
    // the creek's water is no furniture: still toward it, the ring at the bank
    const village = VILLAGE_LAYOUT.areas.village;
    const creekPlan = planClickMove(-6, 66, ground(-6, 76), villageGeometry.obstacles, village, false, { furniture: VILLAGE_FURNITURE });
    expect(creekPlan).toMatchObject({ ok: true, adjusted: "stopped" });
  });

  it("the nearest spot out of a collider's margin lies in a gap no body reaches: the next nearest is taken", () => {
    // seat 7 (plaza_4): the paving between the bench's back and the planter behind it — 7 cm of room between the grown boxes
    const s = VILLAGE_SEATS[7];
    const village = VILLAGE_LAYOUT.areas.village;
    const spots = freeSpotsNear(4.98, 11.41, villageGeometry.obstacles, village);
    expect(spots.length).toBeGreaterThan(1);
    for (let i = 1; i < spots.length; i++) {
      const d0 = Math.hypot(spots[i - 1].x - 4.98, spots[i - 1].z - 11.41);
      expect(Math.hypot(spots[i].x - 4.98, spots[i].z - 11.41)).toBeGreaterThanOrEqual(d0);
    }
    const plan = planClickMove(s.standX, s.standZ, ground(4.98, 11.41), villageGeometry.obstacles, village, true, { furniture: VILLAGE_FURNITURE });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(simulateWalk(s.standX, s.standZ, plan.x, plan.z, villageGeometry.obstacles, village, R, plan.via).arrived).toBe(true);
  });

  it("the far creek bank tapped from the water's edge (no way round within DETOUR_MAX_RATIO): over the bridge, not nothing", () => {
    const village = VILLAGE_LAYOUT.areas.village;
    const from = { x: 4.67, z: 71.21 }; // at the creek's south face, the bridge 27 m west
    const plan = planClickMove(from.x, from.z, ground(-7.51, 87.08), villageGeometry.obstacles, village);
    expect(plan).toMatchObject({ ok: true, x: -7.51, z: 87.08, adjusted: "none" });
    if (!plan.ok) return;
    expect(plan.via!.some((p) => p.x > -26 + R && p.x < -22 - R)).toBe(true); // by the bridge
    expect(simulateWalk(from.x, from.z, plan.x, plan.z, villageGeometry.obstacles, village, R, plan.via).arrived).toBe(true);
  });

  it("startClickPlan + finishClickPlan is planClickMove; the way round's search runs in slices (finishClickPlanSteps)", () => {
    const village = VILLAGE_LAYOUT.areas.village;
    const obstacles = villageGeometry.obstacles;
    // straight: decided at the start
    expect(startClickPlan(0, 16, ground(3, 20), obstacles, village).plan).toEqual(planClickMove(0, 16, ground(3, 20), obstacles, village));
    // across the creek by the bridge: a way round, left for the finish
    const start = startClickPlan(-6, 65.7, ground(-6, 85, 0.001), obstacles, village);
    expect(start.plan).toBeUndefined();
    expect(finishClickPlan(start.detour!)).toEqual(planClickMove(-6, 65.7, ground(-6, 85, 0.001), obstacles, village));
    const steps = finishClickPlanSteps(start.detour!);
    let slices = 0;
    let r = steps.next();
    while (!r.done) {
      slices++;
      r = steps.next();
    }
    expect(slices).toBeGreaterThan(0);
    expect(r.value).toEqual(finishClickPlan(start.detour!));
  });
});
