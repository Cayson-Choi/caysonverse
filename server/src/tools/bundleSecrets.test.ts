/**
 * Tests for scripts/check-bundle-secrets.ts (Task 25): the needles find a planted secret in a built-looking bundle, in the
 * literal and the \uXXXX form; the public labels the client prints itself ("마지막 문") are not a hit; the teacher key hashes are
 * found; the CLI exits 0 on a clean folder and 1 on a planted one, an empty one and a missing one.
 * Lives in the server workspace like the other script tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { keyHashNeedles, listBundleFiles, main, roomNeedles, scanFiles, scanText } from "../../../scripts/check-bundle-secrets";
import { ROOM_DEFS } from "../escape/rooms";

const counsel = ROOM_DEFS.counsel!;
const HINT = counsel.stages[0].hints[0];
/** A string a built client would carry: ordinary UI copy, including the public label of the last door. */
const CLEAN = `var a="마지막 문",b="상담실",c="자외선 비추기";console.log(a,b,c,"1234");`;

function escapeUnits(s: string): string {
  // A minifier printing ASCII only: every non-ASCII UTF-16 unit becomes a backslash-u escape.
  return [...s].map((ch) => (ch.charCodeAt(0) > 0x7e ? "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0") : ch)).join("");
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-secrets-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("scanText with the counselling room's needles", () => {
  const needles = roomNeedles();

  it("has needles for the room", () => {
    expect(needles.length).toBeGreaterThan(5);
    expect(needles.every((n) => n.source === "room counsel")).toBe(true);
  });

  it("is clean for ordinary UI copy, public labels included", () => {
    expect(scanText("index.js", CLEAN, needles)).toEqual([]);
  });

  it("finds a hint as written", () => {
    const hits = scanText("index.js", `var s="${HINT}";`, needles);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].file).toBe("index.js");
    expect(hits[0].excerpt.length).toBeLessThanOrEqual(20);
  });

  it("finds the same hint written as \\uXXXX escapes", () => {
    expect(scanText("index.js", `var s="${escapeUnits(HINT)}";`, needles).length).toBeGreaterThan(0);
  });

  it("finds the cabinet digits as a quoted literal but not as a bare number", () => {
    const digits = (counsel.locks.find((l) => l.kind === "digits") as { answer: string }).answer;
    expect(scanText("a.js", `lock("${digits}")`, needles).length).toBeGreaterThan(0);
    expect(scanText("a.js", `x=${digits}+1`, needles)).toEqual([]);
  });

  it("finds the cover word as an array of letters", () => {
    const letters = (counsel.locks.find((l) => l.kind === "letters") as { answer: string[] }).answer;
    expect(scanText("a.js", `w=${JSON.stringify(letters)}`, needles).length).toBeGreaterThan(0);
  });
});

describe("keyHashNeedles", () => {
  it("finds a key file's sha256 in a bundle, in either letter case, and skips bad entries", () => {
    const hash = crypto.createHash("sha256").update("TESTKEY").digest("hex");
    const file = path.join(dir, "keys.json");
    fs.writeFileSync(file, JSON.stringify({ keys: [{ id: "x", label: "y", sha256: hash }, { id: "z", sha256: "nope" }, 5] }));
    const needles = keyHashNeedles([file, path.join(dir, "missing.json")]);
    expect(needles).toHaveLength(1);
    expect(scanText("a.js", `h="${hash.toUpperCase()}"`, needles)).toHaveLength(1);
    expect(scanText("a.js", `h="${hash.slice(0, 40)}"`, needles)).toEqual([]);
  });

  it("ignores an unreadable key file", () => {
    const file = path.join(dir, "bad.json");
    fs.writeFileSync(file, "{not json");
    expect(keyHashNeedles([file])).toEqual([]);
  });

  it("covers the committed e2e fixture", () => {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../e2e/fixtures/teacher-keys.e2e.json"), "utf8")) as { keys: { sha256: string }[] };
    const sources = keyHashNeedles().map((n) => n.source);
    expect(fixture.keys.length).toBeGreaterThan(0);
    expect(sources.some((s) => s.includes("e2e/fixtures/teacher-keys.e2e.json"))).toBe(true);
  });
});

describe("scanFiles and the CLI", () => {
  function write(rel: string, text: string): void {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }

  it("lists js/html/css (and json/map) files recursively and nothing else", () => {
    write("index.html", "<html></html>");
    write("assets/app.js", CLEAN);
    write("assets/app.css", "a{}");
    write("assets/pic.webp", "binary");
    expect(listBundleFiles(dir).map((f) => path.relative(dir, f).split(path.sep).join("/"))).toEqual(["assets/app.css", "assets/app.js", "index.html"]);
  });

  it("passes (exit 0) on a clean bundle", () => {
    write("index.html", "<html></html>");
    write("assets/app.js", CLEAN);
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--dist", dir])).toBe(0);
  });

  it("fails (exit 1) on a planted needle, naming the file and the first 20 characters", () => {
    write("index.html", "<html></html>");
    write("assets/app.js", CLEAN + `var leak="${HINT}";`);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--dist", dir])).toBe(1);
    const lines = err.mock.calls.map((c) => String(c[0]));
    const fail = lines.find((l) => l.includes("assets/app.js"));
    expect(fail).toBeDefined();
    expect(fail).toContain([...HINT].slice(0, 20).join(""));
    expect(fail).not.toContain([...HINT].slice(0, 21).join(""));
    expect(scanFiles(dir, roomNeedles()).hits.length).toBeGreaterThan(0);
  });

  it("fails on an empty folder and on a missing one (nothing scanned is not a pass)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--dist", dir])).toBe(1);
    expect(main(["--dist", path.join(dir, "nope")])).toBe(1);
  });

  it("rejects unknown arguments", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--bogus"])).toBe(1);
  });
});
