import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  RGFormat,
  UnsignedByteType,
  ClampToEdgeWrapping,
  NoColorSpace,
  type BufferGeometry,
  type Material,
  type Object3D,
  type ShaderMaterial,
} from "three";
import { mergeStones } from "./creekStones";
import { groundGrainTexture } from "../groundDetail";
import { makeFountainNoise } from "../fountainWater";
import { getPbrSet, type PbrSet } from "../pbr/pbrLibrary";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { createDepthWater } from "./depthWater";
import type { VillageNodes, VillageTier } from "../villageModelPrep";
import { bankGeometry, reshapeWater, sheetGeometry } from "./creekGeometry";
import {
  BED_MAX,
  BED_MIN,
  CASCADES,
  CREEK_H,
  CREEK_RECT,
  CREEK_W,
  fillHoles,
  mapBytes,
  newFoam,
  newGrid,
  rasterGround,
  shoreAt,
  type CreekGrid,
  type GroundSource,
} from "./creekMap";
import { bankMaterial, reedMaterial, reedUniforms, rockMaterial, sheetMaterial } from "./creekMaterials";
import { planCreek } from "./creekPlan";
import { reedGeometry } from "./creekReeds";

declare global {
  interface Window {
    /** DEV: what the creek patch built (draw calls, triangles, counts); null until it is up. */
    __cvCreek?: () => CreekStats | null;
    /** DEV: the village's ground triangles (world space), for probes. */
    __cvCreekGround?: () => GroundSource[];
  }
}

export interface CreekStats {
  stones: number;
  pebbles: number;
  reeds: number;
  stepping: { x: number; z: number; top: number }[];
  triangles: number;
  meshes: number;
  buildMs: number;
}

/** `?creek=old` (DEV) keeps the village's own creek, for the before/after pictures. */
export function creekMode(search: string, dev: boolean): "new" | "old" {
  return dev && new URLSearchParams(search).get("creek") === "old" ? "old" : "new";
}

const WATER_NAME = /^village_water_(00|01|02|12|22|32|-12)$/;

function isMeshObj(o: Object3D): o is Mesh {
  return (o as Mesh).isMesh === true && !(o as { isInstancedMesh?: boolean }).isInstancedMesh;
}

const matName = (m: Material | Material[]): string => (Array.isArray(m) ? m[0]?.name ?? "" : m.name);

/** The village model's ground triangles in world space (every non-instanced `LM_grass` mesh). */
export function groundSources(root: Object3D): GroundSource[] {
  const out: GroundSource[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!isMeshObj(o) || matName(o.material) !== "LM_grass") return;
    const pos = o.geometry.getAttribute("position");
    const ind = o.geometry.getIndex();
    const arr = new Float32Array(pos.count * 3);
    const v = { x: 0, y: 0, z: 0 };
    const e = o.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) {
      v.x = pos.getX(i);
      v.y = pos.getY(i);
      v.z = pos.getZ(i);
      arr[i * 3] = e[0]! * v.x + e[4]! * v.y + e[8]! * v.z + e[12]!;
      arr[i * 3 + 1] = e[1]! * v.x + e[5]! * v.y + e[9]! * v.z + e[13]!;
      arr[i * 3 + 2] = e[2]! * v.x + e[6]! * v.y + e[10]! * v.z + e[14]!;
    }
    out.push({ position: arr, index: ind ? (ind.array as ArrayLike<number>) : null });
  });
  return out;
}

/**
 * Where the feeder stream (from the falls, running south) meets the creek (running east), the baked ground leaves a hill and a
 * ridge between them (the model's terrain is 10 m cells out there), so the creek ended in a round cap a few metres from the
 * feeder's blunt end. Two ground vertices are lowered into the channel so the two join in a corner. The loader's geometry is
 * shared, so the mesh gets its own copy (the undo puts the original back).
 */
const JUNCTION_VERTICES: readonly { x: number; z: number; y: number }[] = [];

export function carveJunction(root: Object3D, own: { dispose(): void }[], undo: (() => void)[]): void {
  root.traverse((o) => {
    if (!isMeshObj(o) || matName(o.material) !== "LM_grass") return;
    const old = o.geometry;
    const pos = old.getAttribute("position");
    let hit = false;
    for (let i = 0; i < pos.count && !hit; i++) {
      for (const v of JUNCTION_VERTICES) if (Math.abs(pos.getX(i) - v.x) < 1 && Math.abs(pos.getZ(i) - v.z) < 1) hit = true;
    }
    if (!hit) return;
    const g = old.clone();
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      for (const v of JUNCTION_VERTICES) if (Math.abs(p.getX(i) - v.x) < 1 && Math.abs(p.getZ(i) - v.z) < 1) p.setY(i, v.y);
    }
    p.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    o.geometry = g;
    own.push(g);
    undo.push(() => {
      o.geometry = old;
    });
  });
}

function triCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute("position").count / 3;
}

interface Built {
  group: Group;
  update(time: number): void;
  stats: CreekStats;
  dispose(): void;
}

function build(root: Object3D, nodes: VillageNodes, tier: VillageTier, sets: { gravel: PbrSet; dirt: PbrSet; rock: PbrSet }): Built {
  const t0 = performance.now();
  const low = tier === "low";
  const own: { dispose(): void }[] = [];
  const undo: (() => void)[] = [];
  const group = new Group();
  group.name = "creek_patch";

  // the ground, read back from the model
  const sources = groundSources(root);
  const grid: CreekGrid = newGrid();
  for (const s of sources) rasterGround(grid, s);
  fillHoles(grid);

  // what goes where
  const foam = newFoam();
  const plan = planCreek(grid, { low, foam, slabs: VILLAGE_LAYOUT.backdrop.waterfall.slabs });
  const map = new DataTexture(mapBytes(grid, foam), CREEK_W, CREEK_H, RGFormat, UnsignedByteType);
  map.colorSpace = NoColorSpace;
  map.magFilter = LinearFilter;
  map.minFilter = LinearFilter;
  map.wrapS = map.wrapT = ClampToEdgeWrapping;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  own.push(map);
  const noise = makeFountainNoise();
  own.push(noise);

  // the water: the creek's pieces get the depth-aware material and a reshaped geometry
  let creekWater: ShaderMaterial | null = null;
  const base = nodes.water;
  if (base) {
    creekWater = createDepthWater(base, { map, rect: CREEK_RECT, noise, range: [BED_MIN, BED_MAX], detail: tier === "high" });
    own.push(creekWater);
    root.traverse((o) => {
      if (!isMeshObj(o) || !WATER_NAME.test(o.name)) return;
      const old = o.geometry;
      const reshaped = reshapeWater(old, grid);
      const oldMat = o.material;
      o.geometry = reshaped;
      o.material = creekWater!;
      own.push(reshaped);
      undo.push(() => {
        o.geometry = old;
        o.material = oldMat;
      });
    });
  }

  // the old low-poly creek rocks
  root.traverse((o) => {
    if (!isMeshObj(o) || matName(o.material) !== "LM_rock") return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox!;
    if (b.min.z > 55 && b.max.z < 95 && o.visible) {
      o.visible = false;
      undo.push(() => {
        o.visible = true;
      });
    }
  });

  let triangles = 0;
  let meshes = 0;
  const shared = { noise: groundGrainTexture() };

  // bank and bed
  const bankG = bankGeometry(sources);
  if (bankG) {
    const m = bankMaterial(sets.gravel, sets.dirt, shared, low);
    const mesh = new Mesh(bankG, m);
    mesh.name = "creek_bank";
    mesh.renderOrder = -1; // under the water (0): the surface is drawn over the bed
    mesh.frustumCulled = false;
    group.add(mesh);
    own.push(bankG, m);
    triangles += triCount(bankG);
    meshes++;
  }

  // stones and pebbles: one geometry, one draw
  const stoneG = mergeStones([...plan.stones, ...plan.pebbles]);
  if (stoneG) {
    const m = rockMaterial(sets.rock, shared);
    const mesh = new Mesh(stoneG, m);
    mesh.name = "creek_stones";
    mesh.frustumCulled = false;
    group.add(mesh);
    own.push(stoneG, m);
    triangles += triCount(stoneG);
    meshes++;
  }

  // reeds
  const reedG = reedGeometry(plan.reeds);
  if (reedG) {
    const m = reedMaterial();
    const mesh = new Mesh(reedG, m);
    mesh.name = "creek_reeds";
    mesh.frustumCulled = false;
    group.add(mesh);
    own.push(reedG, m);
    triangles += triCount(reedG);
    meshes++;
  }

  // the cascades' sheets
  const sheets: ShaderMaterial[] = [];
  CASCADES.forEach((c, i) => {
    const shore = shoreAt(grid, c.x - 0.4, c.upY);
    const g = sheetGeometry(i, shore.north - 0.1, shore.south + 0.1);
    const m = sheetMaterial(noise);
    m.uniforms.uWidth!.value = shore.south - shore.north + 0.2;
    if (base) m.uniforms.uTint = base.uniforms.uTint!;
    const mesh = new Mesh(g, m);
    mesh.name = `creek_sheet_${i}`;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    group.add(mesh);
    own.push(g, m);
    sheets.push(m);
    triangles += triCount(g);
    meshes++;
  });

  const stats: CreekStats = {
    stones: plan.stones.length,
    pebbles: plan.pebbles.length,
    reeds: plan.reeds.length,
    stepping: plan.stepping,
    triangles,
    meshes,
    buildMs: performance.now() - t0,
  };
  return {
    group,
    stats,
    update(time) {
      if (creekWater) creekWater.uniforms.uTime!.value = time;
      for (const s of sheets) s.uniforms.uTime!.value = time;
      reedUniforms.uCkTime.value = time;
    },
    dispose() {
      for (const u of undo) u();
      for (const d of own) d.dispose();
    },
  };
}

/**
 * The village's creek, redone at run time (owner 2026-11-18, "여기가 너무 허접해"): depth-tinted see-through water with a real
 * shoreline, wet banks and a pebble bed over the carved ground, river stones (stepping stones, boulders, a stone sill at each
 * cascade) with wet bases and foam collars, a falling sheet with churn at each cascade, and reed clumps. The village model is
 * untouched on disk; this swaps the creek's water and rocks in the clone and adds the rest.
 */
export function CreekPatch({ nodes, tier }: { nodes: VillageNodes; tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  const [built, setBuilt] = useState<Built | null>(null);
  const hiddenSlabs = useRef(false);
  useEffect(() => {
    if (import.meta.env.DEV) window.__cvCreekGround = () => groundSources(nodes.root);
    if (creekMode(window.location.search, import.meta.env.DEV) === "old") return;
    let dead = false;
    let made: Built | null = null;
    const pbr = tier === "high" ? "2k" : "1k";
    void Promise.all([getPbrSet("gravel", pbr, gl), getPbrSet("dirt_path", pbr, gl), getPbrSet("rock", pbr, gl)])
      .then(([gravel, dirt, rock]) => {
        if (dead) return;
        made = build(nodes.root, nodes, tier, { gravel, dirt, rock });
        setBuilt(made);
        if (import.meta.env.DEV) window.__cvCreek = () => made?.stats ?? null;
      })
      .catch((e: unknown) => console.error("[creek] build failed", e));
    return () => {
      dead = true;
      if (import.meta.env.DEV) delete window.__cvCreek;
      made?.dispose();
      setBuilt(null);
    };
  }, [nodes, tier, gl]);
  // The creek's programs (water, bank, stones, reeds, sheets) compile as soon as it is built, off the main thread, not at the first
  // glance at it: a program compiled on first sight left the water missing for a second (seen in the e2e look script).
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!built) return;
    let off = false;
    void gl.compileAsync(scene, camera).catch(() => {
      if (!off) console.warn("[creek] precompile failed");
    });
    return () => {
      off = true;
    };
  }, [built, gl, scene, camera]);
  // The falls' own flat slabs (waterfall.glb, M_falls_slab) are replaced by the stones drawn here; the model loads late, so look until found.
  useEffect(() => {
    hiddenSlabs.current = false;
  }, [built]);
  useFrame(({ clock, scene: sc }, _dt) => {
    if (!built) return;
    built.update(clock.elapsedTime);
    if (hiddenSlabs.current || Math.floor(clock.elapsedTime * 2) % 4 !== 0) return;
    sc.traverse((o) => {
      if (isMeshObj(o) && matName(o.material) === "M_falls_slab" && o.visible) {
        o.visible = false;
        hiddenSlabs.current = true;
      }
    });
  });
  return built ? <primitive object={built.group} dispose={null} /> : null;
}
