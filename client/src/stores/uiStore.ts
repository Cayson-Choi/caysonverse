import { create } from "zustand";

/**
 * Which full-screen-ish panels are open (controls-ux Task 15). Discrete UI state —
 * never per-frame data. Esc closes them in priority order through `resolveEscape`
 * (hotkeys.ts); the NPC dialogue panel keeps its own flag in npcStore.
 */
interface UiStore {
  /** The Esc / ☰ menu (MenuPanel). */
  menuOpen: boolean;
  /**
   * The player roster (Task 16 draws it: Tab held on a PC, the 👥 toggle on a phone).
   * Always false until that panel exists; Esc already closes it first when it is up.
   */
  rosterOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setRosterOpen: (open: boolean) => void;
  /** A fresh world starts with nothing open (WorldScene mount). */
  resetPanels: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  menuOpen: false,
  rosterOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  toggleMenu: () => set((s) => ({ menuOpen: !s.menuOpen })),
  setRosterOpen: (rosterOpen) => set({ rosterOpen }),
  resetPanels: () => set({ menuOpen: false, rosterOpen: false }),
}));
