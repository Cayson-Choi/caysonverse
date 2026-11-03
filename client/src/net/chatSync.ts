/**
 * Bridge the room's chat messages into the three client sinks:
 *  - the module BUBBLE REGISTRY (3D speech bubbles, read by each avatar's render
 *    loop — outside React state),
 *  - the zustand CHAT-LOG store (the collapsible panel — discrete UI events), and
 *  - the TTS queue (design 23): chat only — never System/ChatRejected — gated by
 *    sender distance read from the authoritative schema positions. SWITCHED OFF:
 *    CHAT_VOICE_ENABLED is false (owner decision 2026-11-03), so no line is spoken.
 *
 * Both self and remote bubbles come from the broadcast here (never a local
 * echo). ChatRejected is a personal notice → a local-only dimmed system row.
 * Returns a teardown that unregisters the handlers and clears all sinks.
 */

import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, ChatRejectedPayload, SystemBroadcast } from "@caysonverse/shared/messages";
import { EMOJIS } from "@caysonverse/shared/constants";
import { DEFAULT_APPEARANCE, voiceGender } from "@caysonverse/shared/appearance";
import { bubbleRegistry } from "../game/bubbleRegistry";
import { emojiRegistry } from "../game/emojiRegistry";
import { speakChatNeural, stopChatVoice, type ChatVoiceGender } from "../game/chatVoice";
import { CHAT_VOICE_ENABLED } from "../game/tts";
import { stopNpcVoice } from "../game/npcVoice";
import { useChatStore } from "../stores/chatStore";
import { useSoundStore } from "../stores/soundStore";

/** 🎉 index in EMOJIS — the local self-celebration when MY escape is announced. */
const CELEBRATE_EMOJI_INDEX = EMOJIS.indexOf("\u{1F389}");

/**
 * What the chat sync reads of a room — structural, so any player room fits: the world, a class's hall
 * and a team's classroom (whose chat is the team chat). Room's own generic is invariant, hence a
 * shape instead of Room<WorldState>. The sender's voice and the positions come from the synced
 * players map.
 */
export interface ChatRoom {
  readonly sessionId: string;
  readonly state:
    | {
        readonly players?: {
          get?(sid: string): { voice: number; x: number; z: number } | undefined;
        };
      }
    | undefined;
  onMessage<T = unknown>(type: string, callback: (message: T) => void): () => void;
}

export function startChatSync(room: ChatRoom): () => void {
  const offChat = room.onMessage(MessageType.Chat, (m: ChatBroadcast) => {
    bubbleRegistry.set(m.sid, m.text, performance.now());
    useChatStore.getState().pushMessage(m.name, m.text);
    // Chat is never read aloud (CHAT_VOICE_ENABLED = false, owner decision 2026-11-03). The block below is
    // what runs if the flag is ever turned back on; with it off nothing here reads the sound store, the
    // players map or the Audio API.
    if (!CHAT_VOICE_ENABLED) return;
    // Neural TTS (design 23 gate + design 34 후속 voices): distance from the
    // authoritative schema positions — the 10 Hz patch lag is acceptable for
    // an audibility gate. My own message is distance 0 (always spoken); a
    // sender missing from the state (join/leave race) yields NaN, skipped.
    // The SENDER's synced appearance `voice` picks the male/female Edge voice (a
    // sender missing from the state falls back to the default look's voice).
    const muted = useSoundStore.getState().muted;
    const players = room.state?.players;
    const sender = players?.get?.(m.sid);
    const gender: ChatVoiceGender = voiceGender(sender?.voice ?? DEFAULT_APPEARANCE.voice);
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
    // (Web Speech is fully unwired. The chat channel is off; the NPC channel is the legacy world's.)
    stopChatVoice();
    stopNpcVoice();
  };
}
