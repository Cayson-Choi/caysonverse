// The fishing shop's interior (owner 2026-11-16: "낚시점 같지가 않아"): lake_shop_interior.glb, its own model so the office in
// lake_structures.glb (walls, window, door, roof) stays as it is. Built and light-baked by
// docs/designs/lake-fishing/tools/build_shop_interior.py: a lining of the office (tiles, wainscot, plaster, 텍스 ceiling,
// fluorescent battens) and the shop's fit-out (rod rack with real rods, pegboard of lure / worm packs, float grid, reels,
// the notice board, bait shelves and fridge, coolers, nets, the counter with its lure case, cash tray, ledger, jar, fan).
//
// The light is baked into COLOR_0 (linear irradiance x 0.5): drawn unlit (map x COLOR_0 x 2), the same by day and night as
// a lit shop is, cheap on phones (9 materials, one draw each). Loaded with the lake's other files (inside LakeGlb), in a
// Suspense and a load boundary of its own: a missing interior never holds up or replaces the lake.

import { Suspense, useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { DoubleSide, MeshBasicMaterial, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { versionedUrl } from "../village/modelUrl";
import { LoadBoundary } from "../village/LoadBoundary";
import { DRACO_PATH } from "../game/hub/hubModelPrep";

export const SHOP_INTERIOR_URL = versionedUrl("/models/lake/lake_shop_interior.glb");

/** COLOR_0 holds half the baked light (so highlights up to 2x fit the 0..1 range). */
const LIGHT_SCALE = 2.0;

/** The unlit copy of one of the model's materials (by the material's name: atlas, floor, wall, ..., glass, emit). */
export function shopInteriorMaterial(src: MeshStandardMaterial): MeshBasicMaterial {
  const name = src.name;
  if (name === "glass") {
    return new MeshBasicMaterial({ name: "shop_glass", color: 0xd9eaf0, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
  }
  if (name === "emit") {
    // the fluorescent tubes and the fridge's light strip: past white, so the rich tier's bloom catches them
    const m = new MeshBasicMaterial({ name: "shop_emit" });
    m.color.setRGB(1.9, 1.85, 1.7);
    return m;
  }
  const m = new MeshBasicMaterial({ name: `shop_${name}`, map: src.map, vertexColors: true });
  m.color.setScalar(LIGHT_SCALE);
  if (name === "atlas") {
    // the landing nets' mesh and the fan's guards are cut out of the atlas; both sides drawn (the net bag is seen from inside)
    m.alphaTest = 0.5;
    m.side = DoubleSide;
  }
  return m;
}

/** Swap the loader's lit materials for the unlit baked-light ones (returns the new materials, to dispose). */
export function prepareShopInterior(root: Object3D): Material[] {
  const made = new Map<Material, MeshBasicMaterial>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const swap = (m: Material): Material => {
      const s = m as MeshStandardMaterial;
      if (!s.isMeshStandardMaterial) return m;
      let b = made.get(m);
      if (!b) {
        b = shopInteriorMaterial(s);
        made.set(m, b);
      }
      return b;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    if ((mesh.material as Material).transparent) mesh.renderOrder = 3;
  });
  return [...made.values()];
}

function ShopInteriorModel() {
  const gltf = useGLTF(SHOP_INTERIOR_URL, DRACO_PATH);
  const dressed = useMemo(() => {
    const root = gltf.scene.clone(true);
    return { root, mats: prepareShopInterior(root) };
  }, [gltf]);
  useEffect(() => () => dressed.mats.forEach((m) => m.dispose()), [dressed]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // E2E probe (e2e/shop-look.mjs): the interior's draw count and size, and the scene it is in
    const w = window as unknown as { __cvShopInterior?: unknown };
    w.__cvShopInterior = () => {
      let meshes = 0;
      let tris = 0;
      dressed.root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        meshes++;
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;
      });
      let scene: Object3D = dressed.root;
      while (scene.parent) scene = scene.parent;
      return { meshes, tris, materials: dressed.mats.length, scene };
    };
    return () => {
      delete w.__cvShopInterior;
    };
  }, [dressed]);
  return <primitive object={dressed.root} dispose={null} />;
}

export function LakeShopInterior() {
  return (
    <LoadBoundary fallback={null} onReset={() => useGLTF.clear(SHOP_INTERIOR_URL)} notice="낚시점 안을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
      <Suspense fallback={null}>
        <ShopInteriorModel />
      </Suspense>
    </LoadBoundary>
  );
}
