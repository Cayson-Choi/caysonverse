import { describe, it, expect, beforeEach } from "vitest";
import {
  viewState,
  enterFp,
  exitFp,
  toggleViewMode,
  applyZoom,
  resetViewMode,
  stepViewBlend,
} from "./viewState";
import { normalizeAngle } from "./yaw";
import { useViewStore } from "../stores/viewStore";
import { BLEND_SEC } from "./viewMode";
import type { Orbit } from "./types";

const BAND = { min: 2.5, max: 18 };

function orbit(over: Partial<Orbit> = {}): Orbit {
  return { yaw: 0, pitch: 0.35, distance: 6, ...over };
}

beforeEach(() => resetViewMode());

describe("viewState — reset", () => {
  it("returns to TP, blend 0, level look, and clears the button flag", () => {
    viewState.mode = "fp";
    viewState.blend = 1;
    viewState.fpYaw = 2;
    viewState.fpPitch = 0.5;
    useViewStore.getState().setFp(true);

    resetViewMode();

    expect(viewState).toEqual({ mode: "tp", blend: 0, fpYaw: 0, fpPitch: 0 });
    expect(useViewStore.getState().isFp).toBe(false);
  });
});

describe("viewState — yaw seeding continuity (wrap-safe, both directions)", () => {
  it("enter seeds FP yaw FROM the TP orbit yaw (world does not spin)", () => {
    const o = orbit({ yaw: 1.2 });
    enterFp(o.yaw);
    expect(viewState.mode).toBe("fp");
    expect(viewState.fpYaw).toBeCloseTo(1.2, 6);
  });

  it("exit seeds TP orbit yaw FROM the FP look yaw, normalized past the +/-PI seam", () => {
    const o = orbit({ yaw: 1.2 });
    enterFp(o.yaw);
    // Drag the FP look well past +PI so the raw value would be out of [-PI, PI].
    viewState.fpYaw = normalizeAngle(3.0 + 0.6); // 3.6 → wraps to ~-2.683
    exitFp(o);
    expect(viewState.mode).toBe("tp");
    expect(o.yaw).toBeCloseTo(normalizeAngle(3.6), 6);
    // Continuity: the resumed camera azimuth EQUALS the last FP look azimuth.
    expect(o.yaw).toBeCloseTo(viewState.fpYaw, 6);
  });

  it("does NOT clobber TP distance or pitch across a round-trip (FP look pitch is separate)", () => {
    const o = orbit({ yaw: 0.5, pitch: 0.8, distance: 11 });
    toggleViewMode(o); // → FP
    viewState.fpPitch = 0.9; // FP look tilt must not leak into orbit.pitch
    toggleViewMode(o); // → TP
    expect(o.pitch).toBe(0.8);
    expect(o.distance).toBe(11);
    expect(o.yaw).toBeCloseTo(0.5, 6); // seeded back from the (unchanged) fpYaw
  });
});

describe("viewState — toggle drives the button store", () => {
  it("flips isFp on each toggle", () => {
    const o = orbit();
    expect(useViewStore.getState().isFp).toBe(false);
    toggleViewMode(o);
    expect(viewState.mode).toBe("fp");
    expect(useViewStore.getState().isFp).toBe(true);
    toggleViewMode(o);
    expect(viewState.mode).toBe("tp");
    expect(useViewStore.getState().isFp).toBe(false);
  });
});

describe("viewState — applyZoom (wheel/pinch threshold wiring)", () => {
  it("TP at min + inward → FP; seeds fpYaw from the orbit yaw", () => {
    const o = orbit({ yaw: 0.9, distance: BAND.min });
    applyZoom(o, -0.5, BAND); // inward
    expect(viewState.mode).toBe("fp");
    expect(viewState.fpYaw).toBeCloseTo(0.9, 6);
    expect(o.distance).toBe(BAND.min);
  });

  it("TP above min + inward just zooms the distance in (no toggle)", () => {
    const o = orbit({ distance: 6 });
    applyZoom(o, -1, BAND);
    expect(viewState.mode).toBe("tp");
    expect(o.distance).toBeCloseTo(5, 6);
  });

  it("FP + outward → TP with the pre-FP distance preserved, orbit yaw seeded", () => {
    const o = orbit({ yaw: 0.3, distance: 9 });
    toggleViewMode(o); // enter FP via V at distance 9 (untouched)
    viewState.fpYaw = 1.1; // looked around in FP
    applyZoom(o, +1, BAND); // outward notch exits FP
    expect(viewState.mode).toBe("tp");
    expect(o.distance).toBe(9); // previous distance restored
    expect(o.yaw).toBeCloseTo(1.1, 6);
  });

  it("FP + inward is inert (no mode change, distance untouched)", () => {
    const o = orbit({ distance: 7 });
    toggleViewMode(o);
    applyZoom(o, -2, BAND);
    expect(viewState.mode).toBe("fp");
    expect(o.distance).toBe(7);
  });
});

describe("viewState — stepViewBlend", () => {
  it("advances toward 1 in FP and back toward 0 in TP, reversal-safe", () => {
    const o = orbit();
    toggleViewMode(o); // FP → target 1
    stepViewBlend(BLEND_SEC / 2);
    expect(viewState.blend).toBeCloseTo(0.5, 6);
    // Reverse before completing: back to TP → continues DOWN from 0.5.
    toggleViewMode(o); // TP → target 0
    stepViewBlend(BLEND_SEC / 2 / 2); // dt = BLEND_SEC/4 → step 0.25
    expect(viewState.blend).toBeCloseTo(0.25, 6);
    stepViewBlend(BLEND_SEC); // overshoot guard
    expect(viewState.blend).toBe(0);
  });
});
