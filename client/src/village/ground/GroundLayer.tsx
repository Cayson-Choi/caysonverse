import { groundOld } from "./groundMode";
import { useEffect, useLayoutEffect, useMemo } from "react";
import type { Material, Mesh, Object3D, Texture } from "three";
import { patchGroundPaths, type GroundPatchStats } from "./groundPaths";
import { wearRoadPaint } from "./roadPaint";

declare global {
  interface Window {
    /** Dev-only: what the ground paths took out of the village clone and put in. */
    __cvGroundPaths?: () => GroundPatchStats;
  }
}

/**
 * The lanes and the crossings' connectors, redrawn in their own light-mapped meshes (groundPaths.ts): the baked ones (stickers
 * on the grass) come out of this clone. Nothing is added to the scene: the same two meshes, the same two materials.
 */
export function GroundLayer({ root }: { root: Object3D }) {
  const state = useMemo(() => ({ stats: null as GroundPatchStats | null }), []);
  useLayoutEffect(() => {
    if (groundOld()) return;
    const p = patchGroundPaths(root);
    state.stats = p.stats;
    // the zebra's and the lines' paint, worn (a copy of the road texture's image)
    let unwear: (() => void) | null = null;
    root.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      const mat = Array.isArray(m) ? m[0] : m;
      if (!unwear && mat && mat.name === "LM_road_x") {
        const map = (mat as { map?: Texture | null }).map;
        if (map) unwear = wearRoadPaint(map);
      }
    });
    return () => {
      unwear?.();
      p.restore();
    };
  }, [root, state]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvGroundPaths = () => state.stats as GroundPatchStats;
    return () => {
      delete window.__cvGroundPaths;
    };
  }, [state]);
  return null;
}
