/**
 * AI 조교 side-chat state (design 31 + 후속: three assistants). One private
 * 1:1 conversation PER NPC: histories live ONLY here (client memory, per
 * session), the wire is the server's /api/npc-chat proxy with the npc id (the
 * server injects that assistant's persona/name). Replies are spoken through
 * the Edge-TTS neural voice with the browser Web Speech queue as fallback,
 * honouring the 🔊 mute toggle.
 */

import { create } from "zustand";
import { SERVER_URL } from "../net/endpoint";
import { speakChat } from "../game/tts";
import { playNpcVoice, stopNpcVoice } from "../game/npcVoice";
import { useSoundStore } from "./soundStore";
import type { NpcId } from "../game/npc";

/** Must match the server's NPC_MAX_TURNS / NPC_MAX_CHARS (groqChat.ts). */
export const NPC_HISTORY_TURNS = 12;
export const NPC_INPUT_MAX = 500;

/** Local greeting shown (and spoken) when an assistant's chat first opens. */
export const NPC_GREETING =
  "안녕하세요! 저는 최무호 월드의 AI 조교예요. 공부나 월드에 대해 무엇이든 물어보세요 🙂";

/** Shown as an NPC line when the proxy/network fails without a server message. */
const FALLBACK_ERROR = "죄송해요, 지금은 답변할 수 없어요. 잠시 후 다시 시도해 주세요.";

export interface NpcChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface NpcChatState {
  /** The assistant the panel is talking to; null = panel closed. */
  activeNpc: NpcId | null;
  sending: boolean;
  /** One independent conversation per assistant (session memory). */
  histories: Partial<Record<NpcId, NpcChatMessage[]>>;
  openPanel(npc: NpcId): void;
  closePanel(): void;
  send(text: string): Promise<void>;
}

/**
 * Speak an NPC line: the natural Edge-TTS neural voice first (design 31 후속),
 * the browser's Web Speech voice only as fallback. Mute-aware.
 */
function speakNpc(text: string): void {
  if (useSoundStore.getState().muted) return;
  void playNpcVoice(text).then((played) => {
    if (!played) speakChat(text, 0, { muted: useSoundStore.getState().muted });
  });
}

export const useNpcStore = create<NpcChatState>((set, get) => ({
  activeNpc: null,
  sending: false,
  histories: {},

  openPanel(npc: NpcId) {
    const first = !get().histories[npc]?.length;
    set((s) => ({
      activeNpc: npc,
      histories: first
        ? { ...s.histories, [npc]: [{ role: "assistant", text: NPC_GREETING }] }
        : s.histories,
    }));
    if (first) speakNpc(NPC_GREETING);
  },

  closePanel() {
    stopNpcVoice(); // the 조교 stops mid-sentence when you close the chat
    set({ activeNpc: null });
  },

  async send(raw: string) {
    const npc = get().activeNpc;
    const text = raw.trim().slice(0, NPC_INPUT_MAX);
    if (!npc || !text || get().sending) return;
    set((s) => ({
      sending: true,
      histories: {
        ...s.histories,
        [npc]: [...(s.histories[npc] ?? []), { role: "user" as const, text }],
      },
    }));

    // Wire history: the most recent turns only, oldest dropped (server cap).
    const wire = (get().histories[npc] ?? [])
      .slice(-NPC_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.text }));

    let reply = FALLBACK_ERROR;
    try {
      const res = await fetch(`${SERVER_URL}/api/npc-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ npc, messages: wire }),
      });
      const json = (await res.json().catch(() => null)) as {
        reply?: string;
        error?: string;
      } | null;
      reply = (res.ok ? json?.reply : json?.error) || FALLBACK_ERROR;
    } catch {
      // network failure → fallback line
    }
    set((s) => ({
      sending: false,
      histories: {
        ...s.histories,
        [npc]: [...(s.histories[npc] ?? []), { role: "assistant" as const, text: reply }],
      },
    }));
    speakNpc(reply);
  },
}));
