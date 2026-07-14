import { describe, it, expect } from "vitest";
import { joystickIntent, JOYSTICK_DEAD_ZONE } from "./joystick";
import { worldDirection } from "./input";

/**
 * The joystick reading (nipplejs vector + force) becomes the SAME local movement
 * intent the keyboard produces. nipplejs axes: +x is right, +y is up (verified in
 * its source: `vector:{x:g/o,y:-v/o}`), which lines up with `readIntent`'s
 * forward(+into screen)/right(+screen-right) axes.
 */
describe("joystickIntent", () => {
  it("maps an up push to forward and a right push to right", () => {
    expect(joystickIntent({ x: 0, y: 1 }, 1)).toEqual({ forward: 1, right: 0 });
    expect(joystickIntent({ x: 1, y: 0 }, 1)).toEqual({ forward: 0, right: 1 });
    expect(joystickIntent({ x: 0, y: -1 }, 1)).toEqual({ forward: -1, right: 0 });
    expect(joystickIntent({ x: -1, y: 0 }, 1)).toEqual({ forward: 0, right: -1 });
  });

  it("zeroes intent inside the dead-zone (force below the threshold)", () => {
    expect(joystickIntent({ x: 0, y: 1 }, JOYSTICK_DEAD_ZONE - 0.01)).toEqual({
      forward: 0,
      right: 0,
    });
    expect(joystickIntent({ x: 1, y: 0 }, 0)).toEqual({ forward: 0, right: 0 });
  });

  it("moves at exactly the dead-zone threshold (force >= threshold)", () => {
    expect(joystickIntent({ x: 0, y: 1 }, JOYSTICK_DEAD_ZONE)).toEqual({ forward: 1, right: 0 });
  });

  it("is direction-only: force above the dead-zone never scales the intent", () => {
    // A gentle push and a hard push in the same direction yield the same intent —
    // speed is constant MOVE_SPEED; only direction comes from the stick.
    expect(joystickIntent({ x: 0, y: 1 }, 0.4)).toEqual(joystickIntent({ x: 0, y: 1 }, 1));
  });
});

/**
 * Composed with `worldDirection`, the joystick is camera-relative exactly like
 * the keyboard: the same yaw rotation and unit-length normalization apply.
 */
describe("joystickIntent → worldDirection (camera-relative)", () => {
  it("an up push with the camera behind (yaw 0) walks into the screen (-Z)", () => {
    const dir = worldDirection(joystickIntent({ x: 0, y: 1 }, 1), 0);
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.z).toBeCloseTo(-1, 6);
  });

  it("rotates with the camera yaw (90deg): an up push becomes -X", () => {
    const dir = worldDirection(joystickIntent({ x: 0, y: 1 }, 1), Math.PI / 2);
    expect(dir.x).toBeCloseTo(-1, 6);
    expect(dir.z).toBeCloseTo(0, 6);
  });

  it("normalizes a diagonal push to unit length", () => {
    const dir = worldDirection(joystickIntent({ x: 1, y: 1 }, 1), 0);
    expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1, 6);
  });
});
