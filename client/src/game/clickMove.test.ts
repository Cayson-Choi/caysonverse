import { describe, it, expect, beforeEach } from "vitest";
import { WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import {
  DRAG_SIGN,
  CLICK_MAX_PX,
  CLICK_MAX_MS,
  ARRIVE_DIST,
  STUCK_WINDOW_SEC,
  STUCK_MIN_DIST,
  isClick,
  groundPoint,
  hasArrived,
  dirToIntent,
  setClickTarget,
  getClickTarget,
  clearClickTarget,
  resetClickMove,
  stepClickMove,
} from "./clickMove";
import { worldDirection } from "./input";

// Module-mutable state — every test starts from a clean slate.
beforeEach(() => resetClickMove());

describe("clickMove — drag inversion contract", () => {
  it("DRAG_SIGN is -1 (design 29: TP orbit + FP look drags are INVERTED)", () => {
    // CameraRig multiplies both drag axes by this at the delta consumption
    // point. -1 = inverted relative to the pre-design-29 behaviour; the pan
    // and pinch paths never see it.
    expect(DRAG_SIGN).toBe(-1);
  });
});

describe("clickMove — isClick (click vs drag boundary)", () => {
  it("accepts a short, still press (under both thresholds)", () => {
    expect(isClick(0, 0, 0)).toBe(true);
    expect(isClick(3, 4, 100)).toBe(true); // hypot 5 < 6
    expect(isClick(-3, -4, CLICK_MAX_MS - 1)).toBe(true); // sign-independent
  });

  it("rejects at/over the pixel threshold (a drag, however quick)", () => {
    expect(isClick(CLICK_MAX_PX, 0, 50)).toBe(false);
    expect(isClick(0, -CLICK_MAX_PX, 50)).toBe(false);
    expect(isClick(5, 4, 50)).toBe(false); // hypot ~6.4 ≥ 6
  });

  it("rejects at/over the time threshold (a long press, however still)", () => {
    expect(isClick(0, 0, CLICK_MAX_MS)).toBe(false);
    expect(isClick(1, 1, CLICK_MAX_MS + 100)).toBe(false);
  });

  it("boundary values sit exactly where documented (~6px / ~400ms)", () => {
    expect(CLICK_MAX_PX).toBe(6);
    expect(CLICK_MAX_MS).toBe(400);
    expect(isClick(CLICK_MAX_PX - 0.1, 0, CLICK_MAX_MS - 1)).toBe(true);
  });
});

describe("clickMove — groundPoint (ray ∩ y=0 plane)", () => {
  it("hits straight down under the origin", () => {
    expect(groundPoint(2, 10, 3, 0, -1, 0)).toEqual({ x: 2, z: 3 });
  });

  it("hits along a slanted ray (unnormalized direction is fine)", () => {
    // From (0,5,0) toward (5,0,5): direction (5,-5,5), t = 1.
    const p = groundPoint(0, 5, 0, 5, -5, 5);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(5, 9);
    expect(p!.z).toBeCloseTo(5, 9);
  });

  it("returns null for horizontal or upward rays (no floor ahead)", () => {
    expect(groundPoint(0, 5, 0, 1, 0, 0)).toBeNull();
    expect(groundPoint(0, 5, 0, 0, 1, 0)).toBeNull();
  });
});

describe("clickMove — target set/clamp/replace", () => {
  it("stores a target inside the bounds unchanged", () => {
    setClickTarget(-10, 5);
    expect(getClickTarget()).toEqual({ x: -10, z: 5 });
  });

  it("clamps an out-of-bounds click to the reachable band (bounds − radius)", () => {
    setClickTarget(WORLD_BOUNDS.maxX + 10, WORLD_BOUNDS.minZ - 10);
    expect(getClickTarget()).toEqual({
      x: WORLD_BOUNDS.maxX - PLAYER_RADIUS,
      z: WORLD_BOUNDS.minZ + PLAYER_RADIUS,
    });
  });

  it("re-click replaces the target immediately (mid-move direction change)", () => {
    setClickTarget(10, 0);
    setClickTarget(-5, 3);
    expect(getClickTarget()).toEqual({ x: -5, z: 3 });
  });

  it("clearClickTarget drops the target (manual-input cancel path)", () => {
    setClickTarget(10, 0);
    clearClickTarget();
    expect(getClickTarget()).toBeNull();
    expect(stepClickMove(0, 0, 0.016)).toBeNull();
  });
});

describe("clickMove — arrival", () => {
  it("hasArrived flips exactly at ARRIVE_DIST", () => {
    expect(hasArrived(0, 0, ARRIVE_DIST - 0.01, 0)).toBe(true);
    expect(hasArrived(0, 0, ARRIVE_DIST + 0.01, 0)).toBe(false);
  });

  it("stepClickMove clears the target and stops on arrival", () => {
    setClickTarget(10, 0);
    expect(stepClickMove(10 - ARRIVE_DIST + 0.05, 0, 0.016)).toBeNull();
    expect(getClickTarget()).toBeNull();
  });
});

describe("clickMove — steering direction", () => {
  it("returns the unit world-direction toward the target", () => {
    setClickTarget(10, 0);
    const d = stepClickMove(0, 0, 0.016);
    expect(d).not.toBeNull();
    expect(d!.x).toBeCloseTo(1, 9);
    expect(d!.z).toBeCloseTo(0, 9);

    setClickTarget(3, 4); // from origin: unit (0.6, 0.8)
    const d2 = stepClickMove(0, 0, 0.016);
    expect(d2!.x).toBeCloseTo(0.6, 9);
    expect(d2!.z).toBeCloseTo(0.8, 9);
  });

  it("dirToIntent round-trips through worldDirection for any camera yaw", () => {
    const dirs = [
      { x: 1, z: 0 },
      { x: 0, z: -1 },
      { x: -0.6, z: 0.8 },
    ];
    for (const dir of dirs) {
      for (const yaw of [0, 1.1, -2.5, Math.PI]) {
        const out = worldDirection(dirToIntent(dir, yaw), yaw);
        expect(out.x).toBeCloseTo(dir.x, 6);
        expect(out.z).toBeCloseTo(dir.z, 6);
      }
    }
  });
});

describe("clickMove — stuck detection (net displacement window)", () => {
  /** Advance `seconds` in fixed steps, reporting position via `at`. */
  function run(seconds: number, at: (t: number) => { x: number; z: number }, step = 0.1) {
    let last: ReturnType<typeof stepClickMove> = null;
    for (let t = 0; t < seconds - 1e-9; t += step) {
      last = stepClickMove(at(t).x, at(t).z, step);
    }
    return last;
  }

  it("a player pinned in place is released after ~STUCK_WINDOW_SEC", () => {
    setClickTarget(10, 0);
    // Stationary at the origin for one full window (+ one step to evaluate it).
    run(STUCK_WINDOW_SEC + 0.1, () => ({ x: 0, z: 0 }));
    expect(getClickTarget()).toBeNull();
  });

  it("a player making progress keeps the target across many windows", () => {
    setClickTarget(10, 0);
    // Slides at 1 m/s — well above STUCK_MIN_DIST per window, far from arrival.
    const last = run(3 * STUCK_WINDOW_SEC, (t) => ({ x: t * 1.0, z: 0 }));
    expect(getClickTarget()).not.toBeNull();
    expect(last).not.toBeNull();
  });

  it("sub-threshold creep (wall slide dying in a corner) is released", () => {
    setClickTarget(10, 0);
    // 0.1 m/s → less than STUCK_MIN_DIST of net displacement per window.
    expect(STUCK_MIN_DIST).toBeGreaterThan(0.1 * STUCK_WINDOW_SEC);
    run(2 * STUCK_WINDOW_SEC, (t) => ({ x: t * 0.1, z: 0 }));
    expect(getClickTarget()).toBeNull();
  });

  it("re-click resets the stuck window (a fresh target gets a fresh budget)", () => {
    setClickTarget(10, 0);
    // Sit still for MOST of a window, then retarget: the accumulated window
    // must not carry over, or the new target would be dropped instantly.
    run(STUCK_WINDOW_SEC - 0.2, () => ({ x: 0, z: 0 }));
    setClickTarget(-10, 0);
    run(0.4, () => ({ x: 0, z: 0 })); // 0.4 < window: must still be alive
    expect(getClickTarget()).toEqual({ x: -10, z: 0 });
    run(STUCK_WINDOW_SEC, () => ({ x: 0, z: 0 })); // …but a full window kills it
    expect(getClickTarget()).toBeNull();
  });
});
