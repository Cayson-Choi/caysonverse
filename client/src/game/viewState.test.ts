import { describe, it, expect, beforeEach } from "vitest";
import {
  viewState,
  enterFp,
  exitFp,
  toggleViewMode,
  toggleOverview,
  enterOverview,
  applyZoom,
  resetViewMode,
  stepViewBlend,
  stepOvBlend,
} from "./viewState";
import { normalizeAngle } from "./yaw";
import { useViewStore } from "../stores/viewStore";
import { BLEND_SEC, OV_BLEND_SEC } from "./viewMode";
import type { Orbit } from "./types";

const BAND = { min: 2.5, max: 18 };

function orbit(over: Partial<Orbit> = {}): Orbit {
  return { yaw: 0, pitch: 0.35, distance: 6, ...over };
}

beforeEach(() => resetViewMode());

describe("viewState — reset", () => {
  it("returns to TP, blend 0, level look, no overview, and clears the button flags", () => {
    viewState.mode = "ov";
    viewState.blend = 1;
    viewState.fpYaw = 2;
    viewState.fpPitch = 0.5;
    viewState.ovBlend = 1;
    viewState.prevMode = "fp";
    viewState.ovCenterX = -18;
    viewState.ovCenterZ = 4;
    viewState.ovHeight = 60;
    viewState.dragging = true;
    useViewStore.getState().setFp(true);
    useViewStore.getState().setOv(true);

    resetViewMode();

    expect(viewState).toEqual({
      mode: "tp",
      blend: 0,
      fpYaw: 0,
      fpPitch: 0,
      ovBlend: 0,
      prevMode: "tp",
      ovCenterX: 0,
      ovCenterZ: 0,
      ovHeight: 0,
      dragging: false,
    });
    expect(useViewStore.getState().isFp).toBe(false);
    expect(useViewStore.getState().isOv).toBe(false);
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

describe("viewState — overview mode machine (design 20)", () => {
  it("tp → ov → tp round-trip restores TP and preserves orbit yaw/pitch/distance", () => {
    const o = orbit({ yaw: 0.7, pitch: 0.9, distance: 12 });
    toggleOverview(); // enter overview from TP
    expect(viewState.mode).toBe("ov");
    expect(viewState.prevMode).toBe("tp");
    toggleOverview(); // exit → restore TP
    expect(viewState.mode).toBe("tp");
    expect(o).toEqual({ yaw: 0.7, pitch: 0.9, distance: 12 }); // orbit untouched
  });

  it("fp → ov → fp round-trip restores FP and preserves the FP look yaw", () => {
    const o = orbit({ yaw: 0.2 });
    toggleViewMode(o); // → FP
    viewState.fpYaw = 1.35; // looked around in FP
    viewState.fpPitch = 0.4;
    toggleOverview(); // enter overview from FP
    expect(viewState.mode).toBe("ov");
    expect(viewState.prevMode).toBe("fp");
    toggleOverview(); // exit → restore FP
    expect(viewState.mode).toBe("fp");
    expect(viewState.fpYaw).toBeCloseTo(1.35, 6); // FP look preserved across overview
    expect(viewState.fpPitch).toBeCloseTo(0.4, 6);
  });

  it("drives BOTH button flags: isOv while in overview, restored on exit", () => {
    const o = orbit();
    expect(useViewStore.getState().isOv).toBe(false);
    toggleOverview();
    expect(useViewStore.getState().isOv).toBe(true);
    expect(useViewStore.getState().isFp).toBe(false);
    toggleOverview();
    expect(useViewStore.getState().isOv).toBe(false);
    // From FP, isFp must be restored (not stuck) after an overview round-trip.
    toggleViewMode(o); // → FP
    expect(useViewStore.getState().isFp).toBe(true);
    toggleOverview();
    expect(useViewStore.getState().isFp).toBe(false); // overview owns the button
    expect(useViewStore.getState().isOv).toBe(true);
    toggleOverview();
    expect(useViewStore.getState().isFp).toBe(true); // FP button back
    expect(useViewStore.getState().isOv).toBe(false);
  });

  it("is M-spam safe: a redundant enterOverview never clobbers the remembered mode", () => {
    const o = orbit({ yaw: 0.5 });
    toggleViewMode(o); // → FP
    enterOverview(); // remembers FP
    expect(viewState.prevMode).toBe("fp");
    enterOverview(); // stray second enter (already in overview) — must NOT set prevMode = ov
    enterOverview();
    expect(viewState.prevMode).toBe("fp"); // still FP
    toggleOverview(); // exit → FP (not stuck in overview)
    expect(viewState.mode).toBe("fp");
  });

  it("stepOvBlend eases to 1 in overview and back to 0 outside, reversal-safe", () => {
    toggleOverview(); // → ov, target 1
    stepOvBlend(OV_BLEND_SEC / 2);
    expect(viewState.ovBlend).toBeCloseTo(0.5, 6);
    toggleOverview(); // exit → target 0, continues DOWN from 0.5
    stepOvBlend(OV_BLEND_SEC / 4);
    expect(viewState.ovBlend).toBeCloseTo(0.25, 6);
    stepOvBlend(OV_BLEND_SEC); // overshoot guard
    expect(viewState.ovBlend).toBe(0);
  });

  it("keeps the underlying TP<->FP blend aimed at the REMEMBERED mode while in overview", () => {
    const o = orbit();
    toggleViewMode(o); // → FP, blend heads to 1
    stepViewBlend(BLEND_SEC); // fully FP (blend 1)
    expect(viewState.blend).toBe(1);
    toggleOverview(); // overview over FP — underlying target stays 1 (FP)
    stepViewBlend(BLEND_SEC);
    expect(viewState.blend).toBe(1); // underlying pose remains FP beneath the overview
    toggleOverview(); // back to FP
    expect(viewState.mode).toBe("fp");
    expect(viewState.blend).toBe(1);
  });
});
