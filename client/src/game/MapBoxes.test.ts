import { describe, expect, it } from "vitest";
import { collidersDebugOn } from "./MapBoxes";

describe("collidersDebugOn — the ?debug=colliders overlay is a development switch only (final fix B7)", () => {
  it("in a development build: on for exactly ?debug=colliders", () => {
    expect(collidersDebugOn("?debug=colliders", true)).toBe(true);
    expect(collidersDebugOn("?world=legacy&debug=colliders", true)).toBe(true);
    expect(collidersDebugOn("", true)).toBe(false);
    expect(collidersDebugOn("?debug=1", true)).toBe(false);
    expect(collidersDebugOn("?debug=Colliders", true)).toBe(false);
  });

  it("in a production build: never on, whatever the address says", () => {
    expect(collidersDebugOn("?debug=colliders", false)).toBe(false);
    expect(collidersDebugOn("?world=legacy&debug=colliders", false)).toBe(false);
  });

  it("defaults to the build's own flag (vitest runs as development)", () => {
    expect(import.meta.env.DEV).toBe(true);
    expect(collidersDebugOn("?debug=colliders")).toBe(true);
  });
});
