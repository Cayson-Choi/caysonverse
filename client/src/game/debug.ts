import type { Appearance } from "@caysonverse/shared/appearance";
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
import { useAppStore, type Screen } from "../stores/appStore";
import { useClassStore } from "../stores/classStore";
import { useEscapeStore, type EscapeView } from "../stores/escapeStore";
import type { InspectViewPayload } from "@caysonverse/shared/escape/messages";
import { ensureFrameSampler, type FrameStats } from "./frameStats";

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
  /** The 15 synced appearance fields — lets E2E assert that every client sees the same look. */
  appearance: Appearance;
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

/** The class (AI 학교 탈출) as the dev/E2E hook shows it: the store's data fields, no functions. */
export interface ClassView {
  phase: string;
  classCode: string;
  textLevel: string;
  openRooms: string[];
  litRooms: string[];
  teams: { id: string; name: string; mine: boolean; escapeDoor: string; escapeRoomId: string; members: { sid: string; nickname: string; inEscape: boolean }[] }[];
}

declare global {
  interface Window {
    /** Dev-only E2E hook (see installDebugHook). Absent in production builds. */
    __cv?: {
      /**
       * The local player's own session id (the key of its `__cvAvatars()` entry, and what
       * other clients see in `getRemotes()`). Changes only with a new connection.
       */
      getSessionId: () => string;
      /** The local player's live pose + server-confirmed seatIndex. */
      getPos: () => PoseView;
      /** The live third-person camera orbit (yaw/pitch/distance). */
      getOrbit: () => Orbit;
      /**
       * Whether the LOCAL avatar group is currently rendered. False in
       * first-person once the blend passes the hide threshold (own body +
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
      /** Which screen the app shows: "entry" | "world" | "hub" | "escape" (AI 학교 탈출). */
      getScreen: () => Screen;
      /** The team classroom as the UI reads it (clock, phase, paused, flags …), or null outside one. */
      getEscape: () => EscapeView | null;
      /** The class (phase, code, open rooms, teams and who is inside a classroom), or null outside a class. */
      getClass: () => ClassView | null;
      /** The close-up the player has open (the server's `InspectView` payload: title, body, back, reveal, split …), or null. */
      getInspect: () => InspectViewPayload | null;
      /** The rooms whose progress-board window is lit (rooms a team of this class has escaped). */
      getLitRooms: () => string[];
      /**
       * rAF interval statistics over the last `windowMs` (default 20 s): frames, mean, p95 and max in ms. A rolling
       * page-wide sampler, so a hall → classroom switch does not reset it. Headless reference for the perf E2E.
       */
      getFrameStats: (windowMs?: number) => FrameStats;
    };
  }
}

/**
 * Dev-only E2E hook. Under `import.meta.env.DEV`, exposes `window.__cv` with the
 * own session id (`getSessionId`), the local pose (`getPos`) and remote players
 * (`getRemotes`). The whole body sits
 * behind the DEV guard, so production evaluates `import.meta.env.DEV` to `false`
 * and tree-shakes the hook away. Returns a cleanup that removes the global.
 */
export function installDebugHook(
  getPose: () => Pose,
  getOrbit: () => Orbit,
  getSeatIndex: () => number,
  getSelfVisible: () => boolean,
  getGait: () => Gait,
  getSessionId: () => string,
): () => void {
  if (!import.meta.env.DEV) return () => {};
  ensureFrameSampler(); // starts the rolling rAF sampler behind getFrameStats (kept for the whole session)
  window.__cv = {
    getSessionId: () => getSessionId(),
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
    getScreen: () => useAppStore.getState().screen,
    getEscape: () => {
      const v = useEscapeStore.getState().view;
      return v === null ? null : structuredClone(v);
    },
    getInspect: () => {
      const v = useEscapeStore.getState().inspect;
      return v === null ? null : structuredClone(v);
    },
    getLitRooms: () => [...useClassStore.getState().litRooms],
    getFrameStats: (windowMs = 20000) => ensureFrameSampler().stats(windowMs, performance.now()),
    getClass: () => {
      const c = useClassStore.getState();
      if (c.classCode === "") return null;
      return {
        phase: c.phase,
        classCode: c.classCode,
        textLevel: c.textLevel,
        openRooms: [...c.openRooms],
        litRooms: [...c.litRooms],
        teams: c.teams.map((t) => ({
          id: t.id,
          name: t.name,
          mine: t.mine,
          escapeDoor: t.escapeDoor,
          escapeRoomId: t.escapeRoomId,
          members: t.members.map((m) => ({ ...m })),
        })),
      };
    },
  };
  return () => {
    delete window.__cv;
  };
}
