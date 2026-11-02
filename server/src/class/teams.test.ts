import { describe, it, expect } from "vitest";
import { MAX_TEAMS, TEAM_MAX, TEAM_TARGET } from "@caysonverse/shared/escape/constants";
import { freeCombos } from "@caysonverse/shared/escape/teams";
import {
  TEAM_ERRORS,
  autoAssign,
  createTeam,
  joinTeam,
  leaveTeam,
  partitionSizes,
  teamPadStatus,
  type TeamRec,
} from "./teams";

/** A deterministic rng (mulberry32), so a shuffle is reproducible in a test. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Team `id` with `size` members `<id>1`, `<id>2`, …; its combo is derived from the id's letter. */
function rec(id: string, size: number, inEscape = false): TeamRec {
  const k = id.charCodeAt(0) - 65;
  return {
    id,
    nameIndex: k % 12,
    colorIndex: k % 8,
    members: Array.from({ length: size }, (_, i) => `${id}${i + 1}`),
    inEscape,
  };
}

const key = (c: { nameIndex: number; colorIndex: number }) => `${c.nameIndex}/${c.colorIndex}`;

describe("partitionSizes", () => {
  it("partitionSizes", () => {
    expect(partitionSizes(1)).toEqual([]);
    expect(partitionSizes(2)).toEqual([2]);
    expect(partitionSizes(5)).toEqual([5]);
    expect(partitionSizes(7)).toEqual([4, 3]);
    expect(partitionSizes(25)).toEqual([5, 4, 4, 4, 4, 4]);
    for (let n = 2; n <= 100; n++) {
      const s = partitionSizes(n);
      expect(s.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(2);
      expect(Math.max(...s)).toBeLessThanOrEqual(6);
    }
  });

  it("is empty below the minimum, biggest teams first, and follows target/min/max overrides", () => {
    expect(partitionSizes(0)).toEqual([]);
    expect(partitionSizes(-3)).toEqual([]);
    expect(partitionSizes(6)).toEqual([3, 3]);
    expect(partitionSizes(10)).toEqual([4, 3, 3]);
    for (let n = 2; n <= 100; n++) {
      const s = partitionSizes(n);
      for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThanOrEqual(s[i - 1]);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    }
    expect(partitionSizes(9, 3, 2, 3)).toEqual([3, 3, 3]);
    expect(partitionSizes(2, 4, 3, 6)).toEqual([]);
  });
});

describe("autoAssign — fill", () => {
  it("fill tops up small teams first, leaves escape teams alone, then makes new teams", () => {
    const teams = [rec("A", 2), rec("B", 4), rec("C", 6), rec("D", 3, true)];
    const plan = autoAssign(teams, ["s1", "s2", "s3", "s4", "s5"], "fill", seeded(1));
    expect(plan.joins.filter((j) => j.teamId === "A").map((j) => j.sid)).toEqual(["s1", "s2"]);
    expect(plan.creates.map((c) => c.members.length)).toEqual([3]);
    expect(plan.joins.some((j) => j.teamId === "D")).toBe(false);
    // Nobody is placed twice or lost; nothing is dissolved; the new team has an unused combo.
    expect([...plan.joins.map((j) => j.sid), ...plan.creates.flatMap((c) => c.members)].sort()).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
    ]);
    expect(plan.creates[0].members).toEqual(["s3", "s4", "s5"]);
    expect(plan.dissolve).toEqual([]);
    expect(teams.map(key)).not.toContain(key(plan.creates[0]));
  });

  it("tops up the currently smallest team each time, never past TEAM_TARGET", () => {
    const plan = autoAssign([rec("A", 3), rec("B", 1), rec("C", 2)], ["s1", "s2", "s3", "s4"], "fill", seeded(2));
    // B 1→2 (s1), then B and C are both 2: the earlier one (B) first, and so on.
    expect(plan.joins).toEqual([
      { teamId: "B", sid: "s1" },
      { teamId: "B", sid: "s2" },
      { teamId: "C", sid: "s3" },
      { teamId: "A", sid: "s4" },
    ]);
    expect(plan.creates).toEqual([]);
    const sizes = new Map([["A", 3], ["B", 1], ["C", 2]]);
    for (const j of plan.joins) sizes.set(j.teamId, sizes.get(j.teamId)! + 1);
    for (const s of sizes.values()) expect(s).toBeLessThanOrEqual(TEAM_TARGET);
  });

  it("fill with one loose student and only full or escape teams leaves them loose", () => {
    const plan = autoAssign([rec("C", 6), rec("D", 3, true), rec("E", TEAM_MAX)], ["s1"], "fill", seeded(1));
    expect(plan).toEqual({ joins: [], creates: [], dissolve: [] });
    // With a hub team below TEAM_MAX (but at/over the target) the last one goes to the smallest such team.
    const withRoom = autoAssign([rec("C", 6), rec("D", 3, true), rec("F", 5), rec("G", 4)], ["s1"], "fill", seeded(1));
    expect(withRoom).toEqual({ joins: [{ teamId: "G", sid: "s1" }], creates: [], dissolve: [] });
    // No teams at all and one student: nothing to do.
    expect(autoAssign([], ["s1"], "fill", seeded(1))).toEqual({ joins: [], creates: [], dissolve: [] });
  });

  it("new teams take free combos, preferring a team word nobody uses yet", () => {
    const taken = freeCombos([])[0]; // 햇살(빨강)
    const teams: TeamRec[] = [{ id: "A", nameIndex: taken.nameIndex, colorIndex: 5, members: ["a1", "a2", "a3", "a4"], inEscape: false }];
    const plan = autoAssign(teams, ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"], "fill", seeded(3));
    expect(plan.creates.map((c) => c.members.length)).toEqual([4, 4]);
    const words = plan.creates.map((c) => c.nameIndex);
    expect(new Set(words).size).toBe(2);
    expect(words).not.toContain(taken.nameIndex);
  });

  it("never creates more than MAX_TEAMS teams; the overflow goes to hub teams below TEAM_MAX, then stays loose", () => {
    // 49 hub teams of 5 + one escape team of 6 = MAX_TEAMS teams already.
    const teams: TeamRec[] = freeCombos([])
      .slice(0, MAX_TEAMS)
      .map((c, i) => ({
        id: `t${i}`,
        ...c,
        members: Array.from({ length: i === 0 ? 6 : 5 }, (_, m) => `t${i}m${m}`),
        inEscape: i === 0,
      }));
    const loose = Array.from({ length: 60 }, (_, i) => `s${i}`);
    const plan = autoAssign(teams, loose, "fill", seeded(4));
    expect(plan.creates).toEqual([]);
    expect(plan.joins).toHaveLength(49); // one more into each hub team (5 → 6)
    expect(plan.joins.some((j) => j.teamId === "t0")).toBe(false);
    expect(new Set(plan.joins.map((j) => j.teamId)).size).toBe(49);
  });
});

describe("autoAssign — shuffle", () => {
  it("shuffle regroups everyone outside escape rooms into partitionSizes teams with fresh combos", () => {
    const teams = [rec("A", 2), rec("B", 3), rec("D", 4, true)];
    const plan = autoAssign(teams, ["s1", "s2"], "shuffle", seeded(1));
    expect(plan.dissolve).toEqual(["A", "B"]);
    expect(plan.joins).toEqual([]);
    expect(plan.creates.map((c) => c.members.length)).toEqual(partitionSizes(7)); // [4, 3]
    // Everyone from A, B and the loose students is in exactly one new team; D's members are not.
    const placed = plan.creates.flatMap((c) => c.members);
    expect([...placed].sort()).toEqual(["A1", "A2", "B1", "B2", "B3", "s1", "s2"].sort());
    for (const m of teams[2].members) expect(placed).not.toContain(m);
    // Fresh combos: distinct, and none collides with the team that stays (D).
    const combos = plan.creates.map(key);
    expect(new Set(combos).size).toBe(combos.length);
    expect(combos).not.toContain(key(teams[2]));
  });

  it("uses the rng: different draws give different groupings", () => {
    const teams = [rec("A", 3), rec("B", 3)];
    const low = autoAssign(teams, ["s1", "s2"], "shuffle", () => 0);
    const high = autoAssign(teams, ["s1", "s2"], "shuffle", () => 0.999);
    expect(low.creates.map((c) => c.members)).not.toEqual(high.creates.map((c) => c.members));
    for (const plan of [low, high]) expect(plan.creates.map((c) => c.members.length)).toEqual([4, 4]);
  });

  it("with only escape teams and one loose student leaves everything as it is", () => {
    const plan = autoAssign([rec("D", 4, true)], ["s1"], "shuffle", seeded(5));
    expect(plan).toEqual({ joins: [], creates: [], dissolve: [] });
  });

  it("a pool smaller than TEAM_MIN is left as it is: a lone team is never dissolved into a teamless student (final fix B3)", () => {
    const empty = { joins: [], creates: [], dissolve: [] };
    // One team of one, nobody loose: the shuffle would dissolve it and could place nobody.
    expect(autoAssign([rec("A", 1)], [], "shuffle", seeded(3))).toEqual(empty);
    // The same next to a team inside a classroom (never touched anyway).
    expect(autoAssign([rec("A", 1), rec("D", 4, true)], [], "shuffle", seeded(3))).toEqual(empty);
    // Nobody at all.
    expect(autoAssign([], [], "shuffle", seeded(3))).toEqual(empty);
    // TEAM_MIN (2) is enough to regroup: one new team of both.
    const two = autoAssign([rec("A", 1)], ["s1"], "shuffle", seeded(3));
    expect(two.dissolve).toEqual(["A"]);
    expect(two.creates.map((c) => [...c.members].sort())).toEqual([["A1", "s1"]]);
  });
});

describe("createTeam / joinTeam / leaveTeam", () => {
  it("createTeam rejects a taken (name, color), a member of another team, and the 51st team", () => {
    const teams = [rec("A", 2), rec("B", 3)];
    // A free combo: a new one-member team.
    expect(createTeam(teams, "s1", 4, 4, "team-9")).toEqual({
      id: "team-9",
      nameIndex: 4,
      colorIndex: 4,
      members: ["s1"],
      inEscape: false,
    });
    // Taken (name, colour) — the same word in another colour is fine.
    expect(createTeam(teams, "s1", teams[0].nameIndex, teams[0].colorIndex, "x")).toEqual({ error: TEAM_ERRORS.comboTaken });
    expect("error" in createTeam(teams, "s1", teams[0].nameIndex, (teams[0].colorIndex + 1) % 8, "x")).toBe(false);
    // Already in a team (checked first).
    expect(createTeam(teams, "B2", 9, 1, "x")).toEqual({ error: TEAM_ERRORS.alreadyInTeam });
    // The 51st team.
    const fifty: TeamRec[] = freeCombos([])
      .slice(0, MAX_TEAMS)
      .map((c, i) => ({ id: `t${i}`, ...c, members: [`m${i}`], inEscape: false }));
    const free = freeCombos(fifty)[0];
    expect(createTeam(fifty, "s1", free.nameIndex, free.colorIndex, "x")).toEqual({ error: TEAM_ERRORS.tooManyTeams });
    expect("error" in createTeam(fifty.slice(1), "s1", free.nameIndex, free.colorIndex, "x")).toBe(false);
  });

  it("the error copy is the brief's Korean", () => {
    expect(TEAM_ERRORS).toEqual({
      alreadyInTeam: "이미 팀에 있어요. 먼저 팀에서 나와 주세요",
      comboTaken: "이미 있는 팀 이름과 색이에요",
      teamFull: "팀이 가득 찼어요 (최대 6명)",
      tooManyTeams: "팀을 더 만들 수 없어요",
    });
  });

  it("joinTeam adds at the end up to TEAM_MAX; a member cannot join twice", () => {
    const team = rec("A", TEAM_MAX - 1);
    expect(joinTeam(team, "s1")).toBeNull();
    expect(team.members).toHaveLength(TEAM_MAX);
    expect(team.members[TEAM_MAX - 1]).toBe("s1");
    expect(joinTeam(team, "s2")).toEqual({ error: TEAM_ERRORS.teamFull });
    expect(team.members).toHaveLength(TEAM_MAX);
    const small = rec("B", 2);
    expect(joinTeam(small, "B1")).toEqual({ error: TEAM_ERRORS.alreadyInTeam });
    expect(small.members).toEqual(["B1", "B2"]);
  });

  it("leaveTeam removes the member (order kept) and reports an empty team", () => {
    const team = rec("A", 3);
    expect(leaveTeam(team, "A2")).toEqual({ empty: false });
    expect(team.members).toEqual(["A1", "A3"]);
    expect(leaveTeam(team, "zz")).toEqual({ empty: false }); // not a member: nothing changes
    expect(team.members).toEqual(["A1", "A3"]);
    expect(leaveTeam(team, "A1")).toEqual({ empty: false });
    expect(leaveTeam(team, "A3")).toEqual({ empty: true });
    expect(team.members).toEqual([]);
  });
});

describe("teamPadStatus", () => {
  it("teamPadStatus picks the busiest door and its earliest arrival", () =>
    expect(
      teamPadStatus([
        { sid: "a", door: "counsel", arrivedAt: 100 },
        { sid: "b", door: "counsel", arrivedAt: 50 },
        { sid: "c", door: null, arrivedAt: 0 },
      ]),
    ).toEqual({ door: "counsel", leaderSid: "b", count: 2 }));

  it("a tie goes to the door whose first arrival came earlier; nobody on a pad is the empty status", () => {
    expect(
      teamPadStatus([
        { sid: "a", door: "counsel", arrivedAt: 300 },
        { sid: "b", door: "library", arrivedAt: 200 },
        { sid: "c", door: "counsel", arrivedAt: 250 },
        { sid: "d", door: "library", arrivedAt: 400 },
      ]),
    ).toEqual({ door: "library", leaderSid: "b", count: 2 });
    // Three at one door beat two earlier ones at another.
    expect(
      teamPadStatus([
        { sid: "a", door: "library", arrivedAt: 1 },
        { sid: "b", door: "library", arrivedAt: 2 },
        { sid: "c", door: "career", arrivedAt: 10 },
        { sid: "d", door: "career", arrivedAt: 11 },
        { sid: "e", door: "career", arrivedAt: 12 },
      ]),
    ).toEqual({ door: "career", leaderSid: "c", count: 3 });
    // Same arrival time: the earlier list entry leads.
    expect(
      teamPadStatus([
        { sid: "x", door: "counsel", arrivedAt: 5 },
        { sid: "y", door: "counsel", arrivedAt: 5 },
      ]),
    ).toEqual({ door: "counsel", leaderSid: "x", count: 2 });
    expect(teamPadStatus([{ sid: "a", door: null, arrivedAt: 0 }])).toEqual({ door: "", leaderSid: "", count: 0 });
    expect(teamPadStatus([])).toEqual({ door: "", leaderSid: "", count: 0 });
  });
});
