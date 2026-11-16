// Where each angler's line ends while a fish is on it (lake v2): the fish's mouth, set by its catch rig (catchRig.ts), read by the
// lines in the lake scene (LakeScene.tsx). A registry like rodTips.ts: the fish lives with the avatar, the lines with the lake.

export interface HookPoint {
  x: number;
  y: number;
  z: number;
}

const hooks = new Map<string, HookPoint>();

/** The mouth's world position now, or null when the line is not on a fish (it goes to the float again). */
export function setHookPoint(sid: string, p: HookPoint | null): void {
  if (!p) {
    hooks.delete(sid);
    return;
  }
  const h = hooks.get(sid);
  if (h) {
    h.x = p.x;
    h.y = p.y;
    h.z = p.z;
  } else hooks.set(sid, { x: p.x, y: p.y, z: p.z });
}

export function hookPointOf(sid: string): HookPoint | null {
  return hooks.get(sid) ?? null;
}
