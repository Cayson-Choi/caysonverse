import { useLayoutEffect } from "react";
import type { Object3D } from "three";
import { patchVillage, type PatchStats } from "./lakeVillagePatch";
import { useLakeStore } from "./lakeStore";

declare global {
  interface Window {
    /** DEV only: what the village patch took out of the clone (triangles and instances), or null while the lake is not drawn. */
    __cvLakePatch?: () => PatchStats | null;
  }
}

/**
 * Once any of the new lake is drawn, the village's clone loses what its old backdrop lake drew inside the lake zone (design
 * 11.1); when the lake goes (a failed or replaced file) or the clone does, the originals come back.
 */
export function LakeVillagePatch({ root }: { root: Object3D }) {
  const drawn = useLakeStore((s) => s.drawn);
  useLayoutEffect(() => {
    if (!drawn) return;
    const patch = patchVillage(root);
    if (import.meta.env.DEV) window.__cvLakePatch = () => patch.stats;
    return () => {
      patch.restore();
      if (import.meta.env.DEV) delete window.__cvLakePatch;
    };
  }, [drawn, root]);
  return null;
}
