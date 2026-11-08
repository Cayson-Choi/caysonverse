import { Suspense, useEffect, useLayoutEffect, useMemo } from "react";
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
  nightMapUniform,
  prepareVillage,
  setNightLightmap,
  tickVillage,
  type VillageTier,
} from "./villageModelPrep";
import { dayNight } from "./dayNightDriver";
import { useNightMapWanted } from "./nightLightmap";
import { holdNightLightmap, noteNightRequested, noteVillageRequested } from "./villageRelease";

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
 * parsed model while the player is in the memorial hall (rich tier; the light tier lets it go there), so coming back
 * out is instant; this clone's own materials and instance buffers are released with the component. The files
 * themselves go when the village scene lets go of them (villageRelease.ts, held by VillageScene).
 *
 * The night light map loads on its own, only when night is near (nightLightmap.ts, final fix I2b): `NightLightmap`
 * suspends inside its own boundary, so the village never waits for it; until it is there the day map shows alone.
 */
export function VillageModel({ tier }: { tier: VillageTier }) {
  // A release from now on must free what this reads, even if it is still loading (villageRelease.ts).
  noteVillageRequested();
  // Both files download at once: the light map's request starts before the model's read suspends this component.
  useTexture.preload(VILLAGE_LIGHTMAP_URL);
  const gltf = useGLTF(VILLAGE_MODEL_URL, DRACO_PATH);
  const lightmap = useTexture(VILLAGE_LIGHTMAP_URL);
  const nodes = useMemo(
    () => prepareVillage(gltf.scene, lightmap, tier, LIGHTING.village.toneCurve),
    [gltf, lightmap, tier],
  );
  const night = useNightMapWanted();
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
  return (
    <>
      <primitive object={nodes.root} dispose={null} />
      {night && (
        <Suspense fallback={null}>
          <NightLightmap />
        </Suspense>
      )}
    </>
  );
}

/** Loads the night light map and lays it on the model while mounted; its release frees it (villageRelease.ts). */
function NightLightmap() {
  useEffect(() => holdNightLightmap(), []);
  noteNightRequested();
  const texture = useTexture(VILLAGE_NIGHT_LIGHTMAP_URL);
  useLayoutEffect(() => {
    setNightLightmap(texture);
    return () => {
      if (nightMapUniform.value === texture) setNightLightmap(null);
    };
  }, [texture]);
  return null;
}
