import { describe, expect, it } from "vitest";
import type { Vec3 } from "@caysonverse/shared/village/skyMath";
import {
  AIM_SECONDS,
  aimAllowanceDeg,
  angularRadiusDeg,
  arrowHint,
  clockWords,
  compassWord,
  countText,
  duskWords,
  heightWord,
  isFigureUp,
  meanDirection,
  nextInRanking,
  rankTargets,
  revealOrder,
  showGhost,
  skyShape,
  stepAim,
  whereText,
  type Candidate,
} from "./finderRules";

const RAD = Math.PI / 180;
const dir = (azDeg: number, altDeg: number): Vec3 => [
  Math.sin(azDeg * RAD) * Math.cos(altDeg * RAD),
  Math.sin(altDeg * RAD),
  -Math.cos(azDeg * RAD) * Math.cos(altDeg * RAD),
];
const cand = (id: string, season: Candidate["season"], anchorAltDeg: number, found = false, up = true): Candidate => ({ id, season, anchorAltDeg, found, up });

describe("is a figure up?", () => {
  it("needs its aim point 12° high and 60 % of its stars over the hills (8°)", () => {
    expect(isFigureUp(30, [20, 25, 30])).toBe(true);
    expect(isFigureUp(11.9, [20, 25, 30])).toBe(false);
    expect(isFigureUp(30, [5, 6, 30])).toBe(false); // 1 of 3 above
    expect(isFigureUp(30, [5, 9, 30])).toBe(true); // 2 of 3 = 67 %
    expect(isFigureUp(30, [5, 6, 9, 10, 11])).toBe(true); // 3 of 5 = 60 %
    expect(isFigureUp(30, [])).toBe(false);
  });
});

describe("the aim", () => {
  it("allows 0.3 × the figure's radius, 5-9°", () => {
    expect(aimAllowanceDeg(4)).toBe(5); // Lyra, the Pleiades
    expect(aimAllowanceDeg(20)).toBe(6);
    expect(aimAllowanceDeg(40)).toBe(9); // Ursa Major
  });
  it("fills in one second inside and drains twice as fast outside", () => {
    let p = 0;
    for (let i = 0; i < 30; i++) p = stepAim(p, true, 1 / 60);
    expect(p).toBeCloseTo(0.5, 6);
    p = stepAim(p, false, 0.1);
    expect(p).toBeCloseTo(0.3, 6);
    for (let i = 0; i < 60; i++) p = stepAim(p, true, 1 / 60);
    expect(p).toBe(1);
    expect(stepAim(0.05, false, 1)).toBe(0);
    expect(stepAim(0.5, true, -1)).toBe(0.5);
    expect(AIM_SECONDS).toBe(1);
  });
  it("shows the ghost lines after 20 s", () => {
    expect(showGhost(19.9)).toBe(false);
    expect(showGhost(20)).toBe(true);
  });
});

describe("choosing the target", () => {
  it("starts a first-timer with the Dipper, then Polaris", () => {
    const r = rankTargets([cand("UMa", "spring", 60), cand("dipper", "spring", 59), cand("polaris", "north", 36), cand("Leo", "spring", 40)], "spring");
    expect(r.slice(0, 2)).toEqual(["dipper", "polaris"]);
  });
  it("starts with Cassiopeia when the Dipper is down behind the hills (autumn)", () => {
    const r = rankTargets([cand("dipper", "spring", 9, false, false), cand("Cas", "autumn", 54), cand("polaris", "north", 36), cand("Peg", "autumn", 50)], "autumn");
    expect(r.slice(0, 2)).toEqual(["Cas", "polaris"]);
    expect(r).not.toContain("dipper");
  });
  it("then this season's, the northern sky's, the next season's, the rest, and found ones last", () => {
    const r = rankTargets(
      [
        cand("dipper", "spring", 40, true),
        cand("polaris", "north", 36, true),
        cand("Ori", "winter", 30),
        cand("Peg", "autumn", 70),
        cand("Cas", "autumn", 54),
        cand("Cep", "north", 57),
        cand("Lyr", "summer", 40),
        cand("Ari", "autumn", 38, true),
      ],
      "autumn",
    );
    // Cassiopeia (comfortable 54°) before Pegasus (70°, a stiff neck); then Cepheus; winter (next) before summer
    expect(r).toEqual(["Cas", "Peg", "Cep", "Ori", "Lyr", "dipper", "Ari", "polaris"]);
  });
  it("offers nothing that is not up, and cycles with 다른 별자리", () => {
    expect(rankTargets([cand("Ori", "winter", 5, false, false)], "winter")).toEqual([]);
    expect(nextInRanking(["a", "b", "c"], "b")).toBe("c");
    expect(nextInRanking(["a", "b", "c"], "c")).toBe("a");
    expect(nextInRanking(["a", "b"], "zzz")).toBe("a");
    expect(nextInRanking([], "a")).toBeNull();
  });
});

describe("the hints", () => {
  it("points the edge arrow the way to turn, flags behind and up", () => {
    const right = arrowHint([1, 0, -0.2], 80, false);
    expect(right.show).toBe(true);
    expect(right.angleRad).toBeCloseTo(0, 6);
    expect(right.behind).toBe(false);
    const behind = arrowHint([-0.2, 0, 1], 170, false);
    expect(behind.behind).toBe(true);
    expect(Math.cos(behind.angleRad)).toBeLessThan(0); // turn left
    const overhead = arrowHint([0.01, 0.6, 0.8], 120, false); // behind and high: still "turn round", sideways
    expect(overhead.behind).toBe(true);
    expect(Math.abs(Math.sin(overhead.angleRad))).toBeLessThan(1e-9);
    const up = arrowHint([0.05, 0.9, -0.4], 60, false);
    expect(up.up).toBe(true);
    expect(arrowHint([0.05, 0.05, -1], 4, true).show).toBe(false);
    expect(arrowHint([0.3, 0.3, -1], 26, true).show).toBe(true);
  });
  it("reveals a figure's lines from its brightest star outward", () => {
    // a chain 1-2-3 plus a branch 2-4; star 3 is the brightest
    const mags: Record<number, number> = { 1: 3, 2: 2, 3: 0.5, 4: 4 };
    const order = revealOrder([[1, 2], [2, 3], [2, 4]], (hr) => mags[hr]!);
    expect(order[0]).toBe(1); // the line touching star 3
    expect(order.sort()).toEqual([0, 1, 2]);
    // two pieces: both drawn
    expect(revealOrder([[1, 2], [3, 4]], (hr) => hr).sort()).toEqual([0, 1]);
  });
});

describe("words", () => {
  it("names the compass and the height", () => {
    expect(compassWord(0)).toBe("북");
    expect(compassWord(44)).toBe("북동");
    expect(compassWord(135)).toBe("남동");
    expect(compassWord(350)).toBe("북");
    expect(compassWord(-90)).toBe("서");
    expect(heightWord(10)).toBe("낮게");
    expect(heightWord(40)).toBe("중간쯤");
    expect(heightWord(60)).toBe("높이");
    expect(heightWord(83)).toBe("머리 위");
    expect(whereText(54.4, 40)).toBe("북동쪽 하늘, 중간쯤 (고도 54°)");
    expect(whereText(81, 70)).toBe("머리 위 (고도 81°)");
    expect(countText("가을", 2, 6)).toBe("가을 발견 2/6");
  });
  it("tells when the stars come out", () => {
    expect(clockWords(17, 51)).toBe("오후 5시 51분");
    expect(clockWords(0, 5)).toBe("오전 12시 5분");
    expect(clockWords(12, 0)).toBe("오후 12시");
    const now = { year: 2026, month: 11, day: 10 };
    expect(duskWords(now, { year: 2026, month: 11, day: 10, hour: 17, minute: 51 })).toBe("오늘 오후 5시 51분쯤");
    expect(duskWords(now, { year: 2026, month: 11, day: 11, hour: 17, minute: 50 })).toBe("내일 오후 5시 50분쯤");
    expect(duskWords({ year: 2026, month: 12, day: 31 }, { year: 2027, month: 1, day: 1, hour: 17, minute: 47 })).toBe("내일 오후 5시 47분쯤");
  });
});

describe("the card's little picture", () => {
  it("draws the shape as it stands, the zenith up, in a -1..1 box", () => {
    // three stars on a vertical line in the south: the top one (highest) must come out on top
    const dirs = [dir(180, 20), dir(180, 30), dir(180, 40)];
    const s = skyShape(dirs, [1, 2, 3], [[0, 1], [1, 2]], meanDirection(dirs));
    expect(s.points[2]!.y).toBeGreaterThan(s.points[0]!.y);
    expect(Math.abs(s.points[0]!.x - s.points[2]!.x)).toBeLessThan(1e-6);
    for (const p of s.points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(s.points[0]!.r).toBeGreaterThan(s.points[2]!.r); // brighter = bigger
    // east of the aim is on the right when facing south? facing south, east (az 90) is on the LEFT
    const t = skyShape([dir(170, 30), dir(190, 30)], [1, 1], [[0, 1]], dir(180, 30));
    expect(t.points[0]!.x).toBeLessThan(t.points[1]!.x); // az 170 (toward east) on the left
    // overhead: still a finite picture
    const z = skyShape([dir(0, 89), dir(180, 89)], [1, 1], [[0, 1]], [0, 1, 0]);
    expect(Number.isFinite(z.points[0]!.x + z.points[0]!.y)).toBe(true);
  });
  it("measures a figure's angular radius around its mean", () => {
    const dirs = [dir(90, 10), dir(90, 30)];
    expect(angularRadiusDeg(dirs, meanDirection(dirs))).toBeCloseTo(10, 6);
  });
});
