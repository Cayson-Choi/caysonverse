import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { LIGHTING } from "../game/sceneLighting";
import {
  type VillageNodes,
  VILLAGE_LIGHTMAP_URL,
  VILLAGE_MODEL_URL,
  disposeVillage,
  prepareVillage,
  tickVillage,
  type VillageTier,
} from "./villageModelPrep";

declare global {
  interface Window {
    /** Dev-only: the dressed village model (VillageModel). Absent in production builds. */
    __cvVillage?: () => VillageNodes;
  }
}

/**
 * 케이슨 마을's model in the scene (Task 7): loads `village.glb` (Draco, decoder at /draco/, GPU instances) and its
 * light map, dresses a clone of it for the graphics tier (villageModelPrep.ts: light map, sky dome, water, falls,
 * glowing plot outlines, hidden `col__*` boxes) and renders it. The water's clock, the falls' slide and the dome's
 * exposure move every frame (number writes only).
 *
 * Read (suspends) only when the village area mounts: the entry screen never loads it. The loader's cache keeps the
 * parsed model while the player is in the memorial hall, so coming back out is instant; this clone's own
 * materials are released with the component.
 */
export function VillageModel({ tier }: { tier: VillageTier }) {
  // Both files download at once: the light map's request starts before the model's read suspends this component.
  useTexture.preload(VILLAGE_LIGHTMAP_URL);
  const gltf = useGLTF(VILLAGE_MODEL_URL, DRACO_PATH);
  const lightmap = useTexture(VILLAGE_LIGHTMAP_URL);
  const nodes = useMemo(() => prepareVillage(gltf.scene, lightmap, tier, LIGHTING.village.toneCurve), [gltf, lightmap, tier]);
  useEffect(() => {
    // Dev/E2E probe: the dressed model (draw-call and material checks). Tree-shaken in production.
    if (import.meta.env.DEV) window.__cvVillage = () => nodes;
    return () => {
      if (import.meta.env.DEV) delete window.__cvVillage;
      disposeVillage(nodes);
    };
  }, [nodes]);
  useFrame(({ clock, gl }) => tickVillage(nodes, clock.elapsedTime, gl.toneMappingExposure));
  // dispose={null}: the geometry and shared materials belong to the loader's cache.
  return <primitive object={nodes.root} dispose={null} />;
}
