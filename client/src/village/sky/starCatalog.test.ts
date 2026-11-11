import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allFigureStars } from "@caysonverse/shared/village/constellations";
import { CATALOG_CUTS, countUpTo, loadStarCatalog, parseStarCatalog, resetStarCatalogCache } from "./starCatalog";
import { colourSaturation, starColour, starGain, starSizePx } from "./starShader";

const FILE = fileURLToPath(new URL("../../../public/sky/stars.v1.bin", import.meta.url));
const bytes = readFileSync(FILE);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** RA/Dec (°) back from a parsed unit vector. */
function raDec(eq: Float32Array, i: number): [number, number] {
  const x = eq[i * 3]!, y = eq[i * 3 + 1]!, z = eq[i * 3 + 2]!;
  return [((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, (Math.asin(z) * 180) / Math.PI];
}

describe("the shipped star file (stars.v1.bin)", () => {
  const cat = parseStarCatalog(buffer);

  it("is 20,408 bytes: 2,549 stars to V 5.5 that rise at 36.5° N", () => {
    expect(bytes.length).toBe(20408);
    expect(cat.count).toBe(2549);
    expect(cat.cumulative).toEqual([150, 446, 788, 1441, 2549]);
    expect(countUpTo(cat, 5)).toBe(1441);
    expect(countUpTo(cat, 5.5)).toBe(2549);
    expect(countUpTo(cat, 7)).toBe(2549);
  });

  it("is sorted brightest first, Sirius leading", () => {
    expect(cat.hr[0]).toBe(2491);
    expect(cat.mag[0]).toBeCloseTo(-1.46, 1);
    for (let i = 1; i < cat.count; i++) expect(cat.mag[i]!).toBeGreaterThanOrEqual(cat.mag[i - 1]! - 1e-6);
    expect(cat.mag[cat.count - 1]!).toBeLessThanOrEqual(5.5 + 0.02);
    for (let k = 0; k < CATALOG_CUTS.length; k++) {
      const n = cat.cumulative[k]!;
      expect(cat.mag[n - 1]!).toBeLessThanOrEqual(CATALOG_CUTS[k]! + 0.02);
      if (n < cat.count) expect(cat.mag[n]!).toBeGreaterThan(CATALOG_CUTS[k]! - 0.02);
    }
  });

  it("holds Polaris and Vega where the catalogue puts them (J2000, within 15″)", () => {
    const p = cat.indexOf(424);
    const [ra, dec] = raDec(cat.eq, p);
    expect(Math.abs(ra - 37.95292) * Math.cos((dec * Math.PI) / 180)).toBeLessThan(15 / 3600);
    expect(Math.abs(dec - 89.26417)).toBeLessThan(15 / 3600);
    expect(cat.mag[p]).toBeCloseTo(2.02, 1);
    const v = cat.indexOf(7001);
    const [vra, vdec] = raDec(cat.eq, v);
    expect(Math.abs(vra - 279.23458)).toBeLessThan(15 / 3600);
    expect(Math.abs(vdec - 38.78361)).toBeLessThan(15 / 3600);
    expect(cat.bv[v]).toBeCloseTo(0.0, 1);
    // Betelgeuse is red
    expect(cat.bv[cat.indexOf(2061)]).toBeGreaterThan(1.5);
  });

  it("has every star the figures use", () => {
    for (const hr of allFigureStars()) expect(cat.indexOf(hr), `HR ${hr}`).toBeGreaterThanOrEqual(0);
    expect(cat.indexOf(9999)).toBe(-1);
  });

  it("has no star that never rises over the village (Dec > -53.5°)", () => {
    for (let i = 0; i < cat.count; i++) expect(raDec(cat.eq, i)[1]).toBeGreaterThan(-53.6);
  });

  it("gives the few stars without a B−V NaN (drawn pale yellow-white)", () => {
    let missing = 0;
    for (let i = 0; i < cat.count; i++) if (Number.isNaN(cat.bv[i]!)) missing++;
    expect(missing).toBe(22);
  });
});

describe("parseStarCatalog", () => {
  it("refuses a wrong magic, a truncated body and bad counts", () => {
    expect(() => parseStarCatalog(new ArrayBuffer(4))).toThrow(/too short/);
    const bad = buffer.slice(0);
    new Uint8Array(bad)[0] = 0x58;
    expect(() => parseStarCatalog(bad)).toThrow(/magic/);
    expect(() => parseStarCatalog(buffer.slice(0, buffer.byteLength - 3))).toThrow(/bytes for/);
    const counts = buffer.slice(0);
    new DataView(counts).setUint16(6, 3000, true);
    expect(() => parseStarCatalog(counts)).toThrow(/cumulative/);
  });
});

describe("loadStarCatalog", () => {
  beforeEach(() => resetStarCatalogCache());
  const ok = () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(buffer.slice(0)) });

  it("fetches once and shares the result", async () => {
    const fetchFn = vi.fn(ok);
    const [a, b] = await Promise.all([loadStarCatalog(fetchFn), loadStarCatalog(fetchFn)]);
    expect(a).toBe(b);
    expect(await loadStarCatalog(fetchFn)).toBe(a);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/sky/stars.v1.bin");
  });

  it("forgets a failed request, so a later call tries again", async () => {
    const fail = vi.fn(() => Promise.resolve({ ok: false, status: 503, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }));
    await expect(loadStarCatalog(fail)).rejects.toThrow(/503/);
    const fetchFn = vi.fn(ok);
    expect((await loadStarCatalog(fetchFn)).count).toBe(2549);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("the stars' look", () => {
  it("sizes and gains stars by magnitude within the design's bands", () => {
    expect(starSizePx(-1.46)).toBeCloseTo(6.0, 0);
    expect(starSizePx(3)).toBeCloseTo(2.2, 6);
    expect(starSizePx(5.5)).toBe(1.5);
    expect(starGain(-1.5)).toBe(2.5);
    expect(starGain(2)).toBeCloseTo(1, 9);
    expect(starGain(5.5)).toBeCloseTo(0.2, 9);
  });
  it("keeps faint stars nearly white and lets bright ones show their colour", () => {
    expect(colourSaturation(4)).toBeCloseTo(0.35, 9);
    expect(colourSaturation(0)).toBeCloseTo(0.85, 9);
    const faintRed = starColour(1.8, 4.5);
    const brightRed = starColour(1.8, 0.5);
    expect(brightRed[2]).toBeLessThan(faintRed[2]); // more orange when bright
    expect(faintRed[2]).toBeGreaterThan(0.6);
    const blue = starColour(-0.2, 0.1);
    expect(blue[2]).toBeGreaterThanOrEqual(blue[0]); // Rigel blue-white
    for (const c of [faintRed, brightRed, blue, starColour(Number.NaN, 3)]) expect(Math.max(...c)).toBeCloseTo(1, 6);
  });
});
