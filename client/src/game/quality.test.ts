import { describe, it, expect } from "vitest";
import { LIGHTING } from "./sceneLighting";
import {
  BLOOM,
  BRIGHTNESS,
  QUALITY,
  acesFilmic,
  exposureFor,
  inverseNeutralToneMap,
  neutralToneMap,
  resolveQuality,
  skyBeforeToneMap,
  sparklesPerPoint,
} from "./quality";
import { getRenderProfile } from "./renderProfile";

describe("resolveQuality", () => {
  it("auto follows the device: touch is the light tier, everything else the rich one", () => {
    expect(resolveQuality("auto", true)).toBe("low");
    expect(resolveQuality("auto", false)).toBe("high");
  });

  it("auto picks the light tier where WebGL is drawn in software (a blocked driver: the rich tier ran at 0.5 fps)", () => {
    expect(resolveQuality("auto", false, true)).toBe("low");
    expect(resolveQuality("auto", false, false)).toBe("high");
    // An explicit choice is still honoured.
    expect(resolveQuality("high", false, true)).toBe("high");
  });

  it("an explicit choice wins over the device", () => {
    expect(resolveQuality("high", true)).toBe("high");
    expect(resolveQuality("high", false)).toBe("high");
    expect(resolveQuality("low", true)).toBe("low");
    expect(resolveQuality("low", false)).toBe("low");
  });
});

describe("QUALITY", () => {
  it("high is bloom + shafts + 60 sparkles + soft shadows; low is none of them with blob shadows", () => {
    expect(QUALITY.high).toEqual({ bloom: true, shafts: true, sparkles: 60, shadows: "soft", dpr: [1, 2] });
    expect(QUALITY.low).toEqual({ bloom: false, shafts: false, sparkles: 0, shadows: "blob", dpr: [1, 1] });
  });
});

describe("renderProfile drives the tier's budget (ruling E17: one dpr source)", () => {
  it("a tier gives its dpr and shadow kind through getRenderProfile", () => {
    expect(getRenderProfile(false, "high")).toEqual({ dpr: [1, 2], shadows: true, blobShadows: false });
    expect(getRenderProfile(true, "low")).toEqual({ dpr: [1, 1], shadows: false, blobShadows: true });
    // The tier decides, not the device: a phone that chose "화려하게" is rich, a PC that chose "가볍게" is light.
    expect(getRenderProfile(true, "high")).toEqual(getRenderProfile(false, "high"));
    expect(getRenderProfile(false, "low")).toEqual(getRenderProfile(true, "low"));
  });

  it("without a tier (the world) the old budget is untouched", () => {
    expect(getRenderProfile(true)).toEqual({ dpr: [1, 1], shadows: false, blobShadows: true });
    expect(getRenderProfile(false)).toEqual({ dpr: [1, 1.5], shadows: true, blobShadows: false });
  });
});

describe("BRIGHTNESS and exposureFor", () => {
  it("is the slider's range", () => {
    expect(BRIGHTNESS).toEqual({ min: 0.8, max: 1.4, step: 0.1, default: 1 });
  });

  it("is the brightness itself inside the range", () => {
    expect(exposureFor(1)).toBe(1);
    expect(exposureFor(0.8)).toBe(0.8);
    expect(exposureFor(1.4)).toBe(1.4);
    expect(exposureFor(1.15)).toBe(1.15);
  });

  it("clamps to the range and treats a non-number as the default", () => {
    expect(exposureFor(0)).toBe(0.8);
    expect(exposureFor(-5)).toBe(0.8);
    expect(exposureFor(3)).toBe(1.4);
    expect(exposureFor(Number.POSITIVE_INFINITY)).toBe(1.4);
    expect(exposureFor(Number.NaN)).toBe(1);
  });
});

describe("BLOOM", () => {
  it("keeps the brief's strength and radius, and its threshold sits above the compensated sky at every brightness", () => {
    expect(BLOOM.strength).toBe(0.6);
    expect(BLOOM.radius).toBe(0.4);
    // The bloom pass thresholds on luma. A sky that glows would haze the whole frame.
    for (let i = 0; i <= 6; i++) {
      const exposure = exposureFor(BRIGHTNESS.min + i * BRIGHTNESS.step);
      const [r, g, b] = skyBeforeToneMap(LIGHTING.brightDay.sky, exposure);
      expect(0.299 * r + 0.587 * g + 0.114 * b).toBeLessThan(BLOOM.threshold);
    }
  });
});

describe("sparklesPerPoint", () => {
  it("splits the tier's sparkle budget over the shafts, and is zero with none", () => {
    expect(sparklesPerPoint(60, 0)).toBe(0);
    expect(sparklesPerPoint(0, 4)).toBe(0);
    expect(sparklesPerPoint(60, 1)).toBe(60);
    expect(sparklesPerPoint(60, 3)).toBe(20);
    expect(sparklesPerPoint(60, 4)).toBe(15);
  });

  it("never spends more than the budget in total, and keeps a few per shaft", () => {
    for (let n = 1; n <= 30; n++) {
      const each = sparklesPerPoint(60, n);
      expect(each).toBeGreaterThanOrEqual(2);
      expect(each * n).toBeLessThanOrEqual(Math.max(60, 2 * n));
    }
  });
});

describe("skyBeforeToneMap", () => {
  /** sRGB hex -> linear, for the expectation. */
  const lin = (hex: string): number[] =>
    [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });

  it("is a clear colour that comes out as the sky after the rich tier tone-maps it, at every brightness", () => {
    // The rich tier tone-maps the whole frame, clear colour included; the light tier does not tone-map its clear
    // colour. Feeding the sky through this makes both tiers show the same sky (the blue is held just under 1,
    // which the curve only reaches at infinity). Exact for every colour the curve can reach.
    for (const hex of ["#CFE3B4", "#E6F6FF"]) {
      const want = lin(hex).map((v) => Math.min(v, 0.985));
      for (const brightness of [0.8, 1, 1.4]) {
        const exposure = exposureFor(brightness);
        const got = acesFilmic(skyBeforeToneMap(hex, exposure), exposure);
        for (let c = 0; c < 3; c++) expect(got[c], hex + " @" + brightness + " ch" + c).toBeCloseTo(want[c], 2);
      }
    }
  });

  it("gets the brightest blue sky much closer than the raw colour does (a saturated blue is partly outside the curve)", () => {
    const want = lin("#9ED8FF").map((v) => Math.min(v, 0.985));
    const dist = (got: number[]): number => Math.hypot(...got.map((v, i) => v - want[i]));
    for (const exposure of [0.8, 1, 1.4]) {
      const raw = acesFilmic(lin("#9ED8FF"), exposure);
      const fixed = acesFilmic(skyBeforeToneMap("#9ED8FF", exposure), exposure);
      expect(dist(fixed)).toBeLessThan(dist(raw) / 2);
      // and stays a sky: blue is the strongest channel, and bright
      expect(fixed[2]).toBeGreaterThan(0.95);
      expect(fixed[1]).toBeGreaterThan(fixed[0]);
    }
  });

  it("needs a clear colour brighter than white for the blue (the curve only reaches its top at high input)", () => {
    expect(skyBeforeToneMap("#9ED8FF", 1)[2]).toBeGreaterThan(1);
  });

  it("never returns a negative or non-finite channel, even for black and white", () => {
    for (const hex of ["#000000", "#FFFFFF", "#FF0000"]) {
      for (const v of skyBeforeToneMap(hex, 1)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("the neutral tone curve (케이슨 마을) and its inverse", () => {
  it("passes colours under the 0.76 knee almost as they are (only the toe's 0.04 offset), and compresses highlights below 1", () => {
    const mid = neutralToneMap([0.3, 0.4, 0.5], 1);
    expect(mid[0]).toBeCloseTo(0.26, 6);
    expect(mid[2]).toBeCloseTo(0.46, 6);
    expect(neutralToneMap([0.5, 0.5, 0.5], 2)[0]).toBeLessThan(1);
    expect(neutralToneMap([0.5, 0.5, 0.5], 2)[0]).toBeGreaterThan(0.76);
    // Dark colours are not crushed as ACES's toe does: a dark wood stays visible.
    const wood = [0.04, 0.025, 0.015];
    expect(neutralToneMap(wood, 1.5)[0]).toBeGreaterThan(acesFilmic(wood, 1.15)[0]);
  });

  it("the inverse gives the colour back, under the knee, over it and in the toe", () => {
    for (const exposure of [0.8, 1, 1.5]) {
      for (const c of [
        [0.02, 0.03, 0.05],
        [0.03, 0.2, 0.25],
        [0.35, 0.45, 0.6],
        [0.6, 0.7, 0.85],
        [0.9, 0.88, 0.86],
      ]) {
        const back = neutralToneMap(inverseNeutralToneMap(c, exposure), exposure);
        for (let k = 0; k < 3; k++) expect(back[k], `${c} @ ${exposure}`).toBeCloseTo(c[k]!, 4);
      }
    }
    for (const v of inverseNeutralToneMap([2, -1, 0.5], 1.5)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("inverseNeutralToneMap writes into an out-parameter when given one (no allocation per frame), with the same numbers", () => {
    const out: [number, number, number] = [9, 9, 9];
    for (const c of [
      [0.03, 0.2, 0.25],
      [0.9, 0.88, 0.86],
    ]) {
      const r = inverseNeutralToneMap(c, 1.4, out);
      expect(r).toBe(out);
      expect([...out]).toEqual(inverseNeutralToneMap(c, 1.4));
    }
  });

  it("skyBeforeToneMap takes the scene's curve", () => {
    const hex = LIGHTING.village.sky;
    const lin = skyBeforeToneMap(hex, 1.5, "neutral");
    const shown = neutralToneMap(lin, 1.5);
    const target = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    for (let k = 0; k < 3; k++) expect(shown[k]).toBeCloseTo(target[k]!, 4);
    expect(skyBeforeToneMap(hex, 1.5)).toEqual(skyBeforeToneMap(hex, 1.5, "aces"));
  });
});
