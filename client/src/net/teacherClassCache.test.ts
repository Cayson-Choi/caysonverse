import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TEACHER_CLASS_PREFILL_MS,
  forgetTeacherClass,
  loadTeacherClass,
  saveTeacherClass,
  teacherClassPrefill,
} from "./teacherClassCache";

// In-memory Storage (client vitest runs in the `node` env — no real localStorage).
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const KEY = "cv.teacherClass";
const T0 = 1_800_000_000_000;

beforeEach(() => {
  vi.stubGlobal("localStorage", memStorage());
});

describe("teacherClassPrefill — the class a reloaded teacher tab is offered (final review I2)", () => {
  it("a recent canonical code is offered, up to TEACHER_CLASS_PREFILL_MS old", () => {
    expect(TEACHER_CLASS_PREFILL_MS).toBe(3 * 60 * 60 * 1000);
    expect(teacherClassPrefill({ code: "K7Q2XM", at: T0 }, T0)).toBe("K7Q2XM");
    expect(teacherClassPrefill({ code: "K7Q2XM", at: T0 }, T0 + TEACHER_CLASS_PREFILL_MS)).toBe("K7Q2XM");
  });

  it("an old one (yesterday's class), a future one, a bad code or a bad shape is not", () => {
    expect(teacherClassPrefill({ code: "K7Q2XM", at: T0 }, T0 + TEACHER_CLASS_PREFILL_MS + 1)).toBe("");
    expect(teacherClassPrefill({ code: "K7Q2XM", at: T0 + 60_000 }, T0)).toBe("");
    expect(teacherClassPrefill({ code: "K7Q", at: T0 }, T0)).toBe("");
    expect(teacherClassPrefill({ code: "K7Q2XM" }, T0)).toBe("");
    expect(teacherClassPrefill({ code: "K7Q2XM", at: "now" }, T0)).toBe("");
    expect(teacherClassPrefill(null, T0)).toBe("");
    expect(teacherClassPrefill("K7Q2XM", T0)).toBe("");
  });

  it("a stored lower-case code comes back canonical", () => {
    expect(teacherClassPrefill({ code: "k7q2xm", at: T0 }, T0)).toBe("K7Q2XM");
  });
});

describe("save / load / forget", () => {
  it("nothing stored → empty (a new class)", () => {
    expect(loadTeacherClass(T0)).toBe("");
  });

  it("round-trips the class the teacher opened, then stops offering it after the limit", () => {
    saveTeacherClass("k7q2xm", T0);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ code: "K7Q2XM", at: T0 });
    expect(loadTeacherClass(T0 + 60_000)).toBe("K7Q2XM");
    expect(loadTeacherClass(T0 + TEACHER_CLASS_PREFILL_MS + 1)).toBe("");
  });

  it("stores only the code and the time — never anything that looks like a key", () => {
    saveTeacherClass("K7Q2XM", T0);
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY)!)).sort()).toEqual(["at", "code"]);
  });

  it("ignores a code that is not one, and forget removes the entry", () => {
    saveTeacherClass("ABCD-EFGH-JKMN", T0);
    expect(localStorage.getItem(KEY)).toBeNull();
    saveTeacherClass("K7Q2XM", T0);
    forgetTeacherClass();
    expect(loadTeacherClass(T0)).toBe("");
  });

  it("never throws: corrupt JSON or storage that refuses", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadTeacherClass(T0)).toBe("");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadTeacherClass(T0)).toBe("");
    expect(() => saveTeacherClass("K7Q2XM", T0)).not.toThrow();
    expect(() => forgetTeacherClass()).not.toThrow();
  });
});
