import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  hashKey,
  verifyTeacherKey,
  canTeach,
  loadTeacherKeys,
  resolveKeysFile,
  findRepoRoot,
  type TeacherKeyEntry,
  type VerifiedKey,
} from "./teacherKeys";

// Throwaway test values only — never a real key or ADMIN_CODE.
const KEY = "K7QX-2MPA-9TRW-4HEZ";
const ENTRIES: TeacherKeyEntry[] = [{ id: "t1", label: "새빛초 4-2", group: "saebit", sha256: hashKey(KEY) }];
const OPERATOR = "op-s3cret";

/** <repo>: this file lives in <repo>/server/src/class. */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "teacher-key.mjs");

let tmpDir = "";
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-teacher-keys-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.TEACHER_KEYS_FILE;
});

describe("hashKey", () => {
  it("is the sha256 hex of the trimmed key", () => {
    // sha256("abc") — the FIPS 180-2 test vector.
    const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(hashKey("abc")).toBe(ABC);
    expect(hashKey("  abc\n")).toBe(ABC);
    expect(hashKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(KEY)).not.toContain(KEY);
  });
});

describe("verifyTeacherKey", () => {
  it("verifies by sha256 and ignores surrounding spaces", () => {
    expect(verifyTeacherKey(` ${KEY} `, ENTRIES, undefined)).toEqual({
      id: "t1",
      label: "새빛초 4-2",
      group: "saebit",
      operator: false,
    });
    expect(verifyTeacherKey(KEY, ENTRIES, OPERATOR)?.id).toBe("t1");
  });

  it("rejects wrong, empty and non-string keys; an unset operator code never matches", () => {
    expect(verifyTeacherKey("K7QX-2MPA-9TRW-4HEX", ENTRIES, OPERATOR)).toBeNull(); // one symbol off
    expect(verifyTeacherKey(KEY.toLowerCase(), ENTRIES, OPERATOR)).toBeNull(); // keys are case-exact
    expect(verifyTeacherKey("", ENTRIES, OPERATOR)).toBeNull();
    expect(verifyTeacherKey("   ", ENTRIES, OPERATOR)).toBeNull();
    for (const notString of [undefined, null, 123, {}, [KEY], { toString: () => KEY }]) {
      expect(verifyTeacherKey(notString, ENTRIES, OPERATOR)).toBeNull();
    }
    // The stored hash itself is not a key (no hash-of-hash confusion).
    expect(verifyTeacherKey(ENTRIES[0].sha256, ENTRIES, OPERATOR)).toBeNull();
    // Unset / empty / blank operator code: nothing verifies as operator.
    expect(verifyTeacherKey("", [], undefined)).toBeNull();
    expect(verifyTeacherKey("", [], "")).toBeNull();
    expect(verifyTeacherKey("   ", [], "   ")).toBeNull();
    expect(verifyTeacherKey("undefined", [], undefined)).toBeNull();
    // No entries and a wrong operator code.
    expect(verifyTeacherKey(KEY, [], OPERATOR)).toBeNull();
  });

  it("the operator code verifies as operator", () => {
    expect(verifyTeacherKey("op-s3cret", ENTRIES, "op-s3cret")?.operator).toBe(true);
    expect(verifyTeacherKey(` ${OPERATOR} `, ENTRIES, OPERATOR)).toEqual({
      id: "operator",
      label: "운영자",
      group: "*",
      operator: true,
    });
    expect(verifyTeacherKey("op-s3cre", ENTRIES, OPERATOR)).toBeNull(); // prefix
  });

  it("an entry without a group verifies with the empty group", () => {
    const entries: TeacherKeyEntry[] = [{ id: "t9", label: "혼자 반", sha256: hashKey("NO-GROUP-KEY") }];
    expect(verifyTeacherKey("NO-GROUP-KEY", entries, undefined)).toEqual({
      id: "t9",
      label: "혼자 반",
      group: "",
      operator: false,
    });
  });
});

describe("canTeach", () => {
  const teacher = (id: string, group: string): VerifiedKey => ({ id, label: id, group, operator: false });
  const OPERATOR_KEY: VerifiedKey = { id: "operator", label: "운영자", group: "*", operator: true };

  it("canTeach: operator, same id, same non-empty group only", () => {
    // Operator teaches every class.
    expect(canTeach(OPERATOR_KEY, { id: "t1", group: "saebit" })).toBe(true);
    expect(canTeach(OPERATOR_KEY, { id: "t2", group: "" })).toBe(true);
    // The opener itself, even without a group.
    expect(canTeach(teacher("t1", "saebit"), { id: "t1", group: "saebit" })).toBe(true);
    expect(canTeach(teacher("t2", ""), { id: "t2", group: "" })).toBe(true);
    // A colleague of the same (non-empty) group.
    expect(canTeach(teacher("t3", "saebit"), { id: "t1", group: "saebit" })).toBe(true);
    // Anyone else: no.
    expect(canTeach(teacher("t4", "other"), { id: "t1", group: "saebit" })).toBe(false);
    expect(canTeach(teacher("t5", ""), { id: "t2", group: "" })).toBe(false); // empty group never matches
    expect(canTeach(teacher("t6", ""), { id: "t1", group: "saebit" })).toBe(false);
    // A teacher is not the operator just because a class was opened by the operator.
    expect(canTeach(teacher("t7", "saebit"), { id: "operator", group: "*" })).toBe(false);
  });
});

describe("loadTeacherKeys", () => {
  const write = (name: string, text: string): string => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, text, "utf8");
    return p;
  };
  const GOOD = { id: "t1", label: "새빛초 4-2", group: "saebit", sha256: hashKey(KEY) };

  it("loadTeacherKeys: missing file → [], malformed entries skipped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadTeacherKeys(path.join(tmpDir, "nope.json"))).toEqual([]);
    expect(warn).not.toHaveBeenCalled(); // no file yet is normal, not a warning

    const noGroup = { id: "t2", label: "그룹 없음", group: "", sha256: hashKey("SECOND-KEY") };
    const upper = { id: "t3", label: "대문자 해시", group: "g", sha256: hashKey("THIRD-KEY").toUpperCase() };
    const file = write(
      "keys.json",
      JSON.stringify({
        keys: [
          GOOD,
          null,
          "a string",
          42,
          [],
          { label: "id 없음", sha256: hashKey("x") },
          { id: "", label: "빈 id", sha256: hashKey("x") },
          { id: 7, label: "숫자 id", sha256: hashKey("x") },
          { id: "t4", sha256: hashKey("x") },
          { id: "t5", label: "", sha256: hashKey("x") },
          { id: "t6", label: "해시 없음" },
          { id: "t7", label: "짧은 해시", sha256: "abc123" },
          { id: "t8", label: "16진수 아님", sha256: "z".repeat(64) },
          { id: "t9", label: "그룹이 숫자", group: 5, sha256: hashKey("x") },
          { id: "t10", label: "운영자 그룹 사칭", group: "*", sha256: hashKey("x") },
          { id: "operator", label: "운영자 id 사칭", sha256: hashKey("x") },
          { id: "t1", label: "같은 id 두 번째", sha256: hashKey("x") },
          noGroup,
          upper,
        ],
      }),
    );
    expect(loadTeacherKeys(file)).toEqual([
      GOOD,
      { id: "t2", label: "그룹 없음", sha256: noGroup.sha256 }, // "" group = no group
      { id: "t3", label: "대문자 해시", group: "g", sha256: hashKey("THIRD-KEY") },
    ]);
    // One fixed-text warning with the count only.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("skipped 16");
    expect(warn.mock.calls.flat().map(String).join("\n")).not.toMatch(/[0-9a-f]{64}/);
  });

  it("an unreadable file shape → [] with a fixed warning that quotes nothing from the file", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = write("broken.json", `{"keys":[{"id":"t1","sha256":"${hashKey(KEY)}"`);
    expect(loadTeacherKeys(broken)).toEqual([]);
    expect(loadTeacherKeys(write("array.json", JSON.stringify([GOOD])))).toEqual([]);
    expect(loadTeacherKeys(write("keys-not-array.json", JSON.stringify({ keys: "nope" })))).toEqual([]);
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain(hashKey(KEY));
    expect(logged).not.toContain("sha256");
  });

  it("re-reads the file on every call (keys can be added without a restart)", () => {
    const file = write("keys.json", JSON.stringify({ keys: [GOOD] }));
    expect(loadTeacherKeys(file)).toHaveLength(1);
    const second = { id: "t2", label: "둘째", sha256: hashKey("SECOND-KEY") };
    fs.writeFileSync(file, JSON.stringify({ keys: [GOOD, second] }), "utf8");
    expect(loadTeacherKeys(file).map((e) => e.id)).toEqual(["t1", "t2"]);
  });

  it("reads TEACHER_KEYS_FILE when no path is given", () => {
    const file = write("from-env.json", JSON.stringify({ keys: [GOOD] }));
    process.env.TEACHER_KEYS_FILE = file;
    expect(loadTeacherKeys()).toEqual([GOOD]);
  });
});

describe("key-file path (ruling E7: repo-root relative, never cwd relative)", () => {
  it("resolves the default and relative paths against the repo root, absolute paths as given", () => {
    // Sanity: REPO_ROOT really is the repository root.
    expect(fs.existsSync(path.join(REPO_ROOT, "shared", "src", "escape", "constants.ts"))).toBe(true);

    expect(resolveKeysFile()).toBe(path.join(REPO_ROOT, "server", "teacher-keys.json"));
    expect(resolveKeysFile("e2e/fixtures/teacher-keys.e2e.json")).toBe(
      path.join(REPO_ROOT, "e2e", "fixtures", "teacher-keys.e2e.json"),
    );
    const abs = path.join(tmpDir, "abs.json");
    expect(resolveKeysFile(abs)).toBe(abs);

    process.env.TEACHER_KEYS_FILE = "e2e/fixtures/teacher-keys.e2e.json";
    expect(resolveKeysFile()).toBe(path.join(REPO_ROOT, "e2e", "fixtures", "teacher-keys.e2e.json"));
    process.env.TEACHER_KEYS_FILE = "";
    expect(resolveKeysFile()).toBe(path.join(REPO_ROOT, "server", "teacher-keys.json"));
  });

  it("does not depend on the working directory (`npm run dev` runs the server from server/)", () => {
    const before = process.cwd();
    const expected = path.join(REPO_ROOT, "server", "teacher-keys.json");
    try {
      process.chdir(path.join(REPO_ROOT, "server"));
      expect(resolveKeysFile()).toBe(expected);
      process.chdir(os.tmpdir());
      expect(resolveKeysFile()).toBe(expected);
    } finally {
      process.chdir(before);
    }
  });

  it("finds the repo root from the source tree and from the server/dist bundle alike", () => {
    expect(findRepoRoot(path.join(REPO_ROOT, "server", "src", "class"))).toBe(REPO_ROOT);
    // The production bundle runs from server/dist (one level shallower than src/class).
    expect(findRepoRoot(path.join(REPO_ROOT, "server", "dist"))).toBe(REPO_ROOT);
    // Generic walk-up: the nearest ancestor whose package.json declares workspaces.
    const root = path.join(tmpDir, "repo");
    fs.mkdirSync(path.join(root, "pkg", "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: ["pkg"] }));
    fs.writeFileSync(path.join(root, "pkg", "package.json"), JSON.stringify({ name: "pkg" }));
    expect(findRepoRoot(path.join(root, "pkg", "a", "b"))).toBe(root);
  });
});

describe("scripts/teacher-key.mjs (plain node, ruling E8)", () => {
  const KEY_RE = /\b([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})\b/;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, TEACHER_KEYS_FILE: "" },
    });

  it("issues a readable key, prints it once with the warning, and stores only its sha256", () => {
    const file = path.join(tmpDir, "sub", "k.json");
    const res = run("--id", "t-test", "--label", "테스트", "--group", "g1", "--file", file);
    expect(res.status).toBe(0);
    const match = KEY_RE.exec(res.stdout);
    expect(match).not.toBeNull();
    const key = match![1];
    expect(res.stdout.split(key)).toHaveLength(2); // printed exactly once
    expect(res.stdout).toContain("이 키는 다시 볼 수 없어요. 선생님께 안전하게 전달하세요.");
    expect(key).not.toMatch(/[01OI]/);

    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toContain(key);
    expect(text).not.toContain(key.replace(/-/g, ""));
    expect(JSON.parse(text)).toEqual({
      keys: [{ id: "t-test", label: "테스트", group: "g1", sha256: hashKey(key) }],
    });
    // The server accepts exactly that key.
    expect(verifyTeacherKey(key, loadTeacherKeys(file), undefined)).toEqual({
      id: "t-test",
      label: "테스트",
      group: "g1",
      operator: false,
    });

    // A second key is appended, the first is kept.
    const res2 = run("--id", "t-two", "--label", "둘째", "--file", file);
    expect(res2.status).toBe(0);
    const key2 = KEY_RE.exec(res2.stdout)![1];
    expect(key2).not.toBe(key);
    const entries = loadTeacherKeys(file);
    expect(entries.map((e) => e.id)).toEqual(["t-test", "t-two"]);
    expect(entries[1]).toEqual({ id: "t-two", label: "둘째", sha256: hashKey(key2) });
    expect(fs.readFileSync(file, "utf8")).not.toContain(key2);
  });

  it("refuses duplicate ids, reserved ids/groups, missing fields and a malformed file — file untouched", () => {
    const file = path.join(tmpDir, "k.json");
    expect(run("--id", "t1", "--label", "첫째", "--file", file).status).toBe(0);
    const before = fs.readFileSync(file, "utf8");

    const refused = [
      ["--id", "t1", "--label", "같은 id", "--file", file],
      ["--id", "operator", "--label", "운영자 사칭", "--file", file],
      ["--id", "t2", "--label", "별 그룹", "--group", "*", "--file", file],
      ["--id", "t2", "--file", file],
      ["--label", "id 없음", "--file", file],
      ["--id", "t2", "--label", "   ", "--file", file],
      ["--id", "has space", "--label", "공백 id", "--file", file],
      ["--id", "t2", "--label", "모르는 옵션", "--bogus", "x", "--file", file],
    ];
    for (const args of refused) {
      const res = run(...args);
      expect(res.status).not.toBe(0);
      expect(res.stdout).not.toMatch(KEY_RE);
    }
    expect(fs.readFileSync(file, "utf8")).toBe(before);

    const bad = path.join(tmpDir, "bad.json");
    fs.writeFileSync(bad, "{ not json", "utf8");
    const res = run("--id", "t3", "--label", "망가진 파일", "--file", bad);
    expect(res.status).not.toBe(0);
    expect(fs.readFileSync(bad, "utf8")).toBe("{ not json");
  });
});
