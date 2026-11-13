import { beforeEach, describe, expect, it } from "vitest";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, ChatRejectedPayload } from "@caysonverse/shared/messages";
import { startChatSync, type ChatRoom } from "./chatSync";
import { bubbleRegistry } from "../game/bubbleRegistry";
import { useChatStore } from "../stores/chatStore";

/** A room that only records its message handlers, so a test can deliver a broadcast by hand. */
function harness() {
  const handlers = new Map<string, (m: unknown) => void>();
  const room: ChatRoom = {
    onMessage: (type: string, cb: (m: never) => void) => {
      handlers.set(type, cb as (m: unknown) => void);
      return () => void handlers.delete(type);
    },
  };
  const stop = startChatSync(room);
  return {
    chat: (m: ChatBroadcast) => handlers.get(MessageType.Chat)?.(m),
    rejected: (m: ChatRejectedPayload) => handlers.get(MessageType.ChatRejected)?.(m),
    handlerCount: () => handlers.size,
    stop,
  };
}

beforeEach(() => {
  useChatStore.getState().clear();
  bubbleRegistry.clear();
});

describe("startChatSync", () => {
  it("a chat broadcast reaches the log and the speech bubble of its sender", () => {
    const h = harness();
    h.chat({ sid: "a", name: "이웃", text: "반가워요" });
    expect(useChatStore.getState().log.map((e) => [e.kind, e.name, e.text])).toEqual([["message", "이웃", "반가워요"]]);
    expect(bubbleRegistry.get("a", performance.now())?.text).toBe("반가워요");
    h.stop();
  });

  it("a rejected line is a local system row, not a bubble", () => {
    const h = harness();
    h.rejected({ reason: "메시지가 너무 빨라요." });
    expect(useChatStore.getState().log.map((e) => [e.kind, e.text])).toEqual([["system", "메시지가 너무 빨라요."]]);
    h.stop();
  });

  it("tearing the sync down unregisters its handlers and leaves the log empty", () => {
    const h = harness();
    h.chat({ sid: "a", name: "이웃", text: "안녕하세요" });
    expect(h.handlerCount()).toBe(2);
    expect(() => h.stop()).not.toThrow();
    expect(h.handlerCount()).toBe(0);
    expect(useChatStore.getState().log).toEqual([]);
  });
});
