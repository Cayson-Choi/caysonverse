import { ROOM_LABELS, type ClassPhase, type RoomId } from "@caysonverse/shared/escape/constants";
import type { TeamChatMirrorPayload } from "@caysonverse/shared/escape/messages";
import type { TeamRow } from "../../stores/classStore";

/**
 * The teacher panel's pure parts (AI 학교 탈출, Task 16): which phase buttons apply, where a team is,
 * and how the team-chat mirror reads. The panel (TeacherPanel.tsx) only draws these.
 */

export interface PhaseButtons {
  start: boolean;
  pause: boolean;
  resume: boolean;
  end: boolean;
}

/** Which of 시작 / 일시정지 / 다시 시작 / 수업 끝내기 apply in `phase` (the server's `nextPhase` rule). */
export function phaseButtons(phase: ClassPhase): PhaseButtons {
  switch (phase) {
    case "lobby":
      return { start: true, pause: false, resume: false, end: true };
    case "running":
      return { start: false, pause: true, resume: false, end: true };
    case "paused":
      return { start: false, pause: false, resume: true, end: true };
    case "ended":
      return { start: false, pause: false, resume: false, end: false };
  }
}

/** The phase as the panel's pill says it. */
export function phaseLabel(phase: ClassPhase): string {
  switch (phase) {
    case "lobby":
      return "기다리는 중";
    case "running":
      return "수업 중";
    case "paused":
      return "잠시 멈춤";
    case "ended":
      return "끝났어요";
  }
}

/** Where a team is: the room its classroom is behind, else the hall (E14: `escapeDoor` / `escapeRoomId`). */
export function teamLocation(team: TeamRow): string {
  if (team.escapeRoomId === "") return "중앙 홀";
  return ROOM_LABELS[team.escapeDoor as RoomId] ?? "교실";
}

/** All the stars a team earned in the rooms it escaped. */
export function teamStarTotal(team: TeamRow): number {
  let total = 0;
  for (const room of Object.keys(team.stars) as RoomId[]) total += team.stars[room] ?? 0;
  return total;
}

// ─────────────────────────────────── Team-chat mirror ───────────────────────────────────

/** The tab id of "every team together". */
export const ALL_TEAMS = "*";
/** The name of the hall's held-back lines (`teamId` ""): the server files them under this word. */
export const HALL_TAB_NAME = "중앙 홀";

export interface MirrorTab {
  /** A teamId, or "" for the hall. */
  id: string;
  name: string;
  count: number;
}

/**
 * One line as the teacher reads it. A held-back line (`filtered`) arrives already masked by the
 * server (the offending word is ●●); it is labelled as such so it can never be mistaken for speech.
 */
export function mirrorText(m: TeamChatMirrorPayload): string {
  return m.filtered ? `⚠ 걸러진 말: ${m.text}` : m.text;
}

/**
 * The chat tab's team chips: the hall (only when it has held-back lines), every team of the class
 * in the list's order, then any team that is gone but still has lines. `count` = lines kept.
 */
export function mirrorTabs(mirror: Record<string, TeamChatMirrorPayload[]>, teams: readonly TeamRow[]): MirrorTab[] {
  const tabs: MirrorTab[] = [];
  const hall = mirror[""];
  if (hall && hall.length > 0) tabs.push({ id: "", name: HALL_TAB_NAME, count: hall.length });
  const seen = new Set<string>();
  for (const t of teams) {
    seen.add(t.id);
    tabs.push({ id: t.id, name: t.name, count: mirror[t.id]?.length ?? 0 });
  }
  for (const id of Object.keys(mirror)) {
    if (id === "" || seen.has(id)) continue;
    const lines = mirror[id];
    if (lines.length === 0) continue;
    tabs.push({ id, name: lines[lines.length - 1].teamName, count: lines.length });
  }
  return tabs;
}

/**
 * The lines of one chip (oldest first), or — for `ALL_TEAMS` — every kept line merged by time.
 * The merge is stable: the hall comes first, then the teams in the order the store has them.
 */
export function mirrorLines(mirror: Record<string, TeamChatMirrorPayload[]>, id: string): TeamChatMirrorPayload[] {
  if (id !== ALL_TEAMS) return (mirror[id] ?? []).slice();
  const merged: TeamChatMirrorPayload[] = [];
  const hall = mirror[""];
  if (hall) merged.push(...hall);
  for (const key of Object.keys(mirror)) if (key !== "") merged.push(...mirror[key]);
  return merged.sort((a, b) => a.at - b.at); // Array.prototype.sort is stable
}
