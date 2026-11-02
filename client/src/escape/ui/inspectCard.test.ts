import { describe, expect, it } from "vitest";
import {
  TILT_MAX_DEG,
  flipped,
  inspectImageUrl,
  noteNumber,
  tiltFromDrag,
  tiltTransform,
  uvMaskStyle,
} from "./inspectCard";

describe("tiltFromDrag", () => {
  it("tiltFromDrag clamps to ±35°", () => {
    expect(TILT_MAX_DEG).toBe(35);
    expect(tiltFromDrag(9999, 0, 300).ry).toBe(35);
    expect(tiltFromDrag(-9999, 0, 300).ry).toBe(-35);
    expect(tiltFromDrag(0, 9999, 300).rx).toBe(-35);
    expect(tiltFromDrag(0, -9999, 300).rx).toBe(35);
    // Both axes at once, each clamped on its own.
    expect(tiltFromDrag(9999, -9999, 300)).toEqual({ rx: 35, ry: 35 });
  });

  it("tilts in proportion to the drag over the card's width, and a still finger is flat", () => {
    expect(tiltFromDrag(0, 0, 300)).toEqual({ rx: 0, ry: 0 });
    const half = tiltFromDrag(75, 0, 300).ry; // a quarter of the card's width
    const full = tiltFromDrag(150, 0, 300).ry; // half of it
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(35);
    expect(full).toBeCloseTo(half * 2, 6);
    // The same drag tilts a narrower card more.
    expect(tiltFromDrag(75, 0, 150).ry).toBeGreaterThan(half);
  });

  it("is safe for a broken width or a non-number drag: flat, never NaN", () => {
    for (const w of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = tiltFromDrag(50, 50, w);
      expect(Number.isFinite(t.rx) && Number.isFinite(t.ry), String(w)).toBe(true);
      expect(t, String(w)).toEqual({ rx: 0, ry: 0 });
    }
    expect(tiltFromDrag(Number.NaN, Number.NaN, 300)).toEqual({ rx: 0, ry: 0 });
    // Never a negative zero (toBe(0) tells -0 apart).
    expect(tiltFromDrag(0, 0, 300).rx).toBe(0);
    expect(tiltFromDrag(-0, 0, 300).ry).toBe(0);
  });
});

describe("tiltTransform", () => {
  it("is the CSS the card wears for a tilt, and flat for no tilt", () => {
    expect(tiltTransform({ rx: 0, ry: 0 })).toBe("rotateX(0deg) rotateY(0deg)");
    expect(tiltTransform({ rx: 10.123, ry: -20 })).toBe("rotateX(10.1deg) rotateY(-20deg)");
  });
});

describe("flipped", () => {
  it("is 0 on the front and 180 on the back", () => {
    expect(flipped({ flipped: false })).toBe(0);
    expect(flipped({ flipped: true })).toBe(180);
  });
});

describe("uvMaskStyle", () => {
  it("is a radial-gradient circle of that radius around the pointer", () => {
    const css = uvMaskStyle(40, 60, 90);
    expect(css).toContain("radial-gradient(");
    expect(css).toContain("circle 90px at 40px 60px");
    // Solid in the middle, see-through at the rim: the hidden text shows only under the light.
    expect(css).toMatch(/#000/);
    expect(css).toMatch(/transparent/);
  });

  it("keeps the numbers sane: rounded, finite, and a radius of at least 1 px", () => {
    expect(uvMaskStyle(12.3456, 7.891, 50.5)).toContain("at 12.3px 7.9px");
    const bad = uvMaskStyle(Number.NaN, Number.POSITIVE_INFINITY, -5);
    expect(bad).not.toMatch(/NaN|Infinity/);
    expect(bad).toContain("circle 1px at 0px 0px");
  });
});

describe("inspectImageUrl / noteNumber", () => {
  it("every note shares ONE picture; the number is shown on top of it", () => {
    for (const id of ["note_1", "note_5", "note_8"])
      expect(inspectImageUrl(id)).toBe("/models/school/inspect/note-front.webp");
    expect(noteNumber("note_3")).toBe(3);
    expect(noteNumber("note_8")).toBe(8);
  });

  it("other objects have their own picture, named after them", () => {
    expect(inspectImageUrl("flashlight")).toBe("/models/school/inspect/flashlight-front.webp");
    expect(inspectImageUrl("safe_key_left")).toBe("/models/school/inspect/safe_key_left-front.webp");
    expect(inspectImageUrl("note_box")).toBe("/models/school/inspect/note_box-front.webp");
  });

  it("noteNumber is null for anything that is not a numbered note", () => {
    for (const id of ["note_box", "note_", "note_x", "note_1a", "xnote_1", "flashlight", ""])
      expect(noteNumber(id), id).toBeNull();
  });

  it("an id that could climb out of the inspect folder gets no picture at all", () => {
    for (const id of ["../secret", "a/b", "a\\b", "a b", "", "x?y", "x#y", "%2e%2e"])
      expect(inspectImageUrl(id), id).toBeNull();
  });
});
