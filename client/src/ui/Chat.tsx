import { useEffect } from "react";
import { getRoom } from "../net/connection";
import { startChatSync } from "../net/chatSync";
import { startTypingSync } from "../net/typingSync";
import { ChatLog } from "./ChatLog";
import { isTouchDevice } from "../device";
import { ChatInput } from "./ChatInput";
import "./chat.css";

/**
 * DOM overlay for chat: wires the room's chat messages into the bubble registry
 * and the chat-log store, and the typing broadcast into the typing registry (for
 * this component's lifetime), then renders the input bar and — on a PC — the
 * collapsible log. (On a phone the log's toggle lives in the top-left column,
 * WorldScene mounts it there.) Speech bubbles and the typing "…" themselves live in
 * the 3D scene (driven by the registries), not here.
 */
export function Chat() {
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    const offChat = startChatSync(room);
    const offTyping = startTypingSync(room);
    return () => {
      offChat();
      offTyping();
    };
  }, []);

  return (
    <>
      {!isTouchDevice && <ChatLog />}
      <ChatInput />
    </>
  );
}
