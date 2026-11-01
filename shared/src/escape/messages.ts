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

// EscapeMsg and its payloads (Task 10) are at the end of this file, after the engine's public shapes.

// ─────────────────────── Puzzle engine: public shapes (Task 7) ───────────────────────
//
// What the client may know about a puzzle room. The server-only room data
// (server/src/escape/types.ts: RoomDef, LockDef, ItemDef, ObjectDef …) carries the answers,
// the hints and the clue originals; the server maps it onto these shapes in `publicContent`
// (field by field, never by spreading) and `inspectView`. Types only: nothing here may hold a
// puzzle answer or clue text, and shared/ never imports from server/.

/** The four kinds of puzzle object (the client picks the action icon by kind). */
export type ObjectKind = "inspect" | "switch" | "screen" | "door";
/** Who says a story line. */
export type LineSpeaker = "ari" | "bandit" | "narrator";

/** One story line, resolved for the class's text level. */
export interface StoryLine {
  speaker: LineSpeaker;
  text: string;
}

/** A bag item as the client sees it. */
export interface PublicItem {
  id: string;
  label: string;
  icon: string;
}

interface PublicLockBase {
  id: string;
  /** The object whose inspect view opens this lock. */
  objectId: string;
  /** The lock's plate text, already resolved for the class's text level. */
  plate: string;
}
/**
 * A lock without its answer (and without the server's `requires`/`onSolve` logic: the client
 * learns that a lock is usable from `InspectViewPayload.lockId` and that it opened from the
 * `solved:<id>` flag).
 */
export type PublicLock =
  | (PublicLockBase & { kind: "digits"; length: number })
  | (PublicLockBase & { kind: "letters"; wheels: string[][] })
  | (PublicLockBase & {
      kind: "sort";
      bins: { id: string; label: string }[];
      cards: { id: string; label: string }[];
      /** The cards must be in the team bag before they can be placed. */
      needsItem?: string;
    });

/**
 * A room's public content, sent once when a player joins an escape room, every Text already
 * resolved for one text level. Leaves out hints, answers, clue originals (inspect bodies, split
 * halves, hidden UV text), the persuasion explanations, the summary and the escape lines (those
 * come with the `escaped` event). Sort cards and finale options come in a fixed order that does
 * not depend on the data order or the answer.
 */
export interface RoomContent {
  roomId: RoomId;
  title: string;
  objects: { id: string; label: string; kind: ObjectKind }[];
  items: PublicItem[];
  locks: PublicLock[];
  stages: { id: string; title: string }[];
  lines: Record<string, StoryLine>;
  /** Line ids (keys of `lines`) played at the start. */
  introLines: string[];
  finale: {
    claim: string;
    steps: { id: string; prompt: string; options: { id: string; label: string; desc?: string }[] }[];
  };
}

/** One object's close-up view for one viewer (server → that viewer only). */
export interface InspectViewPayload {
  objectId: string;
  title: string;
  body: string;
  back?: string;
  image?: string;
  /** Hidden text, present only while the team bag holds the object's reveal item (UV light). */
  reveal?: string;
  /** Item id the viewer can put in the bag right now. */
  canPickup?: string;
  /** The first unsolved lock on this object whose conditions hold. */
  lockId?: string;
  /** Half of a split clue (Task 8): the viewer's half, or who holds it. */
  split?: { text?: string; lockedText?: string };
}

/** What happened after a puzzle action (server → the team). `by` is the acting sessionId. */
export type EngineEvent =
  | { e: "picked"; item: string; by: string }
  | { e: "combined"; out: string; by: string }
  | { e: "solved"; lockId: string; by: string }
  | { e: "wrong"; lockId: string; wrongCount?: number; unplaced?: number }
  | { e: "say"; lineId: string }
  | { e: "hint"; stageId: string; tier: number; text: string }
  | { e: "hintWait"; waitS: number }
  | { e: "hintMax" }
  | { e: "coop"; objectId: string; by: string }
  | { e: "hold"; objectId: string; by: string; on: boolean }
  | { e: "coopDone"; coopId: string }
  | { e: "finale"; step: number }
  | { e: "votes" }
  | { e: "finaleWrong"; stepId: string; optionId: string; explain: string }
  /** The team escaped. `lines` = the room's escape lines (kept off RoomContent: they may retell the answer). */
  | { e: "escaped"; lines: StoryLine[] }
  | { e: "members" };

// ─────────────────────────────── EscapeRoom messages (Task 10) ───────────────────────────────

/**
 * EscapeRoom messages (client → server unless noted). The room also handles the world's Move,
 * Chat, Emoji, Jump and Typing (it is a PlayerRoom): its chat is the team chat.
 */
export const EscapeMsg = {
  /** Server → one client, on every join and reconnect: the room's public content (`RoomContent`). */
  Content: "x_content",
  /** Look at an object up close (changes nothing; the answer is `InspectView`, to the asker only). */
  Inspect: "x_inspect",
  /** Server → the asker: one object's close-up for that player (`InspectViewPayload`). */
  InspectView: "x_inspect_view",
  Pickup: "x_pickup",
  Combine: "x_combine",
  /** Set the team's shared input of a digits / letters lock. */
  LockInput: "x_lock_input",
  /** Put a card on a sort-lock bin ("" = take it back). */
  BoardPlace: "x_board_place",
  LockSubmit: "x_lock_submit",
  /** Press a coop switch (two members within COOP_WINDOW_MS). */
  Press: "x_press",
  /** A lone member starts / stops holding a coop switch (SOLO_HOLD_MS). */
  HoldStart: "x_hold_start",
  HoldEnd: "x_hold_end",
  /** Vote for an option of the current last-door step. */
  Vote: "x_vote",
  HintRequest: "x_hint",
  /** "다시 도전" after the time ran out: ESCAPE_RETRY_EXTRA_S more, overtime. */
  Retry: "x_retry",
  /** Server → the team: what happened (`EscapeEventPayload`). */
  Event: "x_event",
  /** Server → one client: a personal Korean notice. */
  Notice: "x_notice",
} as const;

export type EscapeMsg = (typeof EscapeMsg)[keyof typeof EscapeMsg];

/** Inspect, Pickup, Press, HoldStart, HoldEnd. */
export interface ObjectActionPayload {
  objectId: string;
}
export interface CombinePayload {
  a: string;
  b: string;
}
export interface LockInputPayload {
  lockId: string;
  /** digits: the digits; letters: one wheel-index digit per wheel. */
  value: string;
}
export interface BoardPlacePayload {
  lockId: string;
  cardId: string;
  /** A bin id, or "" to take the card back. */
  bin: string;
}
export interface LockSubmitPayload {
  lockId: string;
}
export interface VotePayload {
  optionId: string;
}

/** The room's closing summary, resolved for the class's text level (sent only with the escape). */
export interface EscapeSummary {
  lines: string[];
  question: string;
  source: string;
}

/**
 * The team escaped: the engine's escape lines plus the stars, the play time and the summary.
 * Re-sent to a member who joins or reconnects after the escape (the lines exist nowhere else).
 */
export interface EscapedEvent {
  e: "escaped";
  lines: StoryLine[];
  stars: number;
  elapsedS: number;
  summary: EscapeSummary;
}

/** `EscapeMsg.Event`: an engine event, except that the escape carries the room's extras. */
export type EscapeEventPayload = Exclude<EngineEvent, { e: "escaped" }> | EscapedEvent;

/** Payload type for each EscapeMsg value. */
export interface EscapePayloads {
  [EscapeMsg.Content]: RoomContent;
  [EscapeMsg.Inspect]: ObjectActionPayload;
  [EscapeMsg.InspectView]: InspectViewPayload;
  [EscapeMsg.Pickup]: ObjectActionPayload;
  [EscapeMsg.Combine]: CombinePayload;
  [EscapeMsg.LockInput]: LockInputPayload;
  [EscapeMsg.BoardPlace]: BoardPlacePayload;
  [EscapeMsg.LockSubmit]: LockSubmitPayload;
  [EscapeMsg.Press]: ObjectActionPayload;
  [EscapeMsg.HoldStart]: ObjectActionPayload;
  [EscapeMsg.HoldEnd]: ObjectActionPayload;
  [EscapeMsg.Vote]: VotePayload;
  [EscapeMsg.HintRequest]: EmptyPayload;
  [EscapeMsg.Retry]: EmptyPayload;
  [EscapeMsg.Event]: EscapeEventPayload;
  [EscapeMsg.Notice]: NoticePayload;
}
