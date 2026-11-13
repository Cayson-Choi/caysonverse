import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { type BusNodes, applyBusDayNight, disposeBus, prepareBus, setBusAnisotropy } from "./villageBusPrep";
import { readBus } from "./villageBusLoader";
import { dayNight } from "./dayNightDriver";
import type { VillageTier } from "./villageModelPrep";
import { noteBusRequested } from "./villageRelease";
import { getTransitRenderPose, stepTransitRender } from "../net/transitSync";

declare global {
  interface Window {
    /** Dev-only: the dressed village bus (VillageBus). Absent in production builds. */
    __cvBus?: () => BusNodes;
  }
}

/**
 * The village bus parked at the stop (villageBusPrep.ts): reads `village_bus.glb` (Draco, ~0.35 MB, 4 draw calls; its
 * download starts beside the village model's, villageBusLoader.ts) and dresses a clone of it for the tier. It suspends
 * in a Suspense of its own inside the village's (VillageScene): the village never waits for it, and a bus that is slow,
 * stalled or failed is simply not there. The time of day and the renderer's exposure are written into its materials
 * every frame (number writes only). Its textures get a modest anisotropic filter (setBusAnisotropy). The file is
 * released with the village's (villageRelease.ts).
 */
export function VillageBus({ tier }: { tier: VillageTier }) {
  noteBusRequested();
  const gltf = readBus();
  const gl = useThree((s) => s.gl);
  const nodes = useMemo(() => {
    const n = prepareBus(gltf.scene, tier);
    setBusAnisotropy(n, gl.capabilities.getMaxAnisotropy());
    // prepareBus freezes every node's local matrix for the static parked model.
    // The root alone is made dynamic so the server-scheduled route can move the
    // complete bus without rebuilding materials or child matrices.
    n.root.matrixAutoUpdate = true;
    // prepareBus switched every node's world-matrix update off: without it only the root moved on paper and the
    // meshes stayed drawn at the stop. The children's local matrices stay frozen; their world matrices follow the root.
    n.root.traverse((o) => {
      o.matrixWorldAutoUpdate = true;
    });
    return n;
  }, [gltf, tier, gl]);
  useEffect(() => {
    // Dev/E2E probe: the dressed bus (its materials and placement). Tree-shaken in production.
    if (import.meta.env.DEV) window.__cvBus = () => nodes;
    return () => {
      if (import.meta.env.DEV) delete window.__cvBus;
      disposeBus(nodes);
    };
  }, [nodes]);
  useFrame((state, delta) => {
    stepTransitRender(delta);
    const pose = getTransitRenderPose();
    nodes.root.position.set(pose.x, 0, pose.z);
    // the model is built nose north (-z) and the pose's yaw is the heading (0 faces +z): half a turn between them
    nodes.root.rotation.set(0, pose.yaw + Math.PI, 0);
    nodes.root.updateMatrixWorld(true);
    applyBusDayNight(nodes, dayNight.applied, state.gl.toneMappingExposure);
  });
  // dispose={null}: the geometry and the loader's materials belong to the loader's cache.
  return <primitive object={nodes.root} dispose={null} />;
}
