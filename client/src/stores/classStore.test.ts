import { describe, it, expect, beforeEach } from "vitest";
import { PLACE_ESCAPE, PLACE_HUB, TEAM_COLORS } from "@caysonverse/shared/escape/constants";
import type { TeamChatMirrorPayload } from "@caysonverse/shared/escape/messages";
import { MIRROR_PER_TEAM, teamRows, useClassStore } from "./classStore";

// A plain stand-in for the decoded ClassState: MapSchema and ArraySchema are read only through
// get / forEach / length / includes, which Map and Array provide too.
interface FakePlayer {
  nickname: string;
  place: number;
  teamId: string;
  role: number;
  connected: boolean;
}
interface FakeTeam {
  id: string;
  nameIndex: number;
  colorIndex: number;
  members: string[];
  escapeRoomId: string;
  escapeDoor: string;
  escaped: string[];
  stars: Map<string, number>;
  padDoor: string;
  padLeaderSid: string;
  padCount: number;
}

function player(nickname: string, teamId = "", place = PLACE_HUB): FakePlayer {
  return { nickname, place, teamId, role: 0, connected: true };
}

function team(id: string, nameIndex: number, colorIndex: number, members: string[], extra: Partial<FakeTeam> = {}): FakeTeam {
  return {
    id,
    nameIndex,
    colorIndex,
    members,
    escapeRoomId: "",
    escapeDoor: "",
    escaped: [],
    stars: new Map(),
    padDoor: "",
    padLeaderSid: "",
    padCount: 0,
    ...extra,
  };
}

function classState(players: Record<string, FakePlayer>, teams: FakeTeam[]) {
  return {
    classCode: "AB2CDE",
    phase: "running",
    textLevel: "hard",
    players: new Map(Object.entries(players)),
    teams: new Map(teams.map((t) => [t.id, t])),
    openRooms: ["counsel"],
    litRooms: ["counsel"],
    announcement: "",
    announcedAt: 0,
  };
}

const sample = () =>
  classState(
    {
      me: player("나래", "team-2"),
      s1: player("가람", "team-1"),
      s2: player("다온", "team-1", PLACE_ESCAPE),
      s3: player("세온", "team-3"),
      teacher: { ...player("선생님"), role: 1 },
    },
    [
      team("team-1", 1, 0, ["s1", "s2"], {
        escapeRoomId: "esc-1",
        escapeDoor: "counsel",
        escaped: ["counsel"],
        stars: new Map([["counsel", 3]]),
        padDoor: "counsel",
        padLeaderSid: "s1",
        padCount: 1,
      }),
      team("team-2", 0, 5, ["me"]),
      team("team-3", 2, 3, ["s3", "ghost-gone"]),
    ],
  );

describe("teamRows", () => {
  it("teamRows puts my team first and marks members inside rooms", () => {
    const rows = teamRows(sample() as never, "me");
    // My team first, then the others by name (새싹 < 풍선).
    expect(rows.map((r) => r.name)).toEqual(["햇살(파랑)", "새싹(초록)", "풍선(빨강)"]);
    expect(rows.map((r) => r.mine)).toEqual([true, false, false]);

    const pungseon = rows[2];
    expect(pungseon).toEqual({
      id: "team-1",
      name: "풍선(빨강)",
      nameIndex: 1,
      colorIndex: 0,
      color: TEAM_COLORS[0],
      members: [
        { sid: "s1", nickname: "가람", inEscape: false },
        { sid: "s2", nickname: "다온", inEscape: true },
      ],
      escaped: ["counsel"],
      stars: { counsel: 3 },
      padDoor: "counsel",
      padLeaderSid: "s1",
      padCount: 1,
      escapeDoor: "counsel",
      escapeRoomId: "esc-1",
      mine: false,
    });
  });

  it("skips a member sid with no player yet (join/leave race) and copies, never aliases, the arrays", () => {
    const state = sample();
    const rows = teamRows(state as never, "me");
    const saessak = rows.find((r) => r.id === "team-3")!;
    expect(saessak.members).toEqual([{ sid: "s3", nickname: "세온", inEscape: false }]);
    const pungseon = rows.find((r) => r.id === "team-1")!;
    state.teams.get("team-1")!.escaped.push("library");
    expect(pungseon.escaped).toEqual(["counsel"]);
  });

  it("a teacher (no team) has no 'mine' row; the order is by name alone", () => {
    const rows = teamRows(sample() as never, "teacher");
    expect(rows.every((r) => !r.mine)).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(["새싹(초록)", "풍선(빨강)", "햇살(파랑)"]);
  });

  it("an unknown door or colour index stays harmless (no crash, no fake room ids)", () => {
    const odd = classState({ a: player("가람", "t") }, [
      team("t", 99, 99, ["a"], { escaped: ["counsel", "nowhere"], stars: new Map([["nowhere", 2]]) }),
    ]);
    const [row] = teamRows(odd as never, "a");
    expect(row.name).toBe("팀");
    expect(typeof row.color).toBe("string");
    expect(row.escaped).toEqual(["counsel"]);
    expect(row.stars).toEqual({});
  });
});

describe("useClassStore", () => {
  beforeEach(() => useClassStore.getState().reset());

  it("applyState copies the class's discrete state (phase, code, level, rooms, rows)", () => {
    useClassStore.getState().applyState(sample() as never, "me");
    const s = useClassStore.getState();
    expect(s.phase).toBe("running");
    expect(s.classCode).toBe("AB2CDE");
    expect(s.textLevel).toBe("hard");
    expect(s.openRooms).toEqual(["counsel"]);
    expect(s.litRooms).toEqual(["counsel"]);
    expect(s.teams[0].mine).toBe(true);
  });

  it("keeps the last MIRROR_PER_TEAM team-chat copies per team (hall lines under '')", () => {
    expect(MIRROR_PER_TEAM).toBe(50);
    const line = (teamId: string, i: number): TeamChatMirrorPayload => ({
      teamId,
      teamName: "햇살(파랑)",
      name: "가람",
      text: `줄 ${i}`,
      filtered: false,
      at: i,
    });
    for (let i = 0; i < 60; i++) useClassStore.getState().pushMirror(line("team-1", i));
    useClassStore.getState().pushMirror({ ...line("", 0), filtered: true, text: "●●" });
    const { mirror } = useClassStore.getState();
    expect(mirror["team-1"]).toHaveLength(50);
    expect(mirror["team-1"][0].text).toBe("줄 10");
    expect(mirror["team-1"][49].text).toBe("줄 59");
    expect(mirror[""]).toEqual([{ ...line("", 0), filtered: true, text: "●●" }]);
  });

  it("a toast has a fresh id each time and clears only itself", () => {
    useClassStore.getState().showToast("팀원이 2명 이상 모여야 해요");
    const first = useClassStore.getState().toast!;
    useClassStore.getState().showToast("팀원이 2명 이상 모여야 해요");
    const second = useClassStore.getState().toast!;
    expect(second.id).not.toBe(first.id);
    useClassStore.getState().clearToast(first.id); // stale timer: ignored
    expect(useClassStore.getState().toast).toEqual(second);
    useClassStore.getState().clearToast(second.id);
    expect(useClassStore.getState().toast).toBeNull();
  });

  it("reset forgets everything (leaving the class)", () => {
    useClassStore.getState().applyState(sample() as never, "me");
    useClassStore.getState().showToast("x");
    useClassStore.getState().reset();
    const s = useClassStore.getState();
    expect(s.teams).toEqual([]);
    expect(s.toast).toBeNull();
    expect(s.mirror).toEqual({});
    expect(s.phase).toBe("lobby");
  });
});
