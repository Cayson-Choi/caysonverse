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
import type { ChatBroadcast, ChatRejectedPayload, SystemBroadcast } from "@caysonverse/shared/messages";
import { EMOJIS } from "@caysonverse/shared/constants";
import { bubbleRegistry } from "../game/bubbleRegistry";
import { emojiRegistry } from "../game/emojiRegistry";
import { useChatStore } from "../stores/chatStore";

/** 🎉 index in EMOJIS — the local self-celebration when MY escape is announced. */
const CELEBRATE_EMOJI_INDEX = EMOJIS.indexOf("\u{1F389}");

export function startChatSync(room: Room<WorldState>): () => void {
  const offChat = room.onMessage(MessageType.Chat, (m: ChatBroadcast) => {
    bubbleRegistry.set(m.sid, m.text, performance.now());
    useChatStore.getState().pushMessage(m.name, m.text);
  });

  const offRejected = room.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => {
    useChatStore.getState().pushSystem(m.reason);
  });

  // Server-driven system notice (e.g. the maze escape) → dimmed row for EVERYONE.
  // When the notice is about ME (sid === my session), also fire the 🎉 emoji float
  // locally — reusing the existing emoji pipeline, no new sync (self-celebration).
  const offSystem = room.onMessage(MessageType.System, (m: SystemBroadcast) => {
    useChatStore.getState().pushSystem(m.text);
    if (m.sid && m.sid === room.sessionId && CELEBRATE_EMOJI_INDEX >= 0) {
      emojiRegistry.set(room.sessionId, CELEBRATE_EMOJI_INDEX, performance.now());
    }
  });

  return () => {
    offChat();
    offRejected();
    offSystem();
    bubbleRegistry.clear();
    useChatStore.getState().clear();
  };
}
