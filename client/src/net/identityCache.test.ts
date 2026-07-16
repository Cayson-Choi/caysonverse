import { describe, it, expect, beforeEach, vi } from "vitest";
import { CHARACTER_COUNT, TINT_COUNT } from "@caysonverse/shared/constants";
import { loadIdentity, saveIdentity } from "./identityCache";

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

const KEY = "cv.entry";

beforeEach(() => {
  vi.stubGlobal("localStorage", memStorage());
});

describe("loadIdentity", () => {
  it("returns the empty default when nothing is stored", () => {
    expect(loadIdentity()).toEqual({ nickname: "", character: 0, tint: 0 });
  });

  it("round-trips a valid saved identity", () => {
    saveIdentity({ nickname: "케이슨", character: 5, tint: 3 });
    expect(loadIdentity()).toEqual({ nickname: "케이슨", character: 5, tint: 3 });
  });

  it("accepts every in-range character index (0..CHARACTER_COUNT-1)", () => {
    for (let c = 0; c < CHARACTER_COUNT; c++) {
      localStorage.setItem(KEY, JSON.stringify({ nickname: "a", character: c, tint: 0 }));
      expect(loadIdentity().character).toBe(c);
    }
  });

  it("falls back to 0 for an out-of-range saved character (old/corrupt session)", () => {
    // A session saved before the roster grew, or a tampered value, must never
    // yield an index the CHARACTERS table can't render.
    localStorage.setItem(KEY, JSON.stringify({ nickname: "a", character: CHARACTER_COUNT, tint: 0 }));
    expect(loadIdentity().character).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ nickname: "a", character: 99, tint: 0 }));
    expect(loadIdentity().character).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ nickname: "a", character: -1, tint: 0 }));
    expect(loadIdentity().character).toBe(0);
  });

  it("falls back to 0 for a non-integer or missing character", () => {
    localStorage.setItem(KEY, JSON.stringify({ nickname: "a", character: 2.5, tint: 0 }));
    expect(loadIdentity().character).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ nickname: "a", tint: 0 }));
    expect(loadIdentity().character).toBe(0);
  });

  it("clamps an out-of-range tint the same way", () => {
    localStorage.setItem(KEY, JSON.stringify({ nickname: "a", character: 0, tint: TINT_COUNT }));
    expect(loadIdentity().tint).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ nickname: "a", character: 0, tint: -1 }));
    expect(loadIdentity().tint).toBe(0);
  });

  it("never throws on malformed JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(() => loadIdentity()).not.toThrow();
    expect(loadIdentity()).toEqual({ nickname: "", character: 0, tint: 0 });
  });
});
