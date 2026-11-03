/**
 * Tests for scripts/export-village-layout.ts: `main` writes the layout JSON to the given path (making missing folders),
 * the file is exactly `exportVillageLayout()`, two runs are byte-identical, and bad arguments or an unwritable path
 * exit with 1 and a message. Lives in the server workspace like the other script tests; it never touches `art/`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportVillageLayout } from "@caysonverse/shared/village/villageLayout";
import { main } from "../../../scripts/export-village-layout";

let dir: string;
let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "village-layout-"));
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  err = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
  err.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("export-village-layout main", () => {
  it("writes the layout JSON to the given path, creating missing folders, and exits 0", () => {
    const out = path.join(dir, "nested", "art", "village", "layout.json");
    expect(main([out])).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    const text = fs.readFileSync(out, "utf8");
    expect(JSON.parse(text)).toEqual(exportVillageLayout());
    expect(text.endsWith("\n")).toBe(true);
    expect(text.startsWith('{\n  "format"')).toBe(true); // 2-space indent, readable in a diff
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("PASS");
    expect(err).not.toHaveBeenCalled();
  });

  it("two runs give byte-identical files (and an existing file is overwritten)", () => {
    const a = path.join(dir, "a.json");
    const b = path.join(dir, "b.json");
    expect(main([a])).toBe(0);
    expect(main([b])).toBe(0);
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(true);
    fs.writeFileSync(a, "stale");
    expect(main([a])).toBe(0);
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(true);
  });

  it("the file has everything a Blender script needs (spot check of the sections)", () => {
    const out = path.join(dir, "layout.json");
    main([out]);
    const j = JSON.parse(fs.readFileSync(out, "utf8"));
    for (const key of ["walkBounds", "spawn", "plaza", "ringRoad", "busStop", "stream", "bridge", "pavilion", "lanes", "plots", "memorial", "sceneryHouses", "backdrop", "areas", "colliders"]) {
      expect(j, key).toHaveProperty(key);
    }
    expect(j.colliders.every((c: { node: string; id: string }) => c.node === `col__${c.id}`)).toBe(true);
  });

  it("too many arguments: usage on stderr, exit 1, nothing written", () => {
    const out = path.join(dir, "layout.json");
    expect(main([out, "--extra"])).toBe(1);
    expect(String(err.mock.calls[0][0])).toContain("usage");
    expect(fs.existsSync(out)).toBe(false);
  });

  it("an unwritable path (a folder that is really a file): FAIL on stderr and exit 1", () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    expect(main([path.join(blocker, "layout.json")])).toBe(1);
    expect(String(err.mock.calls[0][0])).toContain("FAIL");
    expect(log).not.toHaveBeenCalled();
  });
});
