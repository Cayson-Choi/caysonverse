/**
 * AI 조교 side-chat state (design 31). A private 1:1 conversation with the
 * NPC: history lives ONLY here (client memory, per session), the wire is the
 * server's /api/npc-chat proxy. Replies are read aloud through the shared TTS
 * queue (distance 0, honouring the 🔊 mute toggle) — the NPC "speaks".
 */

import { create } from "zustand";
import { SERVER_URL } from "../net/endpoint";
import { speakChat } from "../game/tts";
import { useSoundStore } from "./soundStore";

/** Must match the server's NPC_MAX_TURNS / NPC_MAX_CHARS (groqChat.ts). */
export const NPC_HISTORY_TURNS = 12;
export const NPC_INPUT_MAX = 500;

/** Local greeting shown (and spoken) when the panel first opens. */
export const NPC_GREETING =
  "안녕하세요! 저는 최무호 월드의 AI 조교예요. 공부나 월드에 대해 무엇이든 물어보세요 🙂";

/** Shown as an NPC line when the proxy/network fails without a server message. */
const FALLBACK_ERROR = "죄송해요, 지금은 답변할 수 없어요. 잠시 후 다시 시도해 주세요.";

export interface NpcChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface NpcChatState {
  open: boolean;
  sending: boolean;
  messages: NpcChatMessage[];
  openPanel(): void;
  closePanel(): void;
  send(text: string): Promise<void>;
}

/** Speak an NPC line through the shared chat-TTS queue (mute-aware). */
function speakNpc(text: string): void {
  speakChat(text, 0, { muted: useSoundStore.getState().muted });
}

export const useNpcStore = create<NpcChatState>((set, get) => ({
  open: false,
  sending: false,
  messages: [],

  openPanel() {
    const first = get().messages.length === 0;
    set((s) => ({
      open: true,
      messages: first ? [{ role: "assistant", text: NPC_GREETING }] : s.messages,
    }));
    if (first) speakNpc(NPC_GREETING);
  },

  closePanel() {
    set({ open: false });
  },

  async send(raw: string) {
    const text = raw.trim().slice(0, NPC_INPUT_MAX);
    if (!text || get().sending) return;
    set((s) => ({ sending: true, messages: [...s.messages, { role: "user", text }] }));

    // Wire history: the most recent turns only, oldest dropped (server cap).
    const wire = get()
      .messages.slice(-NPC_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.text }));

    let reply = FALLBACK_ERROR;
    try {
      const res = await fetch(`${SERVER_URL}/api/npc-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: wire }),
      });
      const json = (await res.json().catch(() => null)) as {
        reply?: string;
        error?: string;
      } | null;
      reply = (res.ok ? json?.reply : json?.error) || FALLBACK_ERROR;
    } catch {
      // network failure → fallback line
    }
    set((s) => ({ sending: false, messages: [...s.messages, { role: "assistant", text: reply }] }));
    speakNpc(reply);
  },
}));
