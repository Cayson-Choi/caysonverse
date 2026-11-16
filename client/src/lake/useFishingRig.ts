import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AnimationMixer } from "three";
import type { BuiltAvatar } from "../game/characterAvatar";
import { createFishingRig, type FishingRig } from "./fishingRig";
import { readFishView } from "./lakeNet";
import { emptyFishView } from "./lakeProtocol";

/** One avatar's fishing layer, made with its mixer and released with it. */
export function useFishingRig(sid: string, avatar: BuiltAvatar, mixer: AnimationMixer): FishingRig {
  const rig = useMemo(() => createFishingRig({ sid, avatar, mixer }), [sid, avatar, mixer]);
  useEffect(() => () => rig.dispose(), [rig]);
  return rig;
}

// Whether a session carries a rod: a small external store polled at 5 Hz (the schema has no per-field React hook, and the rod
// appears or goes a few times a visit). The player components rebind their base clips when it flips (the rod carrier's walk
// has no right arm, fishAnims.ts).
const listeners = new Set<() => void>();
const flags = new Map<string, boolean>();
let timer: ReturnType<typeof setInterval> | null = null;
const scratch = emptyFishView();

function poll(): void {
  for (const sid of [...flags.keys()]) {
    const has = readFishView(sid, scratch) && scratch.rod > 0;
    if (flags.get(sid) !== has) {
      flags.set(sid, has);
      listeners.forEach((l) => l());
    }
  }
}

export function useHasRod(sid: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!flags.has(sid)) flags.set(sid, readFishView(sid, scratch) && scratch.rod > 0);
      if (!timer) timer = setInterval(poll, 200);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
          flags.clear();
        }
      };
    },
    () => (flags.has(sid) ? flags.get(sid)! : readFishView(sid, scratch) && scratch.rod > 0),
    () => false,
  );
}
