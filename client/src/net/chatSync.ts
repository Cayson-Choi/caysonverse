/**
 * Bridge the room's chat messages into the two client sinks:
 *  - the module BUBBLE REGISTRY (3D speech bubbles, read by each avatar's render
 *    loop — outside React state), and
 *  - the zustand CHAT-LOG store (the collapsible panel — discrete UI events).
 *
 * Both self and remote bubbles come from the broadcast here (never a local
 * echo). ChatRejected is a personal notice → a local-only dimmed system row.
 * Chat is never read aloud (owner decision 2026-11-03). Returns a teardown that
 * unregisters the handlers and clears all sinks.
 */

import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, ChatRejectedPayload } from "@caysonverse/shared/messages";
import { bubbleRegistry } from "../game/bubbleRegistry";
import { useChatStore } from "../stores/chatStore";

/**
 * What the chat sync reads of a room — structural, so any player room fits (Room's own generic is invariant,
 * hence a shape instead of Room<WorldState>).
 */
export interface ChatRoom {
  onMessage<T = unknown>(type: string, callback: (message: T) => void): () => void;
}

export function startChatSync(room: ChatRoom): () => void {
  const offChat = room.onMessage(MessageType.Chat, (m: ChatBroadcast) => {
    bubbleRegistry.set(m.sid, m.text, performance.now());
    useChatStore.getState().pushMessage(m.name, m.text);
  });

  const offRejected = room.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => {
    useChatStore.getState().pushSystem(m.reason);
  });

  return () => {
    offChat();
    offRejected();
    bubbleRegistry.clear();
    useChatStore.getState().clear();
  };
}
