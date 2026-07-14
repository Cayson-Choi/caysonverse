import { describe, it, expect } from "vitest";
import {
  circleIntersectsAABB,
  isBlocked,
  resolveCollision,
  type AABB,
} from "./collision";

// A vertical wall (thick in X, long in Z) used across the slide/tunnel tests.
const WALL: AABB = { minX: 0, maxX: 0.5, minZ: -5, maxZ: 5 };
const R = 0.4;

describe("circleIntersectsAABB", () => {
  it("detects a center inside the box", () => {
    expect(circleIntersectsAABB(0.25, 0, R, WALL)).toBe(true);
  });

  it("detects a circle overlapping a face", () => {
    // center 0.2 left of the face, radius 0.4 → penetrates by 0.2
    expect(circleIntersectsAABB(-0.2, 0, R, WALL)).toBe(true);
  });

  it("rejects a circle exactly tangent to a face (distance === r)", () => {
    // center at minX - r → closest point distance is exactly r → strict < is false
    expect(circleIntersectsAABB(WALL.minX - R, 0, R, WALL)).toBe(false);
  });

  it("rejects a circle clearly clear of the box", () => {
    expect(circleIntersectsAABB(-2, 0, R, WALL)).toBe(false);
  });

  it("uses true (rounded) corner distance, not the expanded square", () => {
    // Diagonally off the (minX,minZ) corner by more than r along the diagonal but
    // less than r on each axis: square-expansion would report a hit, the real
    // circle-vs-corner distance (~0.42 > 0.4) does not.
    const px = WALL.minX - 0.3;
    const pz = WALL.minZ - 0.3;
    expect(circleIntersectsAABB(px, pz, R, WALL)).toBe(false);
  });

  it("honors the slack tolerance (shrinks the effective radius)", () => {
    // penetrating by 0.005 is ignored when slack is 0.01
    const px = WALL.minX - (R - 0.005);
    expect(circleIntersectsAABB(px, 0, R, WALL)).toBe(true);
    expect(circleIntersectsAABB(px, 0, R, WALL, 0.01)).toBe(false);
  });
});

describe("isBlocked", () => {
  const boxes: AABB[] = [
    { minX: 2, maxX: 3, minZ: 2, maxZ: 3 },
    { minX: -3, maxX: -2, minZ: -3, maxZ: -2 },
  ];

  it("is true when the circle overlaps any obstacle", () => {
    expect(isBlocked(2.5, 2.5, R, boxes)).toBe(true);
  });

  it("is false in open space", () => {
    expect(isBlocked(0, 0, R, boxes)).toBe(false);
  });

  it("accepts a target tangent to a wall (hugging, distance === r)", () => {
    expect(isBlocked(2 - R, 2.5, R, boxes)).toBe(false);
  });

  it("applies the default epsilon slack so boundary rounding is not a false drop", () => {
    // 5mm inside the wall is within the default epsilon and must NOT be blocked.
    expect(isBlocked(2 - R + 0.005, 2.5, R, boxes)).toBe(false);
    // 5cm inside is a real intrusion and IS blocked.
    expect(isBlocked(2 - R + 0.05, 2.5, R, boxes)).toBe(true);
  });
});

describe("resolveCollision — free movement", () => {
  it("applies the full delta with no obstacles", () => {
    const out = resolveCollision(0, 0, 1.3, -0.7, R, []);
    expect(out.x).toBeCloseTo(1.3, 9);
    expect(out.z).toBeCloseTo(-0.7, 9);
  });
});

describe("resolveCollision — head-on stop", () => {
  it("stops the circle at wall.minX - r when moving +X into a wall", () => {
    // from x=-1 a 0.8 step would reach -0.2, past the face at -0.4 → clamped.
    const out = resolveCollision(-1, 0, 0.8, 0, R, [WALL]);
    expect(out.x).toBeCloseTo(WALL.minX - R, 9);
    expect(out.z).toBeCloseTo(0, 9);
  });

  it("stops at wall.maxX + r when moving -X into a wall", () => {
    const out = resolveCollision(2, 0, -1.5, 0, R, [WALL]);
    expect(out.x).toBeCloseTo(WALL.maxX + R, 9);
  });

  it("does not clamp a move that stays short of the wall", () => {
    const out = resolveCollision(-2, 0, 0.5, 0, R, [WALL]);
    expect(out.x).toBeCloseTo(-1.5, 9);
  });
});

describe("resolveCollision — slide along a wall", () => {
  it("clamps the blocked axis and lets the free axis advance fully", () => {
    // diagonal into the +X face: X is clamped at the face, Z glides its full 0.5.
    const out = resolveCollision(-1, 0, 0.8, 0.5, R, [WALL]);
    expect(out.x).toBeCloseTo(WALL.minX - R, 9);
    expect(out.z).toBeCloseTo(0.5, 9);
  });
});

describe("resolveCollision — corner stop", () => {
  const WALL_E: AABB = { minX: 2, maxX: 2.5, minZ: -5, maxZ: 5 };
  const WALL_N: AABB = { minX: -5, maxX: 5, minZ: 2, maxZ: 2.5 };

  it("clamps both axes at an inner corner", () => {
    const out = resolveCollision(1, 1, 1, 1, R, [WALL_E, WALL_N]);
    expect(out.x).toBeCloseTo(WALL_E.minX - R, 9);
    expect(out.z).toBeCloseTo(WALL_N.minZ - R, 9);
  });

  it("is independent of obstacle order", () => {
    const a = resolveCollision(1, 1, 1, 1, R, [WALL_E, WALL_N]);
    const b = resolveCollision(1, 1, 1, 1, R, [WALL_N, WALL_E]);
    expect(a).toEqual(b);
  });
});

describe("resolveCollision — no tunneling at max speed", () => {
  it("never crosses a wall over many max-speed steps (4 m/s × 50ms)", () => {
    const step = 4 * 0.05; // 0.2 m per frame — the pinned worst case
    let pos = { x: -2, z: 0 };
    for (let i = 0; i < 200; i++) {
      pos = resolveCollision(pos.x, pos.z, step, 0, R, [WALL]);
      // must NEVER end up on/through the wall's near face
      expect(pos.x).toBeLessThanOrEqual(WALL.minX - R + 1e-9);
    }
    // and it did travel up to the wall (not stuck at the start)
    expect(pos.x).toBeCloseTo(WALL.minX - R, 9);
  });

  it("does not tunnel a thin (zero-thickness) obstacle either", () => {
    const thin: AABB = { minX: 1, maxX: 1, minZ: -5, maxZ: 5 };
    const step = 0.2;
    let pos = { x: -2, z: 0 };
    for (let i = 0; i < 200; i++) {
      pos = resolveCollision(pos.x, pos.z, step, 0, R, [thin]);
      expect(pos.x).toBeLessThanOrEqual(thin.minX - R + 1e-9);
    }
  });
});
