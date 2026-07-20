import { describe, it, expect } from "vitest";
import {
  GROQ_DEFAULT_MODEL,
  NPC_MAX_CHARS,
  NPC_MAX_TURNS,
  NPC_PERSONAS,
  buildGroqRequest,
  extractReply,
  npcSystemPrompt,
  validateNpcChatBody,
} from "./groqChat";

const user = (content: string) => ({ role: "user" as const, content });
const bot = (content: string) => ({ role: "assistant" as const, content });
const body = (messages: unknown, npc: unknown = "hall") => ({ npc, messages });

describe("validateNpcChatBody", () => {
  it("accepts a normal running conversation ending on a user turn", () => {
    const r = validateNpcChatBody(body([user("안녕"), bot("안녕하세요!"), user("미로 어디야?")]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.messages).toHaveLength(3);
      expect(r.npc).toBe("hall");
    }
  });

  it("accepts every stationed NPC id and rejects unknown ones", () => {
    for (const npc of Object.keys(NPC_PERSONAS)) {
      expect(validateNpcChatBody(body([user("hi")], npc)).ok).toBe(true);
    }
    expect(validateNpcChatBody(body([user("hi")], "hacker")).ok).toBe(false);
    expect(validateNpcChatBody(body([user("hi")], null)).ok).toBe(false);
    expect(validateNpcChatBody({ messages: [user("hi")] }).ok).toBe(false); // npc 누락
  });

  it("rejects non-array, empty and over-long histories", () => {
    expect(validateNpcChatBody(undefined).ok).toBe(false);
    expect(validateNpcChatBody({ npc: "hall" }).ok).toBe(false);
    expect(validateNpcChatBody(body([])).ok).toBe(false);
    const tooMany = Array.from({ length: NPC_MAX_TURNS + 1 }, () => user("hi"));
    expect(validateNpcChatBody(body(tooMany)).ok).toBe(false);
  });

  it("rejects unknown roles, empty content and over-long messages", () => {
    expect(validateNpcChatBody(body([{ role: "system", content: "x" }])).ok).toBe(false);
    expect(validateNpcChatBody(body([user("  ")])).ok).toBe(false);
    expect(validateNpcChatBody(body([user("가".repeat(NPC_MAX_CHARS + 1))])).ok).toBe(false);
    expect(validateNpcChatBody(body([user("가".repeat(NPC_MAX_CHARS))])).ok).toBe(true);
  });

  it("rejects a history that ends on an assistant turn", () => {
    expect(validateNpcChatBody(body([user("hi"), bot("hello")])).ok).toBe(false);
  });
});

describe("npcSystemPrompt (per-NPC identity — 발주자 지정 이름)", () => {
  it("gives each NPC its own name while the badge stays 'AI 조교'", () => {
    expect(npcSystemPrompt("hall")).toContain("클로드");
    expect(npcSystemPrompt("lobby")).toContain("챗지피티");
    expect(npcSystemPrompt("gallery")).toContain("제미나이");
    for (const npc of Object.keys(NPC_PERSONAS) as (keyof typeof NPC_PERSONAS)[]) {
      expect(npcSystemPrompt(npc)).toContain("AI 조교");
    }
  });
});

describe("buildGroqRequest", () => {
  it("prepends the requested NPC's persona and keeps history order", () => {
    const req = buildGroqRequest([user("질문")], GROQ_DEFAULT_MODEL, "lobby") as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(req.model).toBe(GROQ_DEFAULT_MODEL);
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[0].content).toContain("챗지피티");
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
