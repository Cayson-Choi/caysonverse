import { describe, it, expect } from "vitest";
import {
  MOVE_SPEED,
  MOVE_SPEED_SLACK,
  MOVE_ELAPSED_FLOOR_MS,
  WORLD_BOUNDS,
  PLAYER_RADIUS,
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
  // The clamp keeps the player CENTER a body-radius off the boundary walls, so a
  // clamped edge position rests flush against the wall (still accepted, not
  // dropped). z = 12 stays clear of the east-wall screen.
  it("clamps a legal-speed move that overshoots the edge", () => {
    const current = { x: WORLD_BOUNDS.maxX - 0.1, z: 12 };
    const result = validateMove(current, { x: WORLD_BOUNDS.maxX + 5, z: 12, yaw: 0 }, 2000);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(WORLD_BOUNDS.maxX - PLAYER_RADIUS, 6);
  });

  it("clamps a south-edge overshoot to rest flush against the wall (clear lounge x)", () => {
    // The min-Z (south) boundary at a clear lounge x (spawn column): a legal-speed
    // overshoot south of the world clamps the centre a body-radius off the wall
    // (accepted, not dropped). NOTE the SW/min-X corner is now the MAZE's walled
    // corner (v2-3 west extension) — overshooting there is correctly DROPPED, so
    // this exercises the clamp on the still-open south edge.
    const c = { x: -15, z: WORLD_BOUNDS.minZ + 0.1 };
    const result = validateMove(c, { x: -15, z: WORLD_BOUNDS.minZ - 5, yaw: 0 }, 10000);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(-15, 6);
    expect(result!.z).toBeCloseTo(WORLD_BOUNDS.minZ + PLAYER_RADIUS, 6);
  });

  it("drops an overshoot into the maze west wall (the min-X boundary is now walled)", () => {
    // After the west extension the world's min-X edge coincides with the maze's
    // solid west wall, so a clamp there lands inside a wall → dropped (not accepted).
    const c = { x: WORLD_BOUNDS.minX + PLAYER_RADIUS + 0.2, z: -10 };
    const result = validateMove(c, { x: WORLD_BOUNDS.minX - 5, z: -10, yaw: 0 }, 10000);
    expect(result).toBeNull();
  });
});

describe("validateMove — obstacle drop", () => {
  it("drops a move whose target lands inside furniture", () => {
    // The E2E test sofa sits at (-15, -7); its centre is solidly inside it.
    const result = validateMove({ x: -15, z: -6.5 }, { x: -15, z: -7, yaw: 0 }, 1000);
    expect(result).toBeNull();
  });

  it("drops a move into the interior divider wall", () => {
    // The divider (x≈0) is solid away from the door; z = -8 is wall, not gap.
    const result = validateMove({ x: 0.7, z: -8 }, { x: 0, z: -8, yaw: 0 }, 1000);
    expect(result).toBeNull();
  });

  it("drops a move into the lecture-hall screen", () => {
    const result = validateMove({ x: 29, z: 0 }, { x: 29.6, z: 0, yaw: 0 }, 1000);
    expect(result).toBeNull();
  });

  it("accepts a target hugging a wall (tangent, not penetrating)", () => {
    // Flush against the divider's east face at a solid section — legal.
    const hugX = 0.25 + PLAYER_RADIUS;
    const result = validateMove({ x: 1.2, z: -8 }, { x: hugX, z: -8, yaw: 0 }, 1000);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(hugX, 6);
  });

  it("accepts an open-floor move through the door gap", () => {
    const result = validateMove({ x: -0.5, z: 0 }, { x: 0.5, z: 0, yaw: 0 }, 1000);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0.5, 6);
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
