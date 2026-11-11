import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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
import { holdNightLightmap, noteBusRequested, noteNightRequested, noteVillageRequested } from "./villageRelease";
import { preloadBus } from "./villageBusLoader";
import { createVegetation, vegModeFrom, type VegStats, type VillageVegetation } from "./veg/villageVegetation";

declare global {
  interface Window {
    /** Dev-only: the dressed village model (VillageModel). Absent in production builds. */
    __cvVillage?: () => VillageNodes;
    /** Dev-only: the 3D vegetation's numbers (veg3d: mode, instances per level, triangles, draw calls), or null (`?veg=old`). */
    __cvVeg?: () => VegStats | null;
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
  // The files download at once: the light map's and the bus's requests start before the model's read suspends this
  // component (the bus, beside it, is read in a Suspense of its own: usually in when the village is, never waited for).
  useTexture.preload(VILLAGE_LIGHTMAP_URL);
  noteBusRequested();
  preloadBus();
  const gltf = useGLTF(VILLAGE_MODEL_URL, DRACO_PATH);
  const lightmap = useTexture(VILLAGE_LIGHTMAP_URL);
  const gl = useThree((s) => s.gl);
  const nodes = useMemo(
    // A texture already on the GPU (a rich-to-light switch mid-visit) is never capped: its storage is immutable.
    () =>
      prepareVillage(
        gltf.scene,
        lightmap,
        tier,
        LIGHTING.village.toneCurve,
        undefined,
        (t) => gl.properties.has(t),
        gl.capabilities.getMaxAnisotropy(),
      ),
    [gltf, lightmap, tier, gl],
  );
  // The 3D flowers and cherry crowns (veg3d), built in steps after the village is up; once ready they hide the old
  // cards in this clone (`?veg=old` in DEV keeps them). Disposing gives the clone its cards back.
  const [veg, setVeg] = useState<VillageVegetation | null>(null);
  useEffect(() => {
    let cancelled = false;
    let built: VillageVegetation | null = null;
    void createVegetation(nodes.root, tier, vegModeFrom(window.location.search, import.meta.env.DEV), () => cancelled).then((v) => {
      if (!v) return;
      if (cancelled) v.dispose();
      else {
        built = v;
        setVeg(v);
      }
    });
    if (import.meta.env.DEV) window.__cvVeg = () => built?.stats() ?? null;
    return () => {
      cancelled = true;
      if (import.meta.env.DEV) delete window.__cvVeg;
      built?.dispose();
      setVeg(null);
    };
  }, [nodes, tier]);
  const night = useNightMapWanted();
  useEffect(() => {
    // Dev/E2E probe: the dressed model (draw-call and material checks). Tree-shaken in production.
    if (import.meta.env.DEV) window.__cvVillage = () => nodes;
    return () => {
      if (import.meta.env.DEV) delete window.__cvVillage;
      disposeVillage(nodes);
    };
  }, [nodes]);
  useFrame(({ clock, gl, camera }) => {
    tickVillage(nodes, clock.elapsedTime, gl.toneMappingExposure);
    applyDayNight(nodes, dayNight.applied);
    veg?.update(camera, clock.elapsedTime);
  });
  // dispose={null}: the geometry and shared materials belong to the loader's cache.
  return (
    <>
      <primitive object={nodes.root} dispose={null} />
      {veg && <primitive object={veg.group} dispose={null} />}
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
