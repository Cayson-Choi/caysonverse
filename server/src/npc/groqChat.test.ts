import { describe, it, expect } from "vitest";
import {
  GROQ_DEFAULT_MODEL,
  NPC_MAX_CHARS,
  NPC_MAX_TURNS,
  NPC_SYSTEM_PROMPT,
  buildGroqRequest,
  extractReply,
  validateNpcChatBody,
} from "./groqChat";

const user = (content: string) => ({ role: "user" as const, content });
const bot = (content: string) => ({ role: "assistant" as const, content });

describe("validateNpcChatBody", () => {
  it("accepts a normal running conversation ending on a user turn", () => {
    const r = validateNpcChatBody({ messages: [user("안녕"), bot("안녕하세요!"), user("미로 어디야?")] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messages).toHaveLength(3);
  });

  it("rejects non-array, empty and over-long histories", () => {
    expect(validateNpcChatBody(undefined).ok).toBe(false);
    expect(validateNpcChatBody({}).ok).toBe(false);
    expect(validateNpcChatBody({ messages: [] }).ok).toBe(false);
    const tooMany = Array.from({ length: NPC_MAX_TURNS + 1 }, () => user("hi"));
    expect(validateNpcChatBody({ messages: tooMany }).ok).toBe(false);
  });

  it("rejects unknown roles, empty content and over-long messages", () => {
    expect(validateNpcChatBody({ messages: [{ role: "system", content: "x" }] }).ok).toBe(false);
    expect(validateNpcChatBody({ messages: [user("  ")] }).ok).toBe(false);
    expect(validateNpcChatBody({ messages: [user("가".repeat(NPC_MAX_CHARS + 1))] }).ok).toBe(false);
    expect(validateNpcChatBody({ messages: [user("가".repeat(NPC_MAX_CHARS))] }).ok).toBe(true);
  });

  it("rejects a history that ends on an assistant turn", () => {
    expect(validateNpcChatBody({ messages: [user("hi"), bot("hello")] }).ok).toBe(false);
  });
});

describe("buildGroqRequest", () => {
  it("prepends the persona system prompt and keeps history order", () => {
    const req = buildGroqRequest([user("질문")]) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(req.model).toBe(GROQ_DEFAULT_MODEL);
    expect(req.messages[0]).toEqual({ role: "system", content: NPC_SYSTEM_PROMPT });
    expect(req.messages[1]).toEqual({ role: "user", content: "질문" });
  });

  it("honours a model override (GROQ_MODEL env path)", () => {
    const req = buildGroqRequest([user("q")], "other-model") as { model: string };
    expect(req.model).toBe("other-model");
  });
});

describe("extractReply", () => {
  it("extracts and trims the first choice's content", () => {
    expect(extractReply({ choices: [{ message: { content: "  답변  " } }] })).toBe("답변");
  });

  it("returns null for malformed or empty responses", () => {
    expect(extractReply(null)).toBe(null);
    expect(extractReply({})).toBe(null);
    expect(extractReply({ choices: [] })).toBe(null);
    expect(extractReply({ choices: [{ message: { content: "   " } }] })).toBe(null);
  });
});
