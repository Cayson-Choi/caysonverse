import { compileSafely } from "../game/compileSafely";
import { useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Mesh, type BufferGeometry, type Object3D } from "three";
import { LAKE_SHORE, LAKE_WATER_Y } from "@caysonverse/shared/village/lakeLayout";
import { compileSafely } from "../game/compileSafely";
import { getPbrSet } from "../village/pbr/pbrLibrary";
import { groundGrainTexture } from "../village/groundDetail";
import { bankGeometry } from "../village/creek/creekGeometry";
import { bankMaterial, reedMaterial, reedUniforms } from "../village/creek/creekMaterials";
import { reedGeometry } from "../village/creek/creekReeds";
import { bedTexture, fillBedHoles, groundSourcesOf, newBedGrid, rasterBed, type BedRect } from "../village/waterBed";
import { plantGeometry, plantMaterial } from "../village/waterPlants";
import type { VillageTier } from "../village/villageModelPrep";
import type { LakeWater } from "./lakeWater";
import { planLakeShore } from "./lakeShorePlan";

/**
 * The fishing lake's shoreline and shallows (owner 2026-11-18, "물과 땅이 안 섞여"): lake.glb's ground is baked, so this reads it back
 * and dresses it at run time with the pieces the creek already has:
 *  - the bed's height map (waterBed.ts): the lake water's real depth (clear brown-green shallows over the bed, deeper in the middle, a
 *    soft waterline), through `water.setBed`;
 *  - the bank overlay: wet earth and gravel over the mud bank and the bed (the creek's bank material, one water level), fading up into
 *    the lawn so no brown wall stands between the grass and the water;
 *  - reed and sedge clumps in the shallows of the bays, and lily pads with a few white flowers.
 * Three extra draws (bank, reeds, pads), built once; the village model on disk is untouched.
 */

/** The map covers the shoreline's box and a margin (the bank above the waterline). */
function lakeRect(): BedRect {
  const xs = LAKE_SHORE.map((p) => p.x);
  const zs = LAKE_SHORE.map((p) => p.z);
  return { x0: Math.min(...xs) - 3, x1: Math.max(...xs) + 3, z0: Math.min(...zs) - 3, z1: Math.max(...zs) + 3 };
}
/** The bed height range the map's red channel spans (the lake's floor is at about -3.6). */
const BED_RANGE: readonly [number, number] = [-4, 1];

export interface LakeShoreStats {
  reeds: number;
  pads: number;
  flowers: number;
  bankTriangles: number;
  buildMs: number;
}

declare global {
  interface Window {
    /** DEV: what the lake's shore dressing built; null until it is up. */
    __cvLakeShore?: () => LakeShoreStats | null;
  }
}

interface Built {
  group: Group;
  stats: LakeShoreStats;
  dispose(): void;
}

const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

function build(terrain: Object3D, water: LakeWater, tier: VillageTier, sets: { gravel: Parameters<typeof bankMaterial>[0]; dirt: Parameters<typeof bankMaterial>[1] }): Built {
  const t0 = performance.now();
  const low = tier === "low";
  const own: { dispose(): void }[] = [];
  const group = new Group();
  group.name = "lake_shore";

  // the bed: every baked ground triangle of the lake, the highest surface of each texel
  const rect = lakeRect();
  const grid = newBedGrid(rect, low ? 0.33 : 0.25);
  for (const s of groundSourcesOf(terrain, (n) => n.startsWith("LM_"))) rasterBed(grid, s);
  fillBedHoles(grid);
  const map = bedTexture(grid, BED_RANGE);
  own.push(map);
  water.setBed({ texture: map, rect, range: BED_RANGE });

  const inRect = (x: number, z: number): boolean => x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1;
  let bankTris = 0;
  const bankSources = groundSourcesOf(terrain, (n) => n === "LM_mud" || n === "LM_gravel");
  const bankG = bankGeometry(bankSources, inRect);
  if (bankG) {
    const m = bankMaterial(sets.gravel, sets.dirt, { noise: groundGrainTexture() }, low, { level: LAKE_WATER_Y - 0.05, fade: [0.54, 0.72], gravel: [0.05, 0.3], tint: [1.12, 0.98, 0.74] });
    const mesh = new Mesh(bankG, m);
    mesh.name = "lake_bank";
    mesh.renderOrder = -1; // under the water (2): the surface is drawn over the bed
    mesh.frustumCulled = false;
    group.add(mesh);
    own.push(bankG, m);
    bankTris = tris(bankG);
  }

  const plan = planLakeShore(grid, low);
  const reedG = reedGeometry(plan.reeds);
  if (reedG) {
    const m = reedMaterial();
    const mesh = new Mesh(reedG, m);
    mesh.name = "lake_reeds";
    mesh.frustumCulled = false;
    group.add(mesh);
    own.push(reedG, m);
  }
  const plantG = plantGeometry(plan.leaves, plan.flowers);
  if (plantG) {
    const m = plantMaterial("lake_pads");
    const mesh = new Mesh(plantG, m);
    mesh.name = "lake_pads";
    mesh.frustumCulled = false;
    mesh.renderOrder = 3; // over the water (2)
    group.add(mesh);
    own.push(plantG, m);
  }
  return {
    group,
    stats: { reeds: plan.reeds.length, pads: plan.leaves.length, flowers: plan.flowers.length, bankTriangles: bankTris, buildMs: performance.now() - t0 },
    dispose() {
      water.setBed(null);
      for (const d of own) d.dispose();
    },
  };
}

export function LakeShore({ terrain, water, tier }: { terrain: Object3D; water: LakeWater; tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [built, setBuilt] = useState<Built | null>(null);
  useEffect(() => {
    // DEV: window.__cvLakeShoreOff = true (set before the page loads) leaves the lake without this dressing, for the perf comparison
    if (import.meta.env.DEV && (window as unknown as { __cvLakeShoreOff?: boolean }).__cvLakeShoreOff) return;
    let dead = false;
    let made: Built | null = null;
    const pbr = tier === "high" ? "2k" : "1k";
    void Promise.all([getPbrSet("gravel", pbr, gl), getPbrSet("dirt_path", pbr, gl)])
      .then(([gravel, dirt]) => {
        if (dead) return;
        made = build(terrain, water, tier, { gravel, dirt });
        setBuilt(made);
        if (import.meta.env.DEV) window.__cvLakeShore = () => made?.stats ?? null;
      })
      .catch((e: unknown) => console.error("[lake] shore build failed", e));
    return () => {
      dead = true;
      if (import.meta.env.DEV) delete window.__cvLakeShore;
      made?.dispose();
      setBuilt(null);
    };
  }, [terrain, water, tier, gl]);
  // the new programs (bank, reeds, pads) compile off the main thread as soon as they exist, not at the first glance at them
  useEffect(() => {
    if (!built) return;
    let off = false;
    void compileSafely(gl, scene, camera).catch(() => {
      if (!off) console.warn("[lake] precompile failed");
    });
    return () => {
      off = true;
    };
  }, [built, gl, scene, camera]);
  useFrame(({ clock }) => {
    if (built) reedUniforms.uCkTime.value = clock.elapsedTime;
  });
  return built ? <primitive object={built.group} dispose={null} /> : null;
}
