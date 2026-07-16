import { describe, it, expect } from "vitest";
import {
  BLEND_SEC,
  FP_PITCH_MIN,
  FP_PITCH_MAX,
  HIDE_BLEND,
  stepBlend,
  easeBlend,
  clampFpPitch,
  stepZoomMode,
} from "./viewMode";

const BAND = { min: 2.5, max: 18 };

describe("viewMode — stepBlend", () => {
  it("eases toward 1 (enter FP) over BLEND_SEC and clamps at 1", () => {
    const half = stepBlend(0, 1, BLEND_SEC / 2);
    expect(half).toBeCloseTo(0.5, 6);
    expect(stepBlend(0, 1, BLEND_SEC)).toBe(1); // one full step reaches the target
    expect(stepBlend(0.9, 1, 1)).toBe(1); // a big delta cannot overshoot past 1
  });

  it("eases back toward 0 (exit FP) and clamps at 0", () => {
    expect(stepBlend(1, 0, BLEND_SEC)).toBe(0);
    expect(stepBlend(0.2, 0, 1)).toBe(0);
  });

  it("holds when already at the target", () => {
    expect(stepBlend(1, 1, 0.1)).toBe(1);
    expect(stepBlend(0, 0, 0.1)).toBe(0);
  });

  it("reverses continuously mid-blend (no restart, no jump)", () => {
    // Heading INTO FP, interrupted at 0.4 and told to go back to TP: the factor
    // must continue DOWN from 0.4, not snap or restart.
    const down = stepBlend(0.4, 0, 0.025); // dt = BLEND_SEC/10 → step 0.1
    expect(down).toBeCloseTo(0.3, 6);
    // And the other direction from a partial exit.
    const up = stepBlend(0.4, 1, 0.025);
    expect(up).toBeCloseTo(0.5, 6);
  });
});

describe("viewMode — easeBlend (smoothstep)", () => {
  it("pins the endpoints and is symmetric at the midpoint", () => {
    expect(easeBlend(0)).toBe(0);
    expect(easeBlend(1)).toBe(1);
    expect(easeBlend(0.5)).toBeCloseTo(0.5, 6);
  });

  it("has flat ends (slower than linear near 0 and 1)", () => {
    expect(easeBlend(0.25)).toBeLessThan(0.25); // eased in
    expect(easeBlend(0.75)).toBeGreaterThan(0.75); // eased out
  });

  it("clamps out-of-range input", () => {
    expect(easeBlend(-1)).toBe(0);
    expect(easeBlend(2)).toBe(1);
  });
});

describe("viewMode — clampFpPitch", () => {
  it("passes through inside the wider FP range", () => {
    expect(clampFpPitch(0)).toBe(0);
    expect(clampFpPitch(-0.5)).toBe(-0.5);
    expect(clampFpPitch(1.0)).toBe(1.0);
  });

  it("clamps to the FP pitch bounds", () => {
    expect(clampFpPitch(-3)).toBe(FP_PITCH_MIN);
    expect(clampFpPitch(3)).toBe(FP_PITCH_MAX);
    expect(FP_PITCH_MIN).toBeLessThan(-1); // wider than TP minPitch (-0.1)
    expect(FP_PITCH_MAX).toBeGreaterThan(1); // wider than TP maxPitch (1.2 → allow equal)
  });
});

describe("viewMode — stepZoomMode (unified wheel + pinch threshold)", () => {
  it("TP at min + one more inward notch → enters FP (distance unchanged)", () => {
    const r = stepZoomMode("tp", BAND.min, -0.5, BAND); // delta<0 = zoom in
    expect(r).toEqual({ mode: "fp", distance: BAND.min, toggled: true });
  });

  it("TP at min but zooming OUT stays TP and zooms out normally", () => {
    const r = stepZoomMode("tp", BAND.min, +1, BAND);
    expect(r.mode).toBe("tp");
    expect(r.toggled).toBe(false);
    expect(r.distance).toBeCloseTo(BAND.min + 1, 6);
  });

  it("TP above min + inward notch just zooms in (clamps to min, does NOT toggle yet)", () => {
    const r = stepZoomMode("tp", 6, -0.5, BAND);
    expect(r).toEqual({ mode: "tp", distance: 5.5, toggled: false });
    // A big inward notch clamps to min WITHOUT toggling — the NEXT notch (now AT
    // min) is the one that crosses into FP.
    const clampToMin = stepZoomMode("tp", 3, -10, BAND);
    expect(clampToMin).toEqual({ mode: "tp", distance: BAND.min, toggled: false });
  });

  it("FP + any outward notch → back to TP, preserving the (untouched) distance", () => {
    // Entered FP via V at distance 6 → distance was never clobbered; exiting keeps 6.
    const r = stepZoomMode("fp", 6, +1, BAND);
    expect(r).toEqual({ mode: "tp", distance: 6, toggled: true });
    // Entered FP via wheel (already at min) → exit lands back at min.
    const atMin = stepZoomMode("fp", BAND.min, +1, BAND);
    expect(atMin).toEqual({ mode: "tp", distance: BAND.min, toggled: true });
  });

  it("FP + inward or no motion is a no-op (FP ignores follow distance)", () => {
    expect(stepZoomMode("fp", 6, -1, BAND)).toEqual({ mode: "fp", distance: 6, toggled: false });
    expect(stepZoomMode("fp", 6, 0, BAND)).toEqual({ mode: "fp", distance: 6, toggled: false });
  });

  it("treats a distance within epsilon of min as 'at min' for the FP threshold", () => {
    const r = stepZoomMode("tp", BAND.min + 1e-7, -0.5, BAND);
    expect(r.mode).toBe("fp");
    expect(r.toggled).toBe(true);
  });
});

describe("viewMode — constants", () => {
  it("exposes a ~0.25s blend and a mid-blend hide threshold", () => {
    expect(BLEND_SEC).toBeCloseTo(0.25, 6);
    expect(HIDE_BLEND).toBeGreaterThan(0);
    expect(HIDE_BLEND).toBeLessThan(1);
  });
});
