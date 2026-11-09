import { describe, it, expect, beforeEach } from "vitest";
import { SNAP_DISTANCE, CAMERA } from "./constants";
import { worldDirection } from "./input";
import { applyZoom, resetViewMode, viewState } from "./viewState";
import {
  aboveGroundY,
  CAMERA_KEY_YAW_RATE,
  CAMERA_LOOK_LIFT,
  FOLLOW_SMOOTH_RATE,
  ORBIT_EASE,
  ZOOM_BAND,
  ZOOM_SMOOTH_RATE,
  pinchZoomDelta,
  recenterYaw,
  smoothToward,
  stepFollow,
  stepKeyYaw,
  stepOrbitToward,
} from "./cameraControls";
import type { Orbit } from "./types";

const PI = Math.PI;
const DT = 1 / 60;

// viewState is module-mutable: every test starts from a fresh third-person view.
beforeEach(() => resetViewMode());

function orbit(over: Partial<Orbit> = {}): Orbit {
  return { yaw: 0, pitch: 0.35, distance: 6, ...over };
}

describe("cameraControls — constants (verbatim from the brief)", () => {
  it("keeps the agreed tuning values", () => {
    expect(CAMERA_KEY_YAW_RATE).toBe(2.2);
    expect(ORBIT_EASE).toEqual({ yawRate: 10, pitchRate: 2, distRate: 12, eps: 1e-3 });
    expect(ZOOM_SMOOTH_RATE).toBe(12);
    expect(FOLLOW_SMOOTH_RATE).toBe(14);
    expect(CAMERA_LOOK_LIFT).toBe(0.25);
  });

  it("ZOOM_BAND is the wheel/pinch clamp band (min/max follow distance)", () => {
    expect(ZOOM_BAND).toEqual({ min: CAMERA.minDistance, max: CAMERA.maxDistance });
  });
});

describe("recenterYaw", () => {
  it("puts the camera behind the body: TP forward equals body facing", () => {
    for (const b of [-2.5, 0, 0.7, 3]) {
      const f = worldDirection({ forward: 1, right: 0 }, recenterYaw(b));
      expect(f.x).toBeCloseTo(Math.sin(b), 6);
      expect(f.z).toBeCloseTo(Math.cos(b), 6);
    }
  });

  it("returns an angle already wrapped into [-PI, PI]", () => {
    for (const b of [-PI, -2.5, 0, 0.7, 3, PI]) {
      const y = recenterYaw(b);
      expect(y).toBeGreaterThanOrEqual(-PI);
      expect(y).toBeLessThanOrEqual(PI);
    }
  });
});

describe("stepOrbitToward", () => {
  it("recenter half-turn finishes within 0.35 s at 60 fps, then stops (spec §8 멈춤 시간)", () => {
    const o = { yaw: 0, pitch: 0.35, distance: 6 };
    const goal = { yaw: Math.PI - 0.01 };
    let t = 0,
      done = false;
    while (!done && t < 1) {
      done = stepOrbitToward(o, goal, 1 / 60);
      t += 1 / 60;
    }
    expect(done).toBe(true);
    expect(t).toBeLessThanOrEqual(0.35);
    expect(stepOrbitToward(o, goal, 1 / 60)).toBe(true);
    expect(o.yaw).toBeCloseTo(goal.yaw, 3);
  });

  it("eases out: the turn is fastest at the start and every frame moves toward the goal", () => {
    const o = orbit({ yaw: 0 });
    const goal = { yaw: 2 };
    let prev = o.yaw;
    let prevStep = Infinity;
    for (let i = 0; i < 6; i++) {
      stepOrbitToward(o, goal, DT);
      const step = o.yaw - prev;
      expect(step).toBeGreaterThan(0); // never backwards
      expect(step).toBeLessThanOrEqual(prevStep + 1e-12); // decelerating
      expect(o.yaw).toBeLessThanOrEqual(goal.yaw); // no overshoot
      prevStep = step;
      prev = o.yaw;
    }
    // First frame covers 1 − e^(−rate·dt) of the gap (per-second exponential rate).
    const first = orbit({ yaw: 0 });
    stepOrbitToward(first, goal, DT);
    expect(first.yaw).toBeCloseTo(goal.yaw * (1 - Math.exp(-ORBIT_EASE.yawRate * DT)), 6);
  });

  it("takes the shortest arc across the +/-PI seam and never spins the long way", () => {
    const o = orbit({ yaw: 3.0 });
    const goal = { yaw: -3.0 }; // short way is UP through +PI (about +0.283 rad)
    stepOrbitToward(o, goal, DT);
    expect(o.yaw).toBeGreaterThan(3.0);
    let done = false;
    for (let i = 0; i < 120 && !done; i++) done = stepOrbitToward(o, goal, DT);
    expect(done).toBe(true);
    expect(Math.abs(Math.atan2(Math.sin(o.yaw - goal.yaw), Math.cos(o.yaw - goal.yaw)))).toBeLessThan(
      ORBIT_EASE.eps,
    );
  });

  it("only touches the fields the goal names", () => {
    const o = orbit({ yaw: 1, pitch: 0.5, distance: 9 });
    for (let i = 0; i < 200; i++) stepOrbitToward(o, { yaw: -1 }, DT);
    expect(o.pitch).toBe(0.5);
    expect(o.distance).toBe(9);
    expect(o.yaw).toBeCloseTo(-1, 3);
  });

  it("drives pitch and distance too, and is done only when ALL named fields are within eps", () => {
    const o = orbit({ yaw: 0, pitch: 0.2, distance: 12 });
    const goal = { yaw: 0.4, pitch: 0.8, distance: 4 };
    let frames = 0;
    let done = false;
    while (!done && frames < 600) {
      done = stepOrbitToward(o, goal, DT);
      frames++;
    }
    expect(done).toBe(true);
    expect(frames).toBeLessThan(600);
    expect(o.yaw).toBeCloseTo(0.4, 3);
    expect(o.pitch).toBeCloseTo(0.8, 3);
    expect(o.distance).toBeCloseTo(4, 3);

    // One slow field keeps the whole goal unfinished while the others have arrived.
    const p = orbit({ yaw: 0, pitch: 0, distance: 6 });
    const finished = stepOrbitToward(p, { yaw: 0, pitch: 1, distance: 6 }, DT);
    expect(finished).toBe(false);
  });

  it("holds still at dt = 0 (and reports done only if already within eps)", () => {
    const o = orbit({ yaw: 0 });
    expect(stepOrbitToward(o, { yaw: 1 }, 0)).toBe(false);
    expect(o.yaw).toBe(0);
    const near = orbit({ yaw: 1 - ORBIT_EASE.eps / 2 });
    expect(stepOrbitToward(near, { yaw: 1 }, 0)).toBe(true);
  });

  it("an empty goal is trivially done and changes nothing", () => {
    const o = orbit({ yaw: 0.3, pitch: 0.4, distance: 5 });
    expect(stepOrbitToward(o, {}, DT)).toBe(true);
    expect(o).toEqual({ yaw: 0.3, pitch: 0.4, distance: 5 });
  });
});

describe("stepKeyYaw", () => {
  it("Z turns left (+), C right (−), both cancel, wraps", () => {
    expect(stepKeyYaw(0, true, false, 1)).toBeCloseTo(CAMERA_KEY_YAW_RATE, 6); // Z → yaw up
    expect(stepKeyYaw(0, false, true, 1)).toBeCloseTo(-CAMERA_KEY_YAW_RATE, 6); // C → yaw down
    expect(stepKeyYaw(0.4, true, true, 1)).toBe(0.4); // both held cancel exactly
    expect(stepKeyYaw(0.4, false, false, 1)).toBe(0.4); // none held
    // Wraps across the seam instead of growing past PI.
    const wrapped = stepKeyYaw(PI - 0.1, true, false, 0.5, 2); // +1 rad → past PI
    expect(wrapped).toBeGreaterThanOrEqual(-PI);
    expect(wrapped).toBeLessThanOrEqual(PI);
    expect(wrapped).toBeCloseTo(PI - 0.1 + 1 - 2 * PI, 6);
  });

  it("scales with dt and an explicit rate, and Z really turns the view to the LEFT", () => {
    expect(stepKeyYaw(0, true, false, 0.5, 4)).toBeCloseTo(2, 6);
    expect(stepKeyYaw(0, true, false, 0, 4)).toBe(0);
    // A camera at yaw 0 looks along −Z (north); after Z the view direction gains a −X
    // (screen-left) component.
    const yaw = stepKeyYaw(0, true, false, 0.2);
    const look = worldDirection({ forward: 1, right: 0 }, yaw);
    expect(look.x).toBeLessThan(0);
    expect(look.z).toBeLessThan(0);
  });
});

describe("smoothToward", () => {
  it("converges without overshoot, monotonically", () => {
    const cases: [number, number][] = [
      [2.5, 18],
      [18, 2.5],
      [0, 0.001],
    ];
    for (const [from, to] of cases) {
      let v = from;
      let prevGap = Math.abs(to - v);
      for (let i = 0; i < 300; i++) {
        v = smoothToward(v, to, DT);
        const gap = Math.abs(to - v);
        expect(gap).toBeLessThanOrEqual(prevGap + 1e-12);
        // never crosses the target
        expect((to - from) * (to - v)).toBeGreaterThanOrEqual(0);
        prevGap = gap;
      }
      expect(v).toBeCloseTo(to, 4);
    }
  });

  it("closes target + (current − target)·e^(−rate·dt) of the gap per step", () => {
    expect(smoothToward(10, 0, DT)).toBeCloseTo(10 * Math.exp(-ZOOM_SMOOTH_RATE * DT), 9);
    expect(smoothToward(10, 0, 0.1, 5)).toBeCloseTo(10 * Math.exp(-0.5), 9);
  });

  it("holds exactly at dt = 0 and when already on target", () => {
    expect(smoothToward(7.123, 3, 0)).toBe(7.123);
    expect(smoothToward(3, 3, DT)).toBe(3);
  });

  it("is frame-rate independent: two half steps equal one whole step", () => {
    const whole = smoothToward(9, 1, 0.032);
    const halves = smoothToward(smoothToward(9, 1, 0.016), 1, 0.016);
    expect(halves).toBeCloseTo(whole, 9);
  });
});

describe("stepFollow", () => {
  it("lags smoothly toward a moving target and does not overshoot", () => {
    const cur = { x: 0, z: 0 };
    stepFollow(cur, 1, 0, DT);
    expect(cur.x).toBeCloseTo(1 - Math.exp(-FOLLOW_SMOOTH_RATE * DT), 9);
    expect(cur.z).toBe(0);
    let prev = cur.x;
    for (let i = 0; i < 200; i++) {
      stepFollow(cur, 1, 0, DT);
      expect(cur.x).toBeGreaterThanOrEqual(prev);
      expect(cur.x).toBeLessThanOrEqual(1);
      prev = cur.x;
    }
    expect(cur.x).toBeCloseTo(1, 4);
  });

  it("trails a steadily walking target by a constant, small gap (no lurch)", () => {
    const cur = { x: 0, z: 0 };
    const speed = 4; // m/s (MOVE_SPEED)
    let target = 0;
    for (let i = 0; i < 240; i++) {
      target += speed * DT;
      stepFollow(cur, target, 0, DT);
    }
    const gap = target - cur.x;
    expect(gap).toBeGreaterThan(0.1);
    expect(gap).toBeLessThan(SNAP_DISTANCE); // never reaches the snap threshold
    expect(gap).toBeCloseTo(speed / FOLLOW_SMOOTH_RATE, 1); // steady-state lag v / rate
  });

  it("snaps on a jump larger than SNAP_DISTANCE (teleport / kick-back / seat)", () => {
    const cur = { x: 0, z: 0 };
    stepFollow(cur, SNAP_DISTANCE + 0.01, 0, DT);
    expect(cur).toEqual({ x: SNAP_DISTANCE + 0.01, z: 0 });
    const diag = { x: 10, z: 10 };
    stepFollow(diag, 10 + 3, 10 + 3, 0); // ~4.24 m diagonal → snap even at dt = 0
    expect(diag).toEqual({ x: 13, z: 13 });
  });

  it("does not snap at exactly SNAP_DISTANCE, and holds at dt = 0", () => {
    const cur = { x: 0, z: 0 };
    stepFollow(cur, SNAP_DISTANCE, 0, DT);
    expect(cur.x).toBeGreaterThan(0);
    expect(cur.x).toBeLessThan(SNAP_DISTANCE);
    const still = { x: 1, z: 2 };
    stepFollow(still, 2, 3, 0);
    expect(still).toEqual({ x: 1, z: 2 });
  });
});

describe("pinchZoomDelta", () => {
  it("is (prev − curr) × pinchSpeed: spreading zooms IN (negative), pinching OUT (positive)", () => {
    expect(pinchZoomDelta(200, 260)).toBeCloseTo(-60 * CAMERA.pinchSpeed, 9);
    expect(pinchZoomDelta(260, 200)).toBeCloseTo(60 * CAMERA.pinchSpeed, 9);
    expect(pinchZoomDelta(150, 150)).toBe(0);
  });

  it("pinch range: spreading clamps at minDistance then enters FP; pinching in clamps at maxDistance", () => {
    const BAND = { min: CAMERA.minDistance, max: CAMERA.maxDistance }; // CameraRig의 ZOOM_BAND와 같음
    expect(BAND).toEqual(ZOOM_BAND);
    resetViewMode();
    const o = { yaw: 0, pitch: 0.35, distance: 6 };
    for (let i = 0; i < 50; i++) applyZoom(o, pinchZoomDelta(200, 260), BAND);
    expect(viewState.mode).toBe("fp");
    expect(o.distance).toBe(CAMERA.minDistance);
    for (let i = 0; i < 200; i++) applyZoom(o, pinchZoomDelta(260, 200), BAND);
    expect(viewState.mode).toBe("tp");
    expect(o.distance).toBe(CAMERA.maxDistance);
  });
});

describe("aboveGroundY", () => {
  it("keeps the camera above the floor at the lowest pitch and longest zoom", () => {
    const lowest = 1.4 + CAMERA.maxDistance * Math.sin(CAMERA.minPitch);
    expect(lowest).toBeLessThan(0); // without the floor stop the camera would sit under the ground
    expect(aboveGroundY(lowest)).toBe(CAMERA.minY);
    expect(CAMERA.minY).toBeGreaterThan(0);
    expect(aboveGroundY(3.2)).toBe(3.2); // higher camera heights are untouched
  });
});
