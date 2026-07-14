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
  /**
   * Whether the local player is the admin (instructor). Inferred client-side:
   * a join that supplied an admin code AND succeeded proves the code was correct
   * (a wrong code is rejected server-side). NEVER derived from schema — no other
   * client can learn who is admin. Gates rendering of the admin panel only.
   */
  isAdmin: boolean;
  /** One-shot Korean notice shown on the entry screen (e.g. after a kick). */
  notice: string | null;

  /** Enter the world after a successful join. `isAdmin` gates the admin panel. */
  enterWorld: (identity: Identity, isAdmin?: boolean) => void;
  /** Return to the entry screen, optionally with a Korean notice. */
  leaveToEntry: (notice?: string | null) => void;
  /** Clear the entry notice (e.g. once the user edits the form). */
  clearNotice: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: "entry",
  identity: null,
  isAdmin: false,
  notice: null,

  enterWorld: (identity, isAdmin = false) =>
    set({ screen: "world", identity, isAdmin, notice: null }),
  leaveToEntry: (notice = null) => set({ screen: "entry", identity: null, isAdmin: false, notice }),
  clearNotice: () => set({ notice: null }),
}));
