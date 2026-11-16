import { useLayoutEffect, useMemo } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { FileLoader, LinearMipmapLinearFilter, Mesh, RepeatWrapping, SRGBColorSpace, ClampToEdgeWrapping, type Texture } from "three";
import { LIGHTING } from "../game/sceneLighting";
import { dayNight } from "./dayNightDriver";
import { noteMountainsRequested } from "./villageRelease";
import { LIGHT_TIER_MAX_TEXTURE, capTextureSize, type VillageNodes, type VillageTier } from "./villageModelPrep";
import {
  MOUNTAINS_GRID_URL,
  MOUNTAINS_TEXTURE_URL,
  applyMountains,
  buildMountainGeometry,
  createMountainMaterial,
  cutFarBackdrop,
  parseMountains,
} from "./mountains";

declare global {
  interface Window {
    /** Dev-only: the distant mountains' numbers (triangles, what was cut from the old backdrop). */
    __cvMountains?: () => { triangles: number; cutTriangles: number; cutInstances: number; visible: boolean };
  }
}

/** Distant mountains off (the old backdrop as it was): the DEV address flag `?mountains=old`. */
export function mountainsMode(): "new" | "old" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "new";
  return new URLSearchParams(location.search).get("mountains") === "old" ? "old" : "new";
}

const loadArrayBuffer = (l: FileLoader<unknown>) => {
  l.setResponseType("arraybuffer");
};

/** Start the mountains' two files downloading with the village's (they are small: 60 KB grid, 0.4 MB atlas). */
export function preloadMountains(): void {
  noteMountainsRequested();
  useLoader.preload(FileLoader, MOUNTAINS_GRID_URL, loadArrayBuffer);
  useTexture.preload(MOUNTAINS_TEXTURE_URL);
}

/**
 * The distant mountains (B6; mountains.ts): read their two files (suspends inside its own boundary in VillageModel,
 * so the village never waits for them), build the rings, cut the old far range out of this village clone once they
 * are in, and follow the time of day every frame.
 */
export function VillageMountains({ nodes, tier }: { nodes: VillageNodes; tier: VillageTier }) {
  const buffer = useLoader(FileLoader, MOUNTAINS_GRID_URL, loadArrayBuffer) as ArrayBuffer;
  const atlas = useTexture(MOUNTAINS_TEXTURE_URL) as Texture;
  const gl = useThree((s) => s.gl);
  const built = useMemo(() => {
    // the light (phone) tier: the atlas at 2048 px wide like the village's own textures (4.5 MB on the GPU, not 18)
    if (tier === "low") capTextureSize(atlas, LIGHT_TIER_MAX_TEXTURE, undefined, (t) => gl.properties.has(t));
    atlas.colorSpace = SRGBColorSpace;
    atlas.wrapS = RepeatWrapping;
    atlas.wrapT = ClampToEdgeWrapping;
    atlas.minFilter = LinearMipmapLinearFilter;
    atlas.anisotropy = 4;
    atlas.needsUpdate = true;
    const layers = parseMountains(buffer);
    const geometry = buildMountainGeometry(layers);
    const material = createMountainMaterial(
      atlas,
      { map: nodes.sky?.map ?? null, mapping: nodes.skyMapping },
      tier === "high" ? "high" : "low",
      LIGHTING.village.toneCurve ?? "neutral",
    );
    const mesh = new Mesh(geometry, material);
    mesh.name = "village_mountains";
    mesh.frustumCulled = false; // a ring round the camera: always partly in view
    mesh.renderOrder = -50; // after the dome, before the village (it is opaque: depth sorts the rest)
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return { mesh, geometry, material, triangles: (geometry.index?.count ?? 0) / 3 };
  }, [buffer, atlas, nodes, tier, gl]);

  useLayoutEffect(() => {
    const cut = cutFarBackdrop(nodes.root);
    if (import.meta.env.DEV) {
      window.__cvMountains = () => ({
        triangles: built.triangles,
        cutTriangles: cut.trianglesRemoved,
        cutInstances: cut.instancesRemoved,
        visible: built.mesh.visible,
      });
    }
    return () => {
      if (import.meta.env.DEV) delete window.__cvMountains;
      cut.restore();
    };
  }, [nodes, built]);

  useLayoutEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
    },
    [built],
  );

  useFrame(({ gl }) => {
    applyMountains(built.material, dayNight.applied, nodes.sky?.color ?? null, gl.toneMappingExposure);
  });

  return <primitive object={built.mesh} dispose={null} />;
}
