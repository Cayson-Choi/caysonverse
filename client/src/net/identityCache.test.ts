import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  APPEARANCE_FIELDS,
  APPEARANCE_PRESETS,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  applyPreset,
} from "@caysonverse/shared/appearance";
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
  it("returns { nickname: '', appearance: DEFAULT_APPEARANCE } when nothing is stored", () => {
    expect(loadIdentity()).toEqual({ nickname: "", appearance: DEFAULT_APPEARANCE });
  });

  it("round-trips a saved appearance", () => {
    const princess = applyPreset(DEFAULT_APPEARANCE, APPEARANCE_PRESETS[1]);
    const look = { ...princess, voice: 1 };
    saveIdentity({ nickname: "케이슨", appearance: look });
    expect(loadIdentity()).toEqual({ nickname: "케이슨", appearance: look });
    // Stored under the same key the pre-builder build used, as { nickname, appearance }.
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ nickname: "케이슨", appearance: look });
  });

  it("migrates a pre-builder { character, tint } identity to DEFAULT_APPEARANCE, keeping the nickname (spec §5.2)", () => {
    localStorage.setItem(KEY, JSON.stringify({ nickname: "케이슨", character: 5, tint: 3 }));
    expect(loadIdentity()).toEqual({ nickname: "케이슨", appearance: DEFAULT_APPEARANCE });
  });

  it("replaces a corrupt or out-of-range appearance with DEFAULT_APPEARANCE as a whole", () => {
    const valid = { ...DEFAULT_APPEARANCE, top: 1, topColor: 2 };
    const corrupt: unknown[] = [
      { ...valid, hat: APPEARANCE_RANGES.hat }, // one field out of range
      { ...valid, skin: -1 },
      { ...valid, hairColor: 1.5 },
      { ...valid, voice: "1" },
      (() => {
        const missing: Record<string, number> = { ...valid };
        delete missing.itemColor;
        return missing;
      })(),
      null,
      "princess",
      [1, 2, 3],
    ];
    for (const appearance of corrupt) {
      localStorage.setItem(KEY, JSON.stringify({ nickname: "케이슨", appearance }));
      const loaded = loadIdentity();
      expect(loaded.nickname).toBe("케이슨");
      // As a whole: the valid fields (top/topColor) are NOT kept either.
      expect(loaded.appearance, JSON.stringify(appearance)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  it("returns a fresh appearance object the caller may change", () => {
    const loaded = loadIdentity();
    expect(Object.isFrozen(loaded.appearance)).toBe(false);
    loaded.appearance.top = 1;
    expect(DEFAULT_APPEARANCE.top).not.toBe(1);
    expect(Object.keys(loaded.appearance).sort()).toEqual([...APPEARANCE_FIELDS].sort());
  });

  it("never throws on malformed JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(() => loadIdentity()).not.toThrow();
    expect(loadIdentity()).toEqual({ nickname: "", appearance: DEFAULT_APPEARANCE });
    localStorage.setItem(KEY, "null");
    expect(loadIdentity()).toEqual({ nickname: "", appearance: DEFAULT_APPEARANCE });
    localStorage.setItem(KEY, JSON.stringify({ nickname: 7, appearance: DEFAULT_APPEARANCE }));
    expect(loadIdentity()).toEqual({ nickname: "", appearance: DEFAULT_APPEARANCE });
  });
});
