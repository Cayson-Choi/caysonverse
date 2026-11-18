// The rod, the net and a landed fish. Chunk C's `lake_gear.glb` / `lake_fish.glb` (shared lakeGear.ts is the contract) are
// fetched once the first time a rod is in sight; until they are in (or if they fail) small procedural stand-ins with the same
// node contract (`grip` the root, `rod_tip`, `net_grip`) are drawn. The real rod is a skinned bone chain: its clips fold it to
// 1.15 m for walking (Rod_Folded), open it over 0.58 s (Rod_Extend), and bend it (Rod_Bend_Fight over the open pose). Its
// `grip` goes on the right hand's slot with GRIP_OFFSET and no turn (the rod's axis is ROD_AXIS_R already); the net's
// `net_grip` the same on the left. A fish `fish_<kind>` is 1 m long at scale 1 (extras.refCm 100), nose +Z, back +Y.

import {
  AnimationMixer,
  CylinderGeometry,
  Group,
  Mesh,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector2,
  Vector3,
  type Material,
  SphereGeometry,
  ConeGeometry,
  Color,
  type AnimationAction,
  type AnimationClip,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { LAKE_GEAR_NODES, lakeFishNode, type LakeFishId } from "@caysonverse/shared/village/lakeGear";
import { fishKindFromId } from "@caysonverse/shared/village/fishing";
import { LAKE_URLS, lakeAssetWanted } from "./lakeAssets";
import { applyEelSkin, isEelKind } from "./eelSkin";

interface GearFiles {
  gear: { scene: Object3D; animations: AnimationClip[] } | null;
  fish: Object3D | null;
}
const files: GearFiles = { gear: null, fish: null };
let gearPending: Promise<void> | null = null;

/** Fetch lake_gear.glb and lake_fish.glb once (the first rod in sight). A failure leaves the stand-ins; a later rod tries again. */
export function loadLakeGear(): Promise<void> {
  if (!gearPending) {
    const loader = new GLTFLoader();
    // lake v2: lake_fish.glb is Draco-compressed (the village's own decoder, client/public/draco/)
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    loader.setDRACOLoader(draco);
    const gear = lakeAssetWanted("gear")
      ? loader.loadAsync(LAKE_URLS.gear).then((g) => {
          files.gear = { scene: g.scene, animations: g.animations };
        })
      : Promise.resolve();
    const fish = lakeAssetWanted("fish")
      ? loader.loadAsync(LAKE_URLS.fish).then((g) => {
          files.fish = g.scene;
        })
      : Promise.resolve();
    gearPending = Promise.all([gear, fish])
      .then(() => undefined)
      .catch((e: unknown) => {
        console.warn("[lake] lake_gear.glb / lake_fish.glb failed", e);
        gearPending = null;
      });
  }
  return gearPending;
}

/** Whether the real gear is in (a rod made now is the real one). */
export function lakeGearReady(): boolean {
  return files.gear !== null;
}

/** The float's mesh parts of lake_gear.glb (the body and the glowing 케미), for the floats' instanced meshes; null until loaded. */
export function lakeFloatParts(): { body: Mesh | null; chemi: Mesh | null; top: number } | null {
  const g = files.gear?.scene;
  if (!g) return null;
  g.updateMatrixWorld(true);
  const float = g.getObjectByName(LAKE_GEAR_NODES.float);
  if (!float) return null;
  let body: Mesh | null = null;
  let chemi: Mesh | null = null;
  float.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (/chemi/i.test(m.name) || /chemi/i.test(m.parent?.name ?? "")) chemi = chemi ?? m;
    else body = body ?? m;
  });
  const top = g.getObjectByName(LAKE_GEAR_NODES.floatTop)?.position.y ?? 0.35;
  return { body, chemi, top };
}

export const ROD_FOLDED_M = 1.15;
export const ROD_OPEN_M = 3.6;
const SEGMENTS = 4;

export interface Rod {
  /** Node `grip`: the rod's root, put on the right hand's slot. The stand-in points along +Y; the real one along ROD_AXIS_R. */
  root: Group;
  /** lake_gear.glb's rod (placed with GRIP_OFFSET and no turn). */
  real?: boolean;
  /** Node `rod_tip`: the line's end. */
  tip: Object3D;
  /** 0 folded, 1 open (the length eases). */
  setUnfold(u: number): void;
  /** 0 straight .. 1 bent hard (a fight). */
  setBend(b: number): void;
  dispose(): void;
}

/** The rod: the real one when lake_gear.glb is in, else the stand-in. */
export function createRod(): Rod {
  return files.gear ? createRealRod(files.gear) : createStandInRod();
}

function createRealRod(gear: NonNullable<GearFiles["gear"]>): Rod {
  const src = gear.scene.getObjectByName(LAKE_GEAR_NODES.rod);
  if (!src) return createStandInRod();
  const root = cloneSkinned(src) as Group;
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.traverse((o) => {
    o.frustumCulled = false; // a skinned rod's bounds are its rest pose: keep it drawn while it swings
    if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
  });
  const tip = root.getObjectByName(LAKE_GEAR_NODES.rodTip) ?? root;
  const mixer = new AnimationMixer(root);
  const clip = (name: string) => gear.animations.find((c) => c.name === name);
  const act = (name: string): AnimationAction | null => {
    const c = clip(name);
    if (!c) return null;
    const a = mixer.clipAction(c);
    a.play();
    a.paused = true;
    return a;
  };
  const extend = act("Rod_Extend");
  const fight = act("Rod_Bend_Fight");
  const extendLen = clip("Rod_Extend")?.duration ?? 0.58;
  let unfold = 0;
  let bend = 0;
  const apply = () => {
    // folded -> open along Rod_Extend; once open, the bend is a blend of the open pose and the fight's bent one
    const b = unfold >= 0.999 ? bend : 0;
    if (extend) {
      extend.time = Math.min(extendLen - 1e-4, unfold * extendLen);
      extend.weight = 1 - b;
    }
    if (fight) fight.weight = b;
    mixer.update(0);
  };
  apply();
  return {
    root,
    tip,
    real: true,
    setUnfold(u) {
      const v = Math.max(0, Math.min(1, u));
      if (v === unfold) return;
      unfold = v;
      apply();
    },
    setBend(b) {
      const v = Math.max(0, Math.min(1, b));
      if (v === bend) return;
      bend = v;
      apply();
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}

function createStandInRod(): Rod {
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

// (lake v2, owner 2026-11-17: "뜰채는 가지고 있지도 않은데 뜰채 모양이 나오는건 없애": no net — lake_gear.glb's `net_grip` is not drawn)

export interface FishModel {
  root: Group;
  /** Resize to a length in cm (the picture of 1.25x real, like the people). */
  setCm(cm: number): void;
  /** Which species (`Player.fishKind`): the real model shows that one's `fish_<kind>` (the stand-in recolours). */
  setKind(kind: number, color: string): void;
  /**
   * The body's flex (lake v2): the tail beat's phase (rad), its amplitude (fraction of the length at the tail tip) and a static
   * bend (fraction, + = the tail to the fish's left). A vertex-shader wave: the head stays, the tail sweeps.
   */
  setFlex(phase: number, amp: number, bend: number): void;
  /** Far away (an angler across the lake): the 520-triangle LOD1 instead of the full model. */
  setFar(far: boolean): void;
  dispose(): void;
}

/**
 * The drawn length (m) of a caught fish of `cm` (hotfix 2026-11-17, owner: "잡았는데 손에 아무것도 표시가 안돼"): at 1.8x a 19 cm
 * bluegill was 0.34 m, a speck beside the chibi's fists and lost at the rod tip — always readable now (10 cm -> 0.55 m, 19 cm ->
 * 0.67 m, 40 cm -> 0.94 m, 70 cm -> 1.33 m; the model is 1 m long at scale 1), the order of sizes kept.
 */
export function fishDrawnLen(cm: number): number {
  return 0.42 + Math.max(0, cm) * 0.013;
}

/** The flex uniform of one fish model's materials: x phase, y amplitude, z bend. */
export interface FlexUniform {
  value: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown };
}

const FLEX_VERTEX = /* glsl */ `
  // lake v2 fish flex: nose +Z, length 1 in model space; the head stays, the tail sweeps across (x)
  float fs = clamp( 0.5 - position.z, 0.0, 1.05 );
  float fw = smoothstep( 0.12, 1.0, fs ) * ( 0.35 + 0.65 * fs );
  float fl = uFlex.y * fw * sin( uFlex.x - 5.2 * fs ) + uFlex.z * fs * fs;
  // the tail fin bends on its own, a beat behind the body (hotfix 2026-11-17: it swept stiffly with the tail end)
  float ct = smoothstep( 0.8, 1.02, fs );
  fl += uFlex.y * 1.7 * ct * ( fs - 0.78 ) * sin( uFlex.x - 5.2 * fs - 1.3 );
  transformed.x += fl;
`;

/**
 * lake_fish.glb's materials made wet and alive (lake v2): the photo body gets a clear coat (the slime's sheen) over its normal map
 * (the photo's detail and the scales), and every one bends with the flex uniform (onBeforeCompile).
 * The fins (hotfix 2026-11-17, owner: "지느러미가 너무 투명해 … 지느러미가 안보이는 것도 있어"): nearly opaque membranes whose
 * alpha only fades at the frayed edge, and they WRITE DEPTH — see-through fins that wrote none were painted over by the lake's water
 * (drawn after them in the transparent pass) and vanished; alphaTest drops the faded fringe from the depth too.
 */
export function liveMaterial(src: Material, flex: FlexUniform): Material {
  const s = src as MeshStandardMaterial;
  let m: MeshStandardMaterial;
  if (/^M_fish/.test(s.name)) {
    m = new MeshPhysicalMaterial({
      name: s.name,
      map: s.map,
      normalMap: s.normalMap,
      normalScale: new Vector2(0.85, 0.85),
      roughness: 0.34,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      specularIntensity: 0.8,
      side: DoubleSide,
    });
  } else {
    // the fins: membranes with raised rays (their normal map), wet (a light clear coat), soft only at the very edge
    m = new MeshPhysicalMaterial({
      name: s.name,
      map: s.map,
      normalMap: s.normalMap,
      normalScale: new Vector2(1, 1),
      roughness: 0.4,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.18,
      // a fin is thin: the light comes through it — a little of its own colour glows so a fin turned from the sun never goes black
      emissive: new Color(1, 1, 1),
      emissiveMap: s.map,
      emissiveIntensity: 0.28,
      side: DoubleSide,
      transparent: true,
      depthWrite: true,
      alphaTest: 0.3,
    });
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlex = flex;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform vec3 uFlex;").replace("#include <begin_vertex>", "#include <begin_vertex>\n" + FLEX_VERTEX);
  };
  m.customProgramCacheKey = () => "lake-fish-flex";
  return m;
}

/** A landed fish: the real models (the catch's species shown) when lake_fish.glb is in, else the stand-in. Nose +Z. */
export function createFishModel(): FishModel {
  const src = files.fish;
  if (!src) return createStandInFish();
  const root = new Group();
  const kinds = new Map<string, { node: Object3D; near: Object3D[]; far: Object3D[] }>();
  let shown: { node: Object3D; near: Object3D[]; far: Object3D[] } | null = null;
  const flex: FlexUniform = { value: new Vector3(0, 0, 0) };
  const owned = new Map<Material, Material>();
  const ownedEel = new Map<Material, Material>(); // the eel's body has its own skin (eelSkin.ts)
  let far = false;
  const applyLod = () => {
    if (!shown) return;
    const hasFar = shown.far.length > 0;
    for (const o of shown.near) o.visible = !(far && hasFar);
    for (const o of shown.far) o.visible = far;
  };
  return {
    root,
    setCm(cm) {
      root.scale.setScalar(fishDrawnLen(cm));
    },
    setKind(kind) {
      const id = fishKindFromId(kind) as LakeFishId | null;
      if (!id) return;
      let entry = kinds.get(id);
      if (!entry) {
        const s = src.getObjectByName(lakeFishNode(id));
        if (!s) return;
        const node = s.clone(true);
        node.position.set(0, 0, 0);
        node.quaternion.identity();
        const ref = (s.userData as { refCm?: number }).refCm ?? 100;
        node.scale.setScalar(100 / ref);
        const near: Object3D[] = [];
        const farMeshes: Object3D[] = [];
        node.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.frustumCulled = false; // the flex moves the tail outside the rest bounds
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const live = mats.map((mt) => {
            const own = isEelKind(id) ? ownedEel : owned;
            let l = own.get(mt);
            if (!l) {
              l = liveMaterial(mt, flex);
              if (own === ownedEel) applyEelSkin(l);
              own.set(mt, l);
            }
            return l;
          });
          mesh.material = Array.isArray(mesh.material) ? live : live[0]!;
          let lod = false;
          for (let up: Object3D | null = mesh; up && up !== node; up = up.parent) if (/_lod1/.test(up.name)) lod = true;
          if (lod) farMeshes.push(mesh);
          else near.push(mesh);
        });
        entry = { node, near, far: farMeshes };
        kinds.set(id, entry);
        root.add(node);
      }
      if (shown && shown !== entry) shown.node.visible = false;
      entry.node.visible = true;
      shown = entry;
      applyLod();
    },
    setFlex(phase, amp, bend) {
      flex.value.set(phase, amp, bend);
    },
    setFar(f) {
      if (f === far) return;
      far = f;
      applyLod();
    },
    dispose() {
      root.clear();
      kinds.clear();
      for (const m of owned.values()) m.dispose();
      for (const m of ownedEel.values()) m.dispose();
      owned.clear();
      ownedEel.clear();
    },
  };
}

/** A stand-in fish: an ellipsoid with a tail, 1 m long at scale 1, nose toward +Z. */
function createStandInFish(): FishModel {
  const mat = new MeshStandardMaterial({ color: "#b9a46a", roughness: 0.45 });
  const belly = new MeshStandardMaterial({ color: "#e4dcc4", roughness: 0.5 });
  const body = new SphereGeometry(0.5, 14, 10);
  body.scale(1, 0.28, 0.16);
  const tail = new ConeGeometry(0.16, 0.26, 4);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-0.55, 0, 0);
  // nose +Z like lake_fish.glb
  body.rotateY(-Math.PI / 2);
  tail.rotateY(-Math.PI / 2);
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
      const s = fishDrawnLen(cm);
      root.scale.setScalar(Math.max(0.05, s));
    },
    setKind(_kind, hex) {
      mat.color.set(hex);
    },
    setFlex() {},
    setFar() {},
    dispose() {
      body.dispose();
      tail.dispose();
      mat.dispose();
      belly.dispose();
    },
  };
}
