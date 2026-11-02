import { describe, expect, it } from "vitest";
import type { TeamChatMirrorPayload } from "@caysonverse/shared/escape/messages";
import type { TeamRow } from "../../stores/classStore";
import {
  ALL_TEAMS,
  HALL_TAB_NAME,
  mirrorLines,
  mirrorTabs,
  mirrorText,
  phaseButtons,
  phaseLabel,
  teamLocation,
  teamStarTotal,
} from "./teacherPanel";

function team(over: Partial<TeamRow> = {}): TeamRow {
  return {
    id: "team-1",
    name: "햇살(파랑)",
    nameIndex: 0,
    colorIndex: 5,
    color: "#4B4FD8",
    members: [],
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

function line(over: Partial<TeamChatMirrorPayload> = {}): TeamChatMirrorPayload {
  return { teamId: "team-1", teamName: "햇살(파랑)", name: "가람", text: "안녕", filtered: false, at: 1000, ...over };
}

describe("phaseButtons", () => {
  it("phaseButtons", () => {
    expect(phaseButtons("lobby")).toEqual({ start: true, pause: false, resume: false, end: true });
    expect(phaseButtons("running")).toEqual({ start: false, pause: true, resume: false, end: true });
    expect(phaseButtons("paused")).toEqual({ start: false, pause: false, resume: true, end: true });
    expect(phaseButtons("ended")).toEqual({ start: false, pause: false, resume: false, end: false });
  });

  it("every phase has a Korean label", () => {
    expect(phaseLabel("lobby")).toBe("기다리는 중");
    expect(phaseLabel("running")).toBe("수업 중");
    expect(phaseLabel("paused")).toBe("잠시 멈춤");
    expect(phaseLabel("ended")).toBe("끝났어요");
  });
});

describe("the team tab", () => {
  it("teamLocation: the hall until the team's classroom exists, then that room's name", () => {
    expect(teamLocation(team())).toBe("중앙 홀");
    expect(teamLocation(team({ escapeDoor: "counsel", escapeRoomId: "esc-1" }))).toBe("상담실");
    expect(teamLocation(team({ escapeDoor: "library", escapeRoomId: "esc-2" }))).toBe("도서관");
    // A door id the client does not know still reads as a place, never "undefined".
    expect(teamLocation(team({ escapeDoor: "nowhere", escapeRoomId: "esc-3" }))).toBe("교실");
    // A leftover door without a live classroom is not "inside".
    expect(teamLocation(team({ escapeDoor: "counsel", escapeRoomId: "" }))).toBe("중앙 홀");
  });

  it("teamStarTotal adds the stars of every room the team escaped", () => {
    expect(teamStarTotal(team())).toBe(0);
    expect(teamStarTotal(team({ stars: { counsel: 3, library: 2 } }))).toBe(5);
    expect(teamStarTotal(team({ stars: { counsel: 1 } }))).toBe(1);
  });
});

describe("the chat tab (team-chat mirror)", () => {
  it("a filtered line shows only that it was held back and the masked word", () => {
    expect(mirrorText(line({ filtered: true, text: "●●" }))).toBe("⚠ 걸러진 말: ●●");
    expect(mirrorText(line({ filtered: true, text: "너 ●●●야" }))).toBe("⚠ 걸러진 말: 너 ●●●야");
  });

  it("a normal line is shown as it was said", () => {
    expect(mirrorText(line({ text: "서랍 열었어" }))).toBe("서랍 열었어");
  });

  it("tabs: the hall first, then every team in the list, then a dissolved team that still has lines", () => {
    const teams = [team({ id: "team-1", name: "햇살(파랑)" }), team({ id: "team-2", name: "풍선(빨강)" })];
    const mirror = {
      "": [line({ teamId: "", teamName: HALL_TAB_NAME, filtered: true, text: "●●" })],
      "team-2": [line({ teamId: "team-2", teamName: "풍선(빨강)" }), line({ teamId: "team-2", teamName: "풍선(빨강)", at: 2000 })],
      "team-9": [line({ teamId: "team-9", teamName: "구름(분홍)" })],
    };
    expect(mirrorTabs(mirror, teams)).toEqual([
      { id: "", name: "중앙 홀", count: 1 },
      { id: "team-1", name: "햇살(파랑)", count: 0 },
      { id: "team-2", name: "풍선(빨강)", count: 2 },
      { id: "team-9", name: "구름(분홍)", count: 1 },
    ]);
  });

  it("tabs: no hall tab while the hall has no held-back lines", () => {
    expect(mirrorTabs({}, [team()])).toEqual([{ id: "team-1", name: "햇살(파랑)", count: 0 }]);
    expect(mirrorTabs({}, [])).toEqual([]);
  });

  it("lines of one team keep their order; all-teams merges them by time, a tie puts the hall first", () => {
    const a1 = line({ teamId: "team-1", text: "a1", at: 100 });
    const a2 = line({ teamId: "team-1", text: "a2", at: 300 });
    const b1 = line({ teamId: "team-2", teamName: "풍선(빨강)", text: "b1", at: 200 });
    const h1 = line({ teamId: "", teamName: HALL_TAB_NAME, text: "h1", at: 300, filtered: true });
    const mirror = { "team-1": [a1, a2], "team-2": [b1], "": [h1] };
    expect(mirrorLines(mirror, "team-1")).toEqual([a1, a2]);
    expect(mirrorLines(mirror, "")).toEqual([h1]);
    expect(mirrorLines(mirror, ALL_TEAMS).map((m) => m.text)).toEqual(["a1", "b1", "h1", "a2"]);
    expect(mirrorLines(mirror, "team-7")).toEqual([]);
  });
});
