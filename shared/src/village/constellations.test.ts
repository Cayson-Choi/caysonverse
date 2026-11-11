import { describe, expect, it } from "vitest";
import {
  SEASON_ORDER,
  SKY_FIGURES,
  STAR_NAMES,
  allFigureStars,
  figureById,
  figureStars,
  figureTitle,
  whenToLook,
} from "./constellations";

describe("the finder's figures", () => {
  it("are 31 targets: spring 7, summer 7, autumn 6, winter 8, the northern sky 3", () => {
    expect(SKY_FIGURES).toHaveLength(31);
    const per = Object.fromEntries(SEASON_ORDER.map((s) => [s, SKY_FIGURES.filter((f) => f.season === s).length]));
    expect(per).toEqual({ spring: 7, summer: 7, autumn: 6, winter: 8, north: 3 });
    expect(SKY_FIGURES.filter((f) => f.kind === "asterism")).toHaveLength(8);
  });

  it("have unique ids (the progress keys) and 221 lines in all", () => {
    expect(new Set(SKY_FIGURES.map((f) => f.id)).size).toBe(SKY_FIGURES.length);
    expect(SKY_FIGURES.reduce((n, f) => n + f.lines.length, 0)).toBe(221);
  });

  it("have a Korean name, a shape hint and a one-line story each", () => {
    for (const f of SKY_FIGURES) {
      expect(f.name).toMatch(/[가-힣]/);
      expect(f.hint.length).toBeGreaterThan(0);
      expect(f.story).toMatch(/[.!]$/);
      expect(f.evening.altDeg).toBeGreaterThan(0);
    }
  });

  it("draw no degenerate or repeated line", () => {
    for (const f of SKY_FIGURES) {
      const seen = new Set<string>();
      for (const [a, b] of f.lines) {
        expect(a).not.toBe(b);
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        expect(seen.has(key), `${f.id} ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("include the owner's landmarks: Polaris and the Big Dipper's seven stars", () => {
    const dipper = figureById("dipper")!;
    expect(figureStars(dipper).sort((a, b) => a - b)).toEqual([4295, 4301, 4554, 4660, 4905, 5054, 5191]);
    const polaris = figureById("polaris")!;
    expect(polaris.anchorHr).toBe(424);
    expect(polaris.dashed).toBe(true);
    expect(figureStars(polaris)).toContain(424);
    expect(STAR_NAMES[424]).toBe("북극성");
  });

  it("anchor the spring arc on Arcturus, Scorpius on Antares, and ring the Pleiades", () => {
    expect(figureById("springArc")!.anchorHr).toBe(5340);
    expect(figureById("Sco")!.anchorHr).toBe(6134);
    expect(figureById("pleiades")!.ring).toBe(1.2);
    expect(figureTitle(figureById("pleiades")!)).toBe("좀생이별 (플레이아데스)");
  });

  it("use 197 distinct catalogue stars, every anchor among them", () => {
    const all = allFigureStars();
    expect(all).toHaveLength(197);
    for (const f of SKY_FIGURES) if (f.anchorHr !== undefined) expect(figureStars(f)).toContain(f.anchorHr);
  });

  it("say when to look for each one", () => {
    expect(whenToLook(figureById("Ori")!)).toBe("겨울 저녁 남동쪽 하늘 중간쯤");
    expect(whenToLook(figureById("Lyr")!)).toBe("여름 저녁 동쪽 하늘 높이");
    expect(whenToLook(figureById("UMi")!)).toBe("일 년 내내 저녁 북쪽 하늘 중간쯤");
  });
});
