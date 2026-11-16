// The nine fishing clips (fishing_anims.glb: the character's bone names, clips only). Fetched once, the first time a rod is in
// sight (design 10: "누군가 손에 대를 든 게 화면에 보일 때"), and shared by every avatar's mixer (three binds a clip by bone name).

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AnimationClip } from "three";
import { FISHING_CLIPS, RIGHT_ARM_BONES, type FishingClip } from "@caysonverse/shared/village/fishingAnims";
import { LAKE_URLS, lakeAssetWanted } from "./lakeAssets";

export type FishClips = Readonly<Record<FishingClip, AnimationClip>>;

let pending: Promise<FishClips | null> | null = null;
let loaded: FishClips | null = null;

/** The clips, or null when they cannot be had (the rod is then carried and held without the body animation). */
export function loadFishingAnims(): Promise<FishClips | null> {
  if (!lakeAssetWanted("anims")) return Promise.resolve(null);
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(LAKE_URLS.anims)
      .then((g) => {
        const out: Partial<Record<FishingClip, AnimationClip>> = {};
        for (const name of Object.keys(FISHING_CLIPS) as FishingClip[]) {
          const clip = g.animations.find((c) => c.name === name);
          if (clip) out[name] = clip;
        }
        loaded = Object.keys(FISHING_CLIPS).every((n) => out[n as FishingClip]) ? (out as FishClips) : null;
        return loaded;
      })
      .catch((e: unknown) => {
        console.warn("[lake] fishing_anims.glb failed", e);
        pending = null; // a later rod tries again
        return null;
      });
  }
  return pending;
}

export function fishingAnimsNow(): FishClips | null {
  return loaded;
}

/** three drops the dots of a node name (`upperarm.r` -> `upperarmr`) when it binds a track; both spellings are tried. */
const SANITIZED = new Set(RIGHT_ARM_BONES.flatMap((b) => [b, b.replace(/[.[\]:/]/g, "")]));

/** The track's node name: everything before the property (`upperarmr.quaternion` -> `upperarmr`). */
export function trackNode(trackName: string): string {
  const dot = trackName.lastIndexOf(".");
  return dot < 0 ? trackName : trackName.slice(0, dot);
}

/** True for a track of the right arm chain (Carry_Rod owns those while a rod is carried). */
export function isRightArmTrack(trackName: string): boolean {
  return SANITIZED.has(trackNode(trackName));
}

/**
 * A copy of `clip` without the right arm's tracks: the walk / run / idle of someone who carries a rod (design 6.3: Carry_Rod
 * layers over the walk with the walk clip's right-arm tracks removed, so the two never average on the arm).
 */
export function withoutRightArm(clip: AnimationClip): AnimationClip {
  const copy = clip.clone();
  copy.tracks = copy.tracks.filter((t) => !isRightArmTrack(t.name));
  copy.name = clip.name;
  return copy;
}
