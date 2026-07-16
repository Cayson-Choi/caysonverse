import { create } from "zustand";

/**
 * TTS mute state (design 23) — drives the 🔊/🔇 toggle button and gates
 * speakChat at the chat-broadcast hook (chatSync). Discrete UI state, so
 * zustand is fine here (this is not per-frame data). Persisted to localStorage
 * so the choice survives reloads; default is ON (reading enabled) — the value
 * only exists once the user has toggled at least once.
 */

const STORAGE_KEY = "cv-tts-muted";

/** Absent key / blocked storage (private mode) → default ON (not muted). */
function loadMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Storage blocked — the toggle still works for this session only.
  }
}

interface SoundStore {
  /** True = 낭독 꺼짐 (🔇). Read by chatSync on every chat broadcast. */
  muted: boolean;
  toggleMuted: () => void;
}

export const useSoundStore = create<SoundStore>((set, get) => ({
  muted: loadMuted(),
  toggleMuted: () => {
    const muted = !get().muted;
    saveMuted(muted);
    set({ muted });
  },
}));
