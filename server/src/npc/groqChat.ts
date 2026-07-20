/**
 * AI 조교 NPC — Groq chat proxy (design 31). The client NEVER sees the Groq
 * API key: it POSTs its running 1:1 conversation to `/api/npc-chat` and this
 * module validates, prepends the persona, calls Groq's OpenAI-compatible
 * endpoint and returns the assistant's reply.
 *
 * Everything except the actual fetch is pure and unit-tested: body validation,
 * request building and reply extraction take/return plain data.
 */

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Default model — overridable via GROQ_MODEL without a code change. */
export const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";

/** The client sends at most this many prior turns (user+assistant combined). */
export const NPC_MAX_TURNS = 12;

/** Per-message length cap (code points) — matches the panel's input limit. */
export const NPC_MAX_CHARS = 500;

/** Per-IP sliding-window rate limit for the proxy. */
export const NPC_RATE_LIMIT = 10;
export const NPC_RATE_WINDOW_MS = 60_000;

/** Upstream timeout (ms) — a hung LLM call must not pin the request. */
export const NPC_TIMEOUT_MS = 20_000;

/** Cap on the reply length we ask the model for (tokens). */
export const NPC_MAX_TOKENS = 400;

/**
 * The NPC persona. Korean, warm, concise — a teaching assistant standing beside
 * the lecture-hall screen in 최무호 월드.
 */
export const NPC_SYSTEM_PROMPT = [
  "너는 '최무호 월드' 강의실의 AI 조교야. 강의실 대형 스크린 옆에 서 있는 NPC로, 다가온 방문자와 1:1로 대화해.",
  "항상 한국어 해요체로, 친근하고 정중하게, 2~4문장으로 간결하게 답해.",
  "AI·프로그래밍 등 공부 관련 질문은 쉽고 정확하게 설명해 줘.",
  "월드 안내도 도와줘: 라운지(중앙 휴게 공간), 강의실(동쪽, 네가 있는 곳), 갤러리(북쪽 — 최무호 님의 1살부터 100살까지 일대기 초상), 미로방(서쪽 — 중앙 골에 도달하면 탈출 성공).",
  "욕설·혐오 표현이나 개인정보 요구에는 정중히 거절해.",
].join(" ");

/** One chat turn as exchanged with the client and with Groq. */
export interface NpcMessage {
  role: "user" | "assistant";
  content: string;
}

export type ValidationResult =
  | { ok: true; messages: NpcMessage[] }
  | { ok: false; error: string };

/**
 * Validate the request body from the client. Strict: unknown roles, empty or
 * over-long messages, non-array bodies and over-long histories are rejected
 * (the panel never produces them — a rejection means a tampered client).
 * The LAST message must be from the user (it is the turn being answered).
 */
export function validateNpcChatBody(body: unknown): ValidationResult {
  const messages = (body as { messages?: unknown } | null | undefined)?.messages;
  if (!Array.isArray(messages) || messages.length === 0)
    return { ok: false, error: "messages 배열이 필요합니다" };
  if (messages.length > NPC_MAX_TURNS)
    return { ok: false, error: `대화 턴은 최대 ${NPC_MAX_TURNS}개입니다` };
  const out: NpcMessage[] = [];
  for (const m of messages) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== "user" && role !== "assistant") return { ok: false, error: "잘못된 역할입니다" };
    if (typeof content !== "string" || content.trim().length === 0)
      return { ok: false, error: "빈 메시지는 보낼 수 없습니다" };
    if ([...content].length > NPC_MAX_CHARS)
      return { ok: false, error: `메시지는 ${NPC_MAX_CHARS}자 이내여야 합니다` };
    out.push({ role, content });
  }
  if (out[out.length - 1].role !== "user")
    return { ok: false, error: "마지막 메시지는 사용자 메시지여야 합니다" };
  return { ok: true, messages: out };
}

/** Build the Groq (OpenAI-compatible) request payload: persona + history. */
export function buildGroqRequest(
  messages: NpcMessage[],
  model: string = GROQ_DEFAULT_MODEL,
): object {
  return {
    model,
    messages: [{ role: "system", content: NPC_SYSTEM_PROMPT }, ...messages],
    max_tokens: NPC_MAX_TOKENS,
    temperature: 0.7,
  };
}

/** Pull the assistant text out of a Groq response body, or null if malformed. */
export function extractReply(json: unknown): string | null {
  const content = (
    json as { choices?: { message?: { content?: unknown } }[] } | null | undefined
  )?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
}

/** User-facing Korean errors (the panel shows these verbatim as NPC lines). */
export const NPC_ERRORS = {
  notConfigured: "죄송해요, 지금은 조교 기능이 준비 중이에요. 잠시 후 다시 시도해 주세요.",
  rateLimited: "질문이 너무 빨라요! 잠시 숨 고르고 다시 물어봐 주세요.",
  upstream: "죄송해요, 답변 생성에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
} as const;
