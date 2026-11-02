import { describe, expect, it } from "vitest";
import { HUB_DOORS, TEAM_ZONE } from "@caysonverse/shared/school/hubMap";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import type { TeamRow } from "../../stores/classStore";
import { hubTargets, type HubTargetInput } from "./hubTargets";

const counsel = HUB_DOORS.find((d) => d.room === "counsel")!;
const library = HUB_DOORS.find((d) => d.room === "library")!;
const onCounsel = { x: counsel.returnPoint.x, z: counsel.returnPoint.z };
const onLibrary = { x: library.returnPoint.x, z: library.returnPoint.z };
const onRug = { x: (TEAM_ZONE.minX + TEAM_ZONE.maxX) / 2, z: (TEAM_ZONE.minZ + TEAM_ZONE.maxZ) / 2 };
const inMiddleOfHall = { x: 0, z: 0 };

/** A team row as the class store hands it out; `over` changes what a test cares about. */
function team(over: Partial<TeamRow> = {}): TeamRow {
  return {
    id: "team-1",
    name: "햇살(파랑)",
    nameIndex: 0,
    colorIndex: 5,
    color: "#4B4FD8",
    members: [
      { sid: "me", nickname: "가람", inEscape: false },
      { sid: "mate", nickname: "다온", inEscape: false },
    ],
    escaped: [],
    stars: {},
    padDoor: "",
    padLeaderSid: "",
    padCount: 0,
    escapeDoor: "",
    escapeRoomId: "",
    mine: true,
    ...over,
  };
}

function input(over: Partial<HubTargetInput> = {}): HubTargetInput {
  return {
    ...onCounsel,
    selfSid: "me",
    isTeacher: false,
    phase: "running",
    openRooms: ["counsel"],
    myTeam: team({ padDoor: "counsel", padLeaderSid: "me", padCount: 2 }),
    ...over,
  };
}

describe("hubTargets — the team rug", () => {
  it("a student on the rug is offered 👥 팀 만들기", () => {
    const r = hubTargets(input({ ...onRug, myTeam: null }));
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]).toMatchObject({ kind: "teamDesk", icon: "👥", label: "팀 만들기" });
    expect(r.info).toBeNull();
  });

  it("the rug is offered to a student who already has a team too (the panel lets them leave)", () => {
    const r = hubTargets(input({ ...onRug, myTeam: team() }));
    expect(r.targets.map((x) => x.label)).toEqual(["팀 만들기"]);
  });

  it("elsewhere in the hall there is nothing to do and nothing to say", () => {
    expect(hubTargets(input({ ...inMiddleOfHall }))).toEqual({ targets: [], info: null });
  });

  it("the reach is the rug widened by half a metre (inTeamZone), no wider", () => {
    expect(hubTargets(input({ x: TEAM_ZONE.maxX + 0.4, z: onRug.z, myTeam: null })).targets).toHaveLength(1);
    expect(hubTargets(input({ x: TEAM_ZONE.maxX + 0.7, z: onRug.z, myTeam: null })).targets).toHaveLength(0);
  });
});

describe("hubTargets — a door pad", () => {
  it("hubTargets: leader on the pad with 2 members sees '입장 (팀원 2명)'", () => {
    const r = hubTargets(input());
    expect(r.info).toBeNull();
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]).toMatchObject({ kind: "door", id: "counsel", icon: "🚪", label: "입장 (팀원 2명)" });
    // The count follows the pad: three on it → "팀원 3명".
    const three = hubTargets(input({ myTeam: team({ padDoor: "counsel", padLeaderSid: "me", padCount: 3 }) }));
    expect(three.targets[0].label).toBe("입장 (팀원 3명)");
  });

  it("hubTargets: non-leader gets the info line, no target", () => {
    const r = hubTargets(input({ myTeam: team({ padDoor: "counsel", padLeaderSid: "mate", padCount: 2 }) }));
    expect(r.targets).toEqual([]);
    expect(r.info).toBe("팀장 다온님이 입장을 누르면 함께 들어가요");
  });

  it("hubTargets: lobby, not-open room, escaped room and no-team give their info lines", () => {
    const pad = { padDoor: "counsel", padLeaderSid: "me", padCount: 2 } as const;
    // The class has not started: this comes before everything but a team that is already inside.
    expect(hubTargets(input({ phase: "lobby" }))).toEqual({ targets: [], info: "선생님이 시작하면 문이 열려요" });
    // A door that is not open in this phase.
    expect(hubTargets(input({ ...onLibrary, openRooms: ["counsel"], myTeam: team({ ...pad, padDoor: "library" }) }))).toEqual({
      targets: [],
      info: "이 교실은 다음에 열려요",
    });
    // The team already got out of this room.
    const done = team({ ...pad, escaped: ["counsel"], stars: { counsel: 3 } });
    expect(hubTargets(input({ myTeam: done }))).toEqual({ targets: [], info: "이미 탈출했어요 ⭐×3" });
    // No team at all.
    expect(hubTargets(input({ myTeam: null }))).toEqual({ targets: [], info: "먼저 중앙 홀에서 팀을 만들어요" });
  });

  it("hubTargets: a teammate at the pad of an active instance sees '팀에게 가기'", () => {
    const running = team({ padDoor: "counsel", padLeaderSid: "mate", padCount: 1, escapeDoor: "counsel", escapeRoomId: "esc-7" });
    const r = hubTargets(input({ myTeam: running }));
    expect(r.info).toBeNull();
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]).toMatchObject({ kind: "door", id: "counsel", icon: "🚪", label: "팀에게 가기" });
    // It wins over the lobby/closed lines (the server joins a latecomer first, whatever the phase)…
    expect(hubTargets(input({ myTeam: running, phase: "lobby" })).targets[0].label).toBe("팀에게 가기");
    // …but only at THIS door: the team's classroom is behind another one.
    const elsewhere = hubTargets(input({ ...onLibrary, myTeam: running, openRooms: ["counsel", "library"] }));
    expect(elsewhere.targets.map((x) => x.label)).not.toContain("팀에게 가기");
  });

  it("hubTargets: teachers never get teamDesk or door targets", () => {
    for (const at of [onRug, onCounsel, onLibrary, inMiddleOfHall]) {
      expect(hubTargets(input({ ...at, isTeacher: true, myTeam: null }))).toEqual({ targets: [], info: null });
      expect(hubTargets(input({ ...at, isTeacher: true }))).toEqual({ targets: [], info: null });
    }
  });

  it("the leader alone on the pad is told to wait for a teammate (TEAM_MIN) instead of getting a dead button", () => {
    const r = hubTargets(input({ myTeam: team({ padDoor: "counsel", padLeaderSid: "me", padCount: 1 }) }));
    expect(r.targets).toEqual([]);
    expect(r.info).toBe("팀원이 2명 이상 모이면 입장할 수 있어요");
  });

  it("a member on a pad the team is NOT gathering at is sent to where the others are", () => {
    // The team's pad status says "counsel", but I stand on the library pad.
    const r = hubTargets(
      input({ ...onLibrary, openRooms: ["counsel", "library"], myTeam: team({ padDoor: "counsel", padLeaderSid: "mate", padCount: 2 }) }),
    );
    expect(r.targets).toEqual([]);
    expect(r.info).toBe("팀원들이 모인 문으로 가 주세요");
  });

  it("a step onto the pad the server has not counted yet says nothing (no flash of a wrong line)", () => {
    expect(hubTargets(input({ myTeam: team({ padDoor: "", padLeaderSid: "", padCount: 0 }) }))).toEqual({
      targets: [],
      info: null,
    });
  });

  it("a paused or ended class gives the leader a line instead of a button the server would refuse", () => {
    expect(hubTargets(input({ phase: "paused" }))).toEqual({ targets: [], info: "선생님이 잠시 멈췄어요" });
    expect(hubTargets(input({ phase: "ended" }))).toEqual({ targets: [], info: "수업이 끝났어요" });
  });

  it("the target's distance is to the pad's centre; an unknown leader reads as '팀장'", () => {
    const r = hubTargets(input({ x: onCounsel.x + 0.5, z: onCounsel.z }));
    expect(r.targets[0].dist).toBeCloseTo(0.5, 6);
    const odd = hubTargets(input({ myTeam: team({ padDoor: "counsel", padLeaderSid: "gone", padCount: 2 }) }));
    expect(odd.info).toBe("팀장 팀장님이 입장을 누르면 함께 들어가요");
  });

  it("a room id the pad does not belong to is never invented: every door target id is a RoomId of HUB_DOORS", () => {
    const ids = new Set<RoomId>(HUB_DOORS.map((d) => d.room));
    for (const d of HUB_DOORS) {
      const r = hubTargets(
        input({ x: d.returnPoint.x, z: d.returnPoint.z, openRooms: [...ids], myTeam: team({ padDoor: d.room, padLeaderSid: "me", padCount: 2 }) }),
      );
      expect(r.targets.map((x) => x.id)).toEqual([d.room]);
    }
  });
});
