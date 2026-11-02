import { describe, it, expect, beforeEach, vi } from "vitest";
import { forgetTeacher, getTeacher, rememberTeacher } from "./teacherSession";

/** A Storage whose every method is a spy, so a test can prove nothing was written. */
function spyStorage(): Storage {
  return {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  } as unknown as Storage;
}

describe("teacherSession (module memory only)", () => {
  beforeEach(() => {
    forgetTeacher();
  });

  it("teacherSession lives in memory only (no localStorage/sessionStorage writes)", () => {
    const local = spyStorage();
    const session = spyStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    try {
      rememberTeacher({ key: "TK-SECRET-KEY", classCode: "AB2CDE", textLevel: "hard" });
      expect(getTeacher()).toEqual({ key: "TK-SECRET-KEY", classCode: "AB2CDE", textLevel: "hard" });
      forgetTeacher();
      for (const storage of [local, session]) {
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.getItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forgetTeacher drops the key; nothing is remembered at start", () => {
    expect(getTeacher()).toBeNull();
    rememberTeacher({ key: "K", classCode: "AB2CDE", textLevel: "easy" });
    expect(getTeacher()).not.toBeNull();
    forgetTeacher();
    expect(getTeacher()).toBeNull();
  });

  it("stores the normalised class code and hands out copies the caller cannot change", () => {
    rememberTeacher({ key: "K", classCode: " ab2cde ", textLevel: "easy" });
    const first = getTeacher()!;
    expect(first.classCode).toBe("AB2CDE");
    first.key = "changed";
    expect(getTeacher()!.key).toBe("K");
  });
});
