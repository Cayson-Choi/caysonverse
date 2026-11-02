import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "./reducedMotion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion", () => {
  it("reads the system setting", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false where there is no matchMedia, or it throws", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal("matchMedia", () => {
      throw new Error("blocked");
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});
