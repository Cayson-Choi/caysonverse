import { create } from "zustand";

/**
 * Which full-screen-ish panels are open (controls-ux Task 15). Discrete UI state —
 * never per-frame data. Esc closes them in priority order through `resolveEscape`
 * (hotkeys.ts).
 */
interface UiStore {
  /** The Esc / ☰ menu (MenuPanel). */
  menuOpen: boolean;
  /**
   * The player roster (RosterPanel): Tab held on a PC, the 👥 toggle on a phone. Esc
   * closes it before the menu (resolveEscape); a Tab-held list also hides on window blur.
   */
  rosterOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setRosterOpen: (open: boolean) => void;
  /** A fresh scene starts with nothing open (PlayShell mount). */
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
