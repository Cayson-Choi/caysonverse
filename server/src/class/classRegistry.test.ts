import { describe, it, expect, afterEach } from "vitest";
import {
  CLASS_CODE_ALPHABET,
  MAX_CLASSES_DEFAULT,
  TEACHER_PASS_TTL_MS,
} from "@caysonverse/shared/escape/constants";
import { ClassRegistry, classRegistry, MAX_PASSES_PER_CLASS, type ClassEntry } from "./classRegistry";
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

    expect(reg.attach("AB2CDE", "room-a")).toBe(true);
    expect(reg.get("AB2CDE")?.roomId).toBe("room-a");
    expect(reg.list().map((e) => e.code)).toEqual(["AB2CDE", "ZZ3ZZZ"]);

    reg.release("AB2CDE", "room-a");
    expect(reg.get("AB2CDE")).toBeUndefined();
    expect(reg.list()).toHaveLength(1);
    expect(reg.reserve(entry("QQ4QQQ"))).toBe("ok");
    // Releasing an unknown code is a no-op.
    reg.release("NOPE22", "room-a");
    reg.release("NOPE22", null);
    expect(reg.list()).toHaveLength(2);
  });

  it("attach creates the entry when none was reserved (direct-create test path); without an entry it is a no-op", () => {
    const reg = new ClassRegistry(1);
    expect(reg.attach("AB2CDE", "room-a", entry("AB2CDE", 7))).toBe(true);
    expect(reg.get("AB2CDE")).toEqual({ ...entry("AB2CDE", 7), roomId: "room-a" });
    // An existing entry keeps its data; attaching the same room again is fine.
    expect(reg.attach("AB2CDE", "room-a", { ...entry("AB2CDE", 99), textLevel: "hard" })).toBe(true);
    expect(reg.get("AB2CDE")).toEqual({ ...entry("AB2CDE", 7), roomId: "room-a" });
    // Unknown code without an entry (e.g. released mid-creation): nothing is created.
    expect(reg.attach("ZZ3ZZZ", "room-z")).toBe(false);
    expect(reg.get("ZZ3ZZZ")).toBeUndefined();
  });

  // Controller ruling (Task 4 registry hardening): Colyseus calls onDispose even on a room whose
  // onCreate threw, so a room may only ever touch the entry that carries ITS roomId.
  it("attach only fills an empty roomId or the same one: a second room cannot take over a live code", () => {
    const reg = new ClassRegistry(3);
    reg.reserve(entry("AB2CDE"));
    expect(reg.attach("AB2CDE", "room-a")).toBe(true); // null → room-a
    expect(reg.attach("AB2CDE", "room-b", entry("AB2CDE", 5))).toBe(false);
    expect(reg.get("AB2CDE")?.roomId).toBe("room-a");
  });

  it("release with a wrong roomId is a no-op: the entry and its passes survive", () => {
    const reg = new ClassRegistry(3);
    reg.reserve(entry("AB2CDE"));
    reg.attach("AB2CDE", "room-live");
    const pass = reg.issuePass("AB2CDE", key, 0);

    reg.release("AB2CDE", "room-orphan"); // e.g. a refused client create's late onDispose
    reg.release("AB2CDE", null); // e.g. a failed creation that never attached
    expect(reg.get("AB2CDE")?.roomId).toBe("room-live");
    expect(reg.consumePass(pass, "AB2CDE", 1)?.id).toBe("t1");

    // A reserved entry (roomId still null) is released by null — the HTTP route's failure path.
    reg.reserve(entry("ZZ3ZZZ"));
    reg.release("ZZ3ZZZ", "room-live");
    expect(reg.get("ZZ3ZZZ")).toBeDefined();
    reg.release("ZZ3ZZZ", null);
    expect(reg.get("ZZ3ZZZ")).toBeUndefined();

    // The live room itself releases its class (and the class's passes).
    const later = reg.issuePass("AB2CDE", key, 0);
    reg.release("AB2CDE", "room-live");
    expect(reg.get("AB2CDE")).toBeUndefined();
    expect(reg.consumePass(later, "AB2CDE", 1)).toBeNull();
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
    reg.release("AB2CDE", null);
    expect(reg.consumePass(pa, "AB2CDE", 1)).toBeNull();
    expect(reg.consumePass(pz, "ZZ3ZZZ", 1)?.id).toBe("t1");
  });
});

describe("outstanding-pass cap (fix round 1)", () => {
  it("keeps at most MAX_PASSES_PER_CLASS passes per class and drops the oldest", () => {
    expect(MAX_PASSES_PER_CLASS).toBe(20);
    const reg = new ClassRegistry();
    const issued: string[] = [];
    for (let i = 0; i < MAX_PASSES_PER_CLASS + 5; i++) issued.push(reg.issuePass("AB2CDE", key, i));
    expect(reg.passCount("AB2CDE")).toBe(MAX_PASSES_PER_CLASS);
    // The five oldest are gone, the newest twenty still work (each once).
    for (const p of issued.slice(0, 5)) expect(reg.consumePass(p, "AB2CDE", 100)).toBeNull();
    for (const p of issued.slice(5)) expect(reg.consumePass(p, "AB2CDE", 100)?.id).toBe("t1");
    expect(reg.passCount("AB2CDE")).toBe(0);
  });

  it("the cap is per class: another class's passes are neither counted nor dropped", () => {
    const reg = new ClassRegistry();
    const a = Array.from({ length: MAX_PASSES_PER_CLASS }, (_, i) => reg.issuePass("AB2CDE", key, i));
    const z = Array.from({ length: MAX_PASSES_PER_CLASS }, (_, i) => reg.issuePass("ZZ3ZZZ", key, i));
    expect(reg.passCount("AB2CDE")).toBe(MAX_PASSES_PER_CLASS);
    expect(reg.passCount("ZZ3ZZZ")).toBe(MAX_PASSES_PER_CLASS);
    for (const p of a) expect(reg.consumePass(p, "AB2CDE", 50)?.id).toBe("t1");
    for (const p of z) expect(reg.consumePass(p, "ZZ3ZZZ", 50)?.id).toBe("t1");
  });

  it("issuing prunes only that class's expired passes (no full sweep per call)", () => {
    const reg = new ClassRegistry();
    for (let i = 0; i < 5; i++) reg.issuePass("AB2CDE", key, 0);
    const oldZ = Array.from({ length: 5 }, () => reg.issuePass("ZZ3ZZZ", key, 0));
    // Everything above has expired by now; issuing for AB2CDE sweeps AB2CDE's bucket only.
    const fresh = reg.issuePass("AB2CDE", key, TEACHER_PASS_TTL_MS);
    expect(reg.passCount("AB2CDE")).toBe(1);
    expect(reg.passCount("ZZ3ZZZ")).toBe(5);
    // ZZ3ZZZ's expired passes are still refused, and refusing them drops them.
    for (const p of oldZ) expect(reg.consumePass(p, "ZZ3ZZZ", TEACHER_PASS_TTL_MS)).toBeNull();
    expect(reg.passCount("ZZ3ZZZ")).toBe(0);
    expect(reg.consumePass(fresh, "AB2CDE", TEACHER_PASS_TTL_MS)?.id).toBe("t1");
  });

  it("a pass shown to the wrong class is kept in its own class's bucket; release empties the bucket", () => {
    const reg = new ClassRegistry();
    reg.reserve(entry("AB2CDE"));
    const p = reg.issuePass("AB2CDE", key, 0);
    expect(reg.consumePass(p, "ZZ3ZZZ", 1)).toBeNull();
    expect(reg.passCount("AB2CDE")).toBe(1);
    expect(reg.passCount("ZZ3ZZZ")).toBe(0);
    reg.issuePass("AB2CDE", key, 0);
    reg.release("AB2CDE", null);
    expect(reg.passCount("AB2CDE")).toBe(0);
    expect(reg.consumePass(p, "AB2CDE", 1)).toBeNull();
  });
});
