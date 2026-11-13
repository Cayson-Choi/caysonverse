import { create } from "zustand";
import type { Appearance } from "@caysonverse/shared/appearance";

/**
 * UI/screen state only. Per-frame game data (position, input, camera) lives in
 * refs inside the 3D scene and NEVER here — zustand updates trigger React
 * renders, which must not happen 60x/second.
 */

/** `village` = 케이슨 마을 (where 입장하기 leads); `entry` = the entry screen with the character builder. */
export type Screen = "entry" | "village";

/** Who the local player is, established at join. */
export interface Identity {
  nickname: string;
  /** The 15 appearance fields this player joined with (fixed for the connection). */
  appearance: Appearance;
  sessionId: string;
}

interface AppState {
  screen: Screen;
  identity: Identity | null;
  /** One-shot Korean notice shown on the entry screen (e.g. after a kick or a lost connection). */
  notice: string | null;
  /**
   * True while the resilience driver is recovering a dropped connection: the
   * "재연결 중..." overlay shows, the village freezes behind it, and input is
   * suspended (LocalPlayer reads this each frame without subscribing). Set false
   * again on a successful reconnect or when we fall back to the entry screen.
   */
  reconnecting: boolean;
  /**
   * Monotonic connection generation. Bumped on every successful (re)connection
   * so the village scene, keyed by it, REMOUNTS against the new room — every
   * scene-level `getRoom()` binding (remote sync, banner, chat) rebinds and the
   * remote store is rebuilt clean. The first join uses generation 0.
   */
  connectionEpoch: number;

  /** Enter 케이슨 마을 after a successful village join. */
  enterVillage: (identity: Identity) => void;
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
  notice: null,
  reconnecting: false,
  connectionEpoch: 0,

  enterVillage: (identity) => set({ screen: "village", identity, notice: null, reconnecting: false }),
  leaveToEntry: (notice = null) => set({ screen: "entry", identity: null, notice, reconnecting: false }),
  clearNotice: () => set({ notice: null }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
  reconnected: (sessionId) =>
    set((s) => ({
      identity: s.identity ? { ...s.identity, sessionId } : s.identity,
      connectionEpoch: s.connectionEpoch + 1,
      reconnecting: false,
    })),
}));
