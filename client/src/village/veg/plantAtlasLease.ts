import type { Texture } from "three";
import type { AtlasPixels, CrownGrower } from "./crownGrow";
import { makePlantAtlas } from "./vegPlantAtlas";

interface Atlas {
  owners: number;
  pixels: Promise<AtlasPixels | null> | null;
  texture: Texture | null;
}

let shared: Atlas | null = null;

/** The village, house flowers and park use identical atlas pixels and sampling settings. */
export function acquirePlantAtlas() {
  const atlas: Atlas = (shared ??= { owners: 0, pixels: null, texture: null });
  atlas.owners++;
  let released = false;
  return {
    /** Each grower still makes its own barks. Only one worker needs to draw the plant atlas. */
    startTextures(grower: Pick<CrownGrower, "atlas" | "offPage">) {
      const drawPlant = grower.offPage && !atlas.pixels && !atlas.texture;
      const job = grower.atlas(drawPlant);
      if (drawPlant) {
        atlas.pixels = job.then((result) => result?.atlas ?? null, () => null).then((pixels) => {
          if (!pixels) atlas.pixels = null;
          return pixels;
        });
      }
      return job;
    },
    async texture(cancelled: () => boolean) {
      const pixels = atlas.pixels ? await atlas.pixels : null;
      if (released || cancelled()) return null;
      return (atlas.texture ??= makePlantAtlas(pixels ?? undefined));
    },
    dispose() {
      if (released) return;
      released = true;
      if (--atlas.owners !== 0) return;
      shared = null;
      atlas.pixels = null;
      atlas.texture?.dispose();
      atlas.texture = null;
    },
  };
}
