import { compileSafely } from "../../game/compileSafely";
import { useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Mesh } from "three";
import { getPbrSet } from "../pbr/pbrLibrary";
import { groundGrainTexture } from "../groundDetail";
import { mergeStones, mulberry32, type StoneSpec } from "../creek/creekStones";
import { reedGeometry } from "../creek/creekReeds";
import { reedMaterial, reedUniforms, rockMaterial } from "../creek/creekMaterials";
import type { ReedClump } from "../creek/creekPlan";
import type { VillageTier } from "../villageModelPrep";

/**
 * Where the falls' pool outlet (waterfall.glb: a V-shaped trough ending at z -58) meets the village's feeder stream (a carved channel with
 * banks): the two grounds do not match, and there was a straight cut. The water thins out and in over the last and first metres
 * (fallsMaterials OUTLET_END, villageWater CREEK); this lays a natural riffle over the join: a sill of river stones from bank to bank,
 * pebbles below it, reed and sedge clumps on both sides. One draw for the stones, one for the reeds; built once at load.
 */

const SEAM_Z = -58.9;
const CENTRE_X = -107.1;
const WATER_Y = -0.3;

function plan(low: boolean): { stones: StoneSpec[]; reeds: ReedClump[] } {
  const rnd = mulberry32(2718);
  const stones: StoneSpec[] = [];
  const reeds: ReedClump[] = [];
  // the sill: big flat-topped stones side by side, a few round ones, standing a hand over the water
  const n = low ? 8 : 12;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const x = CENTRE_X + t * 6.4 + (rnd() - 0.5) * 0.3;
    const z = SEAM_Z + (rnd() - 0.5) * 0.9;
    const big = rnd() < 0.55;
    const r = big ? 0.5 + rnd() * 0.3 : 0.3 + rnd() * 0.2;
    stones.push({ x, z, top: WATER_Y + 0.05 + rnd() * 0.16, rx: r * (1.1 + rnd() * 0.5), rz: r * (0.8 + rnd() * 0.4), depth: 0.7, yaw: rnd() * 3.14, flat: big ? 0.7 : 0.2, seed: 2000 + i, tone: 0.8 + rnd() * 0.35, detail: low ? 3 : 4 });
  }
  // pebbles in the run below the sill
  const np = low ? 10 : 26;
  for (let i = 0; i < np; i++) {
    const r = 0.06 + rnd() * rnd() * 0.16;
    stones.push({ x: CENTRE_X + (rnd() - 0.5) * 5.4, z: SEAM_Z + 0.5 + rnd() * 2.6, top: WATER_Y - 0.02 + r * 0.3, rx: r * (1 + rnd() * 0.5), rz: r * (1 + rnd() * 0.4), depth: r * 1.2, yaw: rnd() * 6.28, flat: rnd() * 0.4, seed: 2100 + i, tone: 0.75 + rnd() * 0.5, detail: 2 });
  }
  // reeds and sedge on both banks
  const nr = low ? 7 : 14;
  for (let i = 0; i < nr; i++) {
    const side = i % 2 ? 1 : -1;
    reeds.push({ x: CENTRE_X + side * (3.1 + rnd() * 1.3), y: WATER_Y - 0.05, z: SEAM_Z + (rnd() - 0.5) * 3.2, h: 0.9 + rnd() * 0.9, seed: 2200 + i, sedge: rnd() < 0.45 ? 1 : 0 });
  }
  return { stones, reeds };
}

export function FallsSeam({ tier }: { tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [group, setGroup] = useState<Group | null>(null);
  useEffect(() => {
    let dead = false;
    let made: { group: Group; dispose(): void } | null = null;
    void getPbrSet("rock", tier === "high" ? "2k" : "1k", gl)
      .then((rock) => {
        if (dead) return;
        const low = tier === "low";
        const p = plan(low);
        const g = new Group();
        g.name = "falls_seam";
        const own: { dispose(): void }[] = [];
        const sg = mergeStones(p.stones);
        if (sg) {
          const m = rockMaterial(rock, { noise: groundGrainTexture() });
          const mesh = new Mesh(sg, m);
          mesh.name = "falls_seam_stones";
          mesh.frustumCulled = false;
          g.add(mesh);
          own.push(sg, m);
        }
        const rg = reedGeometry(p.reeds);
        if (rg) {
          const m = reedMaterial();
          const mesh = new Mesh(rg, m);
          mesh.name = "falls_seam_reeds";
          mesh.frustumCulled = false;
          g.add(mesh);
          own.push(rg, m);
        }
        made = { group: g, dispose: () => own.forEach((d) => d.dispose()) };
        setGroup(g);
      })
      .catch((e: unknown) => console.error("[falls seam] build failed", e));
    return () => {
      dead = true;
      made?.dispose();
      setGroup(null);
    };
  }, [tier, gl]);
  useEffect(() => {
    if (!group) return;
    void compileSafely(gl, scene, camera).catch(() => console.warn("[falls seam] precompile failed"));
  }, [group, gl, scene, camera]);
  useFrame(({ clock }) => {
    if (group) reedUniforms.uCkTime.value = clock.elapsedTime;
  });
  return group ? <primitive object={group} dispose={null} /> : null;
}
