// Which lake files exist. The client never asks for a file that is not there (a 404 is a console error, and design 12.11 wants
// none): chunk A's `lake.glb`, B's facilities, C's `lake_gear.glb` / `lake_fish.glb` are placeholders until they land, and the
// lake draws its boxes (LakeGreybox) and a procedural rod and fish meanwhile. Whoever merges a real file flips its flag here;
// lakeAssets.test.ts compares the flags with the files in public/models/lake so a forgotten flag fails the tests.
//
// DEV: `?lake=glb` in the address asks for the files whatever the flags say (to try a file before the flag is flipped).

import { versionedUrl } from "../village/modelUrl";
import { FISHING_ANIMS_GLB_HASH, FISHING_ANIMS_PATH } from "@caysonverse/shared/village/fishingAnims";
import { LAKE_FISH_GLB_HASH, LAKE_FISH_PATH, LAKE_GEAR_GLB_HASH, LAKE_GEAR_PATH } from "@caysonverse/shared/village/lakeGear";

export const LAKE_URLS = {
  /** Chunk A: ground (`LM_*`, UV1 light map), water (`lake_water`, COLOR_0 data), reeds / trees (`inst__lake*`), the ridge. */
  lake: versionedUrl("/models/lake/lake.glb"),
  /** Chunk B: pier, 좌대, office, pavilion, benches, chairs, lamps (`col__` / `seat__` / `spot__` / `light__` helpers hidden). */
  structures: versionedUrl("/models/lake/lake_structures.glb"),
  /** A's day and night light maps (UV1 of lake.glb) and the reflection panoramas. */
  lightmap: versionedUrl("/models/lake/lake_lm.webp"),
  lightmapNight: versionedUrl("/models/lake/lake_lm_night.webp"),
  /** B's facilities' own day and night light maps (UV1 of lake_structures.glb): the same sun / sky / lamps as A's. */
  structuresLm: versionedUrl("/models/lake/lake_structures_lm.webp"),
  structuresLmNight: versionedUrl("/models/lake/lake_structures_lm_night.webp"),
  reflDay: versionedUrl("/models/lake/lake_refl_day.webp"),
  reflNight: versionedUrl("/models/lake/lake_refl_night.webp"),
  /** The rod (nodes `grip`, `rod_tip`, a bone chain), the float (`float_top`), the net (`net_grip`) — C. */
  gear: `${LAKE_GEAR_PATH}?v=${LAKE_GEAR_GLB_HASH}`,
  /** `fish_<species>` nodes — C. */
  fish: `${LAKE_FISH_PATH}?v=${LAKE_FISH_GLB_HASH}`,
  /** The nine fishing clips (bones + clips, no mesh). */
  anims: `${FISHING_ANIMS_PATH}?v=${FISHING_ANIMS_GLB_HASH}`,
} as const;

/** The files that are in the repo now (F, 2026-11-16: every chunk's file landed). */
export const LAKE_PRESENT = { lake: true, structures: true, lightmap: true, lightmapNight: true, structuresLm: true, structuresLmNight: true, reflDay: true, reflNight: true, gear: true, fish: true, anims: true } as const;

export type LakeAsset = keyof typeof LAKE_PRESENT;

function forced(): boolean {
  if (!import.meta.env.DEV || typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("lake") === "glb";
}

/** May the client request this file? */
export function lakeAssetWanted(a: LakeAsset): boolean {
  return LAKE_PRESENT[a] || forced();
}
