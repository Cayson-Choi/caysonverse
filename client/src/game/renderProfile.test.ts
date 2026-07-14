import { describe, it, expect } from "vitest";
import { getRenderProfile } from "./renderProfile";

/**
 * The low-spec matrix is BINDING: touch caps dpr at 1, drops the directional
 * shadow, and turns on cheap blob shadows; desktop keeps the 1.5 dpr + real
 * shadow and no blobs. These exact values are asserted so a regression can't
 * silently change the phone rendering budget.
 */
describe("getRenderProfile", () => {
  it("caps dpr, disables shadows and enables blob shadows on touch", () => {
    expect(getRenderProfile(true)).toEqual({ dpr: [1, 1], shadows: false, blobShadows: true });
  });

  it("keeps the desktop 1.5 dpr, real shadows and no blob shadows", () => {
    expect(getRenderProfile(false)).toEqual({ dpr: [1, 1.5], shadows: true, blobShadows: false });
  });
});
