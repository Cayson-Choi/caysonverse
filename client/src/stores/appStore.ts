import { create } from "zustand";

/**
 * UI/screen state only. Per-frame game data (position, input, camera) lives in
 * refs inside the 3D scene and NEVER here — zustand updates trigger React
 * renders, which must not happen 60x/second.
 */

export type Screen = "entry" | "world";

/** Who the local player is, established at join. */
export interface Identity {
  nickname: string;
  character: number;
  tint: number;
  sessionId: string;
}

interface AppState {
  screen: Screen;
  identity: Identity | null;
  /** One-shot Korean notice shown on the entry screen (e.g. after a kick). */
  notice: string | null;

  /** Enter the world after a successful join. */
  enterWorld: (identity: Identity) => void;
  /** Return to the entry screen, optionally with a Korean notice. */
  leaveToEntry: (notice?: string | null) => void;
  /** Clear the entry notice (e.g. once the user edits the form). */
  clearNotice: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: "entry",
  identity: null,
  notice: null,

  enterWorld: (identity) => set({ screen: "world", identity, notice: null }),
  leaveToEntry: (notice = null) => set({ screen: "entry", identity: null, notice }),
  clearNotice: () => set({ notice: null }),
}));
