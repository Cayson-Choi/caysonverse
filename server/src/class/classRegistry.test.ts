import { describe, it, expect, afterEach } from "vitest";
import {
  CLASS_CODE_ALPHABET,
  MAX_CLASSES_DEFAULT,
  TEACHER_PASS_TTL_MS,
} from "@caysonverse/shared/escape/constants";
import { ClassRegistry, classRegistry, type ClassEntry } from "./classRegistry";
import type { VerifiedKey } from "./teacherKeys";

const key: VerifiedKey = { id: "t1", label: "새빛초 4-2", group: "saebit", operator: false };
const OPENER = { id: "t1", group: "saebit", label: "새빛초 4-2" };
const entry = (code: string, openedAt = 0): Omit<ClassEntry, "roomId"> => ({
  code,
  opener: OPENER,
  textLevel: "easy",
  openedAt,
});

afterEach(() => {
  delete process.env.CV_MAX_CLASSES;
});

describe("ClassRegistry", () => {
  it("registry: reserve/attach/release, 'taken' and 'full'", () => {
    const reg = new ClassRegistry(2);
    expect(reg.reserve(entry("AB2CDE", 5))).toBe("ok");
    expect(reg.get("AB2CDE")).toEqual({ ...entry("AB2CDE", 5), roomId: null });
    expect(reg.reserve(entry("AB2CDE"))).toBe("taken");
    expect(reg.reserve(entry("ZZ3ZZZ"))).toBe("ok");
    expect(reg.reserve(entry("QQ4QQQ"))).toBe("full");
    expect(reg.get("QQ4QQQ")).toBeUndefined();
    // At the cap an existing code still answers "taken", not "full".
    expect(reg.reserve(entry("AB2CDE"))).toBe("taken");

    reg.attach("AB2CDE", "room-a");
    expect(reg.get("AB2CDE")?.roomId).toBe("room-a");
    expect(reg.list().map((e) => e.code)).toEqual(["AB2CDE", "ZZ3ZZZ"]);

    reg.release("AB2CDE");
    expect(reg.get("AB2CDE")).toBeUndefined();
    expect(reg.list()).toHaveLength(1);
    expect(reg.reserve(entry("QQ4QQQ"))).toBe("ok");
    // Releasing an unknown code is a no-op.
    reg.release("NOPE22");
    expect(reg.list()).toHaveLength(2);
  });

  it("attach creates the entry when none was reserved (direct-create test path); without an entry it is a no-op", () => {
    const reg = new ClassRegistry(1);
    reg.attach("AB2CDE", "room-a", entry("AB2CDE", 7));
    expect(reg.get("AB2CDE")).toEqual({ ...entry("AB2CDE", 7), roomId: "room-a" });
    // An existing entry keeps its data and only gets the room id.
    reg.attach("AB2CDE", "room-b", { ...entry("AB2CDE", 99), textLevel: "hard" });
    expect(reg.get("AB2CDE")).toEqual({ ...entry("AB2CDE", 7), roomId: "room-b" });
    // Unknown code without an entry (e.g. released mid-creation): nothing is created.
    reg.attach("ZZ3ZZZ", "room-z");
    expect(reg.get("ZZ3ZZZ")).toBeUndefined();
  });

  it("list() is a snapshot, not the live store", () => {
    const reg = new ClassRegistry(3);
    reg.reserve(entry("AB2CDE"));
    const snap = reg.list();
    reg.reserve(entry("ZZ3ZZZ"));
    expect(snap).toHaveLength(1);
    expect(reg.list()).toHaveLength(2);
  });

  it("the cap defaults to CV_MAX_CLASSES, else MAX_CLASSES_DEFAULT", () => {
    process.env.CV_MAX_CLASSES = "3";
    const three = new ClassRegistry();
    for (const c of ["AAAAAA", "BBBBBB", "CCCCCC"]) expect(three.reserve(entry(c))).toBe("ok");
    expect(three.reserve(entry("DDDDDD"))).toBe("full");

    for (const bad of ["abc", "0", "-2", "1.5", ""]) {
      process.env.CV_MAX_CLASSES = bad;
      const reg = new ClassRegistry();
      for (let i = 0; i < MAX_CLASSES_DEFAULT; i++) {
        expect(reg.reserve(entry(`${CLASS_CODE_ALPHABET[i]}22222`))).toBe("ok");
      }
      expect(reg.reserve(entry("ZZZZZZ"))).toBe("full");
    }

    // An explicit argument wins over the environment.
    process.env.CV_MAX_CLASSES = "3";
    const one = new ClassRegistry(1);
    expect(one.reserve(entry("AAAAAA"))).toBe("ok");
    expect(one.reserve(entry("BBBBBB"))).toBe("full");
  });

  it("exports one process-wide registry", () => {
    expect(classRegistry).toBeInstanceOf(ClassRegistry);
  });
});

describe("teacher passes", () => {
  it("passes are single-use, expire after TEACHER_PASS_TTL_MS and are bound to one class", () => {
    const reg = new ClassRegistry();
    const p = reg.issuePass("AB2CDE", key, 0);
    expect(reg.consumePass(p, "ZZ3ZZZ", 1)).toBeNull();
    expect(reg.consumePass(p, "AB2CDE", 1)?.id).toBe("t1");
    expect(reg.consumePass(p, "AB2CDE", 2)).toBeNull();

    // Valid until just before the TTL ends …
    const early = reg.issuePass("AB2CDE", key, 1000);
    expect(reg.consumePass(early, "AB2CDE", 1000 + TEACHER_PASS_TTL_MS - 1)).toEqual(key);
    // … expired from the TTL on, and an expired pass stays dead.
    const late = reg.issuePass("AB2CDE", key, 1000);
    expect(reg.consumePass(late, "AB2CDE", 1000 + TEACHER_PASS_TTL_MS)).toBeNull();
    expect(reg.consumePass(late, "AB2CDE", 1000)).toBeNull();
  });

  it("a pass is 32 random bytes in base64url, never repeats, and carries the verified key", () => {
    const reg = new ClassRegistry();
    const passes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pass = reg.issuePass("AB2CDE", key, 0);
      expect(pass).toMatch(/^[A-Za-z0-9_-]{43}$/);
      passes.add(pass);
    }
    expect(passes.size).toBe(50);
    const op: VerifiedKey = { id: "operator", label: "운영자", group: "*", operator: true };
    expect(reg.consumePass(reg.issuePass("ZZ3ZZZ", op, 0), "ZZ3ZZZ", 0)).toEqual(op);
  });

  it("garbage and non-string passes are rejected", () => {
    const reg = new ClassRegistry();
    const p = reg.issuePass("AB2CDE", key, 0);
    for (const bad of [undefined, null, 1, {}, [p], "", `${p}x`, p.slice(1)]) {
      expect(reg.consumePass(bad, "AB2CDE", 1)).toBeNull();
    }
    // None of the failed attempts burned the real pass.
    expect(reg.consumePass(p, "AB2CDE", 1)?.id).toBe("t1");
  });

  it("releasing a class invalidates its outstanding passes only", () => {
    const reg = new ClassRegistry();
    reg.reserve(entry("AB2CDE"));
    reg.reserve(entry("ZZ3ZZZ"));
    const pa = reg.issuePass("AB2CDE", key, 0);
    const pz = reg.issuePass("ZZ3ZZZ", key, 0);
    reg.release("AB2CDE");
    expect(reg.consumePass(pa, "AB2CDE", 1)).toBeNull();
    expect(reg.consumePass(pz, "ZZ3ZZZ", 1)?.id).toBe("t1");
  });
});
