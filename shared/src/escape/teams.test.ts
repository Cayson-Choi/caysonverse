import { describe, it, expect } from "vitest";
import { TEAM_COLOR_LABELS, TEAM_COLORS, TEAM_NAMES } from "./constants";
import { freeCombos, teamDisplayName } from "./teams";

const ALL = TEAM_NAMES.length * TEAM_COLORS.length; // 96

describe("teamDisplayName", () => {
  it("is the team word plus the colour label in brackets, e.g. 햇살(파랑)", () => {
    expect(teamDisplayName(0, 5)).toBe("햇살(파랑)");
    expect(teamDisplayName(11, 0)).toBe("구름(빨강)");
    expect(teamDisplayName(3, 7)).toBe(`${TEAM_NAMES[3]}(${TEAM_COLOR_LABELS[7]})`);
    // Every (name, colour) pair reads differently.
    const names = new Set<string>();
    for (let n = 0; n < TEAM_NAMES.length; n++) {
      for (let c = 0; c < TEAM_COLORS.length; c++) names.add(teamDisplayName(n, c));
    }
    expect(names.size).toBe(ALL);
  });

  it("falls back to a plain 팀 for an index outside the lists (never undefined in a sentence)", () => {
    expect(teamDisplayName(-1, 0)).toBe("팀");
    expect(teamDisplayName(TEAM_NAMES.length, 0)).toBe("팀");
    expect(teamDisplayName(0, TEAM_COLORS.length)).toBe("팀");
    expect(teamDisplayName(1.5, 0)).toBe("팀");
    expect(teamDisplayName(Number.NaN, 2)).toBe("팀");
  });
});

describe("freeCombos", () => {
  it("with no teams lists every (name, colour) once; the first 12 all have different names, neighbours different colours", () => {
    const combos = freeCombos([]);
    expect(combos).toHaveLength(ALL);
    expect(new Set(combos.map((c) => `${c.nameIndex}/${c.colorIndex}`)).size).toBe(ALL);
    for (const c of combos) {
      expect(Number.isInteger(c.nameIndex) && c.nameIndex >= 0 && c.nameIndex < TEAM_NAMES.length).toBe(true);
      expect(Number.isInteger(c.colorIndex) && c.colorIndex >= 0 && c.colorIndex < TEAM_COLORS.length).toBe(true);
    }
    // Children tell teams apart by the word first: the first round uses each name once.
    expect(new Set(combos.slice(0, TEAM_NAMES.length).map((c) => c.nameIndex)).size).toBe(TEAM_NAMES.length);
    for (let i = 1; i < combos.length; i++) expect(combos[i].colorIndex).not.toBe(combos[i - 1].colorIndex);
    expect(combos.slice(0, 3)).toEqual([
      { nameIndex: 0, colorIndex: 0 },
      { nameIndex: 1, colorIndex: 1 },
      { nameIndex: 2, colorIndex: 2 },
    ]);
  });

  it("leaves out the combos in use and keeps the order of the rest", () => {
    const all = freeCombos([]);
    const used = [all[0], all[5], { nameIndex: 7, colorIndex: 2 }];
    const free = freeCombos(used);
    expect(free).toHaveLength(ALL - 3);
    for (const u of used) {
      expect(free.some((c) => c.nameIndex === u.nameIndex && c.colorIndex === u.colorIndex)).toBe(false);
    }
    expect(free).toEqual(all.filter((c) => !used.some((u) => u.nameIndex === c.nameIndex && u.colorIndex === c.colorIndex)));
    // A team list with a duplicate (should never happen) still removes the combo once.
    expect(freeCombos([all[0], all[0]])).toHaveLength(ALL - 1);
  });

  it("is empty when every combo is taken", () => {
    expect(freeCombos(freeCombos([]))).toEqual([]);
  });
});
