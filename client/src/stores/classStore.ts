import { create } from "zustand";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { ClassState } from "@caysonverse/shared/schema";
import {
  PLACE_ESCAPE,
  ROOM_IDS,
  TEAM_COLORS,
  type ClassPhase,
  type RoomId,
  type TextLevel,
} from "@caysonverse/shared/escape/constants";
import { teamDisplayName } from "@caysonverse/shared/escape/teams";
import type { TeamChatMirrorPayload } from "@caysonverse/shared/escape/messages";

/**
 * The class (반) as the hub UI reads it — DISCRETE state only (phase, teams, rooms, the
 * teacher's chat mirror, a toast). Positions never come here: they stay in the scene's refs.
 * Written by classSync.ts, which copies the class state in only when its discrete part
 * changed (a fingerprint per patch, not per frame), so a moving crowd never re-renders the
 * team panel.
 */

/** Team-chat copies the teacher keeps per team (oldest dropped). */
export const MIRROR_PER_TEAM = 50;
/** Colour of a team whose colour index is unknown (never happens with a well-formed state). */
const UNKNOWN_TEAM_COLOR = "#9AA0A6";

export interface TeamMemberRow {
  sid: string;
  nickname: string;
  /** Inside the team's classroom right now (Player.place === PLACE_ESCAPE). */
  inEscape: boolean;
}

export interface TeamRow {
  id: string;
  /** The display name everybody reads, e.g. "햇살(파랑)". */
  name: string;
  color: string;
  members: TeamMemberRow[];
  escaped: RoomId[];
  stars: Partial<Record<RoomId, number>>;
  /** Door-pad status (the server's count of connected members in the hub). */
  padDoor: string;
  padLeaderSid: string;
  padCount: number;
  /** The door (RoomId) the team's running classroom is behind, and that classroom ("" = none). */
  escapeDoor: string;
  escapeRoomId: string;
  /** The local player's team. */
  mine: boolean;
}

export interface Toast {
  /** Fresh per toast, so a timer clears only the toast it was started for. */
  id: number;
  text: string;
}

const PHASES: readonly ClassPhase[] = ["lobby", "running", "paused", "ended"];

function isRoomId(v: unknown): v is RoomId {
  return typeof v === "string" && (ROOM_IDS as readonly string[]).includes(v);
}

/** The RoomIds of a synced string list (ArraySchema or array), unknown ids left out. */
function roomIdsOf(list: { forEach(cb: (value: string) => void): void } | undefined): RoomId[] {
  const out: RoomId[] = [];
  list?.forEach((v) => {
    if (isRoomId(v)) out.push(v);
  });
  return out;
}

/**
 * The class's teams as plain rows: my team first, then by display name (Korean order), ties by
 * id. Members are listed in the team's order; a member sid with no player yet (a join/leave race)
 * is left out. Every collection is copied — a row never aliases the schema.
 */
export function teamRows(state: ClassState, selfSid: string): TeamRow[] {
  const myTeamId = state.players?.get(selfSid)?.teamId ?? "";
  const rows: TeamRow[] = [];
  state.teams?.forEach((team, key) => {
    const id = team.id || key;
    const members: TeamMemberRow[] = [];
    team.members?.forEach((sid) => {
      const p = state.players.get(sid);
      if (p) members.push({ sid, nickname: p.nickname, inEscape: p.place === PLACE_ESCAPE });
    });
    const stars: Partial<Record<RoomId, number>> = {};
    team.stars?.forEach((count, room) => {
      if (isRoomId(room)) stars[room] = count;
    });
    rows.push({
      id,
      name: teamDisplayName(team.nameIndex, team.colorIndex),
      color: TEAM_COLORS[team.colorIndex] ?? UNKNOWN_TEAM_COLOR,
      members,
      escaped: roomIdsOf(team.escaped),
      stars,
      padDoor: team.padDoor,
      padLeaderSid: team.padLeaderSid,
      padCount: team.padCount,
      escapeDoor: team.escapeDoor,
      escapeRoomId: team.escapeRoomId,
      mine: myTeamId !== "" && id === myTeamId,
    });
  });
  rows.sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    return a.name.localeCompare(b.name, "ko") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return rows;
}

interface ClassStoreState {
  phase: ClassPhase;
  classCode: string;
  textLevel: TextLevel;
  teams: TeamRow[];
  /** Doors that can be entered now (phase 1: counsel). */
  openRooms: RoomId[];
  /** Rooms lit on the progress board (some team escaped). */
  litRooms: RoomId[];
  /** Teacher only: team-chat copies by teamId ("" = held-back hall lines), last MIRROR_PER_TEAM each. */
  mirror: Record<string, TeamChatMirrorPayload[]>;
  /** A personal notice (`ClassMsg.Notice`, a failed classroom entry, back from a lost classroom). */
  toast: Toast | null;

  /** Copy the class's discrete state (classSync calls this only when it changed). */
  applyState: (state: ClassState, selfSid: string) => void;
  pushMirror: (m: TeamChatMirrorPayload) => void;
  showToast: (text: string) => void;
  /** Clear the toast — only if it is still the one with `id` (omit `id` to clear any). */
  clearToast: (id?: number) => void;
  /** Forget the class (leaving it). */
  reset: () => void;
}

let nextToastId = 1;

const EMPTY = {
  phase: "lobby" as ClassPhase,
  classCode: "",
  textLevel: "easy" as TextLevel,
  teams: [] as TeamRow[],
  openRooms: [] as RoomId[],
  litRooms: [] as RoomId[],
  mirror: {} as Record<string, TeamChatMirrorPayload[]>,
  toast: null as Toast | null,
};

export const useClassStore = create<ClassStoreState>((set) => ({
  ...EMPTY,

  applyState: (state, selfSid) =>
    set({
      phase: PHASES.includes(state.phase) ? state.phase : "lobby",
      classCode: state.classCode ?? "",
      textLevel: state.textLevel === "hard" ? "hard" : "easy",
      teams: teamRows(state, selfSid),
      openRooms: roomIdsOf(state.openRooms),
      litRooms: roomIdsOf(state.litRooms),
    }),

  pushMirror: (m) =>
    set((s) => {
      const key = typeof m.teamId === "string" ? m.teamId : "";
      const prev = s.mirror[key] ?? [];
      const next = prev.length >= MIRROR_PER_TEAM ? prev.slice(prev.length - MIRROR_PER_TEAM + 1) : prev.slice();
      next.push(m);
      return { mirror: { ...s.mirror, [key]: next } };
    }),

  showToast: (text) => set({ toast: { id: nextToastId++, text } }),

  clearToast: (id) => set((s) => (s.toast !== null && (id === undefined || s.toast.id === id) ? { toast: null } : s)),

  reset: () => set({ ...EMPTY, mirror: {}, teams: [], openRooms: [], litRooms: [] }),
}));
