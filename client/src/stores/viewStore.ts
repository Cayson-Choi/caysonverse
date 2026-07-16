import { create } from "zustand";

/**
 * The view-mode state that drives React renders: which overlay toggle buttons
 * show their pressed state — the first-person 👁 and the overview 🗺 (design 20).
 * Per-frame view data (mode, blend, fp yaw/pitch, overview pan/zoom) lives in the
 * module mutable `viewState` (viewState.ts) and is NEVER kept here — a zustand
 * update re-renders, which must not happen 60x/second. `viewState`'s toggle
 * mutations mirror the active mode into these flags so the button labels /
 * aria-pressed stay in sync.
 */
interface ViewStore {
  /** True while the local view is first-person. UI-only (👁 button rendering). */
  isFp: boolean;
  /** True while the local view is the top-down overview. UI-only (🗺 button). */
  isOv: boolean;
  setFp: (value: boolean) => void;
  setOv: (value: boolean) => void;
}

export const useViewStore = create<ViewStore>((set) => ({
  isFp: false,
  isOv: false,
  setFp: (isFp) => set({ isFp }),
  setOv: (isOv) => set({ isOv }),
}));
