import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatTts,
  chatVolume,
  clipForSpeech,
  pickKoreanVoice,
  primeTts,
  speakChat,
  stopTts,
  TTS_MAX_PENDING,
  TTS_MAX_SPEECH_CHARS,
  TTS_MIN_VOLUME,
  TTS_RADIUS_M,
  TTS_WATCHDOG_BASE_MS,
  TTS_WATCHDOG_PER_CHAR_MS,
  type TtsEnv,
  type TtsSynthLike,
  type TtsUtteranceLike,
  type TtsVoiceLike,
} from "./tts";

/**
 * Fully injected SpeechSynthesis stand-in: records every utterance handed to
 * speak(), counts cancel() calls, and lets tests drive the async voice list
 * (getVoices + voiceschanged) and utterance completion (onend/onerror) by hand.
 */
function makeHarness(initialVoices: TtsVoiceLike[] = []) {
  let voices = initialVoices;
  const spoken: TtsUtteranceLike[] = [];
  let cancelCount = 0;
  const voiceListeners: Array<() => void> = [];
  const synth: TtsSynthLike = {
    speak: (u) => spoken.push(u),
    cancel: () => {
      cancelCount += 1;
    },
    getVoices: () => voices,
    addEventListener: (_type, listener) => voiceListeners.push(listener),
  };
  const env: TtsEnv = {
    synth,
    createUtterance: (text) => ({
      text,
      lang: "",
      volume: 1,
      voice: null,
      onend: null,
      onerror: null,
    }),
  };
  return {
    env,
    spoken,
    cancelCount: () => cancelCount,
    setVoices: (v: TtsVoiceLike[]) => {
      voices = v;
    },
    fireVoicesChanged: () => {
      for (const listener of voiceListeners) listener();
    },
    /** Complete utterance #i as the engine would (fires its onend). */
    finish: (i: number) => spoken[i].onend?.(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("chatVolume — distance-proportional attenuation", () => {
  it("is 1.0 for the own message (distance 0)", () => {
    expect(chatVolume(0)).toBe(1);
  });

  it("is TTS_MIN_VOLUME exactly at the audible radius edge", () => {
    expect(chatVolume(TTS_RADIUS_M)).toBeCloseTo(TTS_MIN_VOLUME, 6);
  });

  it("is the linear midpoint halfway out", () => {
    expect(chatVolume(TTS_RADIUS_M / 2)).toBeCloseTo((1 + TTS_MIN_VOLUME) / 2, 6);
  });

  it("decreases monotonically with distance", () => {
    expect(chatVolume(3)).toBeGreaterThan(chatVolume(9));
  });

  it("clamps outside the [0, radius] band (never over 1, never under the floor)", () => {
    expect(chatVolume(-5)).toBe(1);
    expect(chatVolume(TTS_RADIUS_M * 3)).toBeCloseTo(TTS_MIN_VOLUME, 6);
  });
});

describe("clipForSpeech — speech-only length cap", () => {
  it("returns short text unchanged (exactly at the cap included)", () => {
    const atCap = "가".repeat(TTS_MAX_SPEECH_CHARS);
    expect(clipForSpeech("안녕")).toBe("안녕");
    expect(clipForSpeech(atCap)).toBe(atCap);
  });

  it("clips over-cap text to the first cap chars plus an ellipsis", () => {
    const long = "가".repeat(TTS_MAX_SPEECH_CHARS + 40);
    const clipped = clipForSpeech(long);
    expect(clipped).toBe("가".repeat(TTS_MAX_SPEECH_CHARS) + "…");
  });

  it("counts code points, never splitting a surrogate pair", () => {
    const emoji = "😀".repeat(TTS_MAX_SPEECH_CHARS + 10);
    const clipped = clipForSpeech(emoji);
    const points = [...clipped];
    expect(points.length).toBe(TTS_MAX_SPEECH_CHARS + 1); // 80 emoji + …
    expect(points[TTS_MAX_SPEECH_CHARS - 1]).toBe("😀"); // intact, not half a pair
    expect(points[TTS_MAX_SPEECH_CHARS]).toBe("…");
  });
});

describe("pickKoreanVoice — ko-KR preference and fallbacks", () => {
  it("prefers an exact ko-KR voice over a bare-ko one", () => {
    const koKr = { lang: "ko-KR", name: "Heami" };
    const picked = pickKoreanVoice([{ lang: "en-US", name: "Zira" }, { lang: "ko", name: "Bare" }, koKr]);
    expect(picked).toBe(koKr);
  });

  it("normalizes case and underscores (ko_kr counts as exact)", () => {
    const yuna = { lang: "ko_KR", name: "Yuna" };
    expect(pickKoreanVoice([{ lang: "en-US", name: "Zira" }, yuna])).toBe(yuna);
  });

  it("falls back to any ko-prefixed voice when no exact match exists", () => {
    const bare = { lang: "ko", name: "Bare" };
    expect(pickKoreanVoice([{ lang: "ja-JP", name: "Haruka" }, bare])).toBe(bare);
  });

  it("returns null (engine default) when no Korean voice exists", () => {
    expect(pickKoreanVoice([{ lang: "en-US", name: "Zira" }])).toBeNull();
    expect(pickKoreanVoice([])).toBeNull();
  });
});

describe("ChatTts — serial queue policy", () => {
  it("speaks immediately when idle, in ko-KR at full volume for distance 0", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("안녕", 0);
    expect(h.spoken.length).toBe(1);
    expect(h.spoken[0].text).toBe("안녕");
    expect(h.spoken[0].lang).toBe("ko-KR");
    expect(h.spoken[0].volume).toBe(1);
  });

  it("plays serially: the next utterance starts only after the current one ends", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("첫째", 0);
    tts.speak("둘째", 0);
    expect(h.spoken.length).toBe(1);
    h.finish(0);
    expect(h.spoken.length).toBe(2);
    expect(h.spoken[1].text).toBe("둘째");
  });

  it("caps the waiting queue, dropping the OLDEST waiting entry (newest wins)", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("재생중", 0); // playing, not part of the waiting queue
    tts.speak("대기1", 0);
    tts.speak("대기2", 0);
    tts.speak("대기3", 0);
    tts.speak("대기4", 0); // exceeds TTS_MAX_PENDING(3) → 대기1 dropped
    expect(TTS_MAX_PENDING).toBe(3);
    for (let i = 0; i < 4; i++) h.finish(i);
    expect(h.spoken.map((u) => u.text)).toEqual(["재생중", "대기2", "대기3", "대기4"]);
  });

  it("never cancels mid-utterance on overflow (no sentence cut)", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    for (let i = 0; i < 10; i++) tts.speak(`메시지${i}`, 0);
    expect(h.cancelCount()).toBe(0);
    expect(h.spoken.length).toBe(1); // still speaking the first one, untouched
  });

  it("advances exactly once even if onend AND onerror both fire", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("첫째", 0);
    tts.speak("둘째", 0);
    h.spoken[0].onend?.();
    h.spoken[0].onerror?.(); // engine double-fire must not skip 둘째
    h.spoken[0].onend?.();
    expect(h.spoken.length).toBe(2);
    expect(h.spoken[1].text).toBe("둘째");
  });

  it("clips long text for speech only (the utterance carries the clipped form)", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    const long = "라".repeat(150);
    tts.speak(long, 0);
    expect(h.spoken[0].text).toBe("라".repeat(TTS_MAX_SPEECH_CHARS) + "…");
  });

  it("attaches the distance-attenuated volume to the utterance", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("중간 거리", TTS_RADIUS_M / 2);
    expect(h.spoken[0].volume).toBeCloseTo((1 + TTS_MIN_VOLUME) / 2, 6);
  });
});

describe("ChatTts — gates (radius / mute / empty)", () => {
  it("skips senders beyond the audible radius, speaks exactly at the edge", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("너무 멀다", TTS_RADIUS_M + 0.01);
    expect(h.spoken.length).toBe(0);
    tts.speak("경계선", TTS_RADIUS_M);
    expect(h.spoken.length).toBe(1);
    expect(h.spoken[0].volume).toBeCloseTo(TTS_MIN_VOLUME, 6);
  });

  it("skips a NaN distance (missing-position race guard)", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("레이스", Number.NaN);
    expect(h.spoken.length).toBe(0);
  });

  it("skips entirely while muted — nothing spoken, nothing queued", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("음소거 중", 0, { muted: true });
    expect(h.spoken.length).toBe(0);
    tts.speak("다시 켜짐", 0);
    expect(h.spoken.length).toBe(1);
    expect(h.spoken[0].text).toBe("다시 켜짐");
  });

  it("skips blank text", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("   ", 0);
    expect(h.spoken.length).toBe(0);
  });
});

describe("ChatTts — voice selection (async getVoices)", () => {
  it("uses the ko voice when the list is ready at construction", () => {
    const koKr = { lang: "ko-KR", name: "Heami" };
    const h = makeHarness([{ lang: "en-US", name: "Zira" }, koKr]);
    const tts = new ChatTts(h.env);
    tts.speak("안녕", 0);
    expect(h.spoken[0].voice).toBe(koKr);
  });

  it("resolves via voiceschanged when the list loads late, then caches", () => {
    const h = makeHarness([]);
    const tts = new ChatTts(h.env);
    tts.speak("이른 메시지", 0);
    expect(h.spoken[0].voice).toBeNull(); // engine default until voices arrive
    const koKr = { lang: "ko-KR", name: "Heami" };
    h.setVoices([koKr]);
    h.fireVoicesChanged();
    h.finish(0);
    tts.speak("늦은 메시지", 0);
    expect(h.spoken[1].voice).toBe(koKr);
    // Cached once resolved: later list churn is ignored for this session.
    h.setVoices([]);
    h.fireVoicesChanged();
    h.finish(1);
    tts.speak("캐시 확인", 0);
    expect(h.spoken[2].voice).toBe(koKr);
  });

  it("falls back to the engine default (voice null) when no Korean voice exists", () => {
    const h = makeHarness([{ lang: "en-US", name: "Zira" }]);
    const tts = new ChatTts(h.env);
    tts.speak("폴백", 0);
    expect(h.spoken[0].voice).toBeNull();
    expect(h.spoken[0].lang).toBe("ko-KR"); // lang hint still requests Korean
  });
});

describe("ChatTts — API absent (old/unsupported browsers)", () => {
  it("is silently inert with a null env — no throw on any call", () => {
    const tts = new ChatTts(null);
    expect(() => {
      tts.speak("무음", 0);
      tts.prime();
      tts.dispose();
    }).not.toThrow();
  });

  it("module singleton is inert in a window-less environment (this node run)", () => {
    expect(() => {
      primeTts();
      speakChat("무음", 0);
      stopTts();
    }).not.toThrow();
  });
});

describe("ChatTts — priming (mobile autoplay gesture)", () => {
  it("speaks one silent utterance, exactly once across repeated calls", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.prime();
    tts.prime();
    expect(h.spoken.length).toBe(1);
    expect(h.spoken[0].volume).toBe(0);
    expect(h.spoken[0].text).toBe("");
  });

  it("does not occupy the serial queue (a chat right after still speaks)", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.prime();
    tts.speak("입장 직후", 0);
    expect(h.spoken.length).toBe(2);
    expect(h.spoken[1].text).toBe("입장 직후");
  });
});

describe("ChatTts — dispose (room teardown)", () => {
  it("cancels the engine and clears the waiting queue", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("재생중", 0);
    tts.speak("대기중", 0);
    tts.dispose();
    expect(h.cancelCount()).toBeGreaterThanOrEqual(1);
    // A stale onend from the cancelled utterance must NOT start the old queue.
    h.spoken[0].onend?.();
    expect(h.spoken.length).toBe(1);
  });

  it("stays usable after dispose (reconnect remount)", () => {
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("이전 세션", 0);
    tts.dispose();
    tts.speak("새 세션", 0);
    expect(h.spoken.length).toBe(2);
    expect(h.spoken[1].text).toBe("새 세션");
  });
});

describe("ChatTts — watchdog (engine that never fires onend)", () => {
  it("force-advances the queue after the per-utterance deadline", () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const tts = new ChatTts(h.env);
    tts.speak("멈춘 발화", 0);
    tts.speak("다음 발화", 0);
    expect(h.spoken.length).toBe(1);
    vi.advanceTimersByTime(TTS_WATCHDOG_BASE_MS + TTS_WATCHDOG_PER_CHAR_MS * "멈춘 발화".length + 1);
    expect(h.spoken.length).toBe(2);
    expect(h.spoken[1].text).toBe("다음 발화");
  });
});
