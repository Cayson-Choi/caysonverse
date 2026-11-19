import { useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, DoubleSide, Mesh, MeshBasicMaterial, type Material, type Texture } from "three";
import { useLakeStore } from "../lake/lakeStore";
import { dayNight } from "./dayNightDriver";
import { GRASS_VARIATION_PARS } from "./grassVariation";
import { GROUND_GRADE } from "./villageModelPrep";
import type { VillageNodes } from "./villageModelPrep";
import { cutFarBackdrop, mountainLandTint } from "./mountains";
import { skylineClearsForest, skylineMode } from "./skyline/skylinePlacement";
import { buildOuterGround, groundMeshesIn, setOuterGround } from "./outerGround";

/** The far trees beyond this radius stand on the outer ground (the old backdrop's triangles beyond it are cut). */
export const OUTER_CUT_RADIUS = 140;
/** The outer ground's brightness against the lit lawn (measured at noon next to the lawn's rim; the lawn is light-mapped, this is not). */
const GRASS_MATCH = 1.2;

/** The village lawn's tile size in metres per uv unit (x = 3 * u on the baked ground, measured). */
const LAWN_TILE_M = 3;

const mapOf = (m: Material | Material[]): Texture | null => ((Array.isArray(m) ? m[0] : m) as MeshBasicMaterial).map ?? null;

/**
 * The village's outer ground (outerGround.ts): one mesh of lawn in the village's own grass texture, the same anti-tiling and
 * macro tint as the lawn, rolling foothills with shaded slopes, joined to the baked ground with no step. The old backdrop's flat
 * hills beyond it are cut and its far trees stand on this ground. Draws before nothing special: opaque, one draw call, no per-frame
 * work but two colour writes.
 */
export function OuterGround({ nodes }: { nodes: VillageNodes }) {
  const scene = useThree((s) => s.scene);
  const lakeDrawn = useLakeStore((s) => s.drawn);
  const built = useMemo(() => {
    const roots = [nodes.root];
    const lake = scene.getObjectByName("lake_ground_2")?.parent ?? null;
    if (lake) roots.push(lake);
    const meshes = groundMeshesIn(roots);
    const village = meshes.filter((m) => m.name.startsWith("village_lm"));
    const ground = buildOuterGround(meshes);
    const map = mapOf(village[0]?.material ?? []);
    const mpu = LAWN_TILE_M;
    const grade = GROUND_GRADE.LM_grass ?? [1.4, 1.34, 1.05];
    const material = new MeshBasicMaterial({ map: map ?? undefined, vertexColors: true, fog: false, side: DoubleSide });
    material.name = "M_outer_ground";
    material.color = new Color(grade[0]! * GRASS_MATCH, grade[1]! * GRASS_MATCH, grade[2]! * GRASS_MATCH);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vOgWorld;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvOgWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vOgWorld;\n${GRASS_VARIATION_PARS}`)
        .replace("#include <map_fragment>", `#ifdef USE_MAP\n  diffuseColor *= gvVary( map, vMapUv, vOgWorld, texture2D( map, vMapUv ) );\n#endif`);
    };
    material.customProgramCacheKey = () => "village-outer-ground";
    if (map) {
      // the map's own transform carries its repeat; the mesh's uv is world metres, so one tile is `mpu` metres
      material.map = map.clone();
      material.map.repeat.set(1 / mpu, 1 / mpu);
      material.map.needsUpdate = true;
    }
    const mesh = new Mesh(ground.geometry, material);
    mesh.name = "village_outer_ground";
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return { mesh, material, ground };
  }, [nodes, scene, lakeDrawn]);

  useLayoutEffect(() => {
    setOuterGround(built.ground);
    return () => setOuterGround(null);
  }, [built]);

  useLayoutEffect(() => {
    const cut = cutFarBackdrop(nodes.root, OUTER_CUT_RADIUS, built.ground.heightAt, skylineMode() === "on" ? skylineClearsForest : undefined);
    return () => cut.restore();
  }, [nodes, built]);

  useLayoutEffect(
    () => () => {
      built.ground.geometry.dispose();
      built.material.map?.dispose();
      built.material.dispose();
    },
    [built],
  );

  useFrame(() => {
    // the land's time-of-day tint (golden hour, the moonlit dark): the same function the ridges use
    const t = mountainLandTint(dayNight.applied);
    const grade = GROUND_GRADE.LM_grass ?? [1.4, 1.34, 1.05];
    const n = dayNight.applied.night;
    // at night the lawn is a cool dark green like the baked lawn's night grade
    const nightK = 1 + (4.2 - 1) * n;
    built.material.color.setRGB(grade[0]! * GRASS_MATCH * t[0]! * nightK, grade[1]! * GRASS_MATCH * t[1]! * nightK, grade[2]! * GRASS_MATCH * t[2]! * nightK);
  });

  return <primitive object={built.mesh} dispose={null} />;
}
