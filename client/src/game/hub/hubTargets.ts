import { HUB_DOORS, TEAM_ZONE, doorAtPad, inTeamZone, type HubDoor } from "@caysonverse/shared/school/hubMap";
import { TEAM_MIN, type ClassPhase, type RoomId } from "@caysonverse/shared/escape/constants";
import type { InteractTarget } from "../interact";
import type { TeamRow } from "../../stores/classStore";

/**
 * What the central hall offers a student at a spot (AI 학교 탈출, Task 16) — pure: the scene feeds
 * it the class state at the context button's ~5 Hz pass and gets back the targets (the button / E)
 * and one line of guidance for the floor ("why there is no button here").
 *
 *  - On the team rug (`inTeamZone`): 👥 "팀 만들기" (the panel also lists, joins and leaves teams).
 *  - On a door pad: in this order — the team's classroom already runs behind this door → 🚪 "팀에게
 *    가기"; then the reasons nothing can be entered (class not running, door not open, already escaped);
 *    then the team's rule: the pad leader with enough members on it → 🚪 "입장 (팀원 n명)", everyone
 *    else is told who presses, or to make a team first.
 *  - Teachers get neither (they never walk into a classroom).
 *
 * The server decides in the same order (ClassRoom.handleEnterRoom), so a button shown here is one the
 * server will accept; this only chooses what to show.
 */

export interface HubTargetInput {
  x: number;
  z: number;
  selfSid: string;
  isTeacher: boolean;
  phase: ClassPhase;
  openRooms: readonly string[];
  /** The local player's team, or null. */
  myTeam: TeamRow | null;
}

export interface HubTargetResult {
  targets: InteractTarget[];
  /** A line for the floor, or null. */
  info: string | null;
}

/** Korean lines the hall shows (kept together so a test and the HUD read the same words). */
export const HUB_INFO = {
  lobby: "선생님이 시작하면 문이 열려요",
  notOpen: "이 교실은 다음에 열려요",
  noTeam: "먼저 중앙 홀에서 팀을 만들어요",
  /** The leader stands alone on the pad (TEAM_MIN members must be on it). */
  needTeammates: `팀원이 ${TEAM_MIN}명 이상 모이면 입장할 수 있어요`,
  /** My team's pad status points at another door. */
  otherDoor: "팀원들이 모인 문으로 가 주세요",
  paused: "선생님이 잠시 멈췄어요",
  ended: "수업이 끝났어요",
} as const;

export const hubInfo = {
  escaped: (stars: number | undefined): string => (stars && stars > 0 ? `이미 탈출했어요 ⭐×${stars}` : "이미 탈출했어요"),
  notLeader: (leader: string): string => `팀장 ${leader}님이 입장을 누르면 함께 들어가요`,
};

const NO_TARGETS: InteractTarget[] = [];

function padOf(room: RoomId): HubDoor {
  return HUB_DOORS.find((d) => d.room === room)!;
}

function centreDist(x: number, z: number, cx: number, cz: number): number {
  return Math.hypot(x - cx, z - cz);
}

function doorTarget(room: RoomId, dist: number, label: string, short: string): InteractTarget {
  return { kind: "door", id: room, dist, icon: "🚪", label, short };
}

export function hubTargets(i: HubTargetInput): HubTargetResult {
  if (i.isTeacher) return { targets: NO_TARGETS, info: null };

  if (inTeamZone(i.x, i.z)) {
    const dist = centreDist(i.x, i.z, (TEAM_ZONE.minX + TEAM_ZONE.maxX) / 2, (TEAM_ZONE.minZ + TEAM_ZONE.maxZ) / 2);
    return {
      targets: [{ kind: "teamDesk", id: "teamDesk", dist, icon: "👥", label: "팀 만들기" }],
      info: null,
    };
  }

  const room = doorAtPad(i.x, i.z);
  if (room === null) return { targets: NO_TARGETS, info: null };

  const door = padOf(room);
  const dist = centreDist(i.x, i.z, (door.pad.minX + door.pad.maxX) / 2, (door.pad.minZ + door.pad.maxZ) / 2);
  const team = i.myTeam;
  const say = (info: string): HubTargetResult => ({ targets: NO_TARGETS, info });

  // 1. The team's classroom already runs behind THIS door: walk in after them.
  if (team && team.escapeRoomId !== "" && team.escapeDoor === room) {
    return { targets: [doorTarget(room, dist, "팀에게 가기", "팀에게")], info: null };
  }
  // 2. Nothing can be entered right now.
  if (i.phase === "lobby") return say(HUB_INFO.lobby);
  if (i.phase === "paused") return say(HUB_INFO.paused);
  if (i.phase === "ended") return say(HUB_INFO.ended);
  if (!i.openRooms.includes(room)) return say(HUB_INFO.notOpen);
  if (!team) return say(HUB_INFO.noTeam);
  if (team.escaped.includes(room)) return say(hubInfo.escaped(team.stars[room]));
  // 3. The team's pad rule: the first to arrive presses, and enough members stand on the pad.
  // (padDoor "" = the server has not counted anyone on a pad yet — the step I just took: say nothing.)
  if (team.padDoor === "") return { targets: NO_TARGETS, info: null };
  if (team.padDoor !== room) return say(HUB_INFO.otherDoor);
  if (team.padLeaderSid === i.selfSid) {
    if (team.padCount >= TEAM_MIN) {
      return { targets: [doorTarget(room, dist, `입장 (팀원 ${team.padCount}명)`, "입장")], info: null };
    }
    return say(HUB_INFO.needTeammates);
  }
  const leader = team.members.find((m) => m.sid === team.padLeaderSid)?.nickname ?? "팀장";
  return say(hubInfo.notLeader(leader));
}
