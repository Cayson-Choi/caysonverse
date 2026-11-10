import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { BUS_MODEL_URL, type BusNodes, applyBusDayNight, disposeBus, prepareBus } from "./villageBusPrep";
import { dayNight } from "./dayNightDriver";
import type { VillageTier } from "./villageModelPrep";
import { noteBusRequested } from "./villageRelease";

declare global {
  interface Window {
    /** Dev-only: the dressed village bus (VillageBus). Absent in production builds. */
    __cvBus?: () => BusNodes;
  }
}

/**
 * The village bus parked at the stop (villageBusPrep.ts): loads `village_bus.glb` (Draco, ~0.35 MB, 4 draw calls) beside the village
 * model — inside the village's Suspense, so both arrive and are warmed up together — and dresses a clone of it for the
 * tier. The time of day is written into its materials every frame (number writes only). The file is released with the
 * village's (villageRelease.ts).
 */
export function VillageBus({ tier }: { tier: VillageTier }) {
  noteBusRequested();
  const gltf = useGLTF(BUS_MODEL_URL, DRACO_PATH);
  const nodes = useMemo(() => prepareBus(gltf.scene, tier), [gltf, tier]);
  useEffect(() => {
    // Dev/E2E probe: the dressed bus (its materials and placement). Tree-shaken in production.
    if (import.meta.env.DEV) window.__cvBus = () => nodes;
    return () => {
      if (import.meta.env.DEV) delete window.__cvBus;
      disposeBus(nodes);
    };
  }, [nodes]);
  useFrame(() => applyBusDayNight(nodes, dayNight.applied));
  // dispose={null}: the geometry and the loader's materials belong to the loader's cache.
  return <primitive object={nodes.root} dispose={null} />;
}
