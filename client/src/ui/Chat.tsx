import { useEffect } from "react";
import { getRoom } from "../net/connection";
import { startChatSync } from "../net/chatSync";
import { ChatLog } from "./ChatLog";
import { ChatInput } from "./ChatInput";
import "./chat.css";

/**
 * DOM overlay for chat: wires the room's chat messages into the bubble registry
 * and the chat-log store (for this component's lifetime), then renders the
 * collapsible log and the input bar. Speech bubbles themselves live in the 3D
 * scene (driven by the registry), not here.
 */
export function Chat() {
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return startChatSync(room);
  }, []);

  return (
    <>
      <ChatLog />
      <ChatInput />
    </>
  );
}
