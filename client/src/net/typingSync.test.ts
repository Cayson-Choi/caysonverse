import { afterEach, describe, expect, it, vi } from "vitest";
import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, TypingBroadcast } from "@caysonverse/shared/messages";
import { typingRegistry } from "../game/typing";
import { startTypingSync } from "./typingSync";

type Handler = (m: never) => void;

/** A room stand-in that records handlers per message type and lets the test deliver broadcasts. */
function fakeRoom(sessionId = "me") {
  const handlers = new Map<string, Handler>();
  const offs = new Map<string, ReturnType<typeof vi.fn>>();
  const room = {
    sessionId,
    onMessage(type: string, cb: Handler) {
      handlers.set(type, cb);
      const off = vi.fn();
      offs.set(type, off);
      return off;
    },
  } as unknown as Room<WorldState>;
  return {
    room,
    offs,
    typing: (m: TypingBroadcast) => (handlers.get(MessageType.Typing) as ((m: TypingBroadcast) => void))(m),
    chat: (m: ChatBroadcast) => (handlers.get(MessageType.Chat) as ((m: ChatBroadcast) => void))(m),
    registered: (type: string) => handlers.has(type),
  };
}

const chatFrom = (sid: string): ChatBroadcast => ({ sid, name: "n", text: "hi" });

describe("startTypingSync", () => {
  afterEach(() => typingRegistry.clear());

  it("registers a Typing and a Chat handler", () => {
    const f = fakeRoom();
    const stop = startTypingSync(f.room);
    expect(f.registered(MessageType.Typing)).toBe(true);
    expect(f.registered(MessageType.Chat)).toBe(true);
    stop();
  });

  it("on → set: a remote player's ON marks them as typing", () => {
    const f = fakeRoom();
    const stop = startTypingSync(f.room);
    f.typing({ sid: "bob", on: true });
    expect(typingRegistry.isTyping("bob", performance.now())).toBe(true);
    stop();
  });

  it("off → remove at once", () => {
    const f = fakeRoom();
    const stop = startTypingSync(f.room);
    f.typing({ sid: "bob", on: true });
    f.typing({ sid: "bob", on: false });
    expect(typingRegistry.isTyping("bob", performance.now())).toBe(false);
    stop();
  });

  it("a chat line from the typist removes them at once", () => {
    const f = fakeRoom();
    const stop = startTypingSync(f.room);
    f.typing({ sid: "bob", on: true });
    f.typing({ sid: "eve", on: true });
    f.chat(chatFrom("bob"));
    const now = performance.now();
    expect(typingRegistry.isTyping("bob", now)).toBe(false);
    expect(typingRegistry.isTyping("eve", now)).toBe(true); // someone else's chat changes nothing
    stop();
  });

  it("ignores the echo of our own typing (we never show our own …)", () => {
    const f = fakeRoom("me");
    const stop = startTypingSync(f.room);
    f.typing({ sid: "me", on: true });
    expect(typingRegistry.isTyping("me", performance.now())).toBe(false);
    expect(typingRegistry.snapshot(performance.now())).toEqual([]);
    stop();
  });

  it("each ON restarts the receiving clock (the sender's heartbeat)", () => {
    const f = fakeRoom();
    const stop = startTypingSync(f.room);
    const spy = vi.spyOn(performance, "now");
    spy.mockReturnValue(1000);
    f.typing({ sid: "bob", on: true });
    spy.mockReturnValue(4000);
    f.typing({ sid: "bob", on: true });
    // 1000 + TTL(5000) = 6000 would have expired it; the second ON at 4000 keeps it until 9000.
    expect(typingRegistry.isTyping("bob", 6500)).toBe(true);
    expect(typingRegistry.isTyping("bob", 9000)).toBe(false);
    spy.mockRestore();
    stop();
  });

  it("teardown unregisters both handlers and clears the registry", () => {
    const f = fakeRoom();
    const stop = startTypingSync(f.room);
    f.typing({ sid: "bob", on: true });
    f.typing({ sid: "eve", on: true });
    stop();
    expect(f.offs.get(MessageType.Typing)).toHaveBeenCalledTimes(1);
    expect(f.offs.get(MessageType.Chat)).toHaveBeenCalledTimes(1);
    const now = performance.now();
    expect(typingRegistry.isTyping("bob", now)).toBe(false);
    expect(typingRegistry.isTyping("eve", now)).toBe(false);
  });
});
