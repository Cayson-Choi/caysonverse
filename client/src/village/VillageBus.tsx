import { Suspense, useEffect, useMemo, useRef } from "react";
import type { Mesh } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { type BusNodes, applyBusDayNight, disposeBus, followBusSigns, prepareBus, setBusAnisotropy } from "./villageBusPrep";
import { readBus } from "./villageBusLoader";
import { dayNight } from "./dayNightDriver";
import type { VillageTier } from "./villageModelPrep";
import { noteBusRequested } from "./villageRelease";
import { getTransitRenderPose, onBusHorn, stepTransitRender } from "../net/transitSync";
import { BUS_HORN_HEAR_M, playBusHorn } from "./busHorn";
import { BusDriver } from "./BusDriver";
import { LoadBoundary } from "./LoadBoundary";
import { clearNpcCache } from "./npcAvatar";

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
  // The cabin's poles, ceiling rails and strap groups are separate nodes. They used to be hidden near the rider's lens; since
  // owner 2026-11-16 ("반투명하게 보이게 하지 마") they are always drawn (the frame loop only makes sure none stays hidden).
  const fixtures = useRef(new Map<string, Mesh>());
  useEffect(() => {
    const map = fixtures.current;
    map.clear();
    nodes.root.traverse((o) => {
      if (/^(pole|strap|rail)_/.test(o.name) && (o as Mesh).isMesh) map.set(o.name, o as Mesh);
    });
    return () => {
      for (const m of map.values()) m.visible = true;
      map.clear();
    };
  }, [nodes]);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    // The server's driver toots when it has stood a while for someone on the road: heard near the bus only.
    onBusHorn(() => {
      const pose = getTransitRenderPose();
      const d = Math.hypot(camera.position.x - pose.x, camera.position.z - pose.z);
      if (d <= BUS_HORN_HEAR_M) playBusHorn(d);
    });
    return () => onBusHorn(null);
  }, [camera]);
  useFrame((state, delta) => {
    stepTransitRender(delta);
    const pose = getTransitRenderPose();
    nodes.root.position.set(pose.x, 0, pose.z);
    // the model is built nose north (-z) and the pose's yaw is the heading (0 faces +z): half a turn between them
    nodes.root.rotation.set(0, pose.yaw + Math.PI, 0);
    nodes.root.updateMatrixWorld(true);
    followBusSigns(nodes);
    applyBusDayNight(nodes, dayNight.applied, state.gl.toneMappingExposure);
    // owner 2026-11-16 ("반투명하게 보이게 하지 마"): the cabin's poles, rails and straps are always drawn, never hidden near the lens
    for (const mesh of fixtures.current.values()) if (!mesh.visible) mesh.visible = true;
  });
  // dispose={null}: the geometry and the loader's materials belong to the loader's cache.
  // The driver (owner 2026-11-16) rides in the bus as its child: npc.glb is waited for in a Suspense of its own, and a failed one
  // is simply no driver (tried again later).
  return (
    <primitive object={nodes.root} dispose={null}>
      <LoadBoundary fallback={null} onReset={clearNpcCache} notice="버스 기사 모습을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
        <Suspense fallback={null}>
          <BusDriver busRoot={nodes.root} />
        </Suspense>
      </LoadBoundary>
    </primitive>
  );
}
