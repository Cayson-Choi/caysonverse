// Jua 글꼴 부분집합(Task 7b): 조립실이 Jua로 그리는 고정 글자(BUILDER_FONT_TEXT)가 모두 글자 목록에 있고,
// 배포하는 WOFF의 cmap에 정말 들어 있는가. 글자 목록과 WOFF는 scripts/subset-builder-font.mjs가 함께 만든다.
// 문구를 바꾸고 스크립트를 다시 돌리지 않으면 여기서 실패한다.

import { readFileSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BUILDER_FONT_TEXT } from "./builderOptions";

const GLYPHS_URL = new URL("./builderFont.glyphs.json", import.meta.url);

/** 스크립트가 쓴 목록: glyphs = WOFF에 남긴 글자, fallback = Jua에 없어 다음 글꼴이 그리는 글자(예: "…"). */
function glyphList(): { glyphs: string[]; fallback: string[] } {
  const raw = JSON.parse(readFileSync(GLYPHS_URL, "utf8")) as { glyphs: string; fallback: string };
  return { glyphs: Array.from(raw.glyphs), fallback: Array.from(raw.fallback) };
}
const WOFF_URL = new URL("../../public/fonts/jua-builder.woff", import.meta.url);
const OFL_URL = new URL("../../public/fonts/OFL-Jua.txt", import.meta.url);

/** WOFF 1.0에서 표 하나를 꺼낸다(zlib으로 눌려 있으면 푼다). */
function woffTable(woff: Buffer, tag: string): Buffer {
  if (woff.toString("latin1", 0, 4) !== "wOFF") throw new Error("not a WOFF 1.0 file");
  const numTables = woff.readUInt16BE(12);
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    if (woff.toString("latin1", at, at + 4) !== tag) continue;
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const data = woff.subarray(offset, offset + compLength);
    return compLength < origLength ? inflateSync(data) : Buffer.from(data);
  }
  throw new Error(`no ${tag} table`);
}

/** cmap의 유니코드 하위 표(형식 4·12)에서 글리프가 있는 코드 포인트 전부. */
function cmapCodePoints(cmap: Buffer): Set<number> {
  const out = new Set<number>();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const sub = cmap.subarray(cmap.readUInt32BE(8 + i * 8));
    const format = sub.readUInt16BE(0);
    if (format === 4) {
      const segCount = sub.readUInt16BE(6) / 2;
      const ends = 14;
      const starts = ends + segCount * 2 + 2;
      const deltas = starts + segCount * 2;
      const ranges = deltas + segCount * 2;
      for (let s = 0; s < segCount; s++) {
        const end = sub.readUInt16BE(ends + s * 2);
        const start = sub.readUInt16BE(starts + s * 2);
        const delta = sub.readInt16BE(deltas + s * 2);
        const rangeOffset = sub.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const at = ranges + s * 2 + rangeOffset + (c - start) * 2;
            const raw = sub.readUInt16BE(at);
            glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
          }
          if (glyph !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = sub.readUInt32BE(12);
      for (let g = 0; g < groups; g++) {
        const start = sub.readUInt32BE(16 + g * 12);
        const end = sub.readUInt32BE(20 + g * 12);
        const glyph = sub.readUInt32BE(24 + g * 12);
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
      }
    }
  }
  return out;
}

const chars = (text: string) => [...new Set(Array.from(text))];

describe("builder font — Jua subset covers the builder's fixed words", () => {
  it("lists every character the builder draws in Jua (re-run scripts/subset-builder-font.mjs after copy changes)", () => {
    const { glyphs, fallback } = glyphList();
    const listed = new Set([...glyphs, ...fallback]);
    const missing = chars(BUILDER_FONT_TEXT).filter((c) => !listed.has(c));
    expect(missing).toEqual([]);
    // The list is exactly what the copy needs (no stale leftovers that bloat the font), each character once.
    expect([...listed].sort()).toEqual(chars(BUILDER_FONT_TEXT).sort());
    expect(glyphs.length + fallback.length).toBe(listed.size);
    // Hangul all comes from Jua; only punctuation like "…" may fall back to the next font.
    expect(fallback.filter((c) => /[가-힣]/.test(c))).toEqual([]);
  });

  it("ships a WOFF whose cmap maps every listed glyph — and nothing else", () => {
    const mapped = cmapCodePoints(woffTable(readFileSync(WOFF_URL), "cmap"));
    const { glyphs, fallback } = glyphList();
    expect(glyphs.filter((c) => !mapped.has(c.codePointAt(0)!))).toEqual([]);
    expect(fallback.filter((c) => mapped.has(c.codePointAt(0)!))).toEqual([]);
    // Nothing else crept in (the full Jua is ~2 MB); fontTools may keep .notdef-like extras only.
    expect(mapped.size).toBeLessThanOrEqual(glyphs.length + 2);
  });

  it("stays small and carries its OFL licence", () => {
    // The brief's target: 25 KB (WOFF; no brotli here for WOFF2).
    expect(statSync(WOFF_URL).size).toBeLessThanOrEqual(25 * 1024);
    expect(readFileSync(OFL_URL, "utf8")).toContain("SIL OPEN FONT LICENSE");
  });
});
