import { describe, expect, it } from "vitest";
import { GRAIN_SIZE, GROUND_GRAIN_MATERIALS, GROUND_PARS, GROUND_SMOOTH_MATERIAL, grainBytes, groundMapFragment } from "./groundDetail";

describe("groundDetail: close-up ground sharpness", () => {
  it("the grain is mean grey (the average colour does not change), varied and deterministic", () => {
    const a = grainBytes();
    expect(a.length).toBe(GRAIN_SIZE * GRAIN_SIZE * 4);
    let sum = 0;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < a.length; i += 4) {
      sum += a[i]!;
      lo = Math.min(lo, a[i]!);
      hi = Math.max(hi, a[i]!);
    }
    const mean = sum / (a.length / 4);
    expect(mean).toBeGreaterThan(120);
    expect(mean).toBeLessThan(136);
    expect(hi - lo).toBeGreaterThan(60);
    expect(grainBytes()).toEqual(a);
  });

  it("the plaza atlas is the one unique-mapped material that gets the smooth tap, and it is a ground material", () => {
    expect(GROUND_GRAIN_MATERIALS).toContain(GROUND_SMOOTH_MATERIAL);
    expect(groundMapFragment(true)).toContain("villageSmoothTap( map");
    expect(groundMapFragment(false)).not.toContain("villageSmoothTap( map");
    expect(GROUND_PARS.endsWith("void main() {")).toBe(true);
  });

  it("the grain only acts where a texel is magnified, and replaces map_fragment's own sampling", () => {
    const f = groundMapFragment(false);
    expect(f).toContain("magnified");
    expect(f).toContain("diffuseColor *= sampledDiffuseColor");
  });
});
