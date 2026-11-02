/**
 * The entry's destination step — "어디로 갈까요?" (AI 학교 탈출, Task 14). Pure: no React, no DOM, no
 * network. EntryScreen renders it and passes the real connection functions into the class flows
 * (`ClassEntryDeps`), so the order of the calls and what is (never) stored are unit-tested here.
 *
 * The character builder is Caysonverse's shared entrance and carries no school chrome (spec §14):
 * the look and the nickname are made there as before, and 입장하기 opens the destination step,
 * a list of experiences. Today it lists one, AI 학교 탈출 — a student enters with a class code
 * (반 코드), a teacher opens a class with a teacher key (선생님 키). The current world is not on the
 * entry (owner decision, 2026-11-02): it is reached only through the `?world=legacy` link, whose
 * entry is exactly the old one (builder → 입장하기 → world, with the admin pill). Flipping
 * SHOW_WORLD_ON_ENTRY lists it as a second card in the step instead.
 */

import type { Appearance } from "@caysonverse/shared/appearance";
import type { TextLevel } from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
// Type-only: these modules open sockets / touch storage; the flows get them injected.
import type { ClassJoinParams } from "../net/connection";
import type { CachedIdentity } from "../net/identityCache";
import type { TeacherSession } from "../net/teacherSession";
import type { Identity } from "../stores/appStore";
import { validateNickname } from "./validation";

/**
 * Which entry the page opens with. `student` / `teacher` are the two ways into AI 학교 탈출 (the
 * sheet starts as a student; "선생님이신가요?" switches it); `legacy` is the old world entry.
 */
export type EntryMode = "student" | "teacher" | "legacy";

/** Owner decision (2026-11-02): the current world is not shown on the entry (only `?world=legacy`). */
export const SHOW_WORLD_ON_ENTRY = false;

/** `?world=legacy` (exactly) → the old world entry; any other address → the school entry. */
export function entryModeFromUrl(search: string): EntryMode {
  return new URLSearchParams(search).get("world") === "legacy" ? "legacy" : "student";
}

// ─────────────────────────────────────── words ───────────────────────────────────────

export const CLASS_CODE_ERROR = "반 코드 6자리를 넣어 주세요";
export const TEACHER_KEY_ERROR = "선생님 키를 넣어 주세요";

/** The destination step's fixed words (Korean-facing). */
export const ENTRY_COPY = {
  sheetTitle: "어디로 갈까요?",
  close: "닫기",
  classCode: "반 코드",
  classCodePlaceholder: "6자리, 예: K7Q2XM",
  nickname: "닉네임",
  nicknameNote: "실명 대신 별명을 써 주세요",
  changeNickname: "바꾸기",
  changeNicknameLabel: "닉네임 바꾸기",
  enter: "입장하기",
  entering: "입장 중…",
  teacherAsk: "선생님이신가요?",
  studentAsk: "학생이신가요?",
  teacherKey: "선생님 키",
  textLevel: "글 수준",
  openClass: "반 열기",
  opening: "반 여는 중…",
  /** A join that failed without words of its own (the world entry's fallback). */
  failed: "입장에 실패했습니다. 다시 시도해주세요.",
} as const;

export interface TextLevelOption {
  value: TextLevel;
  label: string;
}

/** 글 수준: the reading level the class's puzzles use (the teacher picks it when opening the class). */
export const TEXT_LEVEL_OPTIONS: readonly TextLevelOption[] = Object.freeze([
  Object.freeze({ value: "easy", label: "쉬운 말" }),
  Object.freeze({ value: "hard", label: "조금 어려운 말" }),
]);

// ─────────────────────────────────── destinations ───────────────────────────────────

export type DestinationId = "escape" | "world";

/** One experience card in "어디로 갈까요?". */
export interface Destination {
  id: DestinationId;
  title: string;
  /** The one-line description under the title. */
  line: string;
}

const ESCAPE: Destination = Object.freeze({ id: "escape", title: "AI 학교 탈출", line: "반 코드로 친구들과 함께 AI 윤리 방탈출" });
const WORLD: Destination = Object.freeze({ id: "world", title: "지금 월드", line: "누구나 함께 걷고 이야기하는 3D 광장" });

const ONLY_ESCAPE: readonly Destination[] = Object.freeze([ESCAPE]);
const ESCAPE_AND_WORLD: readonly Destination[] = Object.freeze([ESCAPE, WORLD]);

/**
 * The experiences the destination step lists, in order (a list, so more can be added later). The
 * same frozen array every call — safe to use straight from render.
 */
export function entryDestinations(showWorld: boolean = SHOW_WORLD_ON_ENTRY): readonly Destination[] {
  return showWorld ? ESCAPE_AND_WORLD : ONLY_ESCAPE;
}

/**
 * The destination step's words drawn in Jua (the builder's display font): its title, the card
 * titles, the go buttons and the role switch. builderOptions.BUILDER_FONT_TEXT includes it, so the
 * subset font (scripts/subset-builder-font.mjs) carries these glyphs. Labels, notes, errors and the
 * reading levels use the body font.
 */
export const DESTINATION_FONT_TEXT: string = [
  ENTRY_COPY.sheetTitle,
  ESCAPE.title,
  WORLD.title,
  ENTRY_COPY.enter,
  ENTRY_COPY.entering,
  ENTRY_COPY.openClass,
  ENTRY_COPY.opening,
  ENTRY_COPY.teacherAsk,
  ENTRY_COPY.studentAsk,
].join(" ");

// ─────────────────────────────────────── checks ───────────────────────────────────────

export type EntryCheck = { ok: true } | { ok: false; error: string };

/**
 * A student's entry: a class code of 6 symbols (any case, spaces around are fine — the canonical
 * form is what is sent) and a nickname by the usual rule. The code is named first: it is the field
 * in the sheet (the nickname was already checked on the builder's plate).
 */
export function validateStudentEntry(v: { classCode: string; nickname: string }): EntryCheck {
  if (normalizeClassCode(v.classCode) === null) return { ok: false, error: CLASS_CODE_ERROR };
  const nickname = validateNickname(v.nickname);
  return nickname === null ? { ok: true } : { ok: false, error: nickname };
}

/** A teacher's 반 열기: a non-blank key (only the server can tell whether it is right) and a nickname. */
export function validateTeacherEntry(v: { teacherKey: string; nickname: string }): EntryCheck {
  if (v.teacherKey.trim() === "") return { ok: false, error: TEACHER_KEY_ERROR };
  const nickname = validateNickname(v.nickname);
  return nickname === null ? { ok: true } : { ok: false, error: nickname };
}

// ─────────────────────────────────────── flows ───────────────────────────────────────

/** What a class entry needs from the app (EntryScreen passes the real functions). */
export interface ClassEntryDeps {
  joinClass(p: ClassJoinParams): Promise<{ sessionId: string }>;
  requestTeacherPass(body: { teacherKey: string; textLevel: TextLevel }): Promise<{ classCode: string; pass: string }>;
  rememberTeacher(t: TeacherSession): void;
  forgetTeacher(): void;
  saveIdentity(identity: CachedIdentity): void;
  clearKicked(): void;
  enterHub(identity: Identity, isTeacher: boolean): void;
}

/** A checked entry: the trimmed nickname and the validated look (validateEntry's value). */
interface Who {
  nickname: string;
  appearance: Appearance;
}

/**
 * Student: join the class with the code → the hall. The code and the look are remembered first
 * (a later visit prefills them; the world entry also saves before joining), and a deliberate entry
 * clears an earlier kick. Any teacher key this tab still holds (a 반 열기 that failed) is dropped,
 * so a rejoin after a server restart can never re-open a class as a teacher. Rejects with the
 * join's Korean words (joinClass maps them); a code that cannot match is refused without a request.
 */
export async function enterClassAsStudent(deps: ClassEntryDeps, v: Who & { classCode: string }): Promise<void> {
  const classCode = normalizeClassCode(v.classCode);
  if (classCode === null) throw new Error(CLASS_CODE_ERROR);
  deps.forgetTeacher();
  deps.saveIdentity({ nickname: v.nickname, appearance: v.appearance, classCode });
  deps.clearKicked();
  const room = await deps.joinClass({ classCode, nickname: v.nickname, appearance: v.appearance });
  deps.enterHub({ nickname: v.nickname, appearance: v.appearance, sessionId: room.sessionId, classCode }, false);
}

/**
 * Teacher (Task 13's order): one-time pass for a new class → remember the teacher (module memory
 * only, for re-opening the same class after a server restart) → join with the pass → the hall as
 * the teacher. The key goes only to the pass request and the teacher session — never into the
 * identity cache, a join option or the store — and the pass only into that one join. A refused
 * key rejects with the server's words before anything else happens; a join that fails after the
 * pass forgets the teacher again.
 */
export async function enterClassAsTeacher(
  deps: ClassEntryDeps,
  v: Who & { teacherKey: string; textLevel: TextLevel },
): Promise<void> {
  const key = v.teacherKey.trim();
  const { classCode, pass } = await deps.requestTeacherPass({ teacherKey: key, textLevel: v.textLevel });
  deps.rememberTeacher({ key, classCode, textLevel: v.textLevel });
  deps.saveIdentity({ nickname: v.nickname, appearance: v.appearance, classCode });
  deps.clearKicked();
  let room: { sessionId: string };
  try {
    room = await deps.joinClass({ classCode, nickname: v.nickname, appearance: v.appearance, teacherPass: pass });
  } catch (err) {
    deps.forgetTeacher();
    throw err;
  }
  deps.enterHub({ nickname: v.nickname, appearance: v.appearance, sessionId: room.sessionId, classCode }, true);
}
