/**
 * The entry's routing and its destination step — "어디로 갈까요?" (AI 학교 탈출, Task 14). Pure: no React, no
 * DOM, no network. EntryScreen renders it and passes the real connection functions into the flows
 * (`ClassEntryDeps`, `VillageEntryDeps`), so the order of the calls and what is (never) stored are
 * unit-tested here.
 *
 * The character builder is Caysonverse's shared entrance and carries no school chrome (spec §14):
 * the look and the nickname are made there as before. Where 입장하기 goes depends on the address
 * (owner decision, 2026-11-03; `entryModeFromUrl` / `entryRoute`):
 *   - no parameter → 케이슨 마을, straight in: no code, no destination step (`enterVillageDirectly`);
 *   - `?experience=escape` → the destination step, today one card, AI 학교 탈출 — a student enters
 *     with a class code (반 코드), a teacher opens a class with a teacher key (선생님 키);
 *   - `?world=legacy` → the old world exactly as it was (builder → 입장하기 → world, with the admin
 *     pill). Flipping SHOW_WORLD_ON_ENTRY lists it as a second card in the step instead.
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
 * Which entry the page opens with. `village` (the default) goes straight into 케이슨 마을; `escape` is
 * AI 학교 탈출 (the destination sheet starts as a student; "선생님이신가요?" switches it); `legacy` is
 * the old world entry.
 */
export type EntryMode = "village" | "escape" | "legacy";

/** Owner decision (2026-11-02): the current world is not shown on the entry (only `?world=legacy`). */
export const SHOW_WORLD_ON_ENTRY = false;

/**
 * Owner decision (2026-11-03): `?world=legacy` (exactly) → the old world entry; `?experience=escape`
 * (exactly) → AI 학교 탈출's destination step; any other address → 케이슨 마을. The world link wins
 * when both are given (it is the older, fully separate entry).
 */
export function entryModeFromUrl(search: string): EntryMode {
  const params = new URLSearchParams(search);
  if (params.get("world") === "legacy") return "legacy";
  return params.get("experience") === "escape" ? "escape" : "village";
}

/** What 입장하기 does once the nickname and look are checked. */
export type EntryRoute = "village" | "destinations" | "world";

/**
 * Where a checked 입장하기 leads: the village joins at once (no sheet, no code), AI 학교 탈출 opens the
 * destination step, and the legacy link joins the old world.
 */
export function entryRoute(mode: EntryMode): EntryRoute {
  return mode === "village" ? "village" : mode === "escape" ? "destinations" : "world";
}

// ───────────────────────────────────── the sheet ─────────────────────────────────────

/** The two ways into AI 학교 탈출 (the destination sheet's role switch). */
export type SchoolRole = "student" | "teacher";

/** The sheet's role and the teacher key typed in it. */
export interface TeacherFields {
  role: SchoolRole;
  teacherKey: string;
}

/**
 * The key lives only while the teacher view of the open sheet does: closing the sheet (✕ / Esc / the
 * veil / 바꾸기) or switching back to 학생 returns to 학생 with the key forgotten. A refused key is not
 * an event here — it stays, so a typo can be fixed.
 */
export function teacherFieldsAfter(fields: TeacherFields, event: "close" | SchoolRole): TeacherFields {
  if (event === "teacher") return { role: "teacher", teacherKey: fields.teacherKey };
  return { role: "student", teacherKey: "" };
}

/**
 * Presses this soon after the sheet opened are ignored: the second half of a double click / tap on
 * the builder's 입장하기 would otherwise land on the sheet it just opened (the veil, or a button).
 */
export const SHEET_PRESS_GUARD_MS = 350;

export function sheetPressAllowed(openedAt: number, now: number): boolean {
  return now - openedAt >= SHEET_PRESS_GUARD_MS;
}

/**
 * The field a server refusal points at (focus + aria-invalid): a student's refused join → the class
 * code; a teacher's refused pass request (HTTP 4xx, `requestTeacherPass`'s TeacherPassError) → the
 * key, except a refused class code (404: no such class open, 409: another teacher's class) → the
 * teacher's class-code field. No answer, a server fault or a failed class join after a good pass
 * point at nothing.
 */
export function refusalField(role: SchoolRole, err: unknown): "code" | "key" | null {
  if (role === "student") return "code";
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 404 || status === 409) return "code";
  return typeof status === "number" && status >= 400 && status < 500 ? "key" : null;
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
  /** The teacher's optional class code: filled = go back into that running class, empty = a new class. */
  teacherClassCode: "이어서 들어갈 반 코드",
  teacherClassCodePlaceholder: "비워 두면 새 반을 열어요",
  teacherClassCodeNote: "이미 연 반에 다시 들어갈 때만 넣어 주세요.",
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

/**
 * A teacher's 반 열기: a non-blank key (only the server can tell whether it is right), an optional
 * class code that, when typed, must be a whole one (6 symbols), and a nickname.
 */
export function validateTeacherEntry(v: { teacherKey: string; nickname: string; classCode?: string }): EntryCheck {
  if (v.teacherKey.trim() === "") return { ok: false, error: TEACHER_KEY_ERROR };
  const code = v.classCode?.trim() ?? "";
  if (code !== "" && normalizeClassCode(code) === null) return { ok: false, error: CLASS_CODE_ERROR };
  const nickname = validateNickname(v.nickname);
  return nickname === null ? { ok: true } : { ok: false, error: nickname };
}

/** The teacher's go button: 입장하기 when a class code is typed (re-enter it), else 반 열기 (a new class). */
export function teacherGoLabels(classCode: string): { label: string; busyLabel: string } {
  return classCode.trim() !== ""
    ? { label: ENTRY_COPY.enter, busyLabel: ENTRY_COPY.entering }
    : { label: ENTRY_COPY.openClass, busyLabel: ENTRY_COPY.opening };
}

// ─────────────────────────────────────── flows ───────────────────────────────────────

/** What a class entry needs from the app (EntryScreen passes the real functions). */
export interface ClassEntryDeps {
  joinClass(p: ClassJoinParams): Promise<{ sessionId: string }>;
  requestTeacherPass(body: {
    teacherKey: string;
    textLevel: TextLevel;
    classCode?: string;
  }): Promise<{ classCode: string; pass: string }>;
  rememberTeacher(t: TeacherSession): void;
  forgetTeacher(): void;
  /** The class this browser opened as a teacher (teacherClassCache: prefills the next teacher form). */
  saveTeacherClass(classCode: string): void;
  forgetTeacherClass(): void;
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
 * Teacher (Task 13's order): one-time pass for a new class — or, with a class code typed, for THAT
 * running class (a reload, a closed tab, a co-teacher; the server refuses a code with no live class
 * and never opens one for it) → remember the teacher (module memory only, for re-opening the same
 * class after a server restart) and the class code (teacherClassCache, to prefill the next teacher
 * form) → join with the pass → the hall as the teacher. The key goes only to the pass request and
 * the teacher session — never into the identity cache, a join option or the store — and the pass
 * only into that one join. A refused key rejects with the server's words before anything else
 * happens (a code the server says is not open is forgotten, so it is not offered again); a join
 * that fails after the pass forgets the teacher again (the class code stays: that class exists).
 */
export async function enterClassAsTeacher(
  deps: ClassEntryDeps,
  v: Who & { teacherKey: string; textLevel: TextLevel; classCode?: string },
): Promise<void> {
  const key = v.teacherKey.trim();
  const typed = v.classCode?.trim() ?? "";
  const wanted = typed === "" ? null : normalizeClassCode(typed);
  if (typed !== "" && wanted === null) throw new Error(CLASS_CODE_ERROR);
  const ask = { teacherKey: key, textLevel: v.textLevel };
  let granted: { classCode: string; pass: string };
  try {
    granted = await deps.requestTeacherPass(wanted === null ? ask : { ...ask, classCode: wanted });
  } catch (err) {
    if (wanted !== null && (err as { status?: unknown } | null)?.status === 404) deps.forgetTeacherClass();
    throw err;
  }
  const { classCode, pass } = granted;
  deps.rememberTeacher({ key, classCode, textLevel: v.textLevel });
  deps.saveTeacherClass(classCode);
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

// ───────────────────────────────────── the village ─────────────────────────────────────

/** What entering 케이슨 마을 needs from the app (EntryScreen passes the real functions). */
export interface VillageEntryDeps {
  /** Joins (or creates) a village room; rejects with Korean words (connection.joinVillage maps them). */
  joinVillage(p: { nickname: string; appearance: Appearance }): Promise<{ sessionId: string }>;
  saveIdentity(identity: CachedIdentity): void;
  clearKicked(): void;
  enterVillage(identity: Identity): void;
}

/**
 * 입장하기 in the default mode: straight into 케이슨 마을 — no class code, no destination step. The
 * look is remembered first (a later visit prefills it) and a deliberate entry clears an earlier kick;
 * then the village is joined and the screen moves. A rejected join leaves the screen where it is
 * (nothing is entered) and rejects with the join's Korean words.
 */
export async function enterVillageDirectly(deps: VillageEntryDeps, v: Who): Promise<void> {
  deps.saveIdentity({ nickname: v.nickname, appearance: v.appearance });
  deps.clearKicked();
  const room = await deps.joinVillage({ nickname: v.nickname, appearance: v.appearance });
  deps.enterVillage({ nickname: v.nickname, appearance: v.appearance, sessionId: room.sessionId });
}
