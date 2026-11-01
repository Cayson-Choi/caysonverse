/**
 * 반딧 hint polish (escape phase 1, Task 12) — OPTIONAL and OFF by default (spec §10: "AI 없이도
 * 정해진 힌트로 동작"). The authored hint stays the truth; when the feature is on, Groq may only SAY
 * it again, kindly, in one short sentence. Anything that is not clearly that — a leaked secret, an
 * empty, long or non-Korean answer, an HTTP error, a hang, a throw — gives the authored hint back,
 * unchanged, and never later than the timeout.
 *
 * Secrets (answers, clue originals, every hint of the room: `secretStrings`) are used here only to
 * CHECK the model's answer. They are never sent to the model, and nothing in this file logs: not the
 * prompt, the hint, the answer, the model's reply, the error or the key.
 */
import { GROQ_DEFAULT_MODEL, GROQ_URL, extractReply } from "../npc/groqChat";

/** A hint must never wait longer than this for the model. */
export const BANDIT_TIMEOUT_MS = 1500;
/** The polished sentence is at most this many characters (code points). */
export const BANDIT_MAX_CHARS = 120;
/** Upper bound on the model's output (a reasoning model spends part of it before the sentence). */
const BANDIT_MAX_TOKENS = 400;
const BANDIT_TEMPERATURE = 0.5;

const BANDIT_SYSTEM_PROMPT =
  "너는 손전등을 든 작은 경비 로봇 '반딧'이다. 아래 힌트의 뜻을 바꾸거나 더 알려 주지 말고, 초등학생에게 다정한 한 문장(120자 이내)으로만 다시 말해라.";

const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;

/** On only for `BANDIT_AI=1` with a Groq key; every other value (0, empty, true, …) is off. */
export function banditAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.GROQ_API_KEY;
  return env.BANDIT_AI === "1" && typeof key === "string" && key.trim().length > 0;
}

/**
 * Compare form: Unicode-compatibility folded and lower-cased, with spaces, punctuation, symbols and
 * invisible marks removed — so "4 7 1 9", "4-7-1-9", "４７１９" and "동의 먼저" all meet the stored
 * answers "4719" and "동의먼저".
 */
function fold(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\p{Z}\p{P}\p{S}\p{C}]/gu, "");
}

/**
 * May the model's sentence replace the authored hint? 1–120 characters once trimmed, at least one
 * Hangul syllable or jamo, and none of the secrets that the authored hint itself does not already
 * contain (a hint is one of the room's secrets, and it may use a secret's word: those are fine).
 */
export function acceptRephrase(fixed: string, candidate: string, secrets: readonly string[]): boolean {
  const text = candidate.trim();
  const length = [...text].length;
  if (length < 1 || length > BANDIT_MAX_CHARS) return false;
  if (!HANGUL.test(text)) return false;

  const foldedText = fold(text);
  const foldedFixed = fold(fixed);
  for (const secret of secrets) {
    if (secret === "" || fixed.includes(secret)) continue;
    if (text.includes(secret)) return false;
    const folded = fold(secret);
    if (folded === "" || foldedFixed.includes(folded)) continue;
    if (foldedText.includes(folded)) return false;
  }
  return true;
}

export interface RephraseDeps {
  fetch: typeof fetch;
  apiKey: string;
  model: string;
  /** Default {@link BANDIT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** One Groq call: the model's trimmed text, or null when the answer has none. */
async function askModel(fixed: string, deps: RephraseDeps, signal: AbortSignal): Promise<string | null> {
  const res = await deps.fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: deps.model,
      messages: [
        { role: "system", content: BANDIT_SYSTEM_PROMPT },
        { role: "user", content: fixed },
      ],
      max_tokens: BANDIT_MAX_TOKENS,
      temperature: BANDIT_TEMPERATURE,
    }),
    signal,
  });
  return res.ok ? extractReply(await res.json()) : null;
}

/**
 * The authored hint said again by 반딧, or the authored hint itself. Never rejects and never takes
 * longer than `timeoutMs`, even if the fetch ignores its abort signal.
 */
export function rephraseHint(fixed: string, secrets: readonly string[], deps: RephraseDeps): Promise<string> {
  const timeoutMs = deps.timeoutMs !== undefined && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : BANDIT_TIMEOUT_MS;
  const abort = new AbortController();
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      abort.abort();
      resolve(fixed);
    }, timeoutMs);
    const settle = (text: string): void => {
      clearTimeout(timer);
      resolve(text); // (a no-op after the timeout already answered)
    };
    askModel(fixed, deps, abort.signal).then(
      (reply) => {
        let out = fixed;
        try {
          if (reply !== null && acceptRephrase(fixed, reply, secrets)) out = reply.trim();
        } catch {
          // keep the authored hint
        }
        settle(out);
      },
      () => settle(fixed),
    );
  });
}

/** What a room holds when the feature is on. */
export interface BanditAi {
  /** {@link rephraseHint} with this server's key, model and timeout. */
  rephrase(fixed: string, secrets: readonly string[]): Promise<string>;
}

/** The server's polish step, or null while the feature is off (the default). */
export function createBanditAi(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  timeoutMs?: number,
): BanditAi | null {
  if (!banditAiEnabled(env)) return null;
  const apiKey = (env.GROQ_API_KEY as string).trim();
  const model = env.GROQ_MODEL || GROQ_DEFAULT_MODEL;
  return { rephrase: (fixed, secrets) => rephraseHint(fixed, secrets, { fetch: fetchImpl, apiKey, model, timeoutMs }) };
}
