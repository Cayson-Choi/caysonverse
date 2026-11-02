/**
 * Tests for e2e/luma-check.mjs (plain node, no dependencies): the PNG decoder, the relative-luminance math and
 * the pass rule (mean >= 0.45, 5th percentile >= 0.10). The script is loaded with a dynamic import and also run
 * as a CLI on generated PNG files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "e2e", "luma-check.mjs");

interface LumaModule {
  MEAN_MIN: number;
  P5_MIN: number;
  srgbToLinear(v8: number): number;
  relativeLuminance(r: number, g: number, b: number): number;
  percentile(sortedAscending: ArrayLike<number>, p: number): number;
  decodePng(buf: Uint8Array): { width: number; height: number; rgba: Uint8Array };
  lumaStats(rgba: Uint8Array): { mean: number; p5: number };
  passes(stats: { mean: number; p5: number }): boolean;
  expandArg(arg: string): string[];
}

let luma: LumaModule;
let tmp = "";

// ---------------------------------------------------------------------------------------------------------
// A small PNG encoder for the fixtures.

function crc32(buf: Buffer): number {
  return zlib.crc32(buf);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

interface PngOptions {
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  depth?: 1 | 2 | 4 | 8 | 16;
  /** The raw (unfiltered) scanlines, one Buffer per row. */
  rows: Buffer[];
  /** PNG filter type per row (0..4); defaults to 0. */
  filters?: number[];
  palette?: Buffer;
  interlace?: 0 | 1;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;

function encodePng(o: PngOptions): Buffer {
  const depth = o.depth ?? 8;
  const bpp = Math.max(1, (CHANNELS[o.colorType] * depth) / 8);
  const raw: Buffer[] = [];
  let prev: Buffer = Buffer.alloc(o.rows[0]!.length);
  o.rows.forEach((row, y) => {
    const f = o.filters?.[y] ?? 0;
    const out = Buffer.alloc(row.length);
    for (let i = 0; i < row.length; i += 1) {
      const a = i >= bpp ? row[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let predict = 0;
      if (f === 1) predict = a;
      else if (f === 2) predict = b;
      else if (f === 3) predict = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = (row[i]! - predict) & 0xff;
    }
    raw.push(Buffer.from([f]), out);
    prev = row;
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(o.width, 0);
  ihdr.writeUInt32BE(o.height, 4);
  ihdr[8] = depth;
  ihdr[9] = o.colorType;
  ihdr[12] = o.interlace ?? 0;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (o.palette) parts.push(chunk("PLTE", o.palette));
  parts.push(chunk("IDAT", zlib.deflateSync(Buffer.concat(raw))), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** A solid RGB image. */
function solidPng(r: number, g: number, b: number, w = 8, h = 8, filters?: number[]): Buffer {
  const row = Buffer.alloc(w * 3);
  for (let x = 0; x < w; x += 1) row.set([r, g, b], x * 3);
  return encodePng({ width: w, height: h, colorType: 2, rows: Array.from({ length: h }, () => row), filters });
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-luma-"));
  luma = (await import(pathToFileURL(SCRIPT).href)) as LumaModule;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------

describe("luminance math", () => {
  it("pins the plan thresholds", () => {
    expect(luma.MEAN_MIN).toBe(0.45);
    expect(luma.P5_MIN).toBe(0.1);
  });

  it("decodes sRGB to linear light (the WCAG curve)", () => {
    expect(luma.srgbToLinear(0)).toBe(0);
    expect(luma.srgbToLinear(255)).toBeCloseTo(1, 12);
    expect(luma.srgbToLinear(128)).toBeCloseTo(0.2158605, 6); // mid grey is dark in linear light
    expect(luma.srgbToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 9); // the linear toe
  });

  it("is Rec.709 relative luminance of linearised sRGB", () => {
    expect(luma.relativeLuminance(255, 255, 255)).toBeCloseTo(1, 12);
    expect(luma.relativeLuminance(0, 0, 0)).toBe(0);
    expect(luma.relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 6);
    expect(luma.relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 6);
    expect(luma.relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 6);
    expect(luma.relativeLuminance(128, 128, 128)).toBeCloseTo(0.2158605, 6);
  });

  it("percentile interpolates linearly like numpy.percentile", () => {
    const v = [0, 10, 20, 30, 40];
    expect(luma.percentile(v, 0)).toBe(0);
    expect(luma.percentile(v, 100)).toBe(40);
    expect(luma.percentile(v, 50)).toBe(20);
    expect(luma.percentile(v, 5)).toBeCloseTo(2, 12); // index 0.2 -> 0 + 0.2 * 10
    expect(luma.percentile([7], 5)).toBe(7);
  });

  it("computes the mean and the 5th percentile over the pixels (alpha is ignored)", () => {
    // 20 pixels: 10 white, 10 black -> mean 0.5; the lowest 5% is black -> p5 0.
    const rgba = new Uint8Array(20 * 4);
    for (let i = 0; i < 20; i += 1) rgba.set(i < 10 ? [255, 255, 255, 255] : [0, 0, 0, 7], i * 4);
    const s = luma.lumaStats(rgba);
    expect(s.mean).toBeCloseTo(0.5, 9);
    expect(s.p5).toBe(0);
    // 100 pixels, 5 black: the 5th percentile interpolates between black and white.
    const mostlyWhite = new Uint8Array(100 * 4).fill(255);
    for (let i = 0; i < 5; i += 1) mostlyWhite.set([0, 0, 0, 255], i * 4);
    const s2 = luma.lumaStats(mostlyWhite);
    expect(s2.mean).toBeCloseTo(0.95, 9);
    expect(s2.p5).toBeCloseTo(0.95, 9); // index 4.95 of 99: 95% of the way from the last black pixel to the first white one
  });

  it("passes at exactly mean 0.45 and p5 0.10, and fails just below either", () => {
    expect(luma.passes({ mean: 0.45, p5: 0.1 })).toBe(true);
    expect(luma.passes({ mean: 0.4499, p5: 0.5 })).toBe(false);
    expect(luma.passes({ mean: 0.9, p5: 0.0999 })).toBe(false);
  });
});

describe("decodePng", () => {
  it("decodes 8-bit RGB and RGBA", () => {
    const rgb = luma.decodePng(solidPng(10, 20, 30, 3, 2));
    expect([rgb.width, rgb.height]).toEqual([3, 2]);
    expect(Array.from(rgb.rgba.subarray(0, 8))).toEqual([10, 20, 30, 255, 10, 20, 30, 255]);

    const row = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const rgba = luma.decodePng(encodePng({ width: 2, height: 1, colorType: 6, rows: [row] }));
    expect(Array.from(rgba.rgba)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("undoes every filter type (none, sub, up, average, paeth) on a non-trivial picture", () => {
    const w = 7;
    const h = 5;
    const rows = Array.from({ length: h }, (_, y) => {
      const r = Buffer.alloc(w * 3);
      for (let i = 0; i < r.length; i += 1) r[i] = (i * 37 + y * 91 + (i % 5) * y * 13) & 0xff;
      return r;
    });
    for (const filter of [0, 1, 2, 3, 4]) {
      const png = encodePng({ width: w, height: h, colorType: 2, rows, filters: rows.map(() => filter) });
      const got = luma.decodePng(png);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const o = (y * w + x) * 4;
          expect(Array.from(got.rgba.subarray(o, o + 4))).toEqual([rows[y]![x * 3]!, rows[y]![x * 3 + 1]!, rows[y]![x * 3 + 2]!, 255]);
        }
      }
    }
    // A different filter on every row.
    const mixed = encodePng({ width: w, height: h, colorType: 2, rows, filters: [1, 2, 3, 4, 0] });
    expect(Array.from(luma.decodePng(mixed).rgba.subarray(0, 4))).toEqual([rows[0]![0]!, rows[0]![1]!, rows[0]![2]!, 255]);
  });

  it("decodes greyscale, grey+alpha and 16-bit (high byte)", () => {
    const grey = luma.decodePng(encodePng({ width: 2, height: 1, colorType: 0, rows: [Buffer.from([0, 200])] }));
    expect(Array.from(grey.rgba)).toEqual([0, 0, 0, 255, 200, 200, 200, 255]);
    const ga = luma.decodePng(encodePng({ width: 1, height: 1, colorType: 4, rows: [Buffer.from([90, 40])] }));
    expect(Array.from(ga.rgba)).toEqual([90, 90, 90, 40]);
    const deep = luma.decodePng(
      encodePng({ width: 1, height: 1, colorType: 2, depth: 16, rows: [Buffer.from([0x12, 0x34, 0xab, 0xcd, 0xff, 0x00])] }),
    );
    expect(Array.from(deep.rgba)).toEqual([0x12, 0xab, 0xff, 255]);
  });

  it("decodes palette images at 8 and 2 bits per pixel", () => {
    const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    const p8 = luma.decodePng(encodePng({ width: 3, height: 1, colorType: 3, rows: [Buffer.from([0, 1, 2])], palette }));
    expect(Array.from(p8.rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    // 2-bit: pixels 3,2,1,0 in one byte 0b11100100.
    const p2 = luma.decodePng(encodePng({ width: 4, height: 1, colorType: 3, depth: 2, rows: [Buffer.from([0b11100100])], palette }));
    expect(Array.from(p2.rgba)).toEqual([9, 9, 9, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]);
  });

  it("rejects non-PNG data, truncated data and interlaced images with a clear message", () => {
    expect(() => luma.decodePng(Buffer.from("hello world, not a png"))).toThrow(/PNG/);
    const good = solidPng(1, 2, 3);
    expect(() => luma.decodePng(good.subarray(0, 40))).toThrow();
    const row = Buffer.alloc(6);
    expect(() => luma.decodePng(encodePng({ width: 2, height: 1, colorType: 2, rows: [row], interlace: 1 }))).toThrow(/interlace|인터레이스/);
  });
});

describe("expandArg", () => {
  it("expands * and ? in the file name, sorted, and leaves a plain name alone", () => {
    for (const n of ["style-b.png", "style-a.png", "other.png"]) fs.writeFileSync(path.join(tmp, n), "x");
    expect(luma.expandArg(path.join(tmp, "style-*.png")).map((p) => path.basename(p))).toEqual(["style-a.png", "style-b.png"]);
    expect(luma.expandArg(path.join(tmp, "style-?.png")).map((p) => path.basename(p))).toEqual(["style-a.png", "style-b.png"]);
    expect(luma.expandArg(path.join(tmp, "plain.png"))).toEqual([path.join(tmp, "plain.png")]);
    // A pattern that matches nothing is kept, so the run reports it as a missing file.
    expect(luma.expandArg(path.join(tmp, "nothing-*.png"))).toEqual([path.join(tmp, "nothing-*.png")]);
  });
});

describe("e2e/luma-check.mjs CLI", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  it("passes a bright image (exit 0) and prints mean and p5", () => {
    const file = path.join(tmp, "bright.png");
    fs.writeFileSync(file, solidPng(240, 235, 225, 16, 16));
    const res = run(file);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/PASS/);
    expect(res.stdout).toMatch(/mean=0\.\d{3}/);
    expect(res.stdout).toMatch(/p5=0\.\d{3}/);
  });

  it("fails a dark image (exit 1), and fails as soon as one of several images fails", () => {
    const dark = path.join(tmp, "dark.png");
    const bright = path.join(tmp, "bright.png");
    fs.writeFileSync(dark, solidPng(30, 30, 40));
    fs.writeFileSync(bright, solidPng(250, 250, 250));
    expect(run(dark).status).toBe(1);
    const both = run(bright, dark);
    expect(both.status).toBe(1);
    expect(both.stdout).toMatch(/PASS[^\n]*bright\.png/);
    expect(both.stdout).toMatch(/FAIL[^\n]*dark\.png/);
  });

  it("fails an image that is bright on average but has a dark corner (p5 rule)", () => {
    const w = 20;
    const h = 20;
    // 90% white, 10% black pixels: mean about 0.9 but the 5th percentile is black.
    const rows = Array.from({ length: h }, (_, y) => {
      const r = Buffer.alloc(w * 3, 255);
      if (y < 2) r.fill(0);
      return r;
    });
    const file = path.join(tmp, "corner.png");
    fs.writeFileSync(file, encodePng({ width: w, height: h, colorType: 2, rows }));
    const res = run(file);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/FAIL/);
  });

  it("expands a quoted glob itself (PowerShell does not)", () => {
    fs.writeFileSync(path.join(tmp, "style-a.png"), solidPng(250, 250, 250));
    fs.writeFileSync(path.join(tmp, "style-b.png"), solidPng(245, 245, 245));
    const res = run(path.join(tmp, "style-*.png"));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("style-a.png");
    expect(res.stdout).toContain("style-b.png");
  });

  it("fails with exit 1 on a missing file, an unreadable file and no arguments", () => {
    expect(run(path.join(tmp, "missing.png")).status).toBe(1);
    const junk = path.join(tmp, "junk.png");
    fs.writeFileSync(junk, "not a png");
    const res = run(junk);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain("junk.png");
    expect(run().status).toBe(1);
  });
});
