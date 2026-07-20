/**
 * Bridge the room's chat messages into the three client sinks:
 *  - the module BUBBLE REGISTRY (3D speech bubbles, read by each avatar's render
 *    loop — outside React state),
 *  - the zustand CHAT-LOG store (the collapsible panel — discrete UI events), and
 *  - the TTS queue (design 23): chat only — never System/ChatRejected — gated by
 *    sender distance read from the authoritative schema positions.
 *
 * Both self and remote bubbles come from the broadcast here (never a local
 * echo). ChatRejected is a personal notice → a local-only dimmed system row.
 * Returns a teardown that unregisters the handlers and clears all sinks.
 */

import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, ChatRejectedPayload, SystemBroadcast } from "@caysonverse/shared/messages";
import { EMOJIS } from "@caysonverse/shared/constants";
import { bubbleRegistry } from "../game/bubbleRegistry";
import { emojiRegistry } from "../game/emojiRegistry";
import { speakChatNeural, stopChatVoice, type ChatVoiceGender } from "../game/chatVoice";
import { stopNpcVoice } from "../game/npcVoice";
import { CHARACTERS } from "../game/constants";
import { useChatStore } from "../stores/chatStore";
import { useSoundStore } from "../stores/soundStore";

/** 🎉 index in EMOJIS — the local self-celebration when MY escape is announced. */
const CELEBRATE_EMOJI_INDEX = EMOJIS.indexOf("\u{1F389}");

export function startChatSync(room: Room<WorldState>): () => void {
  const offChat = room.onMessage(MessageType.Chat, (m: ChatBroadcast) => {
    bubbleRegistry.set(m.sid, m.text, performance.now());
    useChatStore.getState().pushMessage(m.name, m.text);
    // Neural TTS (design 23 gate + design 34 후속 voices): distance from the
    // authoritative schema positions — the 10 Hz patch lag is acceptable for
    // an audibility gate. My own message is distance 0 (always spoken); a
    // sender missing from the state (join/leave race) yields NaN, skipped.
    // The SENDER's character picks the male/female Edge voice.
    const muted = useSoundStore.getState().muted;
    const players = room.state?.players;
    const sender = players?.get?.(m.sid);
    const gender: ChatVoiceGender = CHARACTERS[sender?.character ?? 0]?.voice ?? "male";
    if (m.sid === room.sessionId) {
      speakChatNeural(m.text, 0, gender, muted);
    } else {
      const me = players?.get?.(room.sessionId);
      const distance =
        me && sender ? Math.hypot(sender.x - me.x, sender.z - me.z) : Number.NaN;
      speakChatNeural(m.text, distance, gender, muted);
    }
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
    // Stop any in-flight reading and flush both neural channels — a reconnect
    // remounts this sync, and a stale line must not talk over the new world.
    // (Web Speech is fully unwired — Edge TTS is the ONLY voice, 발주자 요청.)
    stopChatVoice();
    stopNpcVoice();
  };
}
