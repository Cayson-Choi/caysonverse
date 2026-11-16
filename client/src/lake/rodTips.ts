// Where each angler's rod tip is (the `rod_tip` node of the rod in their hand): the line is drawn from it to the float.
// A registry instead of a prop chain, because the rods live on avatar bones (fishingRig.ts) and the lines in the lake scene.

import type { Object3D } from "three";

const tips = new Map<string, Object3D>();

export function registerRodTip(sid: string, tip: Object3D): () => void {
  tips.set(sid, tip);
  return () => {
    if (tips.get(sid) === tip) tips.delete(sid);
  };
}

export function rodTipOf(sid: string): Object3D | null {
  return tips.get(sid) ?? null;
}
