import { create } from "zustand";

/**
 * The hall's discrete UI state (AI 학교 탈출, Task 16): whether the team panel is open and the
 * line the floor shows ("선생님이 시작하면 문이 열려요" …). Never per-frame data — `setInfo` is
 * called from the context button's 5 Hz pass and writes only when the line changed.
 */
interface HubUi {
  teamPanelOpen: boolean;
  /** The guidance line for the pad the player stands on, or null. */
  info: string | null;
  openTeamPanel: () => void;
  closeTeamPanel: () => void;
  setInfo: (info: string | null) => void;
  /** A fresh hall scene starts clean. */
  reset: () => void;
}

export const useHubUi = create<HubUi>((set, get) => ({
  teamPanelOpen: false,
  info: null,
  openTeamPanel: () => set({ teamPanelOpen: true }),
  closeTeamPanel: () => set({ teamPanelOpen: false }),
  setInfo: (info) => {
    if (get().info !== info) set({ info });
  },
  reset: () => set({ teamPanelOpen: false, info: null }),
}));
