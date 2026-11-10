import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { hubGeometry, hubZoneLabel } from "@caysonverse/shared/school/hubMap";
import { LEGACY_ACTIVE_MAP, setActiveMap } from "./activeMap";
import {
  DRAG_SIGN,
  CLICK_MAX_PX,
  CLICK_MAX_MS,
  TAP_MAX_PX,
  ARRIVE_DIST,
  STUCK_WINDOW_SEC,
  STUCK_MIN_DIST,
  isClick,
  hasArrived,
  dirToIntent,
  setClickTarget,
  getClickTarget,
  peekClickTarget,
  peekClickRing,
  setPendingClick,
  clearPendingClick,
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

  it("a finger gets the stick's tap tolerance (10 px): a tap that drifts 6-10 px still walks", () => {
    expect(TAP_MAX_PX).toBe(10);
    expect(isClick(8, 0, 100)).toBe(false); // a mouse: that is a drag
    expect(isClick(8, 0, 100, TAP_MAX_PX)).toBe(true); // a finger: still a tap
    expect(isClick(TAP_MAX_PX, 0, 100, TAP_MAX_PX)).toBe(false);
    expect(isClick(0, 0, CLICK_MAX_MS, TAP_MAX_PX)).toBe(false); // the same 400 ms
  });
});

describe("clickMove — target set/clamp/replace", () => {
  it("stores a target inside the bounds unchanged", () => {
    setClickTarget(-10, 5);
    expect(getClickTarget()).toEqual({ x: -10, z: 5, y: 0 });
  });

  it("clamps an out-of-bounds click to the reachable band (bounds − radius)", () => {
    setClickTarget(WORLD_BOUNDS.maxX + 10, WORLD_BOUNDS.minZ - 10);
    expect(getClickTarget()).toEqual({
      x: WORLD_BOUNDS.maxX - PLAYER_RADIUS,
      z: WORLD_BOUNDS.minZ + PLAYER_RADIUS,
      y: 0,
    });
  });

  it("re-click replaces the target immediately (mid-move direction change)", () => {
    setClickTarget(10, 0);
    setClickTarget(-5, 3);
    expect(getClickTarget()).toEqual({ x: -5, z: 3, y: 0 });
  });

  it("clearClickTarget drops the target (manual-input cancel path)", () => {
    setClickTarget(10, 0);
    clearClickTarget();
    expect(getClickTarget()).toBeNull();
    expect(stepClickMove(0, 0, 0.016)).toBeNull();
  });

  it("peekClickTarget reads the live target without copying (per-frame ring), null when idle", () => {
    expect(peekClickTarget()).toBeNull();
    setClickTarget(4, -2);
    const first = peekClickTarget();
    expect(first).toEqual({ x: 4, z: -2, y: 0 });
    expect(peekClickTarget()).toBe(first); // same object every call: no per-frame allocation
    expect(getClickTarget()).not.toBe(first); // getClickTarget keeps its defensive copy
    setClickTarget(1, 1);
    expect(peekClickTarget()).toEqual({ x: 1, z: 1, y: 0 });
    expect(first).toEqual({ x: 4, z: -2, y: 0 }); // a held reference is never mutated by a re-click
    clearClickTarget();
    expect(peekClickTarget()).toBeNull();
  });
});

describe("clickMove — the ring's surface height and the tap's pending ring", () => {
  it("a target keeps the height of the surface it was clicked on (the ring lies there)", () => {
    setClickTarget(3, -4, 0.03);
    expect(getClickTarget()).toEqual({ x: 3, z: -4, y: 0.03 });
    expect(peekClickRing()).toEqual({ x: 3, z: -4, y: 0.03 });
  });

  it("a held-back tap shows its ring at once without walking; the walk replaces it, a double tap drops it", () => {
    setPendingClick(2, 5, 0.01);
    expect(peekClickRing()).toEqual({ x: 2, z: 5, y: 0.01 });
    expect(getClickTarget()).toBeNull();
    expect(stepClickMove(0, 0, 0.016)).toBeNull(); // nothing walks yet
    setClickTarget(2, 5, 0.01); // the 300 ms are up
    expect(peekClickRing()).toBe(peekClickTarget());
    clearClickTarget();
    setPendingClick(2, 5, 0.01);
    clearPendingClick(); // the second tap of a double tap
    expect(peekClickRing()).toBeNull();
  });

  it("clearing the target (a key, Esc, sitting down) drops a pending ring too", () => {
    setPendingClick(1, 1, 0);
    clearClickTarget();
    expect(peekClickRing()).toBeNull();
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
    expect(getClickTarget()).toEqual({ x: -10, z: 0, y: 0 });
    run(STUCK_WINDOW_SEC, () => ({ x: 0, z: 0 })); // …but a full window kills it
    expect(getClickTarget()).toBeNull();
  });
});

describe("clickMove — the active map (Task 15)", () => {
  afterEach(() => setActiveMap(LEGACY_ACTIVE_MAP));

  it("setClickTarget clamps into the active map's bounds", () => {
    setActiveMap({ geometry: hubGeometry(true), zoneLabel: hubZoneLabel });
    setClickTarget(100, 0);
    expect(getClickTarget()!.x).toBeCloseTo(48 - PLAYER_RADIUS, 6);
    // The hub's other edges clamp too (HUB_BOUNDS x -14..48, z -12..12) — not the world's.
    setClickTarget(-100, -100);
    expect(getClickTarget()).toEqual({ x: -14 + PLAYER_RADIUS, z: -12 + PLAYER_RADIUS, y: 0 });
    // Back in the legacy world the world's own bounds apply again.
    setActiveMap(LEGACY_ACTIVE_MAP);
    setClickTarget(100, 0);
    expect(getClickTarget()!.x).toBeCloseTo(WORLD_BOUNDS.maxX - PLAYER_RADIUS, 6);
  });
});
