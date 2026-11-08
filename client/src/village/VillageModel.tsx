import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { LIGHTING } from "../game/sceneLighting";
import {
  type VillageNodes,
  VILLAGE_LIGHTMAP_URL,
  VILLAGE_MODEL_URL,
  VILLAGE_NIGHT_LIGHTMAP_URL,
  applyDayNight,
  disposeVillage,
  prepareVillage,
  tickVillage,
  type VillageTier,
} from "./villageModelPrep";
import { dayNight } from "./dayNightDriver";
import { noteVillageLoaded } from "./villageRelease";

declare global {
  interface Window {
    /** Dev-only: the dressed village model (VillageModel). Absent in production builds. */
    __cvVillage?: () => VillageNodes;
  }
}

/**
 * 케이슨 마을's model in the scene (Task 7): loads `village.glb` (Draco, decoder at /draco/, GPU instances) and its
 * light map, dresses a clone of it for the graphics tier (villageModelPrep.ts: light map, sky dome, water, falls,
 * glowing plot outlines, hidden `col__*` boxes) and renders it. The water's clock, the falls' slide, the dome's
 * exposure and the time of day (Task 7A: the light maps' day/night blend, the lit windows and lamps, the tints; the
 * driver is stepped by DayNight.tsx) move every frame (number writes only).
 *
 * Read (suspends) only when the village area mounts: the entry screen never loads it. The loader's cache keeps the
 * parsed model while the player is in the memorial hall, so coming back out is instant; this clone's own
 * materials and instance buffers are released with the component. The files themselves go when the village scene
 * does (villageRelease.ts, held by VillageScene).
 */
export function VillageModel({ tier }: { tier: VillageTier }) {
  // All the files download at once: the light maps' requests start before the model's read suspends this component.
  useTexture.preload([VILLAGE_LIGHTMAP_URL, VILLAGE_NIGHT_LIGHTMAP_URL]);
  const gltf = useGLTF(VILLAGE_MODEL_URL, DRACO_PATH);
  const [lightmap, nightLightmap] = useTexture([VILLAGE_LIGHTMAP_URL, VILLAGE_NIGHT_LIGHTMAP_URL]);
  const nodes = useMemo(
    () => prepareVillage(gltf.scene, lightmap, tier, LIGHTING.village.toneCurve, nightLightmap),
    [gltf, lightmap, nightLightmap, tier],
  );
  useEffect(() => noteVillageLoaded(gltf.scene, [lightmap, nightLightmap]), [gltf, lightmap, nightLightmap]);
  useEffect(() => {
    // Dev/E2E probe: the dressed model (draw-call and material checks). Tree-shaken in production.
    if (import.meta.env.DEV) window.__cvVillage = () => nodes;
    return () => {
      if (import.meta.env.DEV) delete window.__cvVillage;
      disposeVillage(nodes);
    };
  }, [nodes]);
  useFrame(({ clock, gl }) => {
    tickVillage(nodes, clock.elapsedTime, gl.toneMappingExposure);
    applyDayNight(nodes, dayNight.applied);
  });
  // dispose={null}: the geometry and shared materials belong to the loader's cache.
  return <primitive object={nodes.root} dispose={null} />;
}
