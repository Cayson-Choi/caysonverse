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
  /**
   * True while the resilience driver is recovering a dropped connection: the
   * "재연결 중..." overlay shows, the world freezes behind it, and input is
   * suspended (LocalPlayer reads this each frame without subscribing). Set false
   * again on a successful reconnect or when we fall back to the entry screen.
   */
  reconnecting: boolean;
  /**
   * Monotonic connection generation. Bumped on every successful (re)connection
   * so the WorldScene, keyed by it, REMOUNTS against the new room — every
   * scene-level `getRoom()` binding (remote sync, banner, chat) rebinds and the
   * remote store is rebuilt clean. The first join uses generation 0.
   */
  connectionEpoch: number;

  /** Enter the world after a successful join. `isAdmin` gates the admin panel. */
  enterWorld: (identity: Identity, isAdmin?: boolean) => void;
  /** Return to the entry screen, optionally with a Korean notice. */
  leaveToEntry: (notice?: string | null) => void;
  /** Clear the entry notice (e.g. once the user edits the form). */
  clearNotice: () => void;
  /** Show/hide the reconnection overlay + input suspension. */
  setReconnecting: (reconnecting: boolean) => void;
  /**
   * A reconnection succeeded on `sessionId`. Adopt it (unchanged for a same-
   * session token reconnect, new for a fresh re-join), bump the epoch to remount
   * the scene, and clear the reconnection overlay.
   */
  reconnected: (sessionId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: "entry",
  identity: null,
  isAdmin: false,
  notice: null,
  reconnecting: false,
  connectionEpoch: 0,

  enterWorld: (identity, isAdmin = false) =>
    set({ screen: "world", identity, isAdmin, notice: null, reconnecting: false }),
  leaveToEntry: (notice = null) =>
    set({ screen: "entry", identity: null, isAdmin: false, notice, reconnecting: false }),
  clearNotice: () => set({ notice: null }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
  reconnected: (sessionId) =>
    set((s) => ({
      identity: s.identity ? { ...s.identity, sessionId } : s.identity,
      connectionEpoch: s.connectionEpoch + 1,
      reconnecting: false,
    })),
}));
