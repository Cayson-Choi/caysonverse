/**
 * Team rules of a class (AI 학교 탈출, Task 6) — pure functions over plain records, so they are
 * tested without a room. ClassRoom turns its synced `Team`s into `TeamRec`s, asks these functions,
 * and writes the answer back into state.
 *
 * The (name, colour) helpers the client also needs (`freeCombos`, `teamDisplayName`) live in
 * shared/src/escape/teams.ts (ruling E17).
 */

import { MAX_TEAMS, TEAM_MAX, TEAM_MIN, TEAM_TARGET, type RoomId } from "@caysonverse/shared/escape/constants";
import { freeCombos, type TeamCombo } from "@caysonverse/shared/escape/teams";

/** A team as these rules see it. `members` are ClassRoom sessionIds, in joining order. */
export interface TeamRec {
  id: string;
  nameIndex: number;
  colorIndex: number;
  members: string[];
  /** The team is inside an escape room (it has a live instance): auto-assign leaves it alone. */
  inEscape: boolean;
}

export type TeamError = { error: string };

/** The refusals a student is told (ClassMsg.Notice), Korean as shown. */
export const TEAM_ERRORS = {
  alreadyInTeam: "이미 팀에 있어요. 먼저 팀에서 나와 주세요",
  comboTaken: "이미 있는 팀 이름과 색이에요",
  teamFull: "팀이 가득 찼어요 (최대 6명)",
  tooManyTeams: "팀을 더 만들 수 없어요",
} as const;

function memberOfAny(teams: readonly TeamRec[], sid: string): boolean {
  for (const t of teams) if (t.members.includes(sid)) return true;
  return false;
}

/**
 * A new one-member team for `sid` with (nameIndex, colorIndex), or why not — checked in this order:
 * already in a team, MAX_TEAMS reached, (name, colour) in use. Does not change `teams`.
 */
export function createTeam(
  teams: readonly TeamRec[],
  sid: string,
  nameIndex: number,
  colorIndex: number,
  newId: string,
): TeamRec | TeamError {
  if (memberOfAny(teams, sid)) return { error: TEAM_ERRORS.alreadyInTeam };
  if (teams.length >= MAX_TEAMS) return { error: TEAM_ERRORS.tooManyTeams };
  if (teams.some((t) => t.nameIndex === nameIndex && t.colorIndex === colorIndex)) {
    return { error: TEAM_ERRORS.comboTaken };
  }
  return { id: newId, nameIndex, colorIndex, members: [sid], inEscape: false };
}

/** Add `sid` at the end of `team.members` (mutates), or why not: already a member, or TEAM_MAX reached. */
export function joinTeam(team: TeamRec, sid: string): TeamError | null {
  if (team.members.includes(sid)) return { error: TEAM_ERRORS.alreadyInTeam };
  if (team.members.length >= TEAM_MAX) return { error: TEAM_ERRORS.teamFull };
  team.members.push(sid);
  return null;
}

/** Remove `sid` from `team.members` (mutates; the others keep their order). `empty`: nobody is left. */
export function leaveTeam(team: TeamRec, sid: string): { empty: boolean } {
  const i = team.members.indexOf(sid);
  if (i >= 0) team.members.splice(i, 1);
  return { empty: team.members.length === 0 };
}

/**
 * How `n` students split into new teams: [] below `min`; otherwise k = max(1, round(n / target))
 * teams, more while a team would exceed `max`; sizes floor(n / k), the first n % k one bigger.
 */
export function partitionSizes(n: number, target = TEAM_TARGET, min = TEAM_MIN, max = TEAM_MAX): number[] {
  if (!Number.isInteger(n) || n < min) return [];
  let k = Math.max(1, Math.round(n / target));
  while (Math.ceil(n / k) > max) k++;
  // Never below `min` per team (cannot happen with the class constants, but keep the promise).
  while (k > 1 && Math.floor(n / k) < min && Math.ceil(n / (k - 1)) <= max) k--;
  const base = Math.floor(n / k);
  const extra = n % k;
  const sizes: number[] = [];
  for (let i = 0; i < k; i++) sizes.push(i < extra ? base + 1 : base);
  return sizes;
}

/** What auto-assign does: put students into existing teams, make new teams, dissolve hub teams (shuffle). */
export interface TeamPlan {
  joins: { teamId: string; sid: string }[];
  creates: { nameIndex: number; colorIndex: number; members: string[] }[];
  dissolve: string[];
}

/** A team being filled while a plan is built: an existing hub team (`id`) or a planned new one. */
interface Slot {
  id: string | null;
  size: number;
  members: string[]; // planned new team only
}

/** Index of the smallest slot with size < `limit` (ties: the earlier one), or -1. */
function smallestBelow(slots: readonly Slot[], limit: number): number {
  let best = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].size < limit && (best < 0 || slots[i].size < slots[best].size)) best = i;
  }
  return best;
}

function addTo(slot: Slot, sid: string, plan: TeamPlan): void {
  slot.size++;
  if (slot.id !== null) plan.joins.push({ teamId: slot.id, sid });
  else slot.members.push(sid);
}

/**
 * Turn `rest` into new teams of `partitionSizes`, as many as MAX_TEAMS and the free combos allow
 * (a free combo with a team word nobody uses yet first); whoever is left over goes, one by one, to
 * the smallest team in `slots` below TEAM_MAX (planned new teams included), or stays loose.
 */
function placeRest(rest: readonly string[], slots: Slot[], kept: readonly TeamRec[], plan: TeamPlan): void {
  const sizes = partitionSizes(rest.length);
  const taken: TeamCombo[] = [...kept];
  const usedWords = new Set(kept.map((t) => t.nameIndex));
  const room = MAX_TEAMS - kept.length;
  let next = 0;
  for (let i = 0; i < sizes.length && i < room; i++) {
    const free = freeCombos(taken);
    if (free.length === 0) break;
    const combo = free.find((c) => !usedWords.has(c.nameIndex)) ?? free[0];
    taken.push(combo);
    usedWords.add(combo.nameIndex);
    const members = rest.slice(next, next + sizes[i]);
    next += sizes[i];
    const created = { nameIndex: combo.nameIndex, colorIndex: combo.colorIndex, members };
    plan.creates.push(created);
    slots.push({ id: null, size: members.length, members });
  }
  for (; next < rest.length; next++) {
    const i = smallestBelow(slots, TEAM_MAX);
    if (i < 0) break; // nowhere to go: stays loose
    addTo(slots[i], rest[next], plan);
  }
}

/**
 * The teacher's "자동 배정 / 섞기". Teams inside an escape room (`inEscape`) are never touched.
 *
 * - fill: each loose student in turn goes to the currently smallest hub team below TEAM_TARGET
 *   (ties: the earlier team); the rest form new teams of `partitionSizes`; a single one left over
 *   goes to the smallest hub team below TEAM_MAX, or stays loose.
 * - shuffle: every hub team is dissolved; its members and the loose students are shuffled with
 *   `rng` (Fisher–Yates) and regrouped into `partitionSizes` teams with free combos.
 */
export function autoAssign(
  teams: readonly TeamRec[],
  loose: readonly string[],
  mode: "fill" | "shuffle",
  rng: () => number,
): TeamPlan {
  const plan: TeamPlan = { joins: [], creates: [], dissolve: [] };
  const escapeTeams = teams.filter((t) => t.inEscape);

  if (mode === "shuffle") {
    const pool: string[] = [];
    for (const t of teams) {
      if (t.inEscape) continue;
      plan.dissolve.push(t.id);
      pool.push(...t.members);
    }
    pool.push(...loose);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    placeRest(pool, [], escapeTeams, plan);
    return plan;
  }

  const slots: Slot[] = teams.filter((t) => !t.inEscape).map((t) => ({ id: t.id, size: t.members.length, members: [] }));
  let next = 0;
  for (; next < loose.length; next++) {
    const i = smallestBelow(slots, TEAM_TARGET);
    if (i < 0) break;
    addTo(slots[i], loose[next], plan);
  }
  placeRest(loose.slice(next), slots, teams, plan);
  return plan;
}

/** One team member as the door-pad rule sees them. `door` null = not on a pad (or not counted). */
export interface PadPresence {
  sid: string;
  door: RoomId | null;
  arrivedAt: number;
}

/** A team's door-pad status: the door most members stand at, who got there first, and how many. */
export interface PadStatus {
  door: RoomId | "";
  leaderSid: string;
  count: number;
}

/**
 * The door the team is gathering at (spec §14 "먼저 모인 사람"): the door with the most members
 * on its pad — a tie goes to the door whose earliest arrival came first — and that earliest
 * arrival leads (same time: the earlier list entry). The caller passes `door: null` for members
 * it does not count (disconnected, inside an escape room). Allocation-free apart from the result.
 */
export function teamPadStatus(members: readonly PadPresence[]): PadStatus {
  let bestDoor: RoomId | null = null;
  let bestCount = 0;
  let bestFirst = 0; // index of the earliest arrival at bestDoor
  for (let i = 0; i < members.length; i++) {
    const door = members[i].door;
    if (door === null) continue;
    let seenBefore = false;
    for (let j = 0; j < i; j++) {
      if (members[j].door === door) {
        seenBefore = true;
        break;
      }
    }
    if (seenBefore) continue; // each door is scored once, at its first list entry
    let count = 0;
    let first = i;
    for (let j = i; j < members.length; j++) {
      if (members[j].door !== door) continue;
      count++;
      if (members[j].arrivedAt < members[first].arrivedAt) first = j;
    }
    if (
      bestDoor === null ||
      count > bestCount ||
      (count === bestCount && members[first].arrivedAt < members[bestFirst].arrivedAt)
    ) {
      bestDoor = door;
      bestCount = count;
      bestFirst = first;
    }
  }
  if (bestDoor === null) return { door: "", leaderSid: "", count: 0 };
  return { door: bestDoor, leaderSid: members[bestFirst].sid, count: bestCount };
}
