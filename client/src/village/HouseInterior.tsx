import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { AdditiveBlending, CanvasTexture, CircleGeometry, Color, Mesh as ThreeMesh, PlaneGeometry, MeshBasicMaterial, RepeatWrapping, type PerspectiveCamera, SRGBColorSpace, type Material, type Mesh, type Texture } from "three";
import {
  houseFloorBounds,
  parseHouseFloorArea,
  type HouseFloor,
  type HouseNumber,
} from "@caysonverse/shared/village/houseAreas";
import { houseFloorGeometry } from "@caysonverse/shared/village/housesGeometry";
import type { Pose } from "../game/types";
import { DRACO_PATH, configureLightmap } from "../game/hub/hubModelPrep";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
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
import { buildSolidIndex } from "./hallSolidIndex";
import { hallNightWeight } from "./hallNight";
import { useNightMapWanted } from "./nightLightmap";
import { beginHouseEntry, houseEntryFailed, houseEntryReady, houseEntryState } from "./houseEntry";
import {
  HOUSE_VIEW_MATERIAL,
  applyHouseTextures,
  disposeHouse,
  dressLoadedHouse,
  houseSharedTextureNames,
  houseTextureUrl,
  houseUrls,
  houseViewMapping,
  houseWantsLightmap,
  houseWantsView,
  isHouseLightmapMaterial,
  prepareHouse,
  solidTriangles,
  viewBandVSpan,
} from "./houseModelPrep";
import {
  houseNightMapUniform,
  houseNightUniform,
  patchHouseGlowMaterial,
  patchHouseLightmapMaterial,
  patchHouseViewMaterial,
  resetHouseNight,
} from "./houseNight";
import { HouseMirrorRig } from "./houseMirror";
import type { HouseLamp } from "./houseLampGlow";
import { hearthFlames, houseFireTime, setHouseHearth } from "./houseFire";
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

// No ring or disc marks the way out or the stair on the boards (owner 2026-11-16, "집 안 출구 원판도 없애", as the memorial hall's door):
// the door, the stair, the "나가기 / 2층" button and E are the cue; a tap on the door or the stair still walks there and uses it.


/**
 * The warm pool of light a lit floor lamp throws on the boards at night: one flat additive disc per floor lamp (a soft radial gradient,
 * fading with the house's night weight) — no light, no shadow, one draw call each, nothing by day.
 */
function LampPools({ lamps, n, floor, low }: { lamps: HouseLamp[]; n: HouseNumber; floor: HouseFloor; low: boolean }) {
  const mine = useMemo(() => {
    if (import.meta.env.DEV && (globalThis as { __cvLampOld?: boolean }).__cvLampOld) return [];
    const b = houseFloorBounds(n, floor);
    return lamps.filter((l) => l.floor && l.x > b.minX && l.x < b.maxX && l.z > b.minZ && l.z < b.maxZ);
  }, [lamps, n, floor]);
  const res = useMemo(() => {
    if (mine.length === 0) return null;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,190,100,0.95)");
    grad.addColorStop(0.35, "rgba(255,165,70,0.55)");
    grad.addColorStop(1, "rgba(255,150,60,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(c);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geometry = new PlaneGeometry(low ? 3.0 : 2.4, low ? 3.0 : 2.4).rotateX(-Math.PI / 2);
    const meshes: ThreeMesh[] = mine.map((l) => {
      const m = new ThreeMesh(geometry, material);
      m.position.set(l.x, 0.035, l.z);
      m.renderOrder = 2;
      m.frustumCulled = true;
      return m;
    });
    // the bulb seen from below: a small bright warm disc closing the shade's rim (unlit, so the phone shows it too)
    const bulbMaterial = new MeshBasicMaterial({ color: new Color(2.2, 1.6, 0.9), transparent: true, opacity: 0, toneMapped: false });
    const bulbGeometry = new CircleGeometry(1, 20).rotateX(Math.PI / 2);
    for (const l of mine) {
      const d = new ThreeMesh(bulbGeometry, bulbMaterial);
      d.position.set(l.x, l.y0 + 0.004, l.z);
      d.scale.setScalar(l.w * 0.4);
      meshes.push(d);
    }
    return { texture, material, geometry, meshes, bulbMaterial, bulbGeometry };
  }, [mine, low]);
  useEffect(() => () => {
    res?.texture.dispose();
    res?.material.dispose();
    res?.geometry.dispose();
    res?.bulbMaterial.dispose();
    res?.bulbGeometry.dispose();
  }, [res]);
  useFrame(() => {
    if (res) res.material.opacity = (low ? 0.85 : 0.75) * houseNightUniform.value;
    if (res) res.bulbMaterial.opacity = houseNightUniform.value;
    if (res) for (const m of res.meshes) m.visible = houseNightUniform.value > 0.01;
  });
  if (!res) return null;
  return <>{res.meshes.map((m, i) => <primitive key={i} object={m} dispose={null} />)}</>;
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
      // the day map's settings (sRGB, unflipped, the second UV set): read raw, the night map came out washed and bright
      houseNightMapUniform.value = configureLightmap(t);
    });
    return () => {
      live = false;
    };
  }, [n, urls.lightmapNight, wantsLightmap, nightWanted]);
  useEffect(() => () => resetHouseNight(), [n]);
  useEffect(() => {
    setHouseHearth(n);
    return () => setHouseHearth(0);
  }, [n]);
  // The shared full-size albedos (houseModelPrep HOUSE_TEXTURE_DIR): the GLB's small copies show until they are in.
  useEffect(() => {
    let live = true;
    const names = houseSharedTextureNames(gltf.scene);
    void Promise.all(names.map((name) => loadHouseTexture(n, houseTextureUrl(name, tier)).then((t) => [name, t] as const))).then((got) => {
      if (!live) return;
      const map = new Map<string, Texture>();
      for (const [name, t] of got) if (t) map.set(name, t);
      applyHouseTextures(gltf.scene, map);
    });
    return () => {
      live = false;
    };
  }, [gltf, n, tier]);

  const nodes = useMemo(() => {
    dressLoadedHouse(gltf.scene, n);
    return prepareHouse(gltf.scene, n, floor, day);
  }, [gltf, n, floor, day]);
  useEffect(() => () => disposeHouse(nodes), [nodes]);
  useEffect(() => {
    for (const m of nodes.lightmapped) patchHouseLightmapMaterial(m);
    for (const m of nodes.glows) patchHouseGlowMaterial(m);
  }, [nodes]);
  // The mirrors draw the real room live while they are on screen and near (houseMirror.ts HouseMirrorRig).
  const mirrorRig = useRef<HouseMirrorRig | null>(null);
  const { gl, scene: threeScene, camera: threeCamera } = useThree();
  useEffect(() => {
    const rig = new HouseMirrorRig({ low: tier === "low" });
    rig.attach(nodes.root);
    if (tier === "low") rig.warm(gl, threeScene, threeCamera as PerspectiveCamera); // the phone's picture is another program variant: compile it now, under the entry cover
    mirrorRig.current = rig;
    if (import.meta.env.DEV) window.__cvMirror = () => ({ mirrors: rig.count, redraws: rig.redraws, lastFrameRedraws: rig.lastFrameRedraws, size: rig.size, low: tier === "low", planes: rig.planes });
    return () => {
      mirrorRig.current = null;
      rig.dispose();
      if (import.meta.env.DEV) delete window.__cvMirror;
    };
  }, [nodes, tier, gl, threeScene, threeCamera]);
  useEffect(() => {
    if (!view) return;
    // the band shows the village the way this house's real windows look out (houseViewMapping: the two builders' panoramas differ)
    const side = VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === `house_${n}`)?.doorSide ?? "s";
    const map = houseViewMapping(n, side, viewBandVSpan(nodes.root));
    view.flipY = false;
    view.colorSpace = SRGBColorSpace;
    view.wrapS = RepeatWrapping;
    view.offset.set(map.uShift, 0);
    view.repeat.set(1, map.vScale);
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
  }, [nodes, view, n]);

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

  useFrame(() => mirrorRig.current?.beginFrame(), -1000);
  useFrame(() => {
    houseFireTime.value = performance.now() / 1000;
    const night = wantsLightmap || nodes.views.length > 0 || nodes.glows.length > 0 ? hallNightWeight(dayNight.outdoor.night, houseNightMapUniform.value !== null) : 0;
    if (houseNightUniform.value !== night) houseNightUniform.value = night;
  });

  const flames = useMemo(() => floor === 1 ? hearthFlames(n) : null, [n, floor]);
  useEffect(() => () => {
    flames?.geometry.dispose();
    flames?.material.dispose();
  }, [flames]);
  return <>
    <primitive object={nodes.root} dispose={null} />
    <LampPools lamps={(gltf.scene.userData.houseLamps as HouseLamp[] | undefined) ?? []} n={n} floor={floor} low={tier === "low"} />
    {flames && <primitive object={flames} dispose={null} />}
  </>;
}

declare global {
  interface Window {
    /** Dev-only: the drawn floor of the house (house, floor, meshes drawn) for the e2e checks. */
    /** Dev-only: the house mirrors' live-reflection counters (mirrors on the floor, redraws so far / in the last frame, picture size). */
    __cvMirror?: () => { mirrors: number; redraws: number; lastFrameRedraws: number; size: number; low: boolean; planes: { c: number[]; n: number[]; a: number; b: number; windingAgrees: boolean }[] };
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
          if (isHouseLightmapMaterial(mat.name) && (mat as MeshBasicMaterial).lightMap) lm = true;
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
    </>
  );
}
