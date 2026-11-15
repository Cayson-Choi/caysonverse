import { describe, expect, it } from "vitest";
import { busBodyBoxes, collectObstacles } from "./playerObstacles";
import { resolveCollision } from "@caysonverse/shared/collision";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const noRemotes = () => {};

describe("the moving bus is solid (owner 2026-11-15)", () => {
  it("its four boxes cover the whole 9 x 2.5 m body at any heading", () => {
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.13) {
      const boxes: Box[] = [];
      busBodyBoxes({ x: 10, z: -5, yaw }, boxes);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      for (let a = -4.5; a <= 4.5; a += 0.25) {
        for (let w = -1.25; w <= 1.25; w += 0.25) {
          const x = 10 + fx * a - fz * w;
          const z = -5 + fz * a + fx * w;
          expect(boxes.some((b) => x >= b.minX - 1e-9 && x <= b.maxX + 1e-9 && z >= b.minZ - 1e-9 && z <= b.maxZ + 1e-9)).toBe(true);
        }
      }
    }
  });

  it("walking into the side of the moving bus stops at its flank; parked (null pose) it adds nothing", () => {
    const pose = { x: 0, z: 0, yaw: 0 }; // heading +z: flank at x = +-1.25
    const obstacles = collectObstacles(3, 0, noRemotes, () => pose);
    const withBus = obstacles.length;
    let x = 3;
    for (let i = 0; i < 40; i++) x = resolveCollision(x, 0, -0.1, 0, PLAYER_RADIUS, obstacles).x;
    expect(x).toBeGreaterThanOrEqual(1.25 + PLAYER_RADIUS - 1e-6);
    const parked = collectObstacles(3, 0, noRemotes, () => null);
    expect(parked.length).toBe(withBus - 4);
  });

  it("someone already inside a piece (the bus came to them) can walk out", () => {
    const pose = { x: 0, z: 0, yaw: 0 };
    const obstacles = collectObstacles(0.5, 0, noRemotes, () => pose);
    const next = resolveCollision(0.5, 0, 1, 0, PLAYER_RADIUS, obstacles);
    expect(next.x).toBeCloseTo(1.5, 6);
  });
});
