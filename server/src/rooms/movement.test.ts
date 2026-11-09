import { describe, it, expect } from "vitest";
import {
  MOVE_SPEED,
  RUN_SPEED,
  MOVE_SPEED_SLACK,
  MOVE_ELAPSED_CEIL_MS,
  MOVE_ELAPSED_FLOOR_MS,
  WORLD_BOUNDS,
  PLAYER_RADIUS,
} from "@caysonverse/shared/constants";
import { LEGACY_GEOMETRY, SPAWN_POINT, SPAWN_JITTER } from "@caysonverse/shared/worldMap";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { validateMove, spawnInDisk, moveBaselineAfter } from "./movement";

const ORIGIN = { x: 0, z: 0 };

// Distance a client may legally travel in the given elapsed window.
function budget(elapsedMs: number): number {
  const elapsed = Math.max(elapsedMs, MOVE_ELAPSED_FLOOR_MS);
  return RUN_SPEED * (elapsed / 1000) * MOVE_SPEED_SLACK;
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

describe("validateMove — the sender's clock (MovePayload.t → Player.moveT)", () => {
  it("passes a whole-ms uint32 clock reading through", () => {
    expect(validateMove(ORIGIN, { x: 0.3, z: 0, yaw: 0, t: 734512 }, 100)).toEqual({ x: 0.3, z: 0, yaw: 0, t: 734512 });
    expect(validateMove(ORIGIN, { x: 0.3, z: 0, yaw: 0, t: 1 }, 100)!.t).toBe(1);
    expect(validateMove(ORIGIN, { x: 0.3, z: 0, yaw: 0, t: 0xffffffff }, 100)!.t).toBe(0xffffffff);
  });

  it("leaves out a missing or unusable clock — never a reason to drop the move", () => {
    for (const t of [undefined, 0, -5, 1.5, 2 ** 32, NaN, Infinity, "123", null, {}]) {
      const r = validateMove(ORIGIN, { x: 0.3, z: 0, yaw: 0, t }, 100);
      expect(r).toEqual({ x: 0.3, z: 0, yaw: 0 });
    }
  });
});

describe("moveBaselineAfter — a step spends only the budget it used (fix/remote-move-snapback)", () => {
  const perMs = (RUN_SPEED * MOVE_SPEED_SLACK) / 1000; // metres of budget per ms

  it("keeps the unused part: a 0.45 m step out of a 500 ms budget leaves 500 - 0.45/perMs ms", () => {
    const now = 10_000;
    const next = moveBaselineAfter(now, 500, 0.45);
    expect(now - next).toBeCloseTo(500 - 0.45 / perMs, 9);
  });

  it("a step that used all of it (or more, via the floor) leaves nothing — the old behaviour", () => {
    expect(moveBaselineAfter(10_000, 100, 100 * perMs)).toBe(10_000);
    expect(moveBaselineAfter(10_000, 3, 0.096)).toBe(10_000);
    expect(moveBaselineAfter(10_000, 0, 0)).toBe(10_000);
  });

  it("a burst of queued walk steps 1 ms apart is accepted while the kept budget lasts — then dropped as before", () => {
    // A late frame, then the moves queued behind it, 1 ms apart. Resetting the baseline to `now` on each
    // accepted move (the old rule) left the second one a 1 ms (floored to 10 ms = 0.096 m) budget: dropped.
    expect(validateMove({ x: 0.45, z: 0 }, { x: 0.9, z: 0, yaw: 0 }, 1)).toBeNull(); // the old rule's 2nd step
    let current = { x: 0, z: 0 };
    let now = 50_000;
    let baseline = now - MOVE_ELAPSED_CEIL_MS; // the link froze for half a second
    let accepted = 0;
    for (let k = 1; k <= 14; k++) {
      const budget = Math.min(now - baseline, MOVE_ELAPSED_CEIL_MS);
      const next = validateMove(current, { x: 0.45 * k, z: 0, yaw: 0 }, budget);
      if (next === null) break;
      baseline = moveBaselineAfter(now, budget, Math.hypot(next.x - current.x, next.z - current.z));
      current = next;
      accepted += 1;
      now += 1;
    }
    // The kept budget (4.8 m + 1 ms per step) carries 10 steps of 0.45 m; the 11th would pass 4.8 m: dropped.
    expect(accepted).toBe(10);
    expect(current.x).toBeCloseTo(4.5, 9);
  });

  it("nothing gets looser: over any stretch the accepted travel is at most RUN_SPEED x slack x (time + the 500 ms ceiling)", () => {
    // A cheater hammering 1 m steps at 30 messages/s for 3 s from a full budget.
    let current = { x: 0, z: 0 };
    let now = 0;
    let baseline = -MOVE_ELAPSED_CEIL_MS;
    let travelled = 0;
    for (let k = 0; k < 90; k++, now += 1000 / 30) {
      const budget = Math.min(now - baseline, MOVE_ELAPSED_CEIL_MS);
      const next = validateMove(current, { x: current.x + 1, z: 0, yaw: 0 }, budget, {
        ...LEGACY_GEOMETRY,
        bounds: { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 },
        obstacles: [],
      });
      if (next === null) continue;
      travelled += next.x - current.x;
      baseline = moveBaselineAfter(now, budget, next.x - current.x);
      current = next;
    }
    expect(travelled).toBeLessThanOrEqual(RUN_SPEED * MOVE_SPEED_SLACK * ((now + MOVE_ELAPSED_CEIL_MS) / 1000) + 1e-9);
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

describe("validateMove — run speed (controls-ux §5)", () => {
  it("pins the run multiplier at 1.6", () => {
    expect(RUN_SPEED).toBeCloseTo(MOVE_SPEED * 1.6, 9);
  });

  it("accepts a run step the old walk budget dropped", () => {
    const d = MOVE_SPEED * 0.1 * MOVE_SPEED_SLACK + 0.1; // > 0.6 m (old cap)
    expect(validateMove(ORIGIN, { x: d, z: 0, yaw: 0 }, 100)).not.toBeNull();
  });

  it("drops a step just beyond RUN_SPEED × elapsed × slack", () => {
    const d = RUN_SPEED * 0.1 * MOVE_SPEED_SLACK + 0.01;
    expect(validateMove(ORIGIN, { x: d, z: 0, yaw: 0 }, 100)).toBeNull();
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
    // The central set's north sofa sits at (-15, 3.5); its centre is solidly inside it.
    const result = validateMove({ x: -15, z: 2.4 }, { x: -15, z: 3.5, yaw: 0 }, 1000);
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

// escape phase 1, Task 2: the map a player stands in is an argument, so the school hub and
// the team rooms reuse the same speed/bounds/obstacle rules on their own geometry.
describe("validateMove — map geometry argument", () => {
  const BOX: MapGeometry = {
    id: "counsel",
    bounds: { minX: -6, maxX: 6, minZ: -5, maxZ: 5 },
    obstacles: [{ minX: 1, maxX: 2, minZ: -1, maxZ: 1 }],
    cameraBoxes: [],
  };

  it("clamps into the given geometry's bounds", () =>
    expect(validateMove({ x: 5.5, z: 0 }, { x: 5.9, z: 0, yaw: 0 }, 100, BOX)).toEqual({
      x: 6 - PLAYER_RADIUS,
      z: 0,
      yaw: 0,
    }));

  it("drops a move into the given geometry's obstacle", () =>
    expect(validateMove({ x: 0.3, z: 0 }, { x: 0.8, z: 0, yaw: 0 }, 100, BOX)).toBeNull());

  it("without geo it is the legacy map (same verdicts as before)", () => {
    // Moves whose verdict on the legacy world is pinned by the tests above: accepted open
    // floor, clamped edges, furniture/wall drops. Each must come out the same with no
    // argument and with LEGACY_GEOMETRY passed explicitly.
    const cases: Array<[{ x: number; z: number }, unknown, number]> = [
      [ORIGIN, { x: 0.3, z: 0.2, yaw: 0 }, 100], // open floor
      [{ x: -0.5, z: 0 }, { x: 0.5, z: 0, yaw: 0 }, 1000], // door gap
      [{ x: WORLD_BOUNDS.maxX - 0.1, z: 12 }, { x: WORLD_BOUNDS.maxX + 5, z: 12, yaw: 0 }, 2000], // east clamp
      [{ x: -15, z: WORLD_BOUNDS.minZ + 0.1 }, { x: -15, z: WORLD_BOUNDS.minZ - 5, yaw: 0 }, 10000], // south clamp
      [{ x: -15, z: 2.4 }, { x: -15, z: 3.5, yaw: 0 }, 1000], // sofa
      [{ x: 0.7, z: -8 }, { x: 0, z: -8, yaw: 0 }, 1000], // divider wall
      [{ x: 29, z: 0 }, { x: 29.6, z: 0, yaw: 0 }, 1000], // lecture-hall screen
      [{ x: WORLD_BOUNDS.minX + PLAYER_RADIUS + 0.2, z: -10 }, { x: WORLD_BOUNDS.minX - 5, z: -10, yaw: 0 }, 10000], // maze west wall
    ];
    const defaults = cases.map(([c, p, e]) => validateMove(c, p, e));
    const explicit = cases.map(([c, p, e]) => validateMove(c, p, e, LEGACY_GEOMETRY));
    expect(defaults).toEqual(explicit);
    // Non-vacuous: the set holds both outcomes (4 accepted, 4 dropped)...
    expect(defaults.filter((r) => r === null)).toHaveLength(4);
    // ...and the clamps really used the legacy bounds, not some other map's.
    expect(defaults[2]!.x).toBeCloseTo(WORLD_BOUNDS.maxX - PLAYER_RADIUS, 6);
    expect(defaults[3]!.z).toBeCloseTo(WORLD_BOUNDS.minZ + PLAYER_RADIUS, 6);
  });

  it("judges against the given map only (a legacy obstacle is open floor elsewhere)", () => {
    // The legacy sofa at (-15, 3.5) drops the move on the legacy map; a map whose bounds
    // contain that point and has no props there accepts the same move.
    const open: MapGeometry = {
      id: "hub-open",
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
      obstacles: [],
      cameraBoxes: [],
    };
    expect(validateMove({ x: -15, z: 2.4 }, { x: -15, z: 3.5, yaw: 0 }, 1000)).toBeNull();
    expect(validateMove({ x: -15, z: 2.4 }, { x: -15, z: 3.5, yaw: 0 }, 1000, open)).toEqual({
      x: -15,
      z: 3.5,
      yaw: 0,
    });
  });
});

// escape phase 1, Task 2: the spawn rule WorldRoom used, with the map as an argument
// (ClassRoom spawns around HUB_SPAWN on the hub geometry with the same function).
describe("spawnInDisk", () => {
  const ROOM: MapGeometry = {
    id: "counsel",
    bounds: { minX: -6, maxX: 6, minZ: -5, maxZ: 5 },
    obstacles: [],
    cameraBoxes: [],
  };
  /** A deterministic Math.random stand-in that returns `values` in order. */
  const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++];
  };

  it("draws the radius first, then the angle (uniform over the disk's area)", () => {
    expect(spawnInDisk(1, 2, 3, ROOM, seq(0, 0.7))).toEqual({ x: 1, z: 2 }); // r = 0 → centre
    const east = spawnInDisk(1, 2, 3, ROOM, seq(1, 0)); // r = R, angle 0 → +x
    expect(east.x).toBeCloseTo(4, 9);
    expect(east.z).toBeCloseTo(2, 9);
    const south = spawnInDisk(1, 2, 3, ROOM, seq(1, 0.25)); // angle π/2 → +z
    expect(south.x).toBeCloseTo(1, 9);
    expect(south.z).toBeCloseTo(5 - PLAYER_RADIUS, 9); // 2 + 3 = 5 → clamped off the wall
    const half = spawnInDisk(0, 0, 4, ROOM, seq(0.25, 0)); // r = R·√0.25 = R/2
    expect(half.x).toBeCloseTo(2, 9);
  });

  it("clamps into the map's bounds inset by the body radius", () => {
    const corner = spawnInDisk(6, -5, 2, ROOM, seq(0, 0));
    expect(corner).toEqual({ x: 6 - PLAYER_RADIUS, z: -5 + PLAYER_RADIUS });
    const west = spawnInDisk(-6, 0, 2, ROOM, seq(1, 0.5)); // angle π → further west
    expect(west.x).toBe(-6 + PLAYER_RADIUS);
  });

  it("with Math.random keeps the world spawn inside its jitter disk and the world bounds", () => {
    for (let i = 0; i < 500; i++) {
      const p = spawnInDisk(SPAWN_POINT.x, SPAWN_POINT.z, SPAWN_JITTER, LEGACY_GEOMETRY);
      expect(Math.hypot(p.x - SPAWN_POINT.x, p.z - SPAWN_POINT.z)).toBeLessThanOrEqual(SPAWN_JITTER + 1e-9);
      expect(p.x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + PLAYER_RADIUS);
      expect(p.x).toBeLessThanOrEqual(WORLD_BOUNDS.maxX - PLAYER_RADIUS);
      expect(p.z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ + PLAYER_RADIUS);
      expect(p.z).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
    }
  });
});
