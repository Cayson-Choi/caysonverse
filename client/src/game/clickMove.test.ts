import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { HALL_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";

const WORLD_BOUNDS = VILLAGE_LAYOUT.areas.village;
const HALL_BOUNDS = VILLAGE_LAYOUT.areas.hall;
import {
  DRAG_SIGN,
  CLICK_MAX_PX,
  CLICK_MAX_MS,
  TAP_MAX_PX,
  ARRIVE_DIST,
  STUCK_WINDOW_SEC,
  STUCK_MIN_DIST,
  isClick,
  pressTravel,
  hasArrived,
  dirToIntent,
  setClickTarget,
  getClickTarget,
  peekClickTarget,
  peekClickRing,
  peekPendingClick,
  setPendingClick,
  clearPendingClick,
  clearClickTarget,
  resetClickMove,
  stepClickMove,
  clickGeneration,
  VIA_REACH,
  viaPassed,
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

  it("a tap while a walk is under way shows ITS ring at once; the walk's own ring gives way until the tap's walk starts", () => {
    setClickTarget(8, 8, 0.01); // walking to A
    setPendingClick(-3, 2, 0.02); // tap B on the look half (the 300 ms double-tap wait)
    expect(peekClickRing()).toEqual({ x: -3, z: 2, y: 0.02 }); // B's ring, not A's (round 2 review)
    expect(getClickTarget()).toEqual({ x: 8, z: 8, y: 0.01 }); // still walking to A meanwhile
    clearPendingClick(); // a second tap: a double tap (recenter), B is dropped
    expect(peekClickRing()).toEqual({ x: 8, z: 8, y: 0.01 }); // A's ring is back
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

  it("one long frame (a hitch: a GC pause, a texture upload) is not 0.8 s of pushing a wall", () => {
    setClickTarget(10, 0);
    // the first step after the click arrives 1.2 s late: the avatar has not moved yet because it could not, not because it is stuck
    expect(stepClickMove(0, 0, 1.2)).not.toBeNull();
    expect(getClickTarget()).not.toBeNull();
    run(1.6, (t) => ({ x: 0.2 + t * 3, z: 0 })); // and walks on from there
    expect(getClickTarget()).not.toBeNull();
    // a hitch in the middle of a walk is no different
    expect(stepClickMove(5, 0, 2)).not.toBeNull();
    expect(getClickTarget()).not.toBeNull();
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

describe("clickMove — the active map", () => {
  afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

  it("setClickTarget clamps into the active map's bounds", () => {
    setActiveMap(HALL_ACTIVE_MAP);
    setClickTarget(HALL_BOUNDS.maxX + 100, 0);
    expect(getClickTarget()!.x).toBeCloseTo(HALL_BOUNDS.maxX - PLAYER_RADIUS, 6);
    // The hall's other edges clamp too — not the village's.
    setClickTarget(-1e4, -1e4);
    expect(getClickTarget()).toEqual({ x: HALL_BOUNDS.minX + PLAYER_RADIUS, z: HALL_BOUNDS.minZ + PLAYER_RADIUS, y: 0 });
    // Back in the open village the village's own bounds apply again.
    setActiveMap(VILLAGE_ACTIVE_MAP);
    setClickTarget(1e4, 0);
    expect(getClickTarget()!.x).toBeCloseTo(WORLD_BOUNDS.maxX - PLAYER_RADIUS, 6);
  });
});

describe("clickMove — round 3 review", () => {
  it("a press dragged out and back to where it went down is a drag (the camera turned), not a click", () => {
    let travel = 0;
    travel = pressTravel(travel, 20, 0);
    travel = pressTravel(travel, 40, 3); // 40 px out...
    travel = pressTravel(travel, 1, 0); // ...and back within 1 px
    expect(travel).toBeCloseTo(Math.hypot(40, 3), 9);
    expect(isClick(travel, 0, 100)).toBe(false);
    // a still press stays a click
    expect(isClick(pressTravel(pressTravel(0, 1, 1), 2, 0), 0, 100)).toBe(true);
  });

  it("the walk arriving while a tap waits out its double-tap window keeps the tap's ring (it walks there next)", () => {
    setClickTarget(1, 0, 0); // walking to A, nearly there
    const tap = setPendingClick(5, 5, 0.02); // tap B on the look half
    let x = 0;
    for (let t = 0; t < 0.3; t += 1 / 60) {
      const dir = stepClickMove(x, 0, 1 / 60);
      if (dir) x += dir.x * (4 / 60);
      expect(peekClickRing()).toBe(tap); // B's ring the whole 300 ms
    }
    expect(getClickTarget()).toBeNull(); // A is reached
    expect(peekPendingClick()).toBe(tap);
  });

  it("the walk released by the no-progress rule keeps a waiting tap's ring too", () => {
    setClickTarget(10, 0, 0);
    const tap = setPendingClick(-5, 5, 0);
    for (let t = 0; t < STUCK_WINDOW_SEC + 0.1; t += 1 / 60) stepClickMove(0, 0, 1 / 60); // pinned
    expect(getClickTarget()).toBeNull();
    expect(peekClickRing()).toBe(tap);
  });

  it("a key, the stick, Esc or sitting down (clearClickTarget) still drops the waiting tap: it is then not walked", () => {
    setClickTarget(10, 0, 0);
    setPendingClick(-5, 5, 0);
    clearClickTarget();
    expect(peekPendingClick()).toBeNull();
    expect(peekClickRing()).toBeNull();
  });
});

describe("clickMove — round 4 review", () => {
  it("a way round (via): the steer heads for each corner in turn, then the target; arrival only at the target", () => {
    setClickTarget(4, 4, 0, [
      { x: 0, z: 4 },
      { x: 2, z: 6 },
    ]);
    // first toward the first corner, straight up
    const d0 = stepClickMove(0, 0, 1 / 60)!;
    expect(d0.x).toBeCloseTo(0, 9);
    expect(d0.z).toBeCloseTo(1, 9);
    // within VIA_REACH of it: on to the next corner
    const d1 = stepClickMove(0, 4 - VIA_REACH / 2, 1 / 60)!;
    expect(d1.x).toBeGreaterThan(0.6);
    expect(d1.z).toBeGreaterThan(0.6);
    // past both: the target (its own arrival radius)
    const d2 = stepClickMove(2, 6 - VIA_REACH / 2, 1 / 60)!;
    expect(Math.atan2(d2.z, d2.x)).toBeCloseTo(Math.atan2(4 - (6 - VIA_REACH / 2), 2), 6);
    expect(stepClickMove(4, 4 + ARRIVE_DIST / 2, 1 / 60)).toBeNull();
    expect(getClickTarget()).toBeNull();
  });

  it("a target with no via (or an empty one) steers straight; a new target starts its via from the first corner", () => {
    setClickTarget(5, 0, 0, []);
    expect(getClickTarget()!.via).toBeUndefined();
    setClickTarget(5, 0, 0, [{ x: 0, z: 5 }]);
    stepClickMove(0, 5 - VIA_REACH / 2, 1 / 60); // passes the corner
    setClickTarget(5, 0, 0, [{ x: 0, z: 5 }]); // a re-click with the same way: from its first corner again
    const d = stepClickMove(0, 0, 1 / 60)!;
    expect(d.z).toBeCloseTo(1, 9);
  });

  it("clickGeneration changes when a walk is set or dropped by hand, not when it ends by itself (a waiting tap tells the player took over)", () => {
    const g0 = clickGeneration();
    setClickTarget(1, 0, 0);
    const g1 = clickGeneration();
    expect(g1).not.toBe(g0);
    setPendingClick(3, 3, 0); // a tap's own ring: not the player taking over
    expect(clickGeneration()).toBe(g1);
    stepClickMove(1, 0, 1 / 60); // arrival
    expect(getClickTarget()).toBeNull();
    expect(clickGeneration()).toBe(g1);
    clearClickTarget(); // a key (LocalPlayer clears on any manual input, every frame of it), the stick, Esc, a sit
    expect(clickGeneration()).not.toBe(g1);
  });
});

describe("clickMove — round 5 review: a corner passed in one long step", () => {
  it("viaPassed: within VIA_REACH, or beyond the line through the corner square to the leg", () => {
    const c = { x: 0, z: 4 };
    expect(viaPassed(0, 4 - VIA_REACH / 2, c, 0, 0)).toBe(true);
    expect(viaPassed(0, 3.5, c, 0, 0)).toBe(false);
    expect(viaPassed(0, 4.15, c, 0, 0)).toBe(true); // stepped over it (a run, a slow frame)
    expect(viaPassed(0.6, 4.01, c, 0, 0)).toBe(true); // past its line, off to the side
    expect(viaPassed(0.6, 3.9, c, 0, 0)).toBe(false);
  });

  it("a step that jumps over the corner turns for the next one instead of walking back to it", () => {
    setClickTarget(4, 4, 0, [{ x: 0, z: 4 }]);
    stepClickMove(0, 0, 1 / 60); // the leg toward the corner begins here
    const d = stepClickMove(0, 4.2, 1 / 60)!; // 0.2 m past it, more than VIA_REACH
    expect(d.x).toBeGreaterThan(0.99); // on to the target (east), not back south to the corner
    clearClickTarget();
  });
});
