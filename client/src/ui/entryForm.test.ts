import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { NICKNAME_ERROR } from "./validation";
import { BUILDER_FONT_TEXT } from "./builderOptions";
import {
  CLASS_CODE_ERROR,
  DESTINATION_FONT_TEXT,
  ENTRY_COPY,
  SHEET_PRESS_GUARD_MS,
  SHOW_WORLD_ON_ENTRY,
  TEACHER_KEY_ERROR,
  TEXT_LEVEL_OPTIONS,
  entryDestinations,
  entryModeFromUrl,
  enterClassAsStudent,
  enterClassAsTeacher,
  validateStudentEntry,
  validateTeacherEntry,
  refusalField,
  sheetPressAllowed,
  teacherFieldsAfter,
  type ClassEntryDeps,
  type TeacherFields,
} from "./entryForm";

describe("entryModeFromUrl", () => {
  it("entryModeFromUrl", () => {
    expect(entryModeFromUrl("?world=legacy")).toBe("legacy");
    expect(entryModeFromUrl("")).toBe("student");
  });

  it("only the exact ?world=legacy link opens the current world's entry", () => {
    expect(entryModeFromUrl("?debug=1&world=legacy")).toBe("legacy");
    expect(entryModeFromUrl("world=legacy")).toBe("legacy");
    expect(entryModeFromUrl("?world=")).toBe("student");
    expect(entryModeFromUrl("?world=new")).toBe("student");
    expect(entryModeFromUrl("?world=Legacy")).toBe("student");
    expect(entryModeFromUrl("?legacy")).toBe("student");
    expect(entryModeFromUrl("?%E0%A4%A")).toBe("student"); // a malformed escape never throws
  });
});

describe("validateStudentEntry", () => {
  it("student entry needs a 6-symbol class code and a valid nickname", () => {
    expect(validateStudentEntry({ classCode: "K7Q2XM", nickname: "하늘별" })).toEqual({ ok: true });
    // Lower case and surrounding spaces are tidied the way the server reads the code.
    expect(validateStudentEntry({ classCode: " k7q2xm ", nickname: "하늘별" })).toEqual({ ok: true });

    const codeError = { ok: false, error: CLASS_CODE_ERROR };
    expect(validateStudentEntry({ classCode: "", nickname: "하늘별" })).toEqual(codeError);
    expect(validateStudentEntry({ classCode: "K7Q2X", nickname: "하늘별" })).toEqual(codeError);
    expect(validateStudentEntry({ classCode: "K7Q2XMM", nickname: "하늘별" })).toEqual(codeError);
    // 0/O/1/I are not class-code symbols.
    expect(validateStudentEntry({ classCode: "K7Q2X0", nickname: "하늘별" })).toEqual(codeError);
    expect(validateStudentEntry({ classCode: "K7Q2XO", nickname: "하늘별" })).toEqual(codeError);

    const nickError = { ok: false, error: NICKNAME_ERROR };
    expect(validateStudentEntry({ classCode: "K7Q2XM", nickname: "" })).toEqual(nickError);
    expect(validateStudentEntry({ classCode: "K7Q2XM", nickname: "별" })).toEqual(nickError);
    expect(validateStudentEntry({ classCode: "K7Q2XM", nickname: "하늘별!" })).toEqual(nickError);
    expect(validateStudentEntry({ classCode: "K7Q2XM", nickname: "가".repeat(13) })).toEqual(nickError);
  });

  it("names the class code first (it is the field in the sheet; the nickname was checked on the plate)", () => {
    expect(validateStudentEntry({ classCode: "", nickname: "" })).toEqual({ ok: false, error: CLASS_CODE_ERROR });
  });

  it("uses the fixed error words", () => {
    expect(CLASS_CODE_ERROR).toBe("반 코드 6자리를 넣어 주세요");
    expect(TEACHER_KEY_ERROR).toBe("선생님 키를 넣어 주세요");
  });
});

describe("validateTeacherEntry", () => {
  it("teacher entry needs a non-empty key and a valid nickname", () => {
    expect(validateTeacherEntry({ teacherKey: "ABCD-EFGH-JKLM-NPQR", nickname: "김쌤" })).toEqual({ ok: true });
    // Any non-empty key is sent: only the server can say whether it is right.
    expect(validateTeacherEntry({ teacherKey: "x", nickname: "김쌤" })).toEqual({ ok: true });

    const keyError = { ok: false, error: TEACHER_KEY_ERROR };
    expect(validateTeacherEntry({ teacherKey: "", nickname: "김쌤" })).toEqual(keyError);
    expect(validateTeacherEntry({ teacherKey: "   ", nickname: "김쌤" })).toEqual(keyError);

    expect(validateTeacherEntry({ teacherKey: "ABCD", nickname: "김" })).toEqual({ ok: false, error: NICKNAME_ERROR });
    // The key is the field in the sheet, so it is named first.
    expect(validateTeacherEntry({ teacherKey: "", nickname: "" })).toEqual(keyError);
  });
});

describe("entryDestinations — 어디로 갈까요?", () => {
  it("ships with one experience, AI 학교 탈출 (the current world stays behind ?world=legacy)", () => {
    expect(SHOW_WORLD_ON_ENTRY).toBe(false);
    const list = entryDestinations();
    expect(list.map((d) => d.id)).toEqual(["escape"]);
    expect(list[0]).toEqual({ id: "escape", title: "AI 학교 탈출", line: "반 코드로 친구들과 함께 AI 윤리 방탈출" });
  });

  it("lists the current world as a second card when SHOW_WORLD_ON_ENTRY is flipped", () => {
    const list = entryDestinations(true);
    expect(list.map((d) => d.id)).toEqual(["escape", "world"]);
    expect(list[1].title).toBe("지금 월드");
    expect(list[1].line.length).toBeGreaterThan(0);
    expect(entryDestinations(false).map((d) => d.id)).toEqual(["escape"]);
  });

  it("hands out the same frozen cards on every render", () => {
    expect(entryDestinations()).toBe(entryDestinations());
    expect(Object.isFrozen(entryDestinations())).toBe(true);
    expect(Object.isFrozen(entryDestinations(true)[1])).toBe(true);
  });
});

describe("ENTRY_COPY", () => {
  it("uses the fixed words of the destination step", () => {
    expect(ENTRY_COPY.sheetTitle).toBe("어디로 갈까요?");
    expect(ENTRY_COPY.classCode).toBe("반 코드");
    expect(ENTRY_COPY.classCodePlaceholder).toBe("6자리, 예: K7Q2XM");
    expect(ENTRY_COPY.nicknameNote).toBe("실명 대신 별명을 써 주세요");
    expect(ENTRY_COPY.enter).toBe("입장하기");
    expect(ENTRY_COPY.teacherAsk).toBe("선생님이신가요?");
    expect(ENTRY_COPY.teacherKey).toBe("선생님 키");
    expect(ENTRY_COPY.textLevel).toBe("글 수준");
    expect(ENTRY_COPY.openClass).toBe("반 열기");
  });

  it("offers the two reading levels the server knows", () => {
    expect(TEXT_LEVEL_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["easy", "쉬운 말"],
      ["hard", "조금 어려운 말"],
    ]);
  });

  it("puts the sheet's display words into the builder's Jua subset", () => {
    for (const word of [ENTRY_COPY.sheetTitle, ENTRY_COPY.openClass, ENTRY_COPY.teacherAsk, ...entryDestinations(true).map((d) => d.title)]) {
      expect(DESTINATION_FONT_TEXT).toContain(word);
    }
    expect(BUILDER_FONT_TEXT).toContain(DESTINATION_FONT_TEXT);
  });
});

// ─────────────────────────────── the class entry flows (fake app) ───────────────────────────────

type Call = [string, ...unknown[]];

/** Fake app: records every call in order; joinClass / requestTeacherPass do what `opts` says. */
function fakeDeps(opts: { join?: () => Promise<{ sessionId: string }>; pass?: () => Promise<{ classCode: string; pass: string }> } = {}) {
  const calls: Call[] = [];
  const deps: ClassEntryDeps = {
    joinClass: (p) => {
      calls.push(["joinClass", p]);
      return opts.join ? opts.join() : Promise.resolve({ sessionId: "sid-1" });
    },
    requestTeacherPass: (body) => {
      calls.push(["requestTeacherPass", body]);
      return opts.pass ? opts.pass() : Promise.resolve({ classCode: "H4TQ9W", pass: "pass-123" });
    },
    rememberTeacher: (t) => void calls.push(["rememberTeacher", t]),
    forgetTeacher: () => void calls.push(["forgetTeacher"]),
    saveIdentity: (identity) => void calls.push(["saveIdentity", identity]),
    clearKicked: () => void calls.push(["clearKicked"]),
    enterHub: (identity, isTeacher) => void calls.push(["enterHub", identity, isTeacher]),
  };
  const names = () => calls.map((c) => c[0]);
  return { deps, calls, names };
}

const LOOK = { ...DEFAULT_APPEARANCE };

describe("enterClassAsStudent", () => {
  it("joins with the canonical code, remembers code + look, and enters the hall as a student", async () => {
    const { deps, calls, names } = fakeDeps();
    await enterClassAsStudent(deps, { classCode: " k7q2xm ", nickname: "하늘별", appearance: LOOK });

    // A key left behind by an earlier failed 반 열기 must never make this tab a teacher on a rejoin.
    expect(names()).toEqual(["forgetTeacher", "saveIdentity", "clearKicked", "joinClass", "enterHub"]);
    expect(calls[1][1]).toEqual({ nickname: "하늘별", appearance: LOOK, classCode: "K7Q2XM" });
    expect(calls[3][1]).toEqual({ classCode: "K7Q2XM", nickname: "하늘별", appearance: LOOK });
    expect(calls[3][1]).not.toHaveProperty("teacherPass");
    expect(calls[4]).toEqual(["enterHub", { nickname: "하늘별", appearance: LOOK, sessionId: "sid-1", classCode: "K7Q2XM" }, false]);
  });

  it("stays on the entry with the join's own words when the class refuses", async () => {
    const refusal = "반 코드를 확인해 주세요. 수업이 끝났거나 반이 가득 찼을 수도 있어요.";
    const { deps, names } = fakeDeps({ join: () => Promise.reject(new Error(refusal)) });
    await expect(enterClassAsStudent(deps, { classCode: "K7Q2XM", nickname: "하늘별", appearance: LOOK })).rejects.toThrow(refusal);
    expect(names()).not.toContain("enterHub");
  });

  it("refuses a code that can never match without asking the server", async () => {
    const { deps, names } = fakeDeps();
    await expect(enterClassAsStudent(deps, { classCode: "K7Q", nickname: "하늘별", appearance: LOOK })).rejects.toThrow(CLASS_CODE_ERROR);
    expect(names()).toEqual([]);
  });
});

describe("enterClassAsTeacher", () => {
  const TEACHER = { teacherKey: "  abcd-efgh-jkmn-pqrs  ", textLevel: "hard" as const, nickname: "김쌤", appearance: LOOK };

  it("pass → rememberTeacher → joinClass({ …, teacherPass }) → enterHub(identity, true)", async () => {
    const { deps, calls, names } = fakeDeps();
    await enterClassAsTeacher(deps, TEACHER);

    expect(names()).toEqual(["requestTeacherPass", "rememberTeacher", "saveIdentity", "clearKicked", "joinClass", "enterHub"]);
    expect(calls[0][1]).toEqual({ teacherKey: "abcd-efgh-jkmn-pqrs", textLevel: "hard" });
    expect(calls[1][1]).toEqual({ key: "abcd-efgh-jkmn-pqrs", classCode: "H4TQ9W", textLevel: "hard" });
    expect(calls[2][1]).toEqual({ nickname: "김쌤", appearance: LOOK, classCode: "H4TQ9W" });
    expect(calls[4][1]).toEqual({ classCode: "H4TQ9W", nickname: "김쌤", appearance: LOOK, teacherPass: "pass-123" });
    expect(calls[5]).toEqual(["enterHub", { nickname: "김쌤", appearance: LOOK, sessionId: "sid-1", classCode: "H4TQ9W" }, true]);
  });

  it("never stores or hands on the key or the pass beyond the pass request, the teacher session and the one join", async () => {
    const { deps, calls } = fakeDeps();
    await enterClassAsTeacher(deps, TEACHER);
    for (const [name, ...args] of calls) {
      const text = JSON.stringify(args);
      if (name !== "requestTeacherPass" && name !== "rememberTeacher") expect(text).not.toContain("abcd-efgh");
      if (name !== "joinClass") expect(text).not.toContain("pass-123");
    }
  });

  it("a refused key shows the server's words and opens nothing", async () => {
    const words = "선생님 키가 맞지 않아요";
    const { deps, names } = fakeDeps({ pass: () => Promise.reject(new Error(words)) });
    await expect(enterClassAsTeacher(deps, TEACHER)).rejects.toThrow(words);
    expect(names()).toEqual(["requestTeacherPass"]);
  });

  it("forgets the teacher again when the class join fails after the pass", async () => {
    const { deps, names } = fakeDeps({ join: () => Promise.reject(new Error("연결에 실패했습니다. 잠시 후 다시 시도해주세요.")) });
    await expect(enterClassAsTeacher(deps, TEACHER)).rejects.toThrow("연결에 실패했습니다");
    expect(names()).toEqual(["requestTeacherPass", "rememberTeacher", "saveIdentity", "clearKicked", "joinClass", "forgetTeacher"]);
  });
});

// ─────────────────────────────── Fix round 1 ───────────────────────────────

describe("teacherFieldsAfter — the teacher key never outlives the open sheet", () => {
  const typed: TeacherFields = { role: "teacher", teacherKey: "ABCD-EFGH" };

  it("closing the sheet (✕ / Esc / veil / 바꾸기) goes back to 학생 and forgets the key", () => {
    expect(teacherFieldsAfter(typed, "close")).toEqual({ role: "student", teacherKey: "" });
  });

  it("switching back to 학생 forgets the key; switching to 선생님 starts empty", () => {
    expect(teacherFieldsAfter(typed, "student")).toEqual({ role: "student", teacherKey: "" });
    expect(teacherFieldsAfter({ role: "student", teacherKey: "" }, "teacher")).toEqual({ role: "teacher", teacherKey: "" });
  });

  it("a refused key is kept for fixing a typo (a refusal is not one of the events)", () => {
    // EntryScreen applies only these three events to the key; a refusal just shows words.
    expect(typed.teacherKey).toBe("ABCD-EFGH");
    expect(teacherFieldsAfter(typed, "teacher")).toEqual(typed);
  });
});

describe("sheetPressAllowed — a double click / tap on 입장하기 must not land on the sheet it opened", () => {
  it("ignores presses for SHEET_PRESS_GUARD_MS after the sheet opened", () => {
    expect(SHEET_PRESS_GUARD_MS).toBe(350);
    expect(sheetPressAllowed(1000, 1000)).toBe(false);
    expect(sheetPressAllowed(1000, 1120)).toBe(false); // a typical double click's second press
    expect(sheetPressAllowed(1000, 1349.9)).toBe(false);
    expect(sheetPressAllowed(1000, 1350)).toBe(true);
    expect(sheetPressAllowed(1000, 5000)).toBe(true);
  });
});

describe("refusalField — the field a server refusal points at", () => {
  it("a student's refused join points at the class code", () => {
    expect(refusalField("student", new Error("반 코드를 확인해 주세요. 수업이 끝났거나 반이 가득 찼을 수도 있어요."))).toBe("code");
  });

  it("a teacher's refused key (HTTP 4xx from the pass request) points at the key; other failures at nothing", () => {
    const refused = Object.assign(new Error("선생님 키가 올바르지 않아요"), { status: 401 });
    expect(refusalField("teacher", refused)).toBe("key");
    expect(refusalField("teacher", Object.assign(new Error("잠시 후"), { status: 429 }))).toBe("key");
    // No answer (status 0), a server fault, or the class join after a good pass: the key is not at fault.
    expect(refusalField("teacher", Object.assign(new Error("연결에 실패했습니다."), { status: 0 }))).toBeNull();
    expect(refusalField("teacher", Object.assign(new Error("서버 오류"), { status: 500 }))).toBeNull();
    expect(refusalField("teacher", new Error("연결에 실패했습니다."))).toBeNull();
  });
});
