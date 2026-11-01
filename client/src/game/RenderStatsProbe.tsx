import { useEffect } from "react";
import { useFrame } from "@react-three/fiber";

/** What `window.__cvRenderInfo()` reports: the last drawn frame's renderer counters. */
export interface RenderInfoSnapshot {
  /** Draw calls of the last frame (`gl.info.render.calls`). */
  calls: number;
  /** Triangles of the last frame (`gl.info.render.triangles`). */
  triangles: number;
  /** Geometries alive on the GPU (`gl.info.memory.geometries`). */
  geometries: number;
  /** Textures alive on the GPU (`gl.info.memory.textures`). */
  textures: number;
}

declare global {
  interface Window {
    /** Dev-only render-cost probe (see RenderStatsProbe). Absent in production builds. */
    __cvRenderInfo?: () => RenderInfoSnapshot;
  }
}

/** The per-frame copy. Mutated in place every frame — no allocation on the frame path. */
const live: RenderInfoSnapshot = { calls: 0, triangles: 0, geometries: 0, textures: 0 };

/**
 * DEV-only render-cost probe for the character swap measurements (e2e/task-char-perf.mjs).
 * Copies three's renderer counters into a module object once per frame and serves them as
 * `window.__cvRenderInfo()`; the global is removed on unmount. Renders nothing. Mount it once,
 * inside the Canvas, behind `import.meta.env.DEV` (production tree-shakes it away).
 *
 * Priority 0 on purpose: a positive useFrame priority switches R3F's automatic render off.
 * The callback runs just before this frame's render, so the counters it copies are those of the
 * frame drawn last (three resets `gl.info.render` at the start of each render). Whoever polls
 * (about once a second) reads a complete frame, never a half-counted one.
 */
export function RenderStatsProbe(): null {
  useEffect(() => {
    // A copy per call, so a caller can never mutate the live object (this is not the frame path).
    window.__cvRenderInfo = () => ({ ...live });
    return () => {
      delete window.__cvRenderInfo;
    };
  }, []);

  useFrame(({ gl }) => {
    const { render, memory } = gl.info;
    live.calls = render.calls;
    live.triangles = render.triangles;
    live.geometries = memory.geometries;
    live.textures = memory.textures;
  });

  return null;
}
