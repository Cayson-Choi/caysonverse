import type { Orbit, Pose } from "./types";
import { getRemotes } from "./remoteStore";
import { getRoom, sendSit, sendStand } from "../net/connection";
import { bubbleRegistry } from "./bubbleRegistry";
import { emojiRegistry } from "./emojiRegistry";
import { jumpRegistry } from "./jump";
import { typingRegistry } from "./typing";
import { viewState, type ViewState } from "./viewState";
import { remoteGaitProbe, type Gait } from "./gait";
import { getNametagCostMs, getNametagMode, nametagProbe, overviewLabelProbe } from "./labelRegistry";

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
  /** Synced role: 0 = student, 1 = teacher (lets E2E assert the teacher marker). */
  role: number;
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

/** Shape of one name tag in the dev/E2E hook. */
export interface NametagView {
  /** The owner's session id (an AI 조교 is `npc:<id>`). */
  id: string;
  /** Whether the selection (nearest 15 + speakers + pinned) currently wants this tag shown. */
  selected: boolean;
  /** Current opacity 0..1 (chasing its target, so it eases rather than jumps). */
  opacity: number;
  /** Whether a wall is between the camera and this tag (it is dimmed to 35 %). */
  occluded: boolean;
  /** The blue speaking highlight is on. */
  highlight: boolean;
  /** The trailing typing "…" is on. */
  typing: boolean;
  /** Stacking lift applied to the tag (m). */
  liftM: number;
  /** Height (m above the avatar) of the tag's top edge. */
  tagTopM: number;
  /** Height (m above the avatar) of the bottom edge of the avatar's speech bubble. */
  bubbleM: number;
  /** Projected text height (CSS px) — 12–16 for a visible tag. */
  textPx: number;
}

/** Shape of one in-flight jump in the dev/E2E hook. */
export interface JumpView {
  sid: string;
  /** Bumps on every new hop of the same player. */
  seq: number;
  /** Milliseconds since take-off (0 .. JUMP_DURATION_MS). */
  elapsedMs: number;
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
       * The LOCAL avatar's current gait (idle / walk / run) — the animation the
       * loco crossfade last settled on. Lets the run E2E assert the Running_A
       * cycle without reading the three mixer.
       */
      getGait: () => Gait;
      /**
       * The gait each REMOTE avatar is showing, keyed by session id (derived from
       * interpolated speed — never synced). A remote that is not mounted is absent.
       */
      getRemoteGaits: () => Record<string, Gait>;
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
      /** Every jump still in the air (sid, seq, ms since take-off) — own and remote. */
      getJumps: () => JumpView[];
      /** Session ids of every OTHER player whose typing "…" is currently up. */
      getTyping: () => string[];
      /**
       * Every name tag the NametagSystem manages (players by session id, AI 조교 as
       * `npc:<id>`): selected?, current opacity, occluded?, plus the highlight / typing
       * looks, the stacking lift, the tag's top edge and the speech bubble's anchor height.
       */
      getNametags: () => NametagView[];
      /** Average ms the NametagSystem's frame took over the last 120 frames (0 before any). */
      getNametagCostMs: () => number;
      /** The name tag mode the world is using right now ("all" / "nearby" / "off"), as set from the menu. */
      getNametagMode: () => "all" | "nearby" | "off";
      /** The map's room labels: sprite count, drawn this frame (overview blend past OV_VIS_BLEND)?, opacity. */
      getOverviewLabels: () => { count: number; visible: boolean; opacity: number };
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
  getGait: () => Gait,
): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__cv = {
    getPos: () => ({ ...getPose(), seatIndex: getSeatIndex() }),
    getOrbit: () => ({ ...getOrbit() }),
    getSelfVisible: () => getSelfVisible(),
    getGait: () => getGait(),
    getRemoteGaits: () => Object.fromEntries(remoteGaitProbe),
    getView: () => ({ ...viewState }),
    getRemotes: () => getRemotes(),
    getBubbles: () =>
      bubbleRegistry.snapshot(performance.now()).map((b) => ({ sid: b.sid, text: b.text })),
    getEmojis: () =>
      emojiRegistry.snapshot(performance.now()).map((e) => ({ sid: e.sid, index: e.index })),
    getJumps: () => {
      const now = performance.now();
      return jumpRegistry
        .snapshot(now)
        .map((j) => ({ sid: j.sid, seq: j.seq, elapsedMs: now - j.startedAt }));
    },
    getTyping: () => typingRegistry.snapshot(performance.now()),
    getNametags: () =>
      // Field by field: the probe object is the system's live per-tag state (it also holds
      // the avatar's scene nodes), which must not leak into a serialized E2E result.
      Array.from(nametagProbe, ([id, t]) => ({
        id,
        selected: t.selected,
        opacity: t.opacity,
        occluded: t.occluded,
        highlight: t.highlight,
        typing: t.typing,
        liftM: t.liftM,
        tagTopM: t.tagTopM,
        bubbleM: t.bubbleM,
        textPx: t.textPx,
      })),
    getNametagCostMs: () => getNametagCostMs(),
    getNametagMode: () => getNametagMode(),
    getOverviewLabels: () => ({ ...overviewLabelProbe }),
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
