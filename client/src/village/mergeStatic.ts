import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Draw-call merge for a static prop (perf/phone-village, 2026-11-19): every plain mesh under `root` that shares a material (and a
 * shadow/render setup) becomes ONE mesh, its triangles baked into `root`'s space. Looks identical; one draw (one uniform upload,
 * one state change) per material instead of one per part. The crosswalk signal posts were 80+ tiny meshes in view, the public
 * door 43, for ~5000 triangles in all: on a phone the draw calls, not the triangles, are what the CPU pays.
 *
 * Only plain meshes with ONE material are merged; skinned / instanced / invisible meshes, array materials and anything
 * `keep` returns true for stay where they are (a lamp whose material is rewritten per frame needs no exception: the material is
 * shared by the merged mesh). A part that moves on its own (a door leaf) must not be under a `root` that is merged as one.
 * Emptied groups are removed. Geometry of the originals is NOT disposed (a glTF clone shares it); the merged one is new.
 * Returns how many meshes were folded away (originals minus merged meshes).
 */
export function mergeStaticByMaterial(root: Object3D, keep?: (m: Mesh) => boolean): number {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, Mesh[]>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as { isSkinnedMesh?: boolean }).isSkinnedMesh || (m as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    if (!m.visible || Array.isArray(m.material) || !m.geometry?.getAttribute("position") || keep?.(m)) return;
    const mat = m.material as Material;
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${m.frustumCulled ? 1 : 0}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  });
  let folded = 0;
  const tmp = new Matrix4();
  const emptied = new Set<Object3D>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // attributes every part has; a missing uv is filled with zeros (the part then samples the texture's corner, as it would unmerged: no uv = 0,0)
    const names = [...(list[0]!.geometry.attributes ? Object.keys(list[0]!.geometry.attributes) : [])].filter((n) => list.every((m) => m.geometry.getAttribute(n)));
    if (!names.includes("position")) continue;
    const anyUv = list.some((m) => m.geometry.getAttribute("uv"));
    const allIndexed = list.every((m) => m.geometry.index);
    const geos: BufferGeometry[] = [];
    for (const m of list) {
      const src = m.geometry;
      const g = new BufferGeometry();
      for (const n of names) g.setAttribute(n, src.getAttribute(n).clone());
      if (anyUv && !g.getAttribute("uv")) g.setAttribute("uv", new BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
      if (src.index) g.setIndex(src.index.clone());
      const geo = allIndexed || !g.index ? g : g.toNonIndexed();
      m.updateWorldMatrix(true, false);
      geo.applyMatrix4(tmp.multiplyMatrices(toRoot, m.matrixWorld));
      geos.push(geo);
    }
    const merged = mergeGeometries(geos.map((g) => (allIndexed || !g.index ? g : g.toNonIndexed())));
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const first = list[0]!;
    const mesh = new Mesh(merged, first.material);
    mesh.name = first.name || `merged_${(first.material as Material).name || "mat"}`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const m of list) {
      if (m.parent) emptied.add(m.parent);
      m.removeFromParent();
    }
    folded += list.length - 1;
  }
  // drop the groups the merge emptied (only those: an empty anchor node of the file stays)
  for (const p of emptied) {
    for (let g: Object3D | null = p; g && g !== root && g.children.length === 0; ) {
      const up: Object3D | null = g.parent;
      g.removeFromParent();
      g = up;
    }
  }
  return folded;
}
