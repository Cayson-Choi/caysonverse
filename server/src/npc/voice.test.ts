import { describe, it, expect } from "vitest";
import { VOICE_MAX_CHARS, VoiceCache, validateVoiceBody } from "./voice";

describe("validateVoiceBody", () => {
  it("accepts a normal line and trims it", () => {
    const r = validateVoiceBody({ text: "  안녕하세요!  " });
    expect(r).toEqual({ ok: true, text: "안녕하세요!", gender: "female" });
  });

  it("rejects missing/empty/non-string/over-long text", () => {
    expect(validateVoiceBody(undefined).ok).toBe(false);
    expect(validateVoiceBody({}).ok).toBe(false);
    expect(validateVoiceBody({ text: "   " }).ok).toBe(false);
    expect(validateVoiceBody({ text: 42 }).ok).toBe(false);
    expect(validateVoiceBody({ text: "가".repeat(VOICE_MAX_CHARS + 1) }).ok).toBe(false);
    expect(validateVoiceBody({ text: "가".repeat(VOICE_MAX_CHARS) }).ok).toBe(true);
  });

  it("strips emojis from the spoken text and rejects emoji-only lines (발주자 요청)", () => {
    expect(validateVoiceBody({ text: "안녕하세요! 🙂 반가워요" })).toEqual({
      ok: true,
      text: "안녕하세요! 반가워요",
      gender: "female",
    });
    expect(validateVoiceBody({ text: "🙂🎉👋" }).ok).toBe(false);
  });

  it("drops ASCII-art lines and speaks only the prose (문자 그림 낭독 금지)", () => {
    const r = validateVoiceBody({ text: "고양이예요!\n /\\_/\\ \n( o.o )\n귀엽죠?" });
    expect(r).toEqual({ ok: true, text: "고양이예요! 귀엽죠?", gender: "female" });
    expect(validateVoiceBody({ text: "( o.o )\n > ^ < " }).ok).toBe(false);
  });

  it("accepts a gender pick (남/여 캐릭터 목소리), defaults female, rejects junk", () => {
    const male = validateVoiceBody({ text: "안녕", gender: "male" });
    expect(male.ok && male.gender).toBe("male");
    const dflt = validateVoiceBody({ text: "안녕" });
    expect(dflt.ok && dflt.gender).toBe("female");
    expect(validateVoiceBody({ text: "안녕", gender: "robot" }).ok).toBe(false);
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
