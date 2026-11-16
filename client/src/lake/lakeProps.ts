// The rod, the net and a landed fish as the client draws them until chunk C's `lake_gear.glb` / `lake_fish.glb` land: small
// procedural models with the same node contract as design 6.1 (`grip` the root, `rod_tip`, `net_grip`), so swapping the real
// files in changes nothing around them. The rod is a chain of segments: it folds to 1.15 m for walking, unfolds to 3.6 m when
// the angler sits, and bends along its length for a bite or a fight.

import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, TorusGeometry, ConeGeometry } from "three";

export const ROD_FOLDED_M = 1.15;
export const ROD_OPEN_M = 3.6;
const SEGMENTS = 4;

export interface Rod {
  /** Node `grip`: the rod's root, put on the right hand's slot. The rod points along +Y. */
  root: Group;
  /** Node `rod_tip`: the line's end. */
  tip: Object3D;
  /** 0 folded, 1 open (the length eases). */
  setUnfold(u: number): void;
  /** 0 straight .. 1 bent hard (a fight). */
  setBend(b: number): void;
  dispose(): void;
}

export function createRod(): Rod {
  const body = new MeshStandardMaterial({ color: "#16213a", roughness: 0.35, metalness: 0.2 });
  const grip = new MeshStandardMaterial({ color: "#2a2a2c", roughness: 0.9 });
  const tipMat = new MeshStandardMaterial({ color: "#d3402f", roughness: 0.5 });
  const root = new Group();
  root.name = "grip";
  const geoms: CylinderGeometry[] = [];
  const joints: Group[] = [];
  const meshes: Mesh[] = [];
  // the handle
  const handleGeo = new CylinderGeometry(0.03, 0.026, 0.45, 8);
  handleGeo.translate(0, 0.075, 0);
  geoms.push(handleGeo);
  const handle = new Mesh(handleGeo, grip);
  handle.castShadow = true;
  root.add(handle);
  let parent: Object3D = root;
  for (let i = 0; i < SEGMENTS; i++) {
    const joint = new Group();
    const r0 = 0.022 * (1 - i / (SEGMENTS + 1)) + 0.004;
    const r1 = 0.022 * (1 - (i + 1) / (SEGMENTS + 1)) + 0.004;
    // unit-length segment along +Y from the joint; scaled in Y by the segment's real length
    const g = new CylinderGeometry(r1, r0, 1, 8, 1, false);
    g.translate(0, 0.5, 0);
    geoms.push(g);
    const m = new Mesh(g, i === SEGMENTS - 1 ? tipMat : body);
    m.castShadow = true;
    joint.add(m);
    parent.add(joint);
    joints.push(joint);
    meshes.push(m);
    parent = joint;
  }
  const tip = new Object3D();
  tip.name = "rod_tip";
  parent.add(tip);
  let unfold = 0;
  let bend = 0;
  const layout = () => {
    const len = ROD_FOLDED_M + (ROD_OPEN_M - ROD_FOLDED_M) * unfold;
    const seg = (len - 0.3) / SEGMENTS;
    joints.forEach((j, i) => {
      j.position.set(0, i === 0 ? 0.3 : seg, 0);
      meshes[i]!.scale.set(1, seg, 1);
      // the bend grows toward the tip: a rod bends most where it is thin
      j.rotation.x = -bend * 0.12 * (0.4 + i / SEGMENTS);
    });
    tip.position.set(0, seg, 0);
  };
  layout();
  return {
    root,
    tip,
    setUnfold(u) {
      unfold = Math.max(0, Math.min(1, u));
      layout();
    },
    setBend(b) {
      bend = Math.max(0, Math.min(1, b));
      layout();
    },
    dispose() {
      geoms.forEach((g) => g.dispose());
      body.dispose();
      grip.dispose();
      tipMat.dispose();
    },
  };
}

export interface Net {
  /** Node `net_grip`, put on the left hand's slot. The handle points along +Y. */
  root: Group;
  dispose(): void;
}

export function createNet(): Net {
  const wood = new MeshStandardMaterial({ color: "#6b4a2b", roughness: 0.8 });
  const mesh = new MeshStandardMaterial({ color: "#2f5a3a", roughness: 0.9, transparent: true, opacity: 0.8 });
  const root = new Group();
  root.name = "net_grip";
  const handle = new CylinderGeometry(0.02, 0.02, 1.5, 6);
  handle.translate(0, 0.75, 0);
  const rim = new TorusGeometry(0.25, 0.015, 6, 20);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 1.55, 0);
  const bag = new SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bag.translate(0, 1.55, 0);
  root.add(new Mesh(handle, wood), new Mesh(rim, wood), new Mesh(bag, mesh));
  return {
    root,
    dispose() {
      handle.dispose();
      rim.dispose();
      bag.dispose();
      wood.dispose();
      mesh.dispose();
    },
  };
}

export interface FishModel {
  root: Group;
  /** Resize to a length in cm (the picture of 1.25x real, like the people). */
  setCm(cm: number): void;
  setColor(hex: string): void;
  dispose(): void;
}

/** A stand-in fish: an ellipsoid with a tail, 1 m long at scale 1, nose toward +X. */
export function createFishModel(): FishModel {
  const mat = new MeshStandardMaterial({ color: "#b9a46a", roughness: 0.45 });
  const belly = new MeshStandardMaterial({ color: "#e4dcc4", roughness: 0.5 });
  const body = new SphereGeometry(0.5, 14, 10);
  body.scale(1, 0.28, 0.16);
  const tail = new ConeGeometry(0.16, 0.26, 4);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-0.55, 0, 0);
  const root = new Group();
  const b = new Mesh(body, mat);
  const t = new Mesh(tail, mat);
  const w = new Mesh(body.clone().scale(0.98, 0.7, 0.9), belly);
  w.position.y = -0.03;
  b.castShadow = true;
  root.add(b, t, w);
  return {
    root,
    setCm(cm) {
      const s = (cm / 100) * 1.25;
      root.scale.setScalar(Math.max(0.05, s));
    },
    setColor(hex) {
      mat.color.set(hex);
    },
    dispose() {
      body.dispose();
      tail.dispose();
      mat.dispose();
      belly.dispose();
    },
  };
}
