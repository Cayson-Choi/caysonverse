import { create } from "zustand";

/**
 * Sound mute state — drives the 🔊/🔇 toggle button. It gates the 케이슨 마을 guides' voice clips
 * (guideVoice.ts, Task 9A); chat is never read aloud (CHAT_VOICE_ENABLED, owner decision 2026-11-03).
 * Discrete UI state, so zustand is fine here (this is not per-frame data). Persisted to
 * localStorage so the choice survives reloads; default is ON (not muted) — the value only
 * exists once the user has toggled at least once. The storage key keeps its old name
 * ("cv-tts-muted") so a choice made before the rename still applies.
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
  /** True = 소리 꺼짐 (🔇). */
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
