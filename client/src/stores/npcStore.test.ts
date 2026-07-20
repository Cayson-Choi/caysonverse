import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NPC_GREETING, NPC_HISTORY_TURNS, NPC_INPUT_MAX, useNpcStore } from "./npcStore";
import { NPC_CLOSE_RADIUS, NPC_POS, NPC_TALK_RADIUS, isNearNpc } from "../game/npc";
import { OBSTACLES } from "@caysonverse/shared/worldMap";

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

beforeEach(() => {
  useNpcStore.setState({ open: false, sending: false, messages: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("npc placement", () => {
  it("stands clear of every collision obstacle (walkable talk spot)", () => {
    for (const o of OBSTACLES) {
      const inside =
        NPC_POS.x >= o.minX && NPC_POS.x <= o.maxX && NPC_POS.z >= o.minZ && NPC_POS.z <= o.maxZ;
      expect(inside).toBe(false);
    }
  });

  it("proximity radii are ordered (talk < auto-close)", () => {
    expect(NPC_TALK_RADIUS).toBeLessThan(NPC_CLOSE_RADIUS);
    expect(isNearNpc(NPC_POS.x + NPC_TALK_RADIUS - 0.1, NPC_POS.z, NPC_TALK_RADIUS)).toBe(true);
    expect(isNearNpc(NPC_POS.x + NPC_TALK_RADIUS + 0.1, NPC_POS.z, NPC_TALK_RADIUS)).toBe(false);
  });
});

describe("useNpcStore", () => {
  it("greets once on first open and keeps history across close/reopen", () => {
    const s = useNpcStore.getState();
    s.openPanel();
    expect(useNpcStore.getState().messages).toEqual([{ role: "assistant", text: NPC_GREETING }]);
    useNpcStore.getState().closePanel();
    useNpcStore.getState().openPanel();
    expect(useNpcStore.getState().messages).toHaveLength(1); // no duplicate greeting
  });

  it("send() posts the trimmed history and appends the reply", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { reply: "답변이에요" }));
    vi.stubGlobal("fetch", fetchMock);
    useNpcStore.getState().openPanel();
    await useNpcStore.getState().send("  미로는 어디에 있어?  ");

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: "user",
      content: "미로는 어디에 있어?",
    });
    const msgs = useNpcStore.getState().messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: "assistant", text: "답변이에요" });
    expect(useNpcStore.getState().sending).toBe(false);
  });

  it("caps the wire history at NPC_HISTORY_TURNS with the newest turns kept", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { reply: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    useNpcStore.setState({
      messages: Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 ? ("assistant" as const) : ("user" as const),
        text: `m${i}`,
      })),
    });
    await useNpcStore.getState().send("최신 질문");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages).toHaveLength(NPC_HISTORY_TURNS);
    expect(body.messages[body.messages.length - 1].content).toBe("최신 질문");
  });

  it("shows the server's Korean error line on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: "잠시 후 다시" })));
    await useNpcStore.getState().send("질문");
    const msgs = useNpcStore.getState().messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: "assistant", text: "잠시 후 다시" });
  });

  it("falls back to a friendly line on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    await useNpcStore.getState().send("질문");
    const msgs = useNpcStore.getState().messages;
    expect(msgs[msgs.length - 1].role).toBe("assistant");
    expect(msgs[msgs.length - 1].text).toContain("죄송해요");
  });

  it("ignores empty input and clips over-long input to NPC_INPUT_MAX", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { reply: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await useNpcStore.getState().send("   ");
    expect(fetchMock).not.toHaveBeenCalled();
    await useNpcStore.getState().send("가".repeat(NPC_INPUT_MAX + 50));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect([...body.messages[body.messages.length - 1].content]).toHaveLength(NPC_INPUT_MAX);
  });
});
