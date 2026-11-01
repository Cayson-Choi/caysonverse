import { describe, it, expect } from "vitest";
import { isBlocked } from "../collision";
import type { AABB } from "../collision";
import { MAZE_WALLS } from "../maze";
import { LEGACY_GEOMETRY, OBSTACLES, WALLS, WORLD_BOUNDS } from "../worldMap";
import { makeGeometry, wallsAround } from "./geometry";
import type { Opening } from "./geometry";
import { inside, overlaps } from "./reachTestUtil";

const Z: AABB = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
const R = 0.4; // PLAYER_RADIUS

describe("wallsAround", () => {
  it("wallsAround leaves exactly the opening", () => {
    const w = wallsAround(Z, [{ side: "e", from: -1, to: 1 }]);
    expect(isBlocked(5, 0, 0.4, w)).toBe(false);
    expect(isBlocked(5, 2, 0.4, w)).toBe(true);
    expect(isBlocked(-5, 0, 0.4, w)).toBe(true);
  });

  it("without openings seals all four sides, 0.5 m thick, entirely outside the zone", () => {
    const w = wallsAround(Z);
    for (const [x, z] of [
      [0, -5],
      [0, 5],
      [5, 0],
      [-5, 0],
    ] as const) {
      expect(isBlocked(x, z, R, w), `${x},${z}`).toBe(true);
    }
    for (const box of w) expect(overlaps(box, Z)).toBe(false);
    const xs = w.flatMap((b) => [b.minX, b.maxX]);
    const zs = w.flatMap((b) => [b.minZ, b.maxZ]);
    expect(Math.min(...xs)).toBeCloseTo(-5.5, 9);
    expect(Math.max(...xs)).toBeCloseTo(5.5, 9);
    expect(Math.min(...zs)).toBeCloseTo(-5.5, 9);
    expect(Math.max(...zs)).toBeCloseTo(5.5, 9);
  });

  it("keeps the whole interior free: a body anywhere inside the zone inset by its radius is not blocked", () => {
    const w = wallsAround(Z, [{ side: "n", from: -1, to: 1 }]);
    for (let x = -4.6; x <= 4.6; x += 0.2) {
      for (let z = -4.6; z <= 4.6; z += 0.2) expect(isBlocked(x, z, R, w), `${x},${z}`).toBe(false);
    }
  });

  it("overlaps at the corners by the wall thickness (no pinhole at the corner squares)", () => {
    const w = wallsAround(Z);
    for (const [x, z] of [
      [5.25, 5.25],
      [-5.25, 5.25],
      [5.25, -5.25],
      [-5.25, -5.25],
    ] as const) {
      expect(w.some((b) => inside(b, { x, z })), `${x},${z}`).toBe(true);
    }
    // The outer corner point itself is covered by two different boxes.
    expect(w.filter((b) => inside(b, { x: 5.25, z: 5.25 })).length).toBeGreaterThanOrEqual(2);
  });

  it("honours a custom thickness, still attached to the outside", () => {
    const w = wallsAround(Z, [], 1);
    for (const box of w) expect(overlaps(box, Z)).toBe(false);
    const xs = w.flatMap((b) => [b.minX, b.maxX]);
    expect(Math.min(...xs)).toBeCloseTo(-6, 9);
    expect(Math.max(...xs)).toBeCloseTo(6, 9);
    expect(isBlocked(5.5, 0, 0.1, w)).toBe(true);
  });

  it("n/s openings are x intervals, e/w openings are z intervals", () => {
    const n = wallsAround(Z, [{ side: "n", from: 2, to: 4 }]);
    expect(isBlocked(3, -5, R, n)).toBe(false); // x = 3 is in the opening
    expect(isBlocked(0, -5, R, n)).toBe(true);
    expect(isBlocked(-3, -5, R, n)).toBe(true);
    expect(isBlocked(3, 5, R, n)).toBe(true); // the south wall is untouched
    const s = wallsAround(Z, [{ side: "s", from: -4, to: -2 }]);
    expect(isBlocked(-3, 5, R, s)).toBe(false);
    expect(isBlocked(0, 5, R, s)).toBe(true);
    expect(isBlocked(-3, -5, R, s)).toBe(true); // the north wall is untouched
    const wst = wallsAround(Z, [{ side: "w", from: 1, to: 3 }]);
    expect(isBlocked(-5, 2, R, wst)).toBe(false);
    expect(isBlocked(-5, -2, R, wst)).toBe(true);
    expect(isBlocked(5, 2, R, wst)).toBe(true); // the east wall is untouched
  });

  it("supports several openings on one side, in any order, even overlapping ones", () => {
    const openings: Opening[] = [
      { side: "e", from: 2, to: 3 },
      { side: "e", from: -3, to: -2 },
      { side: "e", from: 2.5, to: 3.5 }, // overlaps the first: merged into 2..3.5
    ];
    const w = wallsAround(Z, openings);
    expect(isBlocked(5, -2.5, R, w)).toBe(false);
    expect(isBlocked(5, 2.75, R, w)).toBe(false);
    expect(isBlocked(5, 3.05, R, w)).toBe(false); // only free because 2.5..3.5 widened the 2..3 opening
    expect(isBlocked(5, 0, R, w)).toBe(true); // wall between the two openings
    expect(isBlocked(5, 4.5, R, w)).toBe(true);
    expect(isBlocked(5, -4.5, R, w)).toBe(true);
  });

  it("treats a reversed opening (from > to) as the same interval", () => {
    const a = wallsAround(Z, [{ side: "s", from: 1, to: -1 }]);
    const b = wallsAround(Z, [{ side: "s", from: -1, to: 1 }]);
    expect(a).toEqual(b);
  });

  it("never emits an empty or inverted box, even for an opening flush with the wall end", () => {
    const w = wallsAround(Z, [
      { side: "n", from: -5.5, to: -2 }, // starts exactly at the wall's outer end
      { side: "e", from: 4, to: 99 }, // runs past the other end
    ]);
    expect(w.length).toBeGreaterThan(0);
    for (const b of w) {
      expect(b.maxX).toBeGreaterThan(b.minX);
      expect(b.maxZ).toBeGreaterThan(b.minZ);
    }
  });

  it("an opening bigger than the player's body lets a body walk straight out; a smaller one does not", () => {
    const wide = wallsAround(Z, [{ side: "e", from: -1, to: 1 }]);
    for (let x = 0; x <= 7; x += 0.25) expect(isBlocked(x, 0, R, wide), `x=${x}`).toBe(false);
    const slit = wallsAround(Z, [{ side: "e", from: -0.3, to: 0.3 }]);
    expect(isBlocked(5, 0, R, slit)).toBe(true);
  });
});

describe("makeGeometry", () => {
  const walls: AABB[] = [{ minX: 0, maxX: 1, minZ: 0, maxZ: 5 }];
  const props: AABB[] = [{ minX: 3, maxX: 4, minZ: 3, maxZ: 4 }];
  const bounds = { minX: -1, maxX: 10, minZ: -2, maxZ: 8 };

  it("makeGeometry: cameraBoxes are the walls only", () => {
    const g = makeGeometry("counsel", bounds, walls, props);
    expect(g.cameraBoxes).toEqual(walls);
    expect(g.cameraBoxes).not.toContainEqual(props[0]);
  });

  it("obstacles are the walls followed by the props", () => {
    const g = makeGeometry("hub-open", bounds, walls, props);
    expect(g.obstacles).toEqual([...walls, ...props]);
  });

  it("carries the id and bounds through unchanged", () => {
    const g = makeGeometry("hub-gated", bounds, walls, props);
    expect(g.id).toBe("hub-gated");
    expect(g.bounds).toEqual(bounds);
  });

  it("with no props, obstacles and cameraBoxes hold the same boxes", () => {
    const g = makeGeometry("counsel", bounds, walls, []);
    expect(g.obstacles).toEqual(g.cameraBoxes);
    expect(g.obstacles).toHaveLength(1);
  });
});

describe("LEGACY_GEOMETRY (the existing world, bundled by name)", () => {
  it("is the legacy geometry over the existing bounds and obstacle list (same objects, no copy)", () => {
    expect(LEGACY_GEOMETRY.id).toBe("legacy");
    expect(LEGACY_GEOMETRY.bounds).toBe(WORLD_BOUNDS);
    expect(LEGACY_GEOMETRY.obstacles).toBe(OBSTACLES);
  });

  it("camera boxes are every room wall followed by every maze wall", () => {
    expect(MAZE_WALLS.length).toBeGreaterThan(0);
    expect(LEGACY_GEOMETRY.cameraBoxes).toHaveLength(WALLS.length + MAZE_WALLS.length);
    expect(LEGACY_GEOMETRY.cameraBoxes.slice(0, WALLS.length)).toEqual(WALLS);
    expect(LEGACY_GEOMETRY.cameraBoxes.slice(WALLS.length)).toEqual(MAZE_WALLS);
  });

  it("every camera box is also a collision obstacle", () => {
    for (const box of LEGACY_GEOMETRY.cameraBoxes) expect(LEGACY_GEOMETRY.obstacles).toContainEqual(box);
  });
});
