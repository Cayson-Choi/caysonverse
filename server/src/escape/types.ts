/**
 * The puzzle-room data format (AI 학교 탈출, Task 7) — SERVER ONLY. A room file
 * (server/src/escape/rooms/*.ts) holds answers, hints and clue originals in these shapes, so the
 * client must never import this file or a room file (Task 25's bundle check fails if it does).
 * The client gets the answer-free projection in shared/src/escape/messages.ts instead
 * (`publicContent`, `inspectView`).
 *
 * Flags are plain strings: `picked:<item>`, `made:<item>`, `solved:<lockId>`, a coop's
 * `doneFlag`, an effect's `set`, and `escaped`.
 */

import type { RoomId } from "@caysonverse/shared/escape/constants";
import type { LineSpeaker, ObjectKind } from "@caysonverse/shared/escape/messages";
import type { PrincipleId } from "@caysonverse/shared/escape/principles";

/** A sentence for both reading levels, or one sentence for both. */
export type Text = string | { easy: string; hard: string };
/** Holds when every `all` flag is set, no `none` flag is set and every `items` item is in the team bag. */
export type Cond = { all?: string[]; none?: string[]; items?: string[] };
export type Effect = { set: string } | { give: string } | { take: string } | { say: string };

export interface ObjectDef {
  id: string;
  label: string;
  kind: ObjectKind;
  /** Test/analysis marker (the counselling room's notes). */
  tag?: "private" | "public";
  inspect: {
    title: Text;
    body: Text;
    back?: Text;
    image?: string;
    /** The body becomes the first state whose `when` holds. */
    states?: { when: Cond; body: Text }[];
    /** A layer that shows only while the team bag holds `item` (UV light). */
    reveal?: { item: string; text: string };
  };
  pickup?: { item: string; when?: Cond };
  /** Opens the first lock whose `requires` holds and that is not solved yet. */
  locks?: string[];
  /** Half of a split clue (Task 8). `{owner}` in `lockedText` becomes the owners' nicknames. */
  split?: { group: "A" | "B"; text: string; lockedText: string; when?: Cond };
}

export interface ItemDef {
  id: string;
  label: string;
  icon: string;
}

export interface ComboDef {
  a: string;
  b: string;
  out: string;
  effects?: Effect[];
}

interface LockBase {
  id: string;
  objectId: string;
  plate: Text;
  requires?: Cond;
  onSolve: Effect[];
}
export type LockDef =
  | (LockBase & { kind: "digits"; length: number; answer: string })
  | (LockBase & { kind: "letters"; wheels: string[][]; answer: string[] })
  | (LockBase & {
      kind: "sort";
      bins: { id: string; label: string }[];
      cards: { id: string; label: string }[];
      answer: Record<string, string>;
      needsItem?: string;
    });

export interface CoopDef {
  id: string;
  switches: [string, string];
  requires?: Cond;
  doneFlag: string;
  onSolve: Effect[];
}

export interface StageDef {
  id: string;
  title: string;
  /** The stage is over once this flag is set. */
  doneWhen: string;
  hints: [string, string, string];
}

export interface FinaleOption {
  id: string;
  label: string;
  desc?: string;
  /** Why this option does not persuade (shown after a wrong choice). */
  explain?: string;
}
export interface FinaleStep {
  id: string;
  prompt: Text;
  principleId?: PrincipleId;
  options: FinaleOption[];
  correct: string;
}
export interface FinaleDef {
  requires: Cond;
  claim: Text;
  steps: FinaleStep[];
}

export interface LineDef {
  speaker: LineSpeaker;
  text: Text;
}

export interface RoomDef {
  id: RoomId;
  title: string;
  principleIds: PrincipleId[];
  objects: ObjectDef[];
  items: ItemDef[];
  combos: ComboDef[];
  locks: LockDef[];
  coops: CoopDef[];
  stages: StageDef[];
  finale: FinaleDef;
  lines: Record<string, LineDef>;
  /** Line ids (keys of `lines`) played at the start; they are public. */
  introLines: string[];
  /**
   * Line ids played after the escape. They may retell the answer, so they stay off the public
   * content and travel with the `escaped` event; validateRoomDef refuses one said earlier.
   */
  escapeLines: string[];
  summary: { lines: [Text, Text, Text]; question: Text; source: string };
}
