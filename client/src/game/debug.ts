import type { Orbit, Pose } from "./types";
import { getRemotes } from "./remoteStore";
import { bubbleRegistry } from "./bubbleRegistry";
import { emojiRegistry } from "./emojiRegistry";

/** Shape of one remote player in the dev/E2E hook. */
export interface RemoteView {
  sessionId: string;
  nickname: string;
  x: number;
  z: number;
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
      /** The local player's live pose. */
      getPos: () => Pose;
      /** The live third-person camera orbit (yaw/pitch/distance). */
      getOrbit: () => Orbit;
      /** Every OTHER connected player's newest known position. */
      getRemotes: () => RemoteView[];
      /** Every currently-visible speech bubble (sid + text). */
      getBubbles: () => BubbleView[];
      /** Every currently-active emoji reaction (sid + EMOJIS index). */
      getEmojis: () => EmojiView[];
    };
  }
}

/**
 * Dev-only E2E hook. Under `import.meta.env.DEV`, exposes `window.__cv` with the
 * local pose (`getPos`) and remote players (`getRemotes`). The whole body sits
 * behind the DEV guard, so production evaluates `import.meta.env.DEV` to `false`
 * and tree-shakes the hook away. Returns a cleanup that removes the global.
 */
export function installDebugHook(getPose: () => Pose, getOrbit: () => Orbit): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__cv = {
    getPos: () => ({ ...getPose() }),
    getOrbit: () => ({ ...getOrbit() }),
    getRemotes: () => getRemotes(),
    getBubbles: () =>
      bubbleRegistry.snapshot(performance.now()).map((b) => ({ sid: b.sid, text: b.text })),
    getEmojis: () =>
      emojiRegistry.snapshot(performance.now()).map((e) => ({ sid: e.sid, index: e.index })),
  };
  return () => {
    delete window.__cv;
  };
}
