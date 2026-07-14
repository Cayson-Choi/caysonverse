import type { Pose } from "./types";

declare global {
  interface Window {
    /** Dev-only E2E hook (see installDebugHook). Absent in production builds. */
    __cv?: { getPos: () => Pose };
  }
}

/**
 * Dev-only E2E hook. Under `import.meta.env.DEV`, exposes `window.__cv.getPos()`
 * returning a snapshot of the live local pose. The entire body sits behind the
 * DEV guard, so a production build evaluates `import.meta.env.DEV` to `false` and
 * tree-shakes the hook away. Returns a cleanup that removes the global.
 */
export function installDebugHook(getPose: () => Pose): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__cv = { getPos: () => ({ ...getPose() }) };
  return () => {
    delete window.__cv;
  };
}
