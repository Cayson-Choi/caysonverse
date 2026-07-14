import { describe, it, expect } from "vitest";
import {
  MOVE_SPEED,
  MOVE_SPEED_SLACK,
  MOVE_ELAPSED_FLOOR_MS,
  WORLD_BOUNDS,
} from "@caysonverse/shared/constants";
import { validateMove } from "./movement";

const ORIGIN = { x: 0, z: 0 };

// Distance a client may legally travel in the given elapsed window.
function budget(elapsedMs: number): number {
  const elapsed = Math.max(elapsedMs, MOVE_ELAPSED_FLOOR_MS);
  return MOVE_SPEED * (elapsed / 1000) * MOVE_SPEED_SLACK;
}

describe("validateMove — payload shape", () => {
  it("accepts a normal in-budget step", () => {
    const result = validateMove(ORIGIN, { x: 0.3, z: 0.2, yaw: 0 }, 100);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ x: 0.3, z: 0.2, yaw: 0 });
  });

  it("drops a non-object payload", () => {
    expect(validateMove(ORIGIN, null, 100)).toBeNull();
    expect(validateMove(ORIGIN, undefined, 100)).toBeNull();
    expect(validateMove(ORIGIN, 42, 100)).toBeNull();
    expect(validateMove(ORIGIN, "0,0,0", 100)).toBeNull();
  });

  it("drops missing fields", () => {
    expect(validateMove(ORIGIN, { x: 1, z: 1 }, 100)).toBeNull();
    expect(validateMove(ORIGIN, { x: 1, yaw: 0 }, 100)).toBeNull();
    expect(validateMove(ORIGIN, {}, 100)).toBeNull();
  });

  it("drops NaN / Infinity / non-number coordinates", () => {
    expect(validateMove(ORIGIN, { x: NaN, z: 0, yaw: 0 }, 100)).toBeNull();
    expect(validateMove(ORIGIN, { x: 0, z: Infinity, yaw: 0 }, 100)).toBeNull();
    expect(validateMove(ORIGIN, { x: 0, z: 0, yaw: -Infinity }, 100)).toBeNull();
    expect(validateMove(ORIGIN, { x: "1", z: 0, yaw: 0 }, 100)).toBeNull();
    expect(validateMove(ORIGIN, { x: 0, z: 0, yaw: null }, 100)).toBeNull();
  });
});

describe("validateMove — displacement / speed", () => {
  it("accepts a move exactly at the speed budget", () => {
    const d = budget(100); // straight along x
    const result = validateMove(ORIGIN, { x: d, z: 0, yaw: 0 }, 100);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(d, 5);
  });

  it("drops a teleport (distance beyond budget)", () => {
    const tooFar = budget(100) * 2;
    expect(validateMove(ORIGIN, { x: tooFar, z: 0, yaw: 0 }, 100)).toBeNull();
  });

  it("measures displacement from the current authoritative position", () => {
    const current = { x: 10, z: 10 };
    // small step from (10,10) is fine…
    expect(validateMove(current, { x: 10.2, z: 10.1, yaw: 0 }, 100)).not.toBeNull();
    // …but the same target coords are a teleport when measured from origin.
    expect(validateMove(ORIGIN, { x: 10.2, z: 10.1, yaw: 0 }, 100)).toBeNull();
  });
});

describe("validateMove — elapsed floor", () => {
  it("uses at least the floor budget when elapsed is ~0 (burst)", () => {
    const withinFloor = budget(0) * 0.9; // inside the floored budget
    expect(validateMove(ORIGIN, { x: withinFloor, z: 0, yaw: 0 }, 0)).not.toBeNull();
  });

  it("still drops a step beyond the floored budget", () => {
    const beyondFloor = budget(0) * 2;
    expect(validateMove(ORIGIN, { x: beyondFloor, z: 0, yaw: 0 }, 0)).toBeNull();
  });

  it("does not grant more than the floor when elapsed is tiny", () => {
    // 1ms elapsed would allow only ~0.006m without the floor; the floor lifts
    // that to the 10ms budget, but a step sized for 100ms must still drop.
    expect(validateMove(ORIGIN, { x: budget(100), z: 0, yaw: 0 }, 1)).toBeNull();
  });
});

describe("validateMove — bounds clamp", () => {
  it("clamps a legal-speed move that overshoots the edge", () => {
    // Start near the +x edge; a legal step past maxX is clamped, not dropped.
    const current = { x: WORLD_BOUNDS.maxX - 0.1, z: 0 };
    const result = validateMove(current, { x: WORLD_BOUNDS.maxX + 5, z: 0, yaw: 0 }, 2000);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(WORLD_BOUNDS.maxX);
  });

  it("clamps on every edge", () => {
    const c = { x: WORLD_BOUNDS.minX + 0.1, z: WORLD_BOUNDS.minZ + 0.1 };
    const result = validateMove(c, { x: WORLD_BOUNDS.minX - 5, z: WORLD_BOUNDS.minZ - 5, yaw: 0 }, 10000);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(WORLD_BOUNDS.minX);
    expect(result!.z).toBe(WORLD_BOUNDS.minZ);
  });
});

describe("validateMove — yaw normalization", () => {
  it("normalizes into [-PI, PI]", () => {
    const result = validateMove(ORIGIN, { x: 0, z: 0, yaw: 3 * Math.PI }, 100);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it("leaves an already-normalized yaw within range", () => {
    const result = validateMove(ORIGIN, { x: 0, z: 0, yaw: -7 }, 100);
    expect(result).not.toBeNull();
    expect(result!.yaw).toBeGreaterThanOrEqual(-Math.PI - 1e-9);
    expect(result!.yaw).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it("maps equivalent angles to the same normalized value", () => {
    const a = validateMove(ORIGIN, { x: 0, z: 0, yaw: Math.PI / 2 }, 100);
    const b = validateMove(ORIGIN, { x: 0, z: 0, yaw: Math.PI / 2 + 2 * Math.PI }, 100);
    expect(a!.yaw).toBeCloseTo(b!.yaw, 5);
  });
});
