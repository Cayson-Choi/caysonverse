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
import { createVegetation, hideLegacyVegetationSources, vegModeFrom, vegetationPark, type VegStats, type VillageVegetation } from "./veg/villageVegetation";
import { vegDressing } from "./vegDressing";
import { createWaterfall3D, hideWaterfallCards, type Waterfall3D } from "./waterfall3d";
import type { Object3D } from "three";
import type { DrawnGap } from "./veg/drawnGap";

declare global {
  interface Window {
    /** Dev-only: the dressed village model (VillageModel). Absent in production builds. */
    __cvVillage?: () => VillageNodes;
    /** Dev-only: the 3D vegetation's numbers (veg3d: mode, instances per level, triangles, draw calls), or null (`?veg=old`). */
    __cvVeg?: () => VegStats | null;
    /** Dev-only: every leaf spray's and blossom bunch's gap to the drawn twigs and bark (slow: checks only). */
    __cvVegDrawn?: () => DrawnGap | null;
    /** Dev-only: whether a point is inside the follow camera's keep-out of the trees' bark (null: no vegetation). */
    __cvVegKeepOut?: (x: number, y: number, z: number) => boolean | null;
  }
}

/**
 * The plaza fountain's water: the runtime water (fountainWater.ts), or the model's own with the DEV address flag
 * `?water=old` (for comparing the two). Production builds always draw the new water.
 */
function fountainMode(): "new" | "old" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "new";
  return new URLSearchParams(location.search).get("water") === "old" ? "old" : "new";
}

function waterfallMode(): "new" | "old" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "new";
  return new URLSearchParams(location.search).get("waterfall") === "old" ? "old" : "new";
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
  const getThree = useThree((s) => s.get);
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
        { fountain: fountainMode() },
      ),
    [gltf, lightmap, tier, gl],
  );
  // The 3D flowers, trees and bushes (veg3d), built in steps after the village is up (the old foliage cards and the
  // plaza zelkova hidden at once); once ready they cut the old cards out of this clone (`?veg=old` in DEV keeps them).
  // Detaching gives the clone its cards back. The village is covered while they grow (vegDressing.ts, VegVeil): no
  // arrival ever shows the trees bare. Under the cover the build works in longer slices (it finishes sooner). Built
  // once: going into the hall or a house parks the vegetation and coming out dresses the new clone with it at once
  // (vegPark.ts), no cover and no rebuild.
  const [veg, setVeg] = useState<VillageVegetation | null>(null);
  useLayoutEffect(() => {
    // live: this clone's build; carried: the clone went away first and the build goes on (vegPark.ts); dead: stop it
    let state: "live" | "carried" | "dead" = "live";
    let stopped = false; // a carried build the park stopped (the scene went away, or another tier wants its own)
    let building: Promise<VillageVegetation | null> | null = null;
    let letGo: (() => void) | null = null;
    let built: VillageVegetation | null = null;
    const mode = vegModeFrom(window.location.search, import.meta.env.DEV);
    const restoreLegacy = mode === "new" ? hideLegacyVegetationSources(nodes.root) : () => {};
    const dress = (v: VillageVegetation) => {
      built = v;
      setVeg(v);
    };
    // back from the hall or a house: the vegetation built on the first arrival dresses this clone at once (vegPark.ts)
    const kept = mode === "old" ? null : vegetationPark.take(tier, mode);
    if (kept) {
      kept.attach(nodes.root);
      dress(kept);
      vegDressing.uncover();
    } else if (mode !== "old") {
      // the first arrival's build, still going (the player went in early and came straight back out): this clone is
      // dressed with it the moment it is done, under the cover
      const dressing = vegDressing.begin();
      letGo = vegetationPark.adopt(tier, mode, (v) => {
        letGo = null;
        if (state !== "live") {
          // this clone went away first: keep it for the next one
          if (v) vegetationPark.park(v, tier, mode);
          return;
        }
        vegDressing.done(dressing);
        if (!v) {
          restoreLegacy();
          return;
        }
        v.attach(nodes.root);
        dress(v);
      });
      if (!letGo) {
        building = createVegetation(nodes.root, tier, mode, () => state === "dead" || stopped, {
          // while carried (the player indoors) it works in short slices: the room they are in stays smooth
          sliceMs: () => (state === "live" && !vegDressing.dressed() ? 50 : 12),
          // the trees nearest the camera grow first, and each shows as soon as it is grown
          focus: () => {
            const p = getThree().camera.position;
            return [p.x, p.y, p.z];
          },
          onShow: (v) => {
            if (state === "live") setVeg(v);
          },
        }).catch((e: unknown) => {
          // never left covered by a build that failed: the village shows without its 3D vegetation
          console.error("[veg3d] build failed", e);
          return null;
        });
        void building.then((v) => {
          if (state !== "live") return; // carried (vegPark.ts takes it from here) or stopped
          building = null;
          vegDressing.done(dressing);
          if (v) dress(v);
          else restoreLegacy();
        });
      }
    }
    if (import.meta.env.DEV) {
      window.__cvVeg = () => built?.stats() ?? null;
      window.__cvVegDrawn = () => built?.measureDrawn() ?? null;
      window.__cvVegKeepOut = (x, y, z) => built?.keepOut?.(x, y, z) ?? null;
    }
    return () => {
      if (import.meta.env.DEV) {
        delete window.__cvVeg;
        delete window.__cvVegDrawn;
        delete window.__cvVegKeepOut;
      }
      if (built) {
        state = "dead";
        // kept for the way back out (given back to this clone first); the scene frees it when it goes (vegPark.ts)
        if (mode !== "old") vegetationPark.park(built, tier, mode);
        else built.dispose();
      } else {
        // not dressed yet: the way back out is covered until it is (no bare village, no empty frame)
        vegDressing.cover();
        if (building) {
          // the build goes on without this clone, and is parked (or adopted) once done
          state = "carried";
          vegetationPark.carry(building, tier, mode, () => {
            stopped = true;
          });
        } else {
          state = "dead";
          letGo?.();
        }
      }
      restoreLegacy();
      setVeg(null);
    };
  }, [nodes, tier, getThree]);
  const waterfall = useMemo<{ runtime: Waterfall3D; hidden: Object3D[] } | null>(() => {
    if (waterfallMode() === "old") return null;
    const hidden = hideWaterfallCards(nodes.root);
    return { runtime: createWaterfall3D(tier), hidden };
  }, [nodes, tier]);
  useEffect(() => {
    return () => {
      waterfall?.runtime.dispose();
      waterfall?.hidden.forEach((o) => {
        o.visible = true;
      });
    };
  }, [waterfall]);
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
    veg?.update(camera, clock.elapsedTime, gl.domElement.height);
    waterfall?.runtime.update(clock.elapsedTime, camera);
  });
  // dispose={null}: the geometry and shared materials belong to the loader's cache.
  return (
    <>
      <primitive object={nodes.root} dispose={null} />
      {veg && <primitive object={veg.group} dispose={null} />}
      {waterfall && <primitive object={waterfall.runtime.group} dispose={null} />}
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
