import { describe, expect, it } from "vitest";
import { Object3D, PerspectiveCamera, Vector3 } from "three";
import {
  addInkLabel,
  affineError,
  desaturated,
  inkBucket,
  inkGrid,
  inkLabels,
  inkLabelsVersion,
  lightFromProbe,
  linearToSrgb,
  makeTone,
  parseCss,
  screenGrid,
  srgbToLinear,
  standardLight,
  toneCurve,
  toneKey,
  type InkLabel,
} from "./inkLabels";

function label(over: Partial<InkLabel> = {}): InkLabel & { inkLog: boolean[] } {
  const inkLog: boolean[] = [];
  return { object: new Object3D(), w: 1, h: 0.3, paint() {}, setInk: (on) => inkLog.push(on), inkLog, ...over } as InkLabel & { inkLog: boolean[] };
}

describe("ink label registry", () => {
  it("adds and removes; removal gives the sign its 3D lettering back", () => {
    const l = label();
    const v0 = inkLabelsVersion();
    const off = addInkLabel(l);
    expect(inkLabels().has(l)).toBe(true);
    expect(inkLabelsVersion()).toBe(v0 + 1);
    off();
    expect(inkLabels().has(l)).toBe(false);
    expect(l.inkLog).toEqual([true]);
    off(); // twice: nothing more
    expect(l.inkLog).toEqual([true]);
  });
});

describe("inkBucket: the raster's size steps a quarter octave up from the size on screen", () => {
  it("is never smaller than the sign on screen, at most 19% larger, within the cap", () => {
    for (const px of [8, 9, 13, 37, 100, 211, 512, 700]) {
      const b = inkBucket(px, 4096);
      expect(b).toBeGreaterThanOrEqual(px - 0.5);
      expect(b / px).toBeLessThanOrEqual(2 ** 0.25 + 0.01);
    }
    expect(inkBucket(5000, 768)).toBe(768);
    expect(inkBucket(1, 768)).toBe(8);
  });
  it("holds still while the size moves inside one step (no re-raster each frame)", () => {
    expect(inkBucket(101, 4096)).toBe(inkBucket(104, 4096));
  });
});

describe("colour: what the 3D board shows, what the overlay's ink is drawn with", () => {
  it("parses the css the painters use", () => {
    expect(parseCss("#26292c")).toEqual([0x26 / 255, 0x29 / 255, 0x2c / 255, 1]);
    expect(parseCss("#fff")).toEqual([1, 1, 1, 1]);
    expect(parseCss("rgba(6, 10, 40, 0.55)")).toEqual([6 / 255, 10 / 255, 40 / 255, 0.55]);
    expect(parseCss("rgb(1,2,3)")).toEqual([1 / 255, 2 / 255, 3 / 255, 1]);
    expect(parseCss("gold")).toBeNull();
  });
  it("sRGB round trip", () => {
    for (const v of [0, 0.01, 0.2, 0.5, 0.9, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });
  it("lightFromProbe inverts the tone curve: a board shown under light L gives back L (neutral and ACES)", () => {
    for (const curve of ["neutral", "aces"] as const)
      for (const L of [[1, 1, 1], [0.55, 0.5, 0.45], [1.6, 1.4, 1.2]]) {
        const albedo = [0x8a / 255, 0x61 / 255, 0x39 / 255]; // the lake's plank
        const lin = albedo.map((c, i) => srgbToLinear(c) * L[i]!);
        const shown = toneCurve(lin, curve, 1.4).map(linearToSrgb);
        const got = lightFromProbe(shown, albedo, curve, 1.4);
        // the ink drawn with the recovered light matches the ink under the true light
        const ink = [0.95, 0.92, 0.82];
        const want = toneCurve(ink.map((c, i) => srgbToLinear(c) * L[i]!), curve, 1.4).map(linearToSrgb);
        const have = toneCurve(ink.map((c, i) => srgbToLinear(c) * got[i]!), curve, 1.4).map(linearToSrgb);
        for (let c = 0; c < 3; c++) expect(Math.abs(have[c]! - want[c]!)).toBeLessThan(0.03);
      }
  });
  it("makeTone: white light and the identity curve leave a colour as it is; alpha kept; non-colours passed through", () => {
    const t = makeTone([1, 1, 1], "none", 1);
    expect(t("#26292c")).toBe("rgb(38,41,44)");
    expect(t("rgba(0,0,0,0.6)")).toBe("rgba(0,0,0,0.6)");
    expect(t("gold")).toBe("gold");
    // half the light: darker
    const dim = makeTone([0.5, 0.5, 0.5], "none", 1)("#ffffff");
    expect(dim).toBe(`rgb(${Math.round(linearToSrgb(0.5) * 255)},${Math.round(linearToSrgb(0.5) * 255)},${Math.round(linearToSrgb(0.5) * 255)})`);
  });
  it("toneKey changes only past a 2% light step", () => {
    expect(toneKey([1, 1, 1], "neutral", 1.4)).toBe(toneKey([1.005, 1, 1], "neutral", 1.4));
    expect(toneKey([1, 1, 1], "neutral", 1.4)).not.toBe(toneKey([1.05, 1, 1], "neutral", 1.4));
    expect(toneKey([1, 1, 1], "neutral", 1.4)).not.toBe(toneKey([1, 1, 1], "aces", 1.4));
  });
});

describe("the plane on screen", () => {
  const W = 1236;
  const H = 2745;
  function cam(): PerspectiveCamera {
    const c = new PerspectiveCamera(55, W / H, 0.1, 200);
    c.position.set(0, 1.5, 3);
    c.lookAt(0, 1.5, 0);
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    return c;
  }
  it("inkGrid: two rows, about square columns, 2..8", () => {
    expect(inkGrid(1.2, 0.36)).toEqual({ cols: 7, rows: 2 });
    expect(inkGrid(0.4, 0.14)).toEqual({ cols: 6, rows: 2 });
    expect(inkGrid(0.26, 0.101)).toEqual({ cols: 5, rows: 2 });
    expect(inkGrid(1.5, 0.3)).toEqual({ cols: 8, rows: 2 });
    expect(inkGrid(0.2, 0.4)).toEqual({ cols: 2, rows: 2 });
  });
  it("screenGrid: the corners where three projects them; false behind the eye", () => {
    const c = cam();
    const o = new Object3D();
    o.position.set(0.2, 1.6, 0);
    o.updateMatrixWorld(true);
    const g: number[] = [];
    expect(screenGrid(o.matrixWorld.elements, 1, 0.3, 1, 1, c.matrixWorldInverse.elements, c.projectionMatrix.elements, W, H, g)).toBe(true);
    expect(g.length).toBe(8);
    const tl = new Vector3(0.2 - 0.5, 1.6 + 0.15, 0).project(c);
    expect(g[0]).toBeCloseTo((tl.x * 0.5 + 0.5) * W, 3);
    expect(g[1]).toBeCloseTo((0.5 - tl.y * 0.5) * H, 3);
    const br = new Vector3(0.2 + 0.5, 1.6 - 0.15, 0).project(c);
    expect(g[6]).toBeCloseTo((br.x * 0.5 + 0.5) * W, 3);
    expect(g[7]).toBeCloseTo((0.5 - br.y * 0.5) * H, 3);
    o.position.set(0, 1.5, 5); // behind the camera
    o.updateMatrixWorld(true);
    expect(screenGrid(o.matrixWorld.elements, 1, 0.3, 1, 1, c.matrixWorldInverse.elements, c.projectionMatrix.elements, W, H, g)).toBe(false);
  });
  it("affineError: none for a parallelogram, the perspective's miss for a trapezoid", () => {
    expect(affineError(0, 0, 10, 0, 0, 5, 10, 5)).toBe(0);
    expect(affineError(0, 0, 10, 1, 0, 5, 10, 4)).toBeCloseTo(2, 6);
  });
});

describe("standardLight: three's matte MeshStandardMaterial lighting, on the CPU", () => {
  it("a directional light straight on gives colour x intensity / pi; edge-on or behind gives nothing", () => {
    const sun = { kind: "directional" as const, color: [3, 3, 3], dir: [0, 0, 1] };
    expect(standardLight([0, 0, 1], [sun])[0]).toBeCloseTo(3 / Math.PI, 6);
    expect(standardLight([1, 0, 0], [sun])[0]).toBeCloseTo(0, 6);
    expect(standardLight([0, 0, -1], [sun])[0]).toBe(0);
  });
  it("the hemisphere light mixes ground to sky by 0.5 n.up + 0.5; an ambient adds its colour", () => {
    const hemi = { kind: "hemisphere" as const, color: [1, 1, 2], ground: [0.2, 0.2, 0.2], dir: [0, 1, 0] };
    const side = standardLight([0, 0, 1], [hemi]); // half way
    expect(side[0]).toBeCloseTo(0.6 / Math.PI, 6);
    expect(side[2]).toBeCloseTo(1.1 / Math.PI, 6);
    const up = standardLight([0, 1, 0], [hemi, { kind: "ambient", color: [0.5, 0.5, 0.5] }]);
    expect(up[0]).toBeCloseTo(1.5 / Math.PI, 6);
  });
});

describe("fog and the night fade in the ink's colours", () => {
  it("fog mixes the encoded colour toward the fog's (three mixes after the output encoding)", () => {
    const plain = makeTone([1, 1, 1], "none", 1)("#000000");
    expect(plain).toBe("rgb(0,0,0)");
    const fogged = makeTone([1, 1, 1], "none", 1, { rgb: [1, 1, 1], f: 0.5 })("#000000");
    expect(fogged).toBe("rgb(128,128,128)");
    expect(toneKey([1, 1, 1], "none", 1, { rgb: [1, 1, 1], f: 0.5 })).not.toBe(toneKey([1, 1, 1], "none", 1));
  });
  it("desaturated pulls toward the luminance; the probe and the ink use the same pull", () => {
    expect(desaturated([1, 0, 0], 0)).toEqual([1, 0, 0]);
    const g = desaturated([1, 0, 0], 1);
    expect(g[0]).toBeCloseTo(0.2126, 6);
    expect(g[1]).toBeCloseTo(0.2126, 6);
    // a gilt board shown at night (desaturated, dim light): the ink drawn from the recovered light matches the ink under the true light
    const albedo = [0xd9 / 255, 0xae / 255, 0x4a / 255];
    const L = [0.07, 0.06, 0.09];
    const d = 0.6;
    const shown = toneCurve(desaturated(albedo.map(srgbToLinear), d).map((c, i) => c * L[i]!), "neutral", 1.95).map(linearToSrgb);
    const got = lightFromProbe(shown, albedo, "neutral", 1.95, d);
    const ink = "#f6efe2";
    const want = makeTone(L, "neutral", 1.95, null, d)(ink);
    const have = makeTone(got, "neutral", 1.95, null, d)(ink);
    const nums = (s: string) => s.match(/\d+/g)!.map(Number);
    for (let c = 0; c < 3; c++) expect(Math.abs(nums(have)[c]! - nums(want)[c]!)).toBeLessThanOrEqual(6);
  });
});
