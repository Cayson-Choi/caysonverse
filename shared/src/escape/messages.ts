/**
 * "AI 학교 탈출" room messages — browser-safe (values and types only), shared by the server,
 * the client and the load test. World messages stay in ../messages.ts; the values here are
 * prefixed `c_` (ClassRoom) / `x_` (EscapeRoom, Task 10) so they can never collide with them
 * (ClassRoom also handles the world's Move/Chat/…; a test pins this).
 */

import type { ClassCommand, RoomId } from "./constants";

/** ClassRoom messages (client → server unless noted). */
export const ClassMsg = {
  TeamCreate: "c_team_create",
  TeamJoin: "c_team_join",
  TeamLeave: "c_team_leave",
  /** Teacher: form teams automatically. */
  TeamAuto: "c_team_auto",
  /** Teacher: start / pause / resume / end the class. */
  Command: "c_command",
  /** The pad leader asks to enter the room behind the team's door. */
  EnterRoom: "c_enter",
  /** A student whose escape-room connection could not be restored asks for a new ticket. */
  EscapeRejoin: "c_rejoin",
  /** Teacher: ask for the results CSV. */
  ResultsRequest: "c_results",
  /** Server → one student: the admission ticket for their team's escape room. */
  EscapeTicket: "c_ticket",
  /** Server → one client: a personal Korean notice (e.g. why a team action was refused). */
  Notice: "c_notice",
  /** Server → teachers: a copy of a team-chat line (or a blocked one, masked). */
  TeamChatMirror: "c_chat_mirror",
  /** Server → the teacher who asked: the results as CSV text. */
  ResultsCsv: "c_results_csv",
} as const;

export type ClassMsg = (typeof ClassMsg)[keyof typeof ClassMsg];

export interface CommandPayload {
  cmd: ClassCommand;
}
export interface NoticePayload {
  text: string;
}
export interface TeamCreatePayload {
  nameIndex: number;
  colorIndex: number;
}
export interface TeamJoinPayload {
  teamId: string;
}
export interface TeamAutoPayload {
  mode: "fill" | "shuffle";
}
export interface EnterRoomPayload {
  room: RoomId;
}
export interface EscapeTicketPayload {
  roomId: string;
  ticket: string;
}
export interface TeamChatMirrorPayload {
  teamId: string;
  teamName: string;
  name: string;
  text: string;
  filtered: boolean;
  at: number;
}
export interface ResultsCsvPayload {
  csv: string;
}

/** A message that carries no data. */
export type EmptyPayload = Record<string, never>;

/** Payload type for each ClassMsg value. */
export interface ClassPayloads {
  [ClassMsg.TeamCreate]: TeamCreatePayload;
  [ClassMsg.TeamJoin]: TeamJoinPayload;
  [ClassMsg.TeamLeave]: EmptyPayload;
  [ClassMsg.TeamAuto]: TeamAutoPayload;
  [ClassMsg.Command]: CommandPayload;
  [ClassMsg.EnterRoom]: EnterRoomPayload;
  [ClassMsg.EscapeRejoin]: EmptyPayload;
  [ClassMsg.ResultsRequest]: EmptyPayload;
  [ClassMsg.EscapeTicket]: EscapeTicketPayload;
  [ClassMsg.Notice]: NoticePayload;
  [ClassMsg.TeamChatMirror]: TeamChatMirrorPayload;
  [ClassMsg.ResultsCsv]: ResultsCsvPayload;
}

// EscapeMsg and its payloads are added to this file by Task 10.
