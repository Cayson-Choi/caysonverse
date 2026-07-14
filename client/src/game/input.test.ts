import { describe, it, expect } from "vitest";
import { readIntent, worldDirection } from "./input";

const SQRT1_2 = Math.SQRT1_2; // ~0.7071

describe("readIntent", () => {
  it("maps key booleans to forward/right axes", () => {
    expect(readIntent({ forward: true, backward: false, left: false, right: false })).toEqual({
      forward: 1,
      right: 0,
    });
    expect(readIntent({ forward: false, backward: true, left: false, right: false })).toEqual({
      forward: -1,
      right: 0,
    });
    expect(readIntent({ forward: false, backward: false, left: true, right: false })).toEqual({
      forward: 0,
      right: -1,
    });
    expect(readIntent({ forward: false, backward: false, left: false, right: true })).toEqual({
      forward: 0,
      right: 1,
    });
  });

  it("cancels opposing keys", () => {
    expect(readIntent({ forward: true, backward: true, left: true, right: true })).toEqual({
      forward: 0,
      right: 0,
    });
  });
});

describe("worldDirection", () => {
  it("returns zero for no input (no NaN from normalizing a zero vector)", () => {
    expect(worldDirection({ forward: 0, right: 0 }, 0)).toEqual({ x: 0, z: 0 });
    expect(worldDirection({ forward: 0, right: 0 }, 1.234)).toEqual({ x: 0, z: 0 });
  });

  it("maps cardinal input with camera behind (yaw=0)", () => {
    // Forward = into the screen = -Z when the camera sits at +Z.
    const fwd = worldDirection({ forward: 1, right: 0 }, 0);
    expect(fwd.x).toBeCloseTo(0, 6);
    expect(fwd.z).toBeCloseTo(-1, 6);

    const back = worldDirection({ forward: -1, right: 0 }, 0);
    expect(back.x).toBeCloseTo(0, 6);
    expect(back.z).toBeCloseTo(1, 6);

    const right = worldDirection({ forward: 0, right: 1 }, 0);
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.z).toBeCloseTo(0, 6);

    const left = worldDirection({ forward: 0, right: -1 }, 0);
    expect(left.x).toBeCloseTo(-1, 6);
    expect(left.z).toBeCloseTo(0, 6);
  });

  it("normalizes diagonal input to unit length", () => {
    const d = worldDirection({ forward: 1, right: 1 }, 0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 6);
    expect(d.x).toBeCloseTo(SQRT1_2, 6);
    expect(d.z).toBeCloseTo(-SQRT1_2, 6);
  });

  it("rotates the direction by the camera yaw", () => {
    // Camera rotated 90deg: forward becomes -X, right becomes -Z.
    const fwd = worldDirection({ forward: 1, right: 0 }, Math.PI / 2);
    expect(fwd.x).toBeCloseTo(-1, 6);
    expect(fwd.z).toBeCloseTo(0, 6);

    const right = worldDirection({ forward: 0, right: 1 }, Math.PI / 2);
    expect(right.x).toBeCloseTo(0, 6);
    expect(right.z).toBeCloseTo(-1, 6);
  });
});
