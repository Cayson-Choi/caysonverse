import type { Orbit, Pose } from "./types";
import { getRemotes } from "./remoteStore";
import { getRoom, sendSit, sendStand } from "../net/connection";
import { bubbleRegistry } from "./bubbleRegistry";
import { emojiRegistry } from "./emojiRegistry";
import { viewState, type ViewState } from "./viewState";

/** Non-consented close code (MAY_TRY_RECONNECT) used by the dev drop hook. */
const DEV_DROP_CODE = 4010;

/** Local pose plus the server-confirmed seat, exposed to the E2E hook. */
export interface PoseView extends Pose {
  /** -1 = standing; >= 0 = the occupied seat (server-authoritative). */
  seatIndex: number;
}

/** Shape of one remote player in the dev/E2E hook. */
export interface RemoteView {
  sessionId: string;
  nickname: string;
  /** Character preset index (0..7; 4..7 = royals) — lets E2E assert royal remotes. */
  character: number;
  x: number;
  z: number;
  yaw: number;
  /** False while this remote is disconnected (drives the 50%-opacity ghost). */
  connected: boolean;
  /** -1 = standing; >= 0 = the seat this remote occupies. */
  seatIndex: number;
}

/** Shape of one active speech bubble in the dev/E2E hook. */
export interface BubbleView {
  sid: string;
  text: string;
}

/** Shape of one active emoji reaction in the dev/E2E hook. */
export interface EmojiView {
  sid: string;
  index: number;
}

declare global {
  interface Window {
    /** Dev-only E2E hook (see installDebugHook). Absent in production builds. */
    __cv?: {
      /** The local player's live pose + server-confirmed seatIndex. */
      getPos: () => PoseView;
      /** The live third-person camera orbit (yaw/pitch/distance). */
      getOrbit: () => Orbit;
      /**
       * Whether the LOCAL avatar group is currently rendered. False in
       * first-person once the blend passes the hide threshold (own body + crown +
       * blob shadow hidden together). Lets the FP E2E assert own-avatar hiding
       * without reaching into the three scene graph.
       */
      getSelfVisible: () => boolean;
      /**
       * The live view state (mode / blend / fp yaw+pitch), read straight from the
       * module mutable — updated SYNCHRONOUSLY by the toggle + drag handlers, so
       * (unlike the rAF-published __cvCamera) it is truthful even on a background
       * tab whose requestAnimationFrame is throttled.
       */
      getView: () => ViewState;
      /** Every OTHER connected player's newest known position + seatIndex. */
      getRemotes: () => RemoteView[];
      /** Every currently-visible speech bubble (sid + text). */
      getBubbles: () => BubbleView[];
      /** Every currently-active emoji reaction (sid + EMOJIS index). */
      getEmojis: () => EmojiView[];
      /**
       * Force a TRANSIENT connection drop (dev/E2E only) by closing the
       * transport with a non-consented code — the server holds the seat
       * (allowReconnection) and the resilience driver should re-establish the
       * SAME avatar within the window. Returns true if a room was connected.
       */
      dropConnection: () => boolean;
      /**
       * Send a Sit request for `seatIndex` (dev/E2E only). Deterministically
       * drives the occupied-seat race the proximity UI intentionally can't (it
       * hides taken seats). The server stays authoritative — it still validates.
       */
      sit: (seatIndex: number) => void;
      /** Send a Stand request (dev/E2E only). */
      stand: () => void;
    };
  }
}

/**
 * Dev-only E2E hook. Under `import.meta.env.DEV`, exposes `window.__cv` with the
 * local pose (`getPos`) and remote players (`getRemotes`). The whole body sits
 * behind the DEV guard, so production evaluates `import.meta.env.DEV` to `false`
 * and tree-shakes the hook away. Returns a cleanup that removes the global.
 */
export function installDebugHook(
  getPose: () => Pose,
  getOrbit: () => Orbit,
  getSeatIndex: () => number,
  getSelfVisible: () => boolean,
): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__cv = {
    getPos: () => ({ ...getPose(), seatIndex: getSeatIndex() }),
    getOrbit: () => ({ ...getOrbit() }),
    getSelfVisible: () => getSelfVisible(),
    getView: () => ({ ...viewState }),
    getRemotes: () => getRemotes(),
    getBubbles: () =>
      bubbleRegistry.snapshot(performance.now()).map((b) => ({ sid: b.sid, text: b.text })),
    getEmojis: () =>
      emojiRegistry.snapshot(performance.now()).map((e) => ({ sid: e.sid, index: e.index })),
    dropConnection: () => {
      const room = getRoom();
      if (!room) return false;
      room.connection.close(DEV_DROP_CODE, "dev drop");
      return true;
    },
    sit: (seatIndex: number) => sendSit(seatIndex),
    stand: () => sendStand(),
  };
  return () => {
    delete window.__cv;
  };
}
