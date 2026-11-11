import { describe, it, expect } from "vitest";
import {
  JOYSTICK_DEAD_ZONE,
  STICK_EDGE_PX,
  STICK_RADIUS_PX,
  STICK_RUN_FORCE,
  STICK_RUN_RELEASE,
  createStickState,
  isStickTap,
  isStickZone,
  joystickIntent,
  stickDown,
  stickGait,
  stickMove,
  stickReading,
  stickUp,
} from "./joystick";
import { worldDirection } from "./input";

/**
 * The joystick reading (unit direction vector + force) becomes the SAME local
 * movement intent the keyboard produces. Vector axes: +x is right, +y is up
 * (`stickReading` flips the DOM's y-down), which lines up with `readIntent`'s
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
    // the stick only supplies direction; walk vs run is decided by stickGait.
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

describe("isStickZone", () => {
  it("excludes the 24px left edge strip", () => {
    expect(isStickZone(23, 700, 375, 812)).toBe(false);
    expect(isStickZone(24, 700, 375, 812)).toBe(true);
    expect(STICK_EDGE_PX).toBe(24);
  });

  it("is only the lower-left quarter", () => {
    expect(isStickZone(200, 700, 375, 812)).toBe(false);
    expect(isStickZone(100, 300, 375, 812)).toBe(false);
    // The half-way lines: y >= vh/2 is in, x < vw/2 is in (vw/2 itself is out).
    expect(isStickZone(100, 406, 375, 812)).toBe(true);
    expect(isStickZone(187, 700, 375, 812)).toBe(true);
    expect(isStickZone(187.5, 700, 375, 812)).toBe(false);
  });

  it("mirrors in left-handed mode (right edge strip excluded)", () => {
    expect(isStickZone(375 - 23, 700, 375, 812, true)).toBe(false);
    expect(isStickZone(375 - 24 - 0.5, 700, 375, 812, true)).toBe(true);
    expect(isStickZone(300, 700, 375, 812, true)).toBe(true);
    // The left half (and the left edge strip) is no stick zone for a left-hander.
    expect(isStickZone(100, 700, 375, 812, true)).toBe(false);
    expect(isStickZone(300, 300, 375, 812, true)).toBe(false);
  });

  it("uses the live viewport (landscape after rotation)", () => {
    expect(isStickZone(100, 300, 812, 375)).toBe(true);
    expect(isStickZone(100, 100, 812, 375)).toBe(false);
    expect(isStickZone(500, 300, 812, 375)).toBe(false);
  });
});

describe("stickReading / stickGait (walk vs run bands)", () => {
  it("a half-radius drag upward reads forward with force 0.5", () => {
    // DOM y grows downward, so a thumb moved UP the screen is dy < 0 → vector.y > 0.
    const r = stickReading(0, 0, 0, -28);
    expect(r.vector.x).toBeCloseTo(0, 6);
    expect(r.vector.y).toBeCloseTo(1, 6);
    expect(r.force).toBeCloseTo(0.5, 6);
    expect(STICK_RADIUS_PX).toBe(56);
  });

  it("reads the other directions with the right signs", () => {
    const right = stickReading(100, 700, 128, 700);
    expect(right.vector.x).toBeCloseTo(1, 6);
    expect(right.vector.y).toBeCloseTo(0, 6);
    const down = stickReading(100, 700, 100, 728);
    expect(down.vector.x).toBeCloseTo(0, 6);
    expect(down.vector.y).toBeCloseTo(-1, 6);
    const downLeft = stickReading(100, 700, 80, 720);
    expect(downLeft.vector.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(downLeft.vector.y).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it("past the rim clamps force to 1", () => {
    const r = stickReading(0, 0, 0, -200);
    expect(r.force).toBe(1);
    expect(r.vector.y).toBeCloseTo(1, 6);
    // The vector stays unit length when clamped (direction only).
    const diag = stickReading(50, 50, 50 + 300, 50 - 400);
    expect(diag.force).toBe(1);
    expect(Math.hypot(diag.vector.x, diag.vector.y)).toBeCloseTo(1, 6);
  });

  it("no distance reads force 0 and a zero vector (never NaN)", () => {
    const r = stickReading(120, 640, 120, 640);
    expect(r.force).toBe(0);
    expect(r.vector.x).toBe(0);
    expect(r.vector.y).toBe(0);
  });

  it("honours a custom radius", () => {
    expect(stickReading(0, 0, 0, -10, 20).force).toBeCloseTo(0.5, 6);
    expect(stickReading(0, 0, 0, -30, 20).force).toBe(1);
  });

  it("bands: <0.15 idle, 0.15–0.9 walk, ≥0.9 run; running holds until <0.8", () => {
    expect(stickGait(0.1, false)).toBe("idle");
    expect(stickGait(0.5, false)).toBe("walk");
    expect(stickGait(0.9, false)).toBe("run");
    expect(stickGait(0.85, true)).toBe("run");
    expect(stickGait(0.79, true)).toBe("walk");
  });

  it("band edges: walk from the dead-zone edge, run enters at 0.9 and leaves under 0.8", () => {
    expect(stickGait(JOYSTICK_DEAD_ZONE - 0.001, false)).toBe("idle");
    expect(stickGait(JOYSTICK_DEAD_ZONE, false)).toBe("walk");
    expect(stickGait(STICK_RUN_FORCE - 0.001, false)).toBe("walk");
    expect(stickGait(STICK_RUN_RELEASE, true)).toBe("run");
    expect(stickGait(STICK_RUN_RELEASE - 0.001, true)).toBe("walk");
    expect(stickGait(1, false)).toBe("run");
    // Falling into the dead zone stops regardless of the run latch.
    expect(stickGait(0.05, true)).toBe("idle");
    expect(STICK_RUN_RELEASE).toBeLessThan(STICK_RUN_FORCE);
  });

  it("hovering inside the 0.8–0.9 band never flickers between walk and run", () => {
    // Without hysteresis a thumb jittering around 0.85 would toggle on every move.
    const jitter = [0.85, 0.88, 0.84, 0.86, 0.81, 0.89];
    let running = false;
    for (const f of jitter) {
      const g = stickGait(f, running);
      running = g === "run";
      expect(g).toBe("walk");
    }
    // Once the thumb has pushed through 0.9, the same jitter stays run.
    running = stickGait(0.95, false) === "run";
    expect(running).toBe(true);
    for (const f of jitter) {
      const g = stickGait(f, running);
      running = g === "run";
      expect(g).toBe("run");
    }
  });
});

describe("stickDown (where the dynamic stick may appear)", () => {
  it("starts at the pressed spot inside the zone", () => {
    const s = createStickState();
    expect(s.pointerId).toBeNull();
    expect(stickDown(s, 7, 100, 700, 375, 812, false)).toBe(true);
    expect(s.pointerId).toBe(7);
    expect(s.ox).toBe(100);
    expect(s.oy).toBe(700);
    expect(s.running).toBe(false);
  });

  it("swallows a press in the edge strip or outside the zone: nothing starts", () => {
    const s = createStickState();
    expect(stickDown(s, 1, 10, 700, 375, 812, false)).toBe(false);
    expect(stickDown(s, 1, 300, 700, 375, 812, false)).toBe(false);
    expect(stickDown(s, 1, 100, 100, 375, 812, false)).toBe(false);
    expect(s.pointerId).toBeNull();
  });

  it("left-handed mode starts on the right side only", () => {
    const s = createStickState();
    expect(stickDown(s, 1, 100, 700, 375, 812, true)).toBe(false);
    expect(stickDown(s, 1, 340, 700, 375, 812, true)).toBe(true);
    expect(s.pointerId).toBe(1);
  });
});

describe("stick pointer ownership (Review Focus 3)", () => {
  it("ignores a second pointer down while active", () => {
    const s = createStickState();
    expect(stickDown(s, 1, 100, 700, 375, 812, false)).toBe(true);
    expect(stickDown(s, 2, 150, 720, 375, 812, false)).toBe(false);
    expect(s.pointerId).toBe(1);
    // The first pointer's origin is untouched by the rejected press.
    expect(s.ox).toBe(100);
    expect(s.oy).toBe(700);
  });

  it("ignores moves and ups from other pointers", () => {
    const s = createStickState();
    stickDown(s, 1, 100, 700, 375, 812, false);
    expect(stickMove(s, 2, 100, 600)).toBeNull();
    expect(stickUp(s, 2)).toBe(false);
    expect(s.pointerId).toBe(1);
    // Nothing is active at all: every move/up is foreign.
    const idle = createStickState();
    expect(stickMove(idle, 1, 100, 600)).toBeNull();
    expect(stickUp(idle, 1)).toBe(false);
  });

  it("a full-radius drag yields run: true; release resets", () => {
    const s = createStickState();
    stickDown(s, 1, 100, 700, 375, 812, false);
    const full = stickMove(s, 1, 100, 700 - STICK_RADIUS_PX);
    expect(full).toEqual({ forward: 1, right: 0, run: true });
    expect(s.running).toBe(true);
    expect(stickUp(s, 1)).toBe(true);
    expect(s.pointerId).toBeNull();
    expect(s.running).toBe(false);
    // A released stick answers nothing, and can be pressed again.
    expect(stickMove(s, 1, 100, 600)).toBeNull();
    expect(stickUp(s, 1)).toBe(false);
    expect(stickDown(s, 3, 90, 650, 375, 812, false)).toBe(true);
    expect(s.pointerId).toBe(3);
  });
});

describe("stickMove (intent + run flag)", () => {
  function started() {
    const s = createStickState();
    stickDown(s, 1, 100, 700, 375, 812, false);
    return s;
  }

  it("a light push walks: direction set, run false", () => {
    const s = started();
    // 28 px of 56 = force 0.5
    expect(stickMove(s, 1, 100, 700 - 28)).toEqual({ forward: 1, right: 0, run: false });
  });

  it("inside the dead zone nothing moves and run stays false", () => {
    const s = started();
    expect(stickMove(s, 1, 104, 700)).toEqual({ forward: 0, right: 0, run: false });
    expect(stickMove(s, 1, 100, 700)).toEqual({ forward: 0, right: 0, run: false });
  });

  it("running holds through 0.8–0.9 and drops to walk below 0.8", () => {
    const s = started();
    expect(stickMove(s, 1, 100, 700 - 51)?.run).toBe(true); // 0.911: enter run
    expect(stickMove(s, 1, 100, 700 - 47)?.run).toBe(true); // 0.839: held
    expect(stickMove(s, 1, 100, 700 - 44)?.run).toBe(false); // 0.786: released
    expect(stickMove(s, 1, 100, 700 - 47)?.run).toBe(false); // 0.839 again: stays walk
  });

  it("a diagonal drag reports a unit-direction intent (camera-relative via worldDirection)", () => {
    const s = started();
    const m = stickMove(s, 1, 100 + 40, 700 - 40); // up-right, 56.6 px → force clamps to 1
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.forward).toBeCloseTo(Math.SQRT1_2, 6);
    expect(m.right).toBeCloseTo(Math.SQRT1_2, 6);
    expect(m.run).toBe(true);
    const dir = worldDirection(m, 0);
    expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1, 6);
  });

  it("a new press starts walking-first even if the last drag ended running", () => {
    const s = started();
    stickMove(s, 1, 100, 700 - 56);
    stickUp(s, 1);
    stickDown(s, 2, 100, 700, 375, 812, false);
    expect(stickMove(s, 2, 100, 700 - 47)).toEqual({ forward: 1, right: 0, run: false });
  });
});

describe("isStickTap (a quick tap passes through to click-move)", () => {
  it("a short, still press is a tap", () => {
    expect(isStickTap(0, 0, 100)).toBe(true);
    expect(isStickTap(9, 0, 249)).toBe(true);
    expect(isStickTap(3, 4, 100)).toBe(true); // 5 px
  });

  it("10 px or more of travel is a drag, not a tap", () => {
    expect(isStickTap(10, 0, 100)).toBe(false);
    expect(isStickTap(0, -10, 100)).toBe(false);
    expect(isStickTap(6, 8, 100)).toBe(false); // exactly 10 px
  });

  it("holding 400 ms or longer is a stick press, not a tap — the look half's limit, so one tap walks on either half", () => {
    expect(isStickTap(0, 0, 300)).toBe(true); // a slow finger: a walk on the look half, so here too
    expect(isStickTap(0, 0, 400)).toBe(false);
    expect(isStickTap(0, 0, 900)).toBe(false);
  });
});
