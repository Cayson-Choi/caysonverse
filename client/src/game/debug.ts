import type { Pose } from "./types";
import { getRemotes } from "./remoteStore";

/** Shape of one remote player in the dev/E2E hook. */
export interface RemoteView {
  sessionId: string;
  nickname: string;
  x: number;
  z: number;
}

declare global {
  interface Window {
    /** Dev-only E2E hook (see installDebugHook). Absent in production builds. */
    __cv?: {
      /** The local player's live pose. */
      getPos: () => Pose;
      /** Every OTHER connected player's newest known position. */
      getRemotes: () => RemoteView[];
    };
  }
}

/**
 * Dev-only E2E hook. Under `import.meta.env.DEV`, exposes `window.__cv` with the
 * local pose (`getPos`) and remote players (`getRemotes`). The whole body sits
 * behind the DEV guard, so production evaluates `import.meta.env.DEV` to `false`
 * and tree-shakes the hook away. Returns a cleanup that removes the global.
 */
export function installDebugHook(getPose: () => Pose): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__cv = {
    getPos: () => ({ ...getPose() }),
    getRemotes: () => getRemotes(),
  };
  return () => {
    delete window.__cv;
  };
}
