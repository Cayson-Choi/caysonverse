import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import { LightShafts } from "../LightShafts";
import {
  DRACO_PATH,
  HUB_LIGHTMAP_URL,
  HUB_MODEL_URL,
  disposeHub,
  prepareHub,
  type HubNodes,
} from "./hubModelPrep";

/**
 * The hub model in the scene (AI 학교 탈출, Task 23): loads `hub.glb` (Draco, decoder at /draco/) and its light
 * map, dresses a clone of it (hubModelPrep.ts: light map on the `LM_*` materials, no fog on the clouds, the `col__*`
 * boxes hidden) and renders it. The scene's parts that drive nodes (Gate, ProgressBoard, DoorPads) and hang
 * things on it (HubSigns, the light shafts) are its children and read the dressed nodes through `useHubNodes`.
 *
 * The model is read (suspends) only when this component mounts, i.e. when a player enters the hall: the entry
 * screen never loads it, and nothing preloads it. The loader's cache keeps the parsed model between visits
 * (back from a classroom is instant); the clone's own materials are released with the component, and the GPU
 * resources go with the Canvas.
 */

const HubNodesContext = createContext<HubNodes | null>(null);

/** The dressed hub nodes. Only valid below `HubModel`. */
export function useHubNodes(): HubNodes {
  const nodes = useContext(HubNodesContext);
  if (!nodes) throw new Error("useHubNodes must be used inside <HubModel>");
  return nodes;
}

/** The light shafts through the model's sunny windows (the rich tier draws them; the light tier draws nothing). */
export function HubShafts() {
  return <LightShafts points={useHubNodes().shafts} />;
}

export function HubModel({ children }: { children?: ReactNode }) {
  // Both files download at once: the light map's request starts before the model's read suspends this component.
  useTexture.preload(HUB_LIGHTMAP_URL);
  const gltf = useGLTF(HUB_MODEL_URL, DRACO_PATH);
  const lightmap = useTexture(HUB_LIGHTMAP_URL);
  const nodes = useMemo(() => prepareHub(gltf.scene, lightmap), [gltf, lightmap]);
  useEffect(() => () => disposeHub(nodes), [nodes]);
  return (
    <HubNodesContext.Provider value={nodes}>
      {/* dispose={null}: the geometry and shared materials belong to the loader's cache. */}
      <primitive object={nodes.root} dispose={null} />
      {children}
    </HubNodesContext.Provider>
  );
}
