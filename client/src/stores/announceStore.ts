import { create } from "zustand";

/**
 * The current announcement banner text, mirrored from schema state
 * (`WorldState.announcement`) by announceSync.ts. An empty string means "no
 * banner". This is a DISCRETE UI value (changes rarely, drives a React render),
 * so a zustand store is the right home — unlike per-frame positions.
 *
 * Late joiners get the current value automatically: the state callback fires
 * immediately on subscribe (see announceSync.ts), so the banner appears without
 * any broadcast.
 */
interface AnnounceState {
  text: string;
  setText: (text: string) => void;
}

export const useAnnounceStore = create<AnnounceState>((set) => ({
  text: "",
  setText: (text) => set({ text }),
}));
