import { Object3D, Quaternion, Vector3 } from "three";

/**
 * The lean-back pose of a sitter on a BACKED seat (a sofa, an armchair, a chair; 2026-11-13). character.glb has one sitting
 * clip (`Sit_Chair_*`, upright). Rather than a second clip, the avatar's upper body is turned back about its hips a few degrees
 * after the mixer has posed it: `spine` takes 60 % of the angle, `chest` 40 %.
 *
 * The mixer may or may not rewrite the bones each frame (the local player's runs every frame, a seated remote's is paused), so the
 * lean is written on top of the BASE pose: the base is read from the bone unless the bone still holds exactly what this module
 * wrote last (the mixer did not touch it), in which case the remembered base is used. The lean eases in and out (`LEAN_RATE`).
 */

/** How fast the lean eases (rad/s): 0.2 rad takes about 0.7 s. */
export const LEAN_RATE = 0.3;
/** Share of the angle on each bone. */
export const LEAN_SPLIT = { spine: 0.6, chest: 0.4 } as const;

interface BoneState {
  bone: Object3D;
  base: Quaternion;
  written: Quaternion;
  has: boolean;
}

interface LeanState {
  amount: number;
  bones: BoneState[] | null;
}

const states = new WeakMap<Object3D, LeanState>();
const AXIS = new Vector3(1, 0, 0);
const tmp = new Quaternion();

/** `amount` stepped toward `target` by `rate * delta`, never overshooting. */
export function easeLean(amount: number, target: number, delta: number, rate: number = LEAN_RATE): number {
  const step = rate * Math.max(0, delta);
  if (amount < target) return Math.min(target, amount + step);
  return Math.max(target, amount - step);
}

/**
 * Ease the lean of the avatar under `root` toward `target` (rad; 0 stands upright) and write it onto its `spine` and `chest`.
 * Call it every frame after the avatar's mixer has run. Returns the lean applied now.
 */
export function stepLean(root: Object3D, target: number, delta: number): number {
  let st = states.get(root);
  if (!st) {
    if (target <= 0) return 0;
    st = { amount: 0, bones: null };
    states.set(root, st);
  }
  if (st.bones === null) {
    const bones: BoneState[] = [];
    for (const name of ["spine", "chest"] as const) {
      const bone = root.getObjectByName(name);
      if (bone) bones.push({ bone, base: new Quaternion(), written: new Quaternion(), has: false });
    }
    st.bones = bones;
  }
  st.amount = easeLean(st.amount, target, delta);
  const names = ["spine", "chest"] as const;
  st.bones.forEach((b, i) => {
    const share = LEAN_SPLIT[names[i]!] ?? 0;
    // the base pose: what the bone holds, unless it still holds what we wrote (the mixer left it alone)
    if (!b.has || b.bone.quaternion.angleTo(b.written) > 1e-6) b.base.copy(b.bone.quaternion);
    if (st.amount <= 1e-4) {
      b.bone.quaternion.copy(b.base);
      b.has = false;
      return;
    }
    // backwards: about the bone's own x axis, negative (the avatar faces +z, so a forward lean is a positive turn about x)
    tmp.setFromAxisAngle(AXIS, -st.amount * share);
    b.bone.quaternion.copy(b.base).multiply(tmp);
    b.written.copy(b.bone.quaternion);
    b.has = true;
  });
  return st.amount;
}

/** Forget an avatar's lean state (it is being released). */
export function forgetLean(root: Object3D): void {
  states.delete(root);
}
