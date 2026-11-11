import { describe, expect, it } from "vitest";
import { transitWindowCamera } from "./transitCamera";

describe("transitWindowCamera", () => {
  it("looks through the right-side window while the bus faces north", () => {
    const view = transitWindowCamera({ x: 10, z: 20, yaw: 0 });
    expect(view.x).toBeCloseTo(10);
    expect(view.z).toBeCloseTo(20.8);
    expect(view.targetX).toBeGreaterThan(view.x);
    expect(view.targetZ).toBeCloseTo(view.z);
  });

  it("rotates the window direction with the route yaw", () => {
    const view = transitWindowCamera({ x: 0, z: 0, yaw: Math.PI / 2 });
    expect(view.x).toBeCloseTo(0.8);
    expect(view.z).toBeCloseTo(0);
    expect(view.targetZ).toBeLessThan(view.z);
  });
});
