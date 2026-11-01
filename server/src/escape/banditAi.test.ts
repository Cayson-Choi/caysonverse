import { afterEach, describe, expect, it, vi } from "vitest";
import { GROQ_DEFAULT_MODEL, GROQ_URL } from "../npc/groqChat";
import { acceptRephrase, banditAiEnabled, createBanditAi, rephraseHint } from "./banditAi";
import { secretStrings } from "./content";
import { counsel } from "./rooms/counsel";

const FIXED = "손전등과 필름을 합쳐 봐요.";

/** A Groq chat-completions answer carrying `content`. */
const groqBody = (content: unknown) => ({ choices: [{ message: { content } }] });

/** A fake fetch that answers 200 with the given JSON. */
function fakeGroq(content: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(groqBody(content)), { status: 200 })) as unknown as typeof fetch;
}

/** The (url, init) of the Nth call of a fake fetch. */
function callOf(f: typeof fetch, n = 0): { url: string; init: RequestInit } {
  const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[n];
  return { url, init };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("banditAiEnabled", () => {
  it("is off unless BANDIT_AI=1 and a key exist", () => {
    expect(banditAiEnabled({ BANDIT_AI: "1" })).toBe(false);
    expect(banditAiEnabled({ GROQ_API_KEY: "k" })).toBe(false);
    expect(banditAiEnabled({})).toBe(false);
    expect(banditAiEnabled({ BANDIT_AI: "1", GROQ_API_KEY: "k" })).toBe(true);
  });

  it("is off for any BANDIT_AI value but exactly 1, and for a blank key", () => {
    for (const v of ["0", "", "true", "yes", "on", " 1", "1 "]) {
      expect(banditAiEnabled({ BANDIT_AI: v, GROQ_API_KEY: "k" })).toBe(false);
    }
    expect(banditAiEnabled({ BANDIT_AI: "1", GROQ_API_KEY: "" })).toBe(false);
    expect(banditAiEnabled({ BANDIT_AI: "1", GROQ_API_KEY: "   " })).toBe(false);
  });

  it("reads process.env when no env is given", () => {
    vi.stubEnv("BANDIT_AI", "");
    vi.stubEnv("GROQ_API_KEY", "");
    expect(banditAiEnabled()).toBe(false);
    vi.stubEnv("BANDIT_AI", "1");
    vi.stubEnv("GROQ_API_KEY", "fake-key");
    expect(banditAiEnabled()).toBe(true);
  });
});

describe("acceptRephrase", () => {
  it("accepts a short Korean sentence that holds none of the secrets", () => {
    expect(acceptRephrase(FIXED, "손전등이랑 필름을 같이 써 보면 어때요?", ["4719"])).toBe(true);
  });

  it("rejects empty or blank output", () => {
    expect(acceptRephrase(FIXED, "", [])).toBe(false);
    expect(acceptRephrase(FIXED, "  \n\t ", [])).toBe(false);
  });

  it("accepts 120 characters and rejects 121, counted in code points", () => {
    expect(acceptRephrase(FIXED, "가".repeat(120), [])).toBe(true);
    expect(acceptRephrase(FIXED, "가".repeat(121), [])).toBe(false);
    // 119 syllables + one emoji = 120 code points (121 UTF-16 units): still fine.
    expect(acceptRephrase(FIXED, "가".repeat(119) + "😀", [])).toBe(true);
    expect(acceptRephrase(FIXED, "가".repeat(120) + "😀", [])).toBe(false);
  });

  it("does not count the surrounding whitespace of the model's output", () => {
    expect(acceptRephrase(FIXED, `\n  ${"가".repeat(120)}  \n`, [])).toBe(true);
  });

  it("rejects output without any Hangul", () => {
    expect(acceptRephrase(FIXED, "Try the flashlight with the film!", [])).toBe(false);
    expect(acceptRephrase(FIXED, "1234 !!!", [])).toBe(false);
    expect(acceptRephrase(FIXED, "手電筒と フィルム", [])).toBe(false);
  });

  it("rejects a secret that the fixed hint does not contain", () => {
    expect(acceptRephrase(FIXED, "정답은 4719야!", ["4719"])).toBe(false);
    expect(acceptRephrase(FIXED, "다음 힌트는 보라색 필름을 쓰라는 거예요.", ["보라색 필름을 쓰라는 거예요"])).toBe(false);
  });

  it("allows what the fixed hint itself already says", () => {
    // The hint's own text is a secret too (`secretStrings` lists every hint), and so is a word it uses.
    expect(acceptRephrase(FIXED, "손전등과 필름을 합쳐 봐요, 친구!", [FIXED, "필름"])).toBe(true);
    expect(acceptRephrase(FIXED, "필름이랑 손전등을 같이 써 봐요!", [FIXED, "필름"])).toBe(true);
    // ...but not a different secret next to it.
    expect(acceptRephrase(FIXED, "필름이랑 손전등을 써 봐요. 4719!", [FIXED, "필름", "4719"])).toBe(false);
  });

  it("catches a secret spread out with spaces, punctuation, zero-width marks or full-width digits", () => {
    for (const leak of ["정답은 4 7 1 9 예요", "정답은 4-7-1-9 예요", "정답은 4·7·1·9 예요", "정답은 4\u200B7\u200B1\u200B9 예요", "정답은 ４７１９ 예요"]) {
      expect(acceptRephrase(FIXED, leak, ["4719"]), leak).toBe(false);
    }
    // The letters answer is stored joined (동의먼저); the model may write it with a space.
    expect(acceptRephrase("비밀을 알리기 전에 지킬 것이 있어요.", "꼭 '동의 먼저'예요!", ["동의먼저"])).toBe(false);
  });

  it("ignores a blank or punctuation-only secret instead of rejecting everything", () => {
    expect(acceptRephrase(FIXED, "손전등을 비춰 봐요!", ["", "  ", "...", FIXED])).toBe(true);
  });

  it("holds against the real counsel room: no answer and no other hint gets through", () => {
    const secrets = secretStrings(counsel);
    expect(secrets).toEqual(expect.arrayContaining(["4719", "동의먼저"]));

    const hints = counsel.stages.flatMap((st) => st.hints);
    expect(hints.length).toBe(15);
    expect(hints.some((h) => h.replace(/\s/g, "").includes("동의먼저"))).toBe(true); // so both sides below are exercised
    const ok =(fixed: string, candidate: string) => acceptRephrase(fixed, candidate, secrets);
    for (const fixed of hints) {
      // The authored hint, said again kindly, passes...
      expect(ok(fixed, `${[...fixed].slice(0, 100).join("")} 화이팅!`), fixed).toBe(true);
      // ...an answer does not either (unless the authored hint itself already says it: the last
      // hint of the cover-lock step is "동의 먼저")...
      const says = (answer: string) => fixed.replace(/\s/g, "").includes(answer);
      expect(ok(fixed, "정답은 4719야!"), fixed).toBe(says("4719"));
      expect(ok(fixed, "글자는 동 의 먼 저 예요"), fixed).toBe(says("동의먼저"));
      // ...and neither does any other hint of the room.
      for (const other of hints) {
        if (other === fixed) continue;
        expect([...other].length, other).toBeLessThanOrEqual(120); // so only the guard can say no
        expect(ok(fixed, other), `${fixed} → ${other}`).toBe(false);
      }
    }
  });
});

describe("rephraseHint", () => {
  const deps = (fetch: typeof globalThis.fetch, extra: { timeoutMs?: number } = {}) => ({ fetch, apiKey: "k", model: "m", ...extra });

  it("uses the model sentence when it passes the guard", async () => {
    const fetch = fakeGroq("  손전등이랑 필름을 같이 써 봐요, 친구!  \n");
    const out = await rephraseHint(FIXED, ["4719"], deps(fetch));
    expect(out).toBe("손전등이랑 필름을 같이 써 봐요, 친구!");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks Groq with the 반딧 persona, the key, the model and the fixed hint as the only user message", async () => {
    const fetch = fakeGroq("손전등과 필름을 합쳐 봐요, 친구!");
    await rephraseHint(FIXED, ["4719"], deps(fetch));
    const { url, init } = callOf(fetch);
    expect(url).toBe(GROQ_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer k", "content-type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body)) as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe("m");
    expect(body.messages).toEqual([
      {
        role: "system",
        content:
          "너는 손전등을 든 작은 경비 로봇 '반딧'이다. 아래 힌트의 뜻을 바꾸거나 더 알려 주지 말고, 초등학생에게 다정한 한 문장(120자 이내)으로만 다시 말해라.",
      },
      { role: "user", content: FIXED },
    ]);
  });

  it("never sends the secrets to the model", async () => {
    const fetch = fakeGroq("손전등과 필름을 합쳐 봐요, 친구!");
    await rephraseHint(FIXED, ["4719", "동의먼저", "다른 힌트 문장이에요"], deps(fetch));
    const sent = String(callOf(fetch).init.body);
    expect(sent).not.toContain("4719");
    expect(sent).not.toContain("동의먼저");
    expect(sent).not.toContain("다른 힌트");
  });

  it("falls back to the fixed hint when the model leaks a secret not in the hint", async () => {
    const fetch = fakeGroq("정답은 4719야!");
    expect(await rephraseHint("손전등과 필름을 합쳐 봐요.", ["4719"], { fetch, apiKey: "k", model: "m" })).toBe("손전등과 필름을 합쳐 봐요.");
  });

  it("falls back on empty, non-Korean and over-long output", async () => {
    for (const content of ["", "   ", "Use the flashlight and the film.", "가".repeat(121)]) {
      expect(await rephraseHint(FIXED, [], deps(fakeGroq(content))), JSON.stringify(content)).toBe(FIXED);
    }
  });

  it("falls back on a response with no usable choice", async () => {
    for (const body of [{}, { choices: [] }, { choices: [{}] }, { choices: [{ message: { content: 42 } }] }, null]) {
      const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof globalThis.fetch;
      expect(await rephraseHint(FIXED, [], deps(fetch)), JSON.stringify(body)).toBe(FIXED);
    }
  });

  it("falls back on an HTTP error, even one that carries a good-looking body", async () => {
    for (const status of [400, 401, 429, 500, 503]) {
      const fetch = vi.fn(async () => new Response(JSON.stringify(groqBody("손전등을 비춰 봐요, 친구!")), { status })) as unknown as typeof globalThis.fetch;
      expect(await rephraseHint(FIXED, [], deps(fetch)), String(status)).toBe(FIXED);
    }
  });

  it("falls back when the request throws or the body is not JSON", async () => {
    const throwsAsync = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const throwsSync = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    const notJson = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200 })) as unknown as typeof globalThis.fetch;
    expect(await rephraseHint(FIXED, [], deps(throwsAsync))).toBe(FIXED);
    expect(await rephraseHint(FIXED, [], deps(throwsSync))).toBe(FIXED);
    expect(await rephraseHint(FIXED, [], deps(notJson))).toBe(FIXED);
  });

  it("falls back on timeout, also when the fetch ignores the abort signal", async () => {
    let signal: AbortSignal | undefined;
    const hangs = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {}); // never answers, never rejects
    }) as unknown as typeof globalThis.fetch;
    const started = Date.now();
    expect(await rephraseHint(FIXED, [], deps(hangs, { timeoutMs: 40 }))).toBe(FIXED);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal?.aborted).toBe(true); // the real request is cancelled too
  });

  it("falls back when the answer arrives after the timeout", async () => {
    const slow = vi.fn(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(groqBody("손전등을 비춰 봐요, 친구!")))), 120)),
    ) as unknown as typeof globalThis.fetch;
    expect(await rephraseHint(FIXED, [], deps(slow, { timeoutMs: 30 }))).toBe(FIXED);
  });

  it("gives up after 1500 ms by default, not before", async () => {
    vi.useFakeTimers();
    const hangs = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    let result: string | null = null;
    void rephraseHint(FIXED, [], deps(hangs)).then((r) => (result = r));

    await vi.advanceTimersByTimeAsync(1499);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(FIXED);
  });

  it("leaves no timer behind when the model answers in time", async () => {
    vi.useFakeTimers();
    const out = await rephraseHint(FIXED, [], deps(fakeGroq("손전등과 필름을 합쳐 봐요, 친구!")));
    expect(out).toBe("손전등과 필름을 합쳐 봐요, 친구!");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs nothing, on success or on any failure (no prompt, hint, answer or key)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const throws = vi.fn(async () => {
      throw new Error(`secret-key-k and ${FIXED} and 4719`);
    }) as unknown as typeof globalThis.fetch;
    const http500 = vi.fn(async () => new Response("oops 4719", { status: 500 })) as unknown as typeof globalThis.fetch;
    const hangs = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;

    await rephraseHint(FIXED, ["4719"], deps(fakeGroq("손전등과 필름을 합쳐 봐요, 친구!")));
    await rephraseHint(FIXED, ["4719"], deps(fakeGroq("정답은 4719야!")));
    await rephraseHint(FIXED, ["4719"], deps(throws));
    await rephraseHint(FIXED, ["4719"], deps(http500));
    await rephraseHint(FIXED, ["4719"], deps(hangs, { timeoutMs: 20 }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("createBanditAi", () => {
  it("is null while the feature is off", () => {
    const fetch = fakeGroq("x");
    expect(createBanditAi({}, fetch)).toBeNull();
    expect(createBanditAi({ BANDIT_AI: "0", GROQ_API_KEY: "k" }, fetch)).toBeNull();
    expect(createBanditAi({ BANDIT_AI: "1" }, fetch)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rephrases with the key and the default model, or GROQ_MODEL when set", async () => {
    const fetch = fakeGroq("손전등과 필름을 합쳐 봐요, 친구!");
    const ai = createBanditAi({ BANDIT_AI: "1", GROQ_API_KEY: " k1 " }, fetch);
    expect(ai).not.toBeNull();
    expect(await ai!.rephrase(FIXED, ["4719"])).toBe("손전등과 필름을 합쳐 봐요, 친구!");
    const first = callOf(fetch);
    expect((first.init.headers as Record<string, string>).authorization).toBe("Bearer k1");
    expect((JSON.parse(String(first.init.body)) as { model: string }).model).toBe(GROQ_DEFAULT_MODEL);

    const other = fakeGroq("손전등과 필름을 합쳐 봐요, 친구!");
    await createBanditAi({ BANDIT_AI: "1", GROQ_API_KEY: "k", GROQ_MODEL: "other-model" }, other)!.rephrase(FIXED, []);
    expect((JSON.parse(String(callOf(other).init.body)) as { model: string }).model).toBe("other-model");
  });

  it("passes the timeout on", async () => {
    const hangs = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    const ai = createBanditAi({ BANDIT_AI: "1", GROQ_API_KEY: "k" }, hangs, 30)!;
    expect(await ai.rephrase(FIXED, [])).toBe(FIXED);
  });
});
