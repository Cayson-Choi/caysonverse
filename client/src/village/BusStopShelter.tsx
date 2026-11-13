import { versionedUrl } from "./modelUrl";
import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { Mesh } from "three";
import { DRACO_PATH } from "../game/hub/hubModelPrep";

/**
 * The bus stop's waiting pad, shelter and stop sign (`village_busstop.glb`, art/village/tools/build_busstop.py), modelled
 * in world coordinates so it is placed as it is. The shelter stands at the back of a paved pad with room to walk between
 * it and the bus (shared/village/villageLayout.ts BUS_STOP_PAD, busShelterColliders); it is lit live like the signals.
 */
export const BUSSTOP_MODEL_URL = versionedUrl("/models/village/village_busstop.glb");

/** Runtime 3D bus stop: arched roof, glass back and ends, route light box, bench, arrival display, sign. */
export function BusStopShelter() {
  const gltf = useGLTF(BUSSTOP_MODEL_URL, DRACO_PATH);
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    s.name = "bus-stop-shelter";
    s.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const glass = /glass/.test(m.name);
      m.castShadow = !glass && !/pad_/.test(m.name);
      m.receiveShadow = /pad_/.test(m.name);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
    });
    return s;
  }, [gltf]);
  return <primitive object={scene} dispose={null} />;
}
