import { describe, it, expect } from "vitest";
import { VOICE_MAX_CHARS, VoiceCache, validateVoiceBody } from "./voice";

describe("validateVoiceBody", () => {
  it("accepts a normal line and trims it", () => {
    const r = validateVoiceBody({ text: "  안녕하세요!  " });
    expect(r).toEqual({ ok: true, text: "안녕하세요!" });
  });

  it("rejects missing/empty/non-string/over-long text", () => {
    expect(validateVoiceBody(undefined).ok).toBe(false);
    expect(validateVoiceBody({}).ok).toBe(false);
    expect(validateVoiceBody({ text: "   " }).ok).toBe(false);
    expect(validateVoiceBody({ text: 42 }).ok).toBe(false);
    expect(validateVoiceBody({ text: "가".repeat(VOICE_MAX_CHARS + 1) }).ok).toBe(false);
    expect(validateVoiceBody({ text: "가".repeat(VOICE_MAX_CHARS) }).ok).toBe(true);
  });
});

describe("VoiceCache (FIFO cap)", () => {
  it("caches up to the cap and evicts the OLDEST on overflow", () => {
    const cache = new VoiceCache(2);
    cache.set("a", Buffer.from("A"));
    cache.set("b", Buffer.from("B"));
    cache.set("c", Buffer.from("C"));
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")?.toString()).toBe("B");
    expect(cache.get("c")?.toString()).toBe("C");
  });

  it("re-setting an existing key does not evict", () => {
    const cache = new VoiceCache(2);
    cache.set("a", Buffer.from("A"));
    cache.set("b", Buffer.from("B"));
    cache.set("a", Buffer.from("A2"));
    expect(cache.size).toBe(2);
    expect(cache.get("a")?.toString()).toBe("A2");
    expect(cache.get("b")?.toString()).toBe("B");
  });
});
