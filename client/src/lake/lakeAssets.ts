// Which lake files exist. The client never asks for a file that is not there (a 404 is a console error, and design 12.11 wants
// none): chunk A's `lake.glb`, B's facilities, C's `lake_gear.glb` / `lake_fish.glb` are placeholders until they land, and the
// lake draws its boxes (LakeGreybox) and a procedural rod and fish meanwhile. Whoever merges a real file flips its flag here;
// lakeAssets.test.ts compares the flags with the files in public/models/lake so a forgotten flag fails the tests.
//
// DEV: `?lake=glb` in the address asks for the files whatever the flags say (to try a file before the flag is flipped).

import { FISHING_ANIMS_GLB_HASH, FISHING_ANIMS_PATH } from "@caysonverse/shared/village/fishingAnims";

export const LAKE_URLS = {
  /** Terrain, water, facilities, chairs, lamps, reeds (A + B). Nodes: `lake_water*` (+ optional `aDepth`), `col__lake_*`, `seat__lake_*`, `spot__*` are hidden/ignored by the draw. */
  lake: "/models/lake/lake.glb",
  /** The rod (nodes `grip`, `rod_tip`, a bone chain), the float (`float_top`), the net (`net_grip`) — C. */
  gear: "/models/lake/lake_gear.glb",
  /** `fish_<species>` nodes — C. */
  fish: "/models/lake/lake_fish.glb",
  /** The nine fishing clips (bones + clips, no mesh). */
  anims: `${FISHING_ANIMS_PATH}?v=${FISHING_ANIMS_GLB_HASH}`,
} as const;

/** The files that are in the repo now. */
export const LAKE_PRESENT = { lake: false, gear: false, fish: false, anims: true } as const;

export type LakeAsset = keyof typeof LAKE_PRESENT;

function forced(): boolean {
  if (!import.meta.env.DEV || typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("lake") === "glb";
}

/** May the client request this file? */
export function lakeAssetWanted(a: LakeAsset): boolean {
  return LAKE_PRESENT[a] || forced();
}
