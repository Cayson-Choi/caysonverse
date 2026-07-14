/**
 * Bridge the room's chat messages into the two client sinks:
 *  - the module BUBBLE REGISTRY (3D speech bubbles, read by each avatar's render
 *    loop — outside React state), and
 *  - the zustand CHAT-LOG store (the collapsible panel — discrete UI events).
 *
 * Both self and remote bubbles come from the broadcast here (never a local
 * echo). ChatRejected is a personal notice → a local-only dimmed system row.
 * Returns a teardown that unregisters the handlers and clears both sinks.
 */

import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, ChatRejectedPayload } from "@caysonverse/shared/messages";
import { bubbleRegistry } from "../game/bubbleRegistry";
import { useChatStore } from "../stores/chatStore";

export function startChatSync(room: Room<WorldState>): () => void {
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
