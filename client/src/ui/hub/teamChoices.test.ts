import { describe, expect, it } from "vitest";
import { TEAM_COLORS, TEAM_MAX, TEAM_NAMES } from "@caysonverse/shared/escape/constants";
import { freeCombos } from "@caysonverse/shared/escape/teams";
import type { TeamRow } from "../../stores/classStore";
import { colorFlags, joinState, nameFlags, pickColor, pickName, resolveCombo, usedCombos } from "./teamChoices";

function team(over: Partial<TeamRow> = {}): TeamRow {
  return {
    id: "team-1",
    name: "햇살(하늘)",
    nameIndex: 0,
    colorIndex: 4,
    color: "#3FA7D6",
    members: [{ sid: "a", nickname: "가람", inEscape: false }],
    escaped: [],
    stars: {},
    padDoor: "",
    padLeaderSid: "",
    padCount: 0,
    escapeDoor: "",
    escapeRoomId: "",
    mine: false,
    ...over,
  };
}

describe("which (name, colour) a new team may take — the shared freeCombos rule", () => {
  it("usedCombos reads the indices off the team rows", () => {
    expect(usedCombos([team(), team({ id: "t2", nameIndex: 3, colorIndex: 1 })])).toEqual([
      { nameIndex: 0, colorIndex: 4 },
      { nameIndex: 3, colorIndex: 1 },
    ]);
  });

  it("nothing used: every name and every colour is open, and the first combo is freeCombos' first", () => {
    expect(nameFlags([]).every(Boolean)).toBe(true);
    expect(nameFlags([])).toHaveLength(TEAM_NAMES.length);
    expect(colorFlags([], 0)).toHaveLength(TEAM_COLORS.length);
    expect(colorFlags([], 0).every(Boolean)).toBe(true);
    expect(resolveCombo([], null)).toEqual(freeCombos([])[0]);
  });

  it("a taken pair is not offered, but the same name in another colour still is", () => {
    const used = [{ nameIndex: 0, colorIndex: 4 }];
    expect(colorFlags(used, 0)[4]).toBe(false);
    expect(colorFlags(used, 0).filter(Boolean)).toHaveLength(TEAM_COLORS.length - 1);
    expect(colorFlags(used, 1)[4]).toBe(true); // another name may use that colour
    expect(nameFlags(used)[0]).toBe(true);
  });

  it("a name whose every colour is taken is greyed out", () => {
    const used = TEAM_COLORS.map((_, colorIndex) => ({ nameIndex: 2, colorIndex }));
    expect(nameFlags(used)[2]).toBe(false);
    expect(nameFlags(used).filter(Boolean)).toHaveLength(TEAM_NAMES.length - 1);
    expect(resolveCombo(used, { nameIndex: 2, colorIndex: 0 })?.nameIndex).not.toBe(2);
  });

  it("the choice stays when it is still free and falls to the next free one when someone took it", () => {
    expect(resolveCombo([], { nameIndex: 5, colorIndex: 6 })).toEqual({ nameIndex: 5, colorIndex: 6 });
    const used = [{ nameIndex: 5, colorIndex: 6 }];
    const next = resolveCombo(used, { nameIndex: 5, colorIndex: 6 });
    expect(next).not.toBeNull();
    expect(next?.nameIndex).toBe(5); // same name, a free colour
    expect(next?.colorIndex).not.toBe(6);
  });

  it("every pair taken → no choice at all", () => {
    const all = TEAM_NAMES.flatMap((_, nameIndex) => TEAM_COLORS.map((__, colorIndex) => ({ nameIndex, colorIndex })));
    expect(resolveCombo(all, null)).toBeNull();
    expect(freeCombos(all)).toEqual([]);
  });

  it("picking a name keeps the colour when it is free there, else takes that name's first free colour", () => {
    const used = [{ nameIndex: 1, colorIndex: 3 }];
    expect(pickName(used, { nameIndex: 0, colorIndex: 2 }, 1)).toEqual({ nameIndex: 1, colorIndex: 2 });
    expect(pickName(used, { nameIndex: 0, colorIndex: 3 }, 1)).toEqual({ nameIndex: 1, colorIndex: 0 });
  });

  it("picking a colour that is free changes it; a taken one changes nothing", () => {
    const used = [{ nameIndex: 0, colorIndex: 7 }];
    expect(pickColor(used, { nameIndex: 0, colorIndex: 1 }, 2)).toEqual({ nameIndex: 0, colorIndex: 2 });
    expect(pickColor(used, { nameIndex: 0, colorIndex: 1 }, 7)).toEqual({ nameIndex: 0, colorIndex: 1 });
  });
});

describe("joinState — what the 들어가기 button does for each team row", () => {
  it("joinable when I have no team and it has room", () => {
    expect(joinState(team(), false)).toBe("join");
  });
  it("full at TEAM_MAX members", () => {
    const members = Array.from({ length: TEAM_MAX }, (_, i) => ({ sid: `s${i}`, nickname: `n${i}`, inEscape: false }));
    expect(joinState(team({ members }), false)).toBe("full");
    expect(joinState(team({ members: members.slice(0, TEAM_MAX - 1) }), false)).toBe("join");
  });
  it("my own team is marked, and with a team of my own no other can be joined", () => {
    expect(joinState(team({ mine: true }), true)).toBe("mine");
    expect(joinState(team({ mine: false }), true)).toBe("other");
  });
});
