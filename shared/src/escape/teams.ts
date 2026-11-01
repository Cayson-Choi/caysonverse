/**
 * "AI 학교 탈출" — the pure team helpers both sides need (ruling E17): which (name, colour)
 * combinations are still free, and how a team's name reads. Browser-safe: plain values only, no
 * server imports. The server's team rules (create / join / leave, auto-assign, door-pad status)
 * live in server/src/class/teams.ts and use these; the client's team panel (Task 16) reuses them.
 */

import { TEAM_COLOR_LABELS, TEAM_COLORS, TEAM_NAMES } from "./constants";

/** A team's look: an index into TEAM_NAMES and one into TEAM_COLORS / TEAM_COLOR_LABELS. */
export interface TeamCombo {
  nameIndex: number;
  colorIndex: number;
}

function isIndex(v: number, length: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < length;
}

/**
 * The name everybody reads, e.g. "햇살(파랑)": the team word plus the colour's label (a team is
 * never told apart by colour alone). An index outside the lists reads as a plain "팀".
 */
export function teamDisplayName(nameIndex: number, colorIndex: number): string {
  if (!isIndex(nameIndex, TEAM_NAMES.length) || !isIndex(colorIndex, TEAM_COLORS.length)) return "팀";
  return `${TEAM_NAMES[nameIndex]}(${TEAM_COLOR_LABELS[colorIndex]})`;
}

/**
 * Every (name, colour) pair in one fixed order: round r (0..7) pairs name n with colour (n + r) % 8.
 * So the first 12 combos use 12 different team words, consecutive combos never share a colour, and
 * each round still covers every name once — all 96 pairs exactly once.
 */
const COMBO_ORDER: readonly TeamCombo[] = (() => {
  const out: TeamCombo[] = [];
  for (let round = 0; round < TEAM_COLORS.length; round++) {
    for (let n = 0; n < TEAM_NAMES.length; n++) {
      out.push({ nameIndex: n, colorIndex: (n + round) % TEAM_COLORS.length });
    }
  }
  return out;
})();

/** The (name, colour) pairs no team in `teams` uses, in COMBO_ORDER (new objects, safe to keep). */
export function freeCombos(teams: readonly TeamCombo[]): TeamCombo[] {
  const used = new Set<number>();
  for (const t of teams) used.add(t.nameIndex * TEAM_COLORS.length + t.colorIndex);
  const out: TeamCombo[] = [];
  for (const c of COMBO_ORDER) {
    if (!used.has(c.nameIndex * TEAM_COLORS.length + c.colorIndex)) {
      out.push({ nameIndex: c.nameIndex, colorIndex: c.colorIndex });
    }
  }
  return out;
}
