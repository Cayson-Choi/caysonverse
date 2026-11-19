// The wrist on the rod (owner 2026-11-19: "손목이 꺾인 것 같아 보여"): the fishing clips turn the hand about 115 degrees away from the forearm
// (the rod is held across the fist), which reads as a broken wrist. Only the wrist and the hand bone are eased back toward the forearm's line
// after the mixer has posed them (the way leanBack.ts writes on top of the base pose): the arm, the shoulder, the chair and the rod's own
// direction stay where they were — the rod is turned back by the same amount in the slot's frame, so it keeps its world direction and grip point.
import { Quaternion, type Bone as ThreeBone, type Object3D, type SkinnedMesh } from "three";

/** How much of the clips' wrist rotation is taken away (0 = none, 1 = the hand straight on the forearm): 0.78 leaves about 25 degrees. */
export const WRIST_RELAX = 0.78;

interface Bone {
  bone: Object3D;
  rest: Quaternion;
  base: Quaternion;
  written: Quaternion;
  has: boolean;
}

interface State {
  wrist: Bone;
  hand: Bone;
}

const states = new WeakMap<Object3D, State | null>();

const boneOf = (root: Object3D, name: string): Object3D | null => root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[.[\]:/]/g, "")) ?? null;

/** The bone's rest rotation relative to its parent, from the skeleton's inverse bind matrices. */
function restLocal(root: Object3D, bone: Object3D): Quaternion | null {
  let mesh: SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!mesh && m.isSkinnedMesh && m.skeleton.bones.includes(bone as ThreeBone)) mesh = m;
  });
  const sm = mesh as SkinnedMesh | null;
  if (!sm || !bone.parent) return null;
  const sk = sm.skeleton;
  const i = sk.bones.indexOf(bone as ThreeBone);
  const j = sk.bones.indexOf(bone.parent as ThreeBone);
  if (i < 0 || j < 0) return null;
  const w = sk.boneInverses[i]!.clone().invert();
  const pw = sk.boneInverses[j]!.clone().invert();
  const loc = pw.invert().multiply(w);
  return new Quaternion().setFromRotationMatrix(loc);
}

function stateOf(root: Object3D): State | null {
  if (states.has(root)) return states.get(root) ?? null;
  const w = boneOf(root, "wrist.r");
  const h = boneOf(root, "hand.r");
  const rw = w ? restLocal(root, w) : null;
  const rh = h ? restLocal(root, h) : null;
  const s: State | null = w && h && rw && rh ? { wrist: mk(w, rw), hand: mk(h, rh) } : null;
  states.set(root, s);
  return s;
}

const mk = (bone: Object3D, rest: Quaternion): Bone => ({ bone, rest, base: new Quaternion(), written: new Quaternion(), has: false });

const tmpA = new Quaternion();
const tmpB = new Quaternion();

/**
 * Ease the right wrist and hand of the avatar under `root` toward the forearm's line (`amount` 0..1 = WRIST_RELAX while a rod is held, 0 else).
 * Call it every frame after the mixer. Returns the rotation to give the rod back in the slot's frame (a quaternion in the slot's local frame, or
 * null when nothing is relaxed): `rodQuat = result * (the rod's own rotation)`.
 */
export function relaxWrist(root: Object3D, amount: number, slot: Object3D | null): Quaternion | null {
  const st = stateOf(root);
  if (!st) return null;
  const both = [st.wrist, st.hand];
  for (const b of both) {
    // the mixer's pose is read from the bone unless the bone still holds exactly what was written last time (the mixer did not touch it)
    if (!b.has || !b.bone.quaternion.equals(b.written)) {
      b.base.copy(b.bone.quaternion);
      b.has = true;
    }
  }
  const before = tmpA.copy(st.wrist.base).multiply(st.hand.base);
  for (const b of both) {
    b.written.copy(b.rest).slerp(b.base, 1 - amount);
    b.bone.quaternion.copy(b.written);
  }
  if (amount <= 0 || !slot) return null;
  // the slot keeps its world rotation: rod' = S^-1 (Rw' Rh')^-1 (Rw Rh) S, turned back about the slot's own rotation S
  const after = tmpB.copy(st.wrist.written).multiply(st.hand.written);
  const c = after.invert().multiply(before);
  const s = slot.quaternion;
  return new Quaternion().copy(s).invert().multiply(c).multiply(s);
}

/** Put the wrist and hand back exactly as the mixer posed them (the rod was put down). */
export function restoreWrist(root: Object3D): void {
  const st = states.get(root);
  if (!st) return;
  for (const b of [st.wrist, st.hand]) {
    if (b.has && b.bone.quaternion.equals(b.written)) b.bone.quaternion.copy(b.base);
    b.has = false;
  }
}
