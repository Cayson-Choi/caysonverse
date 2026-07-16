import { create } from "zustand";

/**
 * The ONE piece of view-mode state that drives a React render: whether the
 * first-person 👁 toggle button should show its pressed state. Per-frame view
 * data (mode, blend, fp yaw/pitch) lives in the module mutable `viewState`
 * (viewState.ts) and is NEVER kept here — a zustand update re-renders, which must
 * not happen 60x/second. `viewState`'s toggle mutations mirror the mode into this
 * flag so the button label/aria-pressed stay in sync.
 */
interface ViewStore {
  /** True while the local view is first-person. UI-only (button rendering). */
  isFp: boolean;
  setFp: (value: boolean) => void;
}

export const useViewStore = create<ViewStore>((set) => ({
  isFp: false,
  setFp: (isFp) => set({ isFp }),
}));
