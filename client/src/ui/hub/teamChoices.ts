import { TEAM_COLORS, TEAM_MAX, TEAM_NAMES } from "@caysonverse/shared/escape/constants";
import { freeCombos, type TeamCombo } from "@caysonverse/shared/escape/teams";
import type { TeamRow } from "../../stores/classStore";

/**
 * The team panel's pure parts (AI 학교 탈출, Task 16): which (name, colour) pairs a new team may
 * still take, and what the 들어가기 button does on each row. The pair rule is the SHARED
 * `freeCombos` (ruling E17) — the server judges a create with the same function, so a chip the
 * panel lets you pick is one the server accepts (unless someone took it a moment ago).
 */

/** The pairs the class's teams already use. */
export function usedCombos(teams: readonly Pick<TeamRow, "nameIndex" | "colorIndex">[]): TeamCombo[] {
  return teams.map((t) => ({ nameIndex: t.nameIndex, colorIndex: t.colorIndex }));
}

/** Per name: does it still have a free colour? */
export function nameFlags(used: readonly TeamCombo[]): boolean[] {
  const flags = TEAM_NAMES.map(() => false);
  for (const c of freeCombos(used)) flags[c.nameIndex] = true;
  return flags;
}

/** Per colour: is (name, colour) free? */
export function colorFlags(used: readonly TeamCombo[], nameIndex: number): boolean[] {
  const flags = TEAM_COLORS.map(() => false);
  for (const c of freeCombos(used)) if (c.nameIndex === nameIndex) flags[c.colorIndex] = true;
  return flags;
}

/**
 * The choice to show: `want` while it is still free; else the lowest free colour of the same name;
 * else the first free pair; null when every pair is taken (a class never gets near: 96 pairs, 50 teams).
 */
export function resolveCombo(used: readonly TeamCombo[], want: TeamCombo | null): TeamCombo | null {
  const free = freeCombos(used);
  if (free.length === 0) return null;
  if (want) {
    const same = free.find((c) => c.nameIndex === want.nameIndex && c.colorIndex === want.colorIndex);
    if (same) return same;
    // The same name's lowest free colour (predictable for the chips), before any other name.
    let sameName: TeamCombo | null = null;
    for (const c of free) {
      if (c.nameIndex === want.nameIndex && (sameName === null || c.colorIndex < sameName.colorIndex)) sameName = c;
    }
    if (sameName) return sameName;
  }
  return free[0];
}

/** A name chip tapped: keep the colour if that pair is free, else the name's first free colour. */
export function pickName(used: readonly TeamCombo[], current: TeamCombo, nameIndex: number): TeamCombo {
  return resolveCombo(used, { nameIndex, colorIndex: current.colorIndex }) ?? current;
}

/** A colour chip tapped: only a free colour of the current name changes the choice. */
export function pickColor(used: readonly TeamCombo[], current: TeamCombo, colorIndex: number): TeamCombo {
  return colorFlags(used, current.nameIndex)[colorIndex] ? { nameIndex: current.nameIndex, colorIndex } : current;
}

/** What the team row's button does: join, "full", my own team, or "other" (I already have a team). */
export type JoinState = "join" | "full" | "mine" | "other";

export function joinState(team: TeamRow, iHaveTeam: boolean): JoinState {
  if (team.mine) return "mine";
  if (iHaveTeam) return "other";
  return team.members.length >= TEAM_MAX ? "full" : "join";
}
