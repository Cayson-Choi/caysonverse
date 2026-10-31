import { describe, expect, it } from "vitest";
import { DECLUTTER, NAMETAG_CAP, NAMETAG_FADE_END } from "./constants";
import {
  declutter,
  roundRobinIndices,
  selectNametags,
  type NametagCandidate,
  type TagRect,
} from "./nametagSelect";

const cand = (i: number, o: Partial<NametagCandidate> = {}): NametagCandidate => ({
  id: `p${String(i).padStart(3, "0")}`,
  dist: 1 + i * 0.2,
  onScreen: true,
  speaking: false,
  pinned: false,
  ...o,
});

describe("selectNametags", () => {
  it("uses the spec cap of 15", () => {
    expect(NAMETAG_CAP).toBe(15);
  });

  it("100 on-screen students → exactly the 15 nearest", () => {
    const s = selectNametags(Array.from({ length: 100 }, (_, i) => cand(i)), "nearby");
    expect(s.size).toBe(15);
    expect(s.has("p000")).toBe(true);
    expect(s.has("p015")).toBe(false);
  });

  it("adds far speakers and teachers on top of the nearest 15", () => {
    const c = Array.from({ length: 100 }, (_, i) => cand(i));
    c[90] = cand(90, { speaking: true });
    c[95] = cand(95, { pinned: true });
    const s = selectNametags(c, "nearby");
    expect(s.size).toBe(17);
    expect(s.has("p090") && s.has("p095")).toBe(true);
  });

  it("a speaker or teacher who is already among the nearest 15 does not take an extra slot", () => {
    const c = Array.from({ length: 40 }, (_, i) => cand(i));
    c[2] = cand(2, { speaking: true });
    c[3] = cand(3, { pinned: true });
    expect(selectNametags(c, "nearby").size).toBe(15);
  });

  it("never shows off-screen or ≥ 30 m candidates, even speakers", () => {
    const c = [
      cand(0, { id: "near" }),
      cand(1, { id: "offscreen-speaker", onScreen: false, speaking: true }),
      cand(2, { id: "offscreen-teacher", onScreen: false, pinned: true }),
      cand(3, { id: "far-speaker", dist: NAMETAG_FADE_END, speaking: true }),
      cand(4, { id: "farther-teacher", dist: NAMETAG_FADE_END + 20, pinned: true }),
      cand(5, { id: "just-in-range", dist: NAMETAG_FADE_END - 0.01, speaking: true }),
    ];
    for (const mode of ["nearby", "all"] as const) {
      const s = selectNametags(c, mode);
      expect([...s].sort()).toEqual(["just-in-range", "near"]);
    }
  });

  it("mode 'all' keeps every eligible; mode 'off' shows none", () => {
    const c = Array.from({ length: 100 }, (_, i) => cand(i, { dist: 1 + i * 0.25 }));
    const all = selectNametags(c, "all");
    // dist = 1 + 0.25 i < 30  ⇔  i < 116 → all 100 are in range.
    expect(all.size).toBe(100);
    const withFar = [...c, cand(200, { dist: 45 }), cand(201, { onScreen: false })];
    expect(selectNametags(withFar, "all").size).toBe(100);
    expect(selectNametags(withFar, "off").size).toBe(0);
    // Even a speaker or the teacher is hidden in "off".
    expect(
      selectNametags([cand(0, { speaking: true }), cand(1, { pinned: true })], "off").size,
    ).toBe(0);
  });

  it("breaks distance ties by id, so the choice is stable whatever the input order", () => {
    const tied = Array.from({ length: 20 }, (_, i) => cand(i, { dist: 5 }));
    const a = selectNametags(tied, "nearby");
    const b = selectNametags([...tied].reverse(), "nearby");
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.has("p014") && !a.has("p015")).toBe(true);
  });

  it("honours a custom cap and an empty candidate list", () => {
    const c = Array.from({ length: 10 }, (_, i) => cand(i));
    expect(selectNametags(c, "nearby", 3).size).toBe(3);
    expect(selectNametags([], "nearby").size).toBe(0);
  });
});

describe("declutter", () => {
  const a: TagRect = { id: "a", x: 100, y: 100, w: 80, h: 20, dist: 5 };
  const b: TagRect = { ...a, id: "b", x: 110, dist: 6 };
  const c: TagRect = { ...a, id: "c", x: 105, dist: 7 };

  it("separate tags stay put; the farther of two overlapping lifts by h + gap; a third stacks above both", () => {
    const l = declutter([c, b, a]);
    expect(l.get("a")).toBe(0);
    expect(l.get("b")).toBe(22);
    expect(l.get("c")).toBe(44);
  });

  it("tags that do not overlap are never lifted", () => {
    const apartX: TagRect = { ...a, id: "x", x: 300 }; // 200 px to the right
    const apartY: TagRect = { ...a, id: "y", y: 160 }; // 60 px lower
    const l = declutter([a, apartX, apartY]);
    expect([l.get("a"), l.get("x"), l.get("y")]).toEqual([0, 0, 0]);
  });

  it("the nearer tag keeps its place whatever order the rects arrive in", () => {
    const forward = declutter([a, b]);
    const backward = declutter([b, a]);
    expect(forward.get("a")).toBe(0);
    expect(backward.get("a")).toBe(0);
    expect(backward.get("b")).toBe(22);
  });

  it("a lifted tag clears its neighbour by the gap, and touching tags count as overlapping", () => {
    // b needs 22 = h (20) + gap (2): lifted once it sits exactly gapPx clear of a.
    expect(declutter([a, b], 3, 2).get("b")).toBe(22);
    // With a bigger gap the step grows with it.
    expect(declutter([a, b], 3, 6).get("b")).toBe(26);
    // A tag exactly adjacent (no gap) still counts as touching → it moves.
    const flush: TagRect = { ...a, id: "f", y: 120, dist: 6 };
    expect(declutter([a, flush], 3, 2).get("f")).toBeGreaterThan(0);
  });

  it("gives up after maxSteps lifts (bounded work)", () => {
    const pile: TagRect[] = Array.from({ length: 12 }, (_, i) => ({
      id: `t${String(i).padStart(2, "0")}`,
      x: 100,
      y: 100,
      w: 80,
      h: 20,
      dist: 5 + i,
    }));
    const l = declutter(pile);
    const maxLift = DECLUTTER.maxSteps * (20 + DECLUTTER.gapPx);
    for (const lift of l.values()) expect(lift).toBeLessThanOrEqual(maxLift);
    expect(l.get("t00")).toBe(0);
    expect(l.get("t03")).toBe(maxLift); // the 4th tag in the pile has used up its 3 steps
    expect(l.get("t11")).toBe(maxLift); // …and every later one stops there too
    // A tighter bound is honoured as given.
    expect(declutter(pile, 1).get("t11")).toBe(22);
    expect(declutter(pile, 0).get("t11")).toBe(0);
  });

  it("handles an empty list", () => {
    expect(declutter([]).size).toBe(0);
  });
});

describe("roundRobinIndices", () => {
  it("visits every label and wraps", () => {
    const out: number[] = [];
    expect(roundRobinIndices(out, 8, 10, 8)).toBe(8);
    expect(out.slice(0, 8)).toEqual([8, 9, 0, 1, 2, 3, 4, 5]);
    expect(roundRobinIndices(out, 0, 0, 8)).toBe(0);
  });

  it("covers all labels over successive frames, each exactly once per lap", () => {
    const out: number[] = [];
    const total = 20;
    const seen = new Array<number>(total).fill(0);
    let cursor = 0;
    for (let frame = 0; frame < 5; frame++) {
      const n = roundRobinIndices(out, cursor, total, 8);
      for (let i = 0; i < n; i++) seen[out[i]]++;
      cursor = (cursor + n) % total;
    }
    // 5 frames × 8 = 40 visits = exactly two laps of 20.
    expect(seen.every((v) => v === 2)).toBe(true);
  });

  it("with fewer labels than the budget, visits each one once and writes only total", () => {
    const out: number[] = [99, 99, 99, 99, 99, 99, 99, 99];
    expect(roundRobinIndices(out, 2, 3, 8)).toBe(3);
    expect(out.slice(0, 3)).toEqual([2, 0, 1]);
    expect(out[3]).toBe(99); // beyond n is left alone
  });

  it("a stale cursor beyond the label count (a label left) still lands in range", () => {
    const out: number[] = [];
    expect(roundRobinIndices(out, 27, 10, 3)).toBe(3);
    expect(out.slice(0, 3)).toEqual([7, 8, 9]);
  });

  it("does nothing for a zero budget", () => {
    expect(roundRobinIndices([], 0, 10, 0)).toBe(0);
  });
});
