import { Suspense, useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshBasicMaterial, type Material, type Mesh, type Texture } from "three";
import {
  HOUSE_PLACES,
  houseFloorBounds,
  parseHouseFloorArea,
  type HouseFloor,
  type HouseNumber,
} from "@caysonverse/shared/village/houseAreas";
import { houseFloorGeometry } from "@caysonverse/shared/village/housesGeometry";
import type { Pose } from "../game/types";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { MapBoxes } from "../game/MapBoxes";
import { SceneWarmUp } from "../game/SceneWarmUp";
import { useQualityTier } from "../game/QualityEffects";
import { setSeatSightBlocker, setSeatSpotBlocker } from "../game/seatFraming";
import { setCameraSolids } from "../game/cameraSolids";
import { dayNight } from "./dayNightDriver";
import { LoadBoundary } from "./LoadBoundary";
import { arrivalCamera } from "./houseArrivalCamera";
import { viewState } from "../game/viewState";
import { CAMERA } from "../game/constants";
import { DoorPad } from "./VillageHall";
import { buildSolidIndex } from "./hallSolidIndex";
import { hallNightWeight } from "./hallNight";
import { useNightMapWanted } from "./nightLightmap";
import { beginHouseEntry, houseEntryFailed, houseEntryReady, houseEntryState } from "./houseEntry";
import {
  HOUSE_VIEW_MATERIAL,
  disposeHouse,
  houseUrls,
  houseWantsLightmap,
  houseWantsView,
  prepareHouse,
  solidTriangles,
} from "./houseModelPrep";
import { houseNightMapUniform, houseNightUniform, patchHouseLightmapMaterial, patchHouseViewMaterial, resetHouseNight } from "./houseNight";
import { clearHouseCaches, holdHouseFiles, loadHouseTexture, noteHouseRequested } from "./houseRelease";

/**
 * The inside of a house (집 실내 G): the local player's floor of `house_N.glb`, mounted while the local player is in one of the house's
 * two floors (`house:house_N:1|2`). Holds the house's files while it shows (houseRelease.ts: prefetched at the door, kept 60 s after
 * leaving), shows a plain room until the model is in, and draws the way-out and stair pads. A house with no light bake yet (every
 * material `M_*`) is drawn as loaded under the village's indoor light; one with `LM_*` materials gets its day light map (the night map
 * when night is near) and a window panorama on its `M_view` material.
 */

/** The plain room shown while a model loads: the floor's walls (the colliders) and a floor, so nobody stands in a void. */
function HouseRoom({ n, floor }: { n: HouseNumber; floor: HouseFloor }) {
  const geometry = useMemo(() => houseFloorGeometry(n, floor), [n, floor]);
  const b = houseFloorBounds(n, floor);
  const material = useMemo(() => new MeshBasicMaterial({ color: "#E9E1D2" }), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <group>
      <mesh position={[(b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2]} material={material}>
        <boxGeometry args={[b.maxX - b.minX, 0.02, b.maxZ - b.minZ]} />
      </mesh>
      <MapBoxes geometry={geometry} />
    </group>
  );
}

/** The way-out and stair pads of the floor, as faint rings on the boards. */
function HousePads({ n, floor }: { n: HouseNumber; floor: HouseFloor }) {
  const p = HOUSE_PLACES[n];
  const pads = floor === 1 ? [p.exitPad, p.upPad] : [p.downPad];
  return (
    <>
      {pads.map((pad) => (
        <DoorPad key={`${pad.x}:${pad.z}`} pad={{ centre: { x: pad.x, z: pad.z }, radius: pad.radius }} subtle />
      ))}
    </>
  );
}

/** One floor of the dressed house: the model with its light (when it has any), the window panorama. Suspends while loading. */
function HouseFloorScene({ n, floor, pose }: { n: HouseNumber; floor: HouseFloor; pose: Pose }) {
  noteHouseRequested(n);
  const tier = useQualityTier();
  const urls = houseUrls(n, tier);
  const gltf = useGLTF(urls.glb, DRACO_PATH);
  const wantsLightmap = useMemo(() => houseWantsLightmap(gltf.scene), [gltf]);
  const wantsView = useMemo(() => houseWantsView(gltf.scene), [gltf]);
  const nightWanted = useNightMapWanted();
  const [day, setDay] = useState<Texture | null>(null);
  const [view, setView] = useState<Texture | null>(null);
  // Light maps and the panorama are plain reads: a missing file is a house without that light, not a crash.
  useEffect(() => {
    if (!wantsLightmap) return;
    let live = true;
    void loadHouseTexture(n, urls.lightmapDay).then((t) => live && setDay(t));
    return () => {
      live = false;
    };
  }, [n, urls.lightmapDay, wantsLightmap]);
  useEffect(() => {
    if (!wantsView) return;
    let live = true;
    void loadHouseTexture(n, urls.view).then((t) => live && setView(t));
    return () => {
      live = false;
    };
  }, [n, urls.view, wantsView]);
  useEffect(() => {
    if (!wantsLightmap || !nightWanted) return;
    let live = true;
    void loadHouseTexture(n, urls.lightmapNight).then((t) => {
      if (!live || !t) return;
      t.flipY = false;
      t.channel = 1;
      t.needsUpdate = true;
      houseNightMapUniform.value = t;
    });
    return () => {
      live = false;
    };
  }, [n, urls.lightmapNight, wantsLightmap, nightWanted]);
  useEffect(() => () => resetHouseNight(), [n]);

  const nodes = useMemo(() => prepareHouse(gltf.scene, n, floor, day), [gltf, n, floor, day]);
  useEffect(() => () => disposeHouse(nodes), [nodes]);
  useEffect(() => {
    for (const m of nodes.lightmapped) patchHouseLightmapMaterial(m);
  }, [nodes]);
  useEffect(() => {
    if (!view) return;
    view.flipY = false;
    view.needsUpdate = true;
    const touched: Material[] = [];
    for (const m of nodes.views) {
      (m as MeshBasicMaterial).map = view;
      patchHouseViewMaterial(m);
      m.needsUpdate = true;
      touched.push(m);
    }
    return () => {
      for (const m of touched) (m as MeshBasicMaterial).map = null;
    };
  }, [nodes, view]);

  // The seat framing and the follow camera must see this floor's solid model (the memorial hall's way, hallSolidIndex.ts): the camera
  // never sits in or beyond a wall, a bookcase or the stair, and a seat's first framing sees the seated body.
  useEffect(() => {
    const b = houseFloorBounds(n, floor);
    const solid = buildSolidIndex(solidTriangles(nodes.root), b.minX - 1, b.maxX + 1, b.minZ - 1, b.maxZ + 1);
    const offSight = setSeatSightBlocker((fx, fy, fz, tx, ty, tz) => solid.segmentBlocked(fx, fy, fz, tx, ty, tz, 0.35));
    const offSpot = setSeatSpotBlocker((x, y, z) => solid.underHung(x, y, z, 2.6, 1.0, 0.25) || solid.nearSolid(x, y, z, 0.3));
    const offCamera = setCameraSolids(solid);
    return () => {
      offSight();
      offSpot();
      offCamera();
    };
  }, [nodes, n, floor]);

  // This floor is drawn: the entry cover may open, and the camera glides to the direction that leaves it the longest clear arm (arrival camera).
  useEffect(() => {
    houseEntryReady();
    const cam = arrivalCamera(n, floor, pose.x, pose.z, pose.yaw, CAMERA.distance);
    viewState.orbitGoal = { yaw: cam.yaw, pitch: cam.pitch };
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const night = wantsLightmap || nodes.views.length > 0 ? hallNightWeight(dayNight.outdoor.night, houseNightMapUniform.value !== null) : 0;
    if (houseNightUniform.value !== night) houseNightUniform.value = night;
  });

  return <primitive object={nodes.root} dispose={null} />;
}

declare global {
  interface Window {
    /** Dev-only: the drawn floor of the house (house, floor, meshes drawn) for the e2e checks. */
    __cvHouse?: () => { n: number; floor: number; meshes: number; lightmapped: boolean; viewMaterial: boolean };
  }
}

/**
 * The house floor the local player is on (mounted while they are in a house). `area` changes with the stair; the floor scene is
 * keyed by it, so the other floor's group is the one hidden at once. The files are held for the whole stay.
 */
export function HouseArea({ area, pose }: { area: string; pose: Pose }) {
  const hit = parseHouseFloorArea(area);
  const n = hit?.n ?? 1;
  const floor = hit?.floor ?? 1;
  const inHouse = hit !== null;
  useEffect(() => {
    if (!inHouse) return;
    // a house floor mounted without the keypad's "ok" having raised the cover (a reconnect into a house): raise it now
    if (houseEntryState().phase === "idle") beginHouseEntry();
    return holdHouseFiles(n);
  }, [n, inHouse]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvHouse = () => {
      let meshes = 0;
      let lm = false;
      let view = false;
      const scene = (window as unknown as { __cvThree?: () => { scene: { traverse(f: (o: Mesh) => void): void } } }).__cvThree?.().scene;
      scene?.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        for (let p: { visible: boolean; parent: unknown } | null = o; p; p = p.parent as { visible: boolean; parent: unknown } | null) if (p.visible === false) return;
        meshes += 1;
        const m = (o as Mesh).material as Material | Material[];
        for (const mat of Array.isArray(m) ? m : [m]) {
          if (mat.name.startsWith("LM_")) lm = true;
          if (mat.name === HOUSE_VIEW_MATERIAL) view = true;
        }
      });
      return { n, floor, meshes, lightmapped: lm, viewMaterial: view };
    };
    return () => {
      delete window.__cvHouse;
    };
  }, [n, floor]);
  if (!hit) return null;
  return (
    <>
      <LoadBoundary
        fallback={<HouseRoom n={n} floor={floor} />}
        onReset={() => {
          clearHouseCaches(n);
          houseEntryFailed();
        }}
        notice="집 안을 불러오지 못했어요. 잠시 뒤 다시 불러올게요."
      >
        <Suspense fallback={<HouseRoom n={n} floor={floor} />}>
          <HouseFloorScene key={area} n={n} floor={floor} pose={pose} />
          <SceneWarmUp />
        </Suspense>
      </LoadBoundary>
      <HousePads n={n} floor={floor} />
    </>
  );
}
