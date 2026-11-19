import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { InstancedMesh, Mesh, SRGBColorSpace, TextureLoader, type Group, type Material, type Matrix4, type BufferGeometry, type MeshBasicMaterial } from "three";
import { compileSafely } from "../../game/compileSafely";
import { dayNight } from "../dayNightDriver";
import { versionedUrl } from "../modelUrl";
import { buildCafe, type CafeParts } from "./cafeBuild";
import { blobMaterial, cafeMaterial, cafeUniforms, poolMaterial } from "./cafeMaterials";
import { artAtlas, softDisc } from "./cafeTextures";

declare global {
  interface Window {
    /** Dev-only: the café furniture's numbers (draw calls, triangles, instances). */
    __cvCafe?: () => { drawCalls: number; triangles: number; chairs: number; tables: number };
  }
}

/** DEV address flag `?cafe=off` leaves the furniture out (before/after photos). Production always draws it. */
export function cafeInteriorMode(): "on" | "off" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "on";
  return new URLSearchParams(location.search).get("cafe") === "off" ? "off" : "on";
}

const noRaycast = (): void => {};

function plain(geometry: BufferGeometry, material: Material, name: string): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.raycast = noRaycast; // decoration behind glass: never takes a click or the camera's ray
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function instanced(geometry: BufferGeometry, material: Material, matrices: readonly Matrix4[], name: string): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.raycast = noRaycast;
  mesh.matrixAutoUpdate = false;
  // culling by the instances' own bounds (the merged room mesh is culled by its geometry's)
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

interface Built {
  parts: CafeParts;
  meshes: Mesh[];
  pool: MeshBasicMaterial;
  blob: MeshBasicMaterial;
  dispose(): void;
}

function build(): Built {
  const parts = buildCafe();
  const atlas = artAtlas();
  const disc = softDisc();
  const solid = cafeMaterial("solid");
  const mirror = new TextureLoader().load(versionedUrl("/models/village/cafe_mirror.webp"));
  mirror.colorSpace = SRGBColorSpace;
  const art = cafeMaterial("art", atlas, mirror);
  const blob = blobMaterial(disc);
  const pool = poolMaterial(disc);
  const meshes = [
    plain(parts.fixed, solid, "cafe_fixed"),
    plain(parts.art, art, "cafe_art"),
    instanced(parts.chair, solid, parts.chairMatrices, "cafe_chairs"),
    instanced(parts.table, solid, parts.tableMatrices, "cafe_tables"),
    plain(parts.blobs, blob, "cafe_shadows"),
    plain(parts.pools, pool, "cafe_pools"),
  ];
  meshes[4]!.renderOrder = 1;
  meshes[5]!.renderOrder = 2;
  return {
    parts,
    meshes,
    pool,
    blob,
    dispose() {
      for (const g of [parts.fixed, parts.art, parts.chair, parts.table, parts.blobs, parts.pools]) g.dispose();
      for (const m of [solid, art, blob, pool]) m.dispose();
      atlas.dispose();
      mirror.dispose();
      disc.dispose();
    },
  };
}

/**
 * The village café's furniture (cafeLayout.ts): bentwood chairs and bistro tables as two instanced meshes, and one merged mesh of
 * the rest (the counter's and the shelves' bread, cakes, jars and cups, the Kelsch banquette, the oak ceiling beams, the pendants,
 * the plants, the clock and mirror, the tile mat), a textured one for the chalkboard menu and the framed prints, and two decals
 * (contact shadows, the pendants' warm pools): six draw calls, about 30 k triangles, lit by the room's own model (cafeMaterials.ts)
 * with the village's day and night. Seen through the glass only: the café is never entered, so nothing here is solid or sit-able.
 */
export function CafeInterior() {
  const built = useMemo(() => build(), []);
  useEffect(() => () => built.dispose(), [built]);
  const group = useRef<Group>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  // its programs link now, not on the first frame the glass looks in
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    void compileSafely(gl, g, camera, scene).catch(() => {});
  }, [gl, scene, camera]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvCafe = () => ({ drawCalls: built.meshes.length, triangles: Math.round(built.parts.triangles), chairs: built.parts.chairMatrices.length, tables: built.parts.tableMatrices.length });
    return () => {
      delete window.__cvCafe;
    };
  }, [built]);

  useFrame(() => {
    const s = dayNight.applied;
    cafeUniforms.uNight.value = s.night;
    cafeUniforms.uDay.value = s.day;
    cafeUniforms.uLit.value = s.lights;
    built.pool.opacity = 0.1 + 0.34 * s.lights;
    built.blob.opacity = 0.34;
  });

  return (
    <group ref={group} name="village-cafe-interior">
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} dispose={null} />
      ))}
    </group>
  );
}
