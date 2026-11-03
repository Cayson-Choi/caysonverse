import { create } from "zustand";
import type { Appearance } from "@caysonverse/shared/appearance";
import { useClassStore } from "./classStore";

/**
 * UI/screen state only. Per-frame game data (position, input, camera) lives in
 * refs inside the 3D scene and NEVER here — zustand updates trigger React
 * renders, which must not happen 60x/second.
 */

/**
 * `village` = 케이슨 마을 (where 입장하기 leads by default); `world` = the legacy world; `hub` = a
 * class's hall and corridor (AI 학교 탈출); `escape` = inside the team's classroom (the class
 * connection stays open underneath).
 */
export type Screen = "entry" | "village" | "world" | "hub" | "escape";

/** Who the local player is, established at join. */
export interface Identity {
  nickname: string;
  /** The 15 appearance fields this player joined with (fixed for the connection). */
  appearance: Appearance;
  sessionId: string;
  /** The class code (canonical) of a class session; absent in the world. */
  classCode?: string;
}

interface AppState {
  screen: Screen;
  identity: Identity | null;
  /**
   * Whether the local player is the admin (instructor); always false in the village. Inferred client-side:
   * a join that supplied an admin code AND succeeded proves the code was correct
   * (a wrong code is rejected server-side). NEVER derived from schema — no other
   * client can learn who is admin. Gates rendering of the admin panel only.
   * In a class it is the TEACHER flag: a join with a one-time teacher pass that
   * succeeded (the class's announce / kick / phase controls are the instructor's).
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
  /** The main (world / class) connection is recovering — one half of `reconnecting`. */
  mainReconnecting: boolean;
  /** The team classroom's connection is recovering — the other half of `reconnecting`. */
  escapeReconnecting: boolean;
  /**
   * Monotonic connection generation. Bumped on every successful (re)connection
   * so the main scene (village, world or hall), keyed by it, REMOUNTS against the new room — every
   * scene-level `getRoom()` binding (remote sync, banner, chat) rebinds and the
   * remote store is rebuilt clean. The first join uses generation 0.
   */
  connectionEpoch: number;
  /**
   * Monotonic team-classroom generation: bumped every time a classroom connection is
   * (re)established, so the escape scene, keyed by it, remounts against the new room.
   */
  escapeEpoch: number;

  /** Enter 케이슨 마을 after a successful village join (the village has no admin). */
  enterVillage: (identity: Identity) => void;
  /** Enter the world after a successful join. `isAdmin` gates the admin panel. */
  enterWorld: (identity: Identity, isAdmin?: boolean) => void;
  /** Enter a class's hall after a successful class join. `isTeacher` = joined with a teacher pass. */
  enterHub: (identity: Identity, isTeacher?: boolean) => void;
  /** A team-classroom connection is (re)established: show the classroom (from the hall or a recovery). */
  enterEscape: () => void;
  /** Back from the classroom to the hall; `notice` shows there as a toast. */
  exitEscape: (notice?: string | null) => void;
  /** Return to the entry screen, optionally with a Korean notice. */
  leaveToEntry: (notice?: string | null) => void;
  /** Clear the entry notice (e.g. once the user edits the form). */
  clearNotice: () => void;
  /** Show/hide the reconnection overlay + input suspension (main connection). */
  setReconnecting: (reconnecting: boolean) => void;
  /** The same for the team classroom's connection (the overlay shows while either recovers). */
  setEscapeReconnecting: (reconnecting: boolean) => void;
  /**
   * A reconnection succeeded on `sessionId`. Adopt it (unchanged for a same-
   * session token reconnect, new for a fresh re-join), bump the epoch to remount
   * the scene, and clear the reconnection overlay.
   *
   * `isAdmin` reconciles admin status with what the server actually granted:
   *  - omitted → PRESERVE (Phase-1 token reconnect keeps the server-side userData
   *    marker, so an admin stays an admin);
   *  - explicit → SET (Phase-2 fresh join: `true` only if the admin code was
   *    re-sent and accepted, else `false` so the panel stops rendering and the
   *    client stops pretending it can announce/kick — the F5 fix).
   */
  reconnected: (sessionId: string, isAdmin?: boolean) => void;
}

const NOT_RECONNECTING = { reconnecting: false, mainReconnecting: false, escapeReconnecting: false };

export const useAppStore = create<AppState>((set) => ({
  screen: "entry",
  identity: null,
  isAdmin: false,
  notice: null,
  ...NOT_RECONNECTING,
  connectionEpoch: 0,
  escapeEpoch: 0,

  enterVillage: (identity) =>
    set({ screen: "village", identity, isAdmin: false, notice: null, ...NOT_RECONNECTING }),
  enterWorld: (identity, isAdmin = false) =>
    set({ screen: "world", identity, isAdmin, notice: null, ...NOT_RECONNECTING }),
  enterHub: (identity, isTeacher = false) =>
    set({ screen: "hub", identity, isAdmin: isTeacher, notice: null, ...NOT_RECONNECTING }),
  enterEscape: () =>
    set((s) =>
      // Only from a class (a ticket that lands after leaving the class changes nothing).
      s.screen === "hub" || s.screen === "escape"
        ? {
            screen: "escape",
            escapeEpoch: s.escapeEpoch + 1,
            escapeReconnecting: false,
            reconnecting: s.mainReconnecting,
          }
        : s,
    ),
  exitEscape: (notice = null) => {
    let back = false;
    set((s) => {
      if (s.screen !== "escape") return s;
      back = true;
      return { screen: "hub", escapeReconnecting: false, reconnecting: s.mainReconnecting };
    });
    if (back && notice) useClassStore.getState().showToast(notice);
  },
  leaveToEntry: (notice = null) =>
    set({ screen: "entry", identity: null, isAdmin: false, notice, ...NOT_RECONNECTING }),
  clearNotice: () => set({ notice: null }),
  setReconnecting: (reconnecting) =>
    set((s) => ({ mainReconnecting: reconnecting, reconnecting: reconnecting || s.escapeReconnecting })),
  setEscapeReconnecting: (reconnecting) =>
    set((s) => ({ escapeReconnecting: reconnecting, reconnecting: reconnecting || s.mainReconnecting })),
  reconnected: (sessionId, isAdmin) =>
    set((s) => ({
      identity: s.identity ? { ...s.identity, sessionId } : s.identity,
      isAdmin: isAdmin === undefined ? s.isAdmin : isAdmin,
      connectionEpoch: s.connectionEpoch + 1,
      mainReconnecting: false,
      reconnecting: s.escapeReconnecting,
    })),
}));
