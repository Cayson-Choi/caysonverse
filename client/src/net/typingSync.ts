/**
 * Bridge the room's typing broadcast into the module TYPING REGISTRY (the "…" each
 * name tag reads). Mirrors jumpSync.ts: the server relays a typing event to
 * everyone EXCEPT the typist, and we never show our own "…" anyway, so our own sid is
 * still ignored here as a guard. Besides the explicit OFF, a chat line from the typist also removes them
 * at once (the server clears its flag on a chat and sends no OFF), and an ON that
 * is never followed by either expires by itself (TYPING_TTL_MS, in the registry).
 * Returns a teardown that unregisters both handlers and clears the registry.
 */

import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, TypingBroadcast } from "@caysonverse/shared/messages";
import { typingRegistry } from "../game/typing";

export function startTypingSync(room: Room<WorldState>): () => void {
  const offTyping = room.onMessage(MessageType.Typing, (m: TypingBroadcast) => {
    if (m.sid === room.sessionId) return; // own echo: we never show our own "…"
    if (m.on) typingRegistry.set(m.sid, performance.now());
    else typingRegistry.remove(m.sid);
  });

  const offChat = room.onMessage(MessageType.Chat, (m: ChatBroadcast) => {
    typingRegistry.remove(m.sid);
  });

  return () => {
    offTyping();
    offChat();
    typingRegistry.clear();
  };
}
