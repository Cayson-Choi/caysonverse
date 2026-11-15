import { describe, expect, it } from "vitest";
import { collectObstacles, pushOutOfMovingBus } from "./playerObstacles";
import { resolveCollision } from "@caysonverse/shared/collision";
import { busClearance } from "@caysonverse/shared/village/busBody";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { routePoseAtDistance } from "@caysonverse/shared/village/transit";

const noRemotes = () => {};
const inVillage = () => true;
const free = () => false;

/**
 * The local walk as LocalPlayer runs it each frame: slide against the static colliders, then out of the moving bus.
 * Checker r2 repro: from the pavement, click-walk at the middle of the passing bus.
 */
function walkAtBus(start: { x: number; z: number }, frames: number, busAt: (frame: number) => { x: number; z: number; yaw: number }) {
  let x = start.x;
  let z = start.z;
  let minClearance = Infinity;
  for (let i = 0; i < frames; i++) {
    const bus = busAt(i);
    const dx = bus.x - x;
    const dz = bus.z - z;
    const d = Math.hypot(dx, dz) || 1;
    const step = 6.4 / 60; // running
    const next = resolveCollision(x, z, (dx / d) * step, (dz / d) * step, PLAYER_RADIUS, collectObstacles(x, z, noRemotes));
    x = next.x;
    z = next.z;
    const out = pushOutOfMovingBus(x, z, () => bus, inVillage, free);
    if (out) {
      x = out.x;
      z = out.z;
    }
    minClearance = Math.min(minClearance, busClearance(bus, x, z, PLAYER_RADIUS));
  }
  return minClearance;
}

describe("the moving bus is solid from every side (owner 2026-11-15; checker r2)", () => {
  it("running at the middle of the passing bus from the pavement never gets inside it", () => {
    for (const startAt of [20, 60, 110, 160]) {
      const busAt = (i: number) => routePoseAtDistance(startAt + (4.5 * i) / 60);
      const b = busAt(0);
      // on the pavement beside the bus, a little ahead of it (it drives up to us while we run at it)
      const fx = Math.sin(b.yaw);
      const fz = Math.cos(b.yaw);
      for (const side of [1, -1]) {
        const start = { x: b.x + fx * 3 - fz * side * 3.2, z: b.z + fz * 3 + fx * side * 3.2 };
        expect(walkAtBus(start, 240, busAt), `at ${startAt}, side ${side}`).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it("standing still where the bus passes, I am shoved out at its pace, never left inside", () => {
    const busAt = (i: number) => routePoseAtDistance(30 + (4.5 * i) / 60);
    const b = busAt(0);
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    let x = b.x + fx * 7 - fz * 1.5; // ahead of it, overlapping its path's flank
    let z = b.z + fz * 7 + fx * 1.5;
    for (let i = 0; i < 300; i++) {
      const bus = busAt(i);
      const out = pushOutOfMovingBus(x, z, () => bus, inVillage, free);
      if (out) {
        expect(Math.hypot(out.x - x, out.z - z)).toBeLessThan(0.5);
        x = out.x;
        z = out.z;
      }
      expect(busClearance(bus, x, z, PLAYER_RADIUS)).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("outside the village it does nothing; parked, the bus pushes like any pose; the slide's obstacle list has no bus pieces any more", () => {
    expect(pushOutOfMovingBus(0, 0, () => ({ x: 0, z: 0, yaw: 0 }), () => false, free)).toBeNull();
    expect(pushOutOfMovingBus(0, 0, () => ({ x: 0, z: 0, yaw: 0 }), inVillage, free)).not.toBeNull();
    const a = collectObstacles(3, 0, noRemotes).length;
    const b = collectObstacles(0, 0, noRemotes).length;
    expect(a).toBe(b);
  });
});
