import { describe, expect, it } from "vitest";
import { parseKstTime } from "@caysonverse/shared/village/sunClock";
import {
  STAR_PROGRESS_KEY,
  foundDateText,
  kstIso,
  loadStarProgress,
  markFound,
  normalizeStarProgress,
  saveStarProgress,
  seasonCounts,
} from "./starProgress";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("the finder's progress on this device", () => {
  it("starts empty, and survives a save and a load", () => {
    const s = memory();
    expect(loadStarProgress(s)).toEqual({ found: {}, showFound: false });
    const t = parseKstTime("2026-11-10T21:03")!;
    const p = markFound(markFound(loadStarProgress(s), "Cas", t), "polaris", t + 60_000);
    saveStarProgress({ ...p, showFound: true }, s);
    expect(JSON.parse(s.data[STAR_PROGRESS_KEY]!)).toEqual({
      found: { Cas: "2026-11-10T21:03:00+09:00", polaris: "2026-11-10T21:04:00+09:00" },
      showFound: true,
    });
    expect(loadStarProgress(s)).toEqual({ found: p.found, showFound: true });
  });

  it("keeps the first date and ignores unknown ids", () => {
    const t = parseKstTime("2026-11-10T21:03")!;
    const p = markFound({ found: {}, showFound: false }, "Cas", t);
    expect(markFound(p, "Cas", t + 86_400_000)).toBe(p);
    expect(markFound(p, "Xyz", t)).toBe(p);
  });

  it("falls back on broken storage, field by field", () => {
    expect(loadStarProgress(memory({ [STAR_PROGRESS_KEY]: "{not json" }))).toEqual({ found: {}, showFound: false });
    expect(normalizeStarProgress({ found: { Cas: "2026-11-10", Nope: "x", UMa: 5 }, showFound: "yes" })).toEqual({
      found: { Cas: "2026-11-10" },
      showFound: false,
    });
    expect(normalizeStarProgress([1, 2])).toEqual({ found: {}, showFound: false });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadStarProgress(throwing)).toEqual({ found: {}, showFound: false });
    expect(() => saveStarProgress({ found: {}, showFound: true }, throwing)).not.toThrow();
    expect(loadStarProgress(null)).toEqual({ found: {}, showFound: false });
  });

  it("counts per season: spring 7, summer 7, autumn 6, winter 8, north 3", () => {
    const c = seasonCounts({ found: { Cas: "x", Peg: "y", UMi: "z" } });
    expect(c.autumn).toEqual({ found: 2, total: 6 });
    expect(c.north).toEqual({ found: 1, total: 3 });
    expect(c.spring).toEqual({ found: 0, total: 7 });
    expect(c.summer.total).toBe(7);
    expect(c.winter.total).toBe(8);
  });

  it("writes Korean dates", () => {
    expect(kstIso(Date.parse("2026-11-10T12:03:00Z"))).toBe("2026-11-10T21:03:00+09:00");
    expect(kstIso(Date.parse("2026-11-30T15:30:00Z"))).toBe("2026-12-01T00:30:00+09:00");
    expect(foundDateText("2026-11-10T21:03:00+09:00")).toBe("11월 10일");
    expect(foundDateText("garbage")).toBe("");
  });
});
