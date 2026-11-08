import {
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from "three";
import type { CubbyAnchor } from "@caysonverse/shared/village/villageLayout";
import { PROP_KINDS, SAMPLE_PHOTO_ATLAS, type PropKind, type PropPlacement, type SampleCubby } from "./sampleCubbies";

/**
 * The memorial cubbies' props as GPU instances (케이슨 마을 Task 9; Task 8 review m2): ONE InstancedMesh per prop kind
 * and material slot, whatever the number of cubbies — about a dozen draw calls for the ~1,000 props of 160 filled
 * cubbies, where cloning them one by one would cost a thousand. The portraits differ per cubby but share one material:
 * the photo slot reads a tile of the placeholder atlas through a per-instance UV offset (`photoTile`), not a material
 * per photo. The name cards stay plain (the name is on the close-up card).
 *
 * `layoutCubbyProps` is pure (numbers only: the matrices and the photo tiles); `buildCubbyPropMeshes` turns its output
 * and the loaded memorial_props.glb into the meshes.
 */

/** Height of the cubby's floor under its anchor (the opening centre; the cell is 0.4 m tall). */
export const CUBBY_FLOOR_BELOW_ANCHOR = 0.2;

/** One prop kind's instances: their matrices (16 floats each, column-major) and, for the photo frame, the atlas tiles. */
export interface PropInstances {
  kind: PropKind;
  count: number;
  matrices: Float32Array;
  /** The cubby each instance belongs to (same order). */
  cubbies: string[];
  /** photo_frame only: the portrait (atlas tile index) of each instance. */
  photoTiles?: number[];
}

const position = new Vector3();
const quaternion = new Quaternion();
const unitScale = new Vector3(1, 1, 1);
const up = new Vector3(0, 1, 0);

/**
 * The world matrix of a prop placed in a cubby: at the anchor, `u` along the run (the cubby's right-hand axis
 * `(cos yaw, -sin yaw)`), `w` back into the cubby (against its facing `(sin yaw, cos yaw)`), on the cubby's floor plus
 * `dy`, turned to the cubby's yaw plus the prop's `turn`. The same frame the Task 8 renders used.
 */
export function placementMatrix(anchor: CubbyAnchor, p: Pick<PropPlacement, "u" | "w" | "dy" | "turn">, out: Matrix4 = new Matrix4()): Matrix4 {
  const fx = Math.sin(anchor.yaw);
  const fz = Math.cos(anchor.yaw);
  const sx = fz;
  const sz = -fx;
  position.set(anchor.x + sx * p.u - fx * p.w, anchor.y - CUBBY_FLOOR_BELOW_ANCHOR + p.dy, anchor.z + sz * p.u - fz * p.w);
  quaternion.setFromAxisAngle(up, anchor.yaw + p.turn);
  return out.compose(position, quaternion, unitScale);
}

/**
 * The instances of every prop kind the samples use: one entry per kind (in `PROP_KINDS` order, kinds with no instance
 * left out), its count the number of placements of that kind over all the samples. An empty cubby (no sample) gets
 * nothing; a sample whose cubby is not among `anchors` is skipped.
 */
export function layoutCubbyProps(anchors: readonly CubbyAnchor[], samples: readonly SampleCubby[]): PropInstances[] {
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const lists = new Map<PropKind, { placements: Array<{ anchor: CubbyAnchor; p: PropPlacement; photo: number }> }>();
  for (const s of samples) {
    const anchor = byId.get(s.id);
    if (!anchor) continue;
    for (const p of s.props) {
      let list = lists.get(p.kind);
      if (!list) lists.set(p.kind, (list = { placements: [] }));
      list.placements.push({ anchor, p, photo: s.photo });
    }
  }
  const m = new Matrix4();
  const out: PropInstances[] = [];
  for (const kind of PROP_KINDS) {
    const list = lists.get(kind);
    if (!list || list.placements.length === 0) continue;
    const matrices = new Float32Array(list.placements.length * 16);
    list.placements.forEach(({ anchor, p }, i) => placementMatrix(anchor, p, m).toArray(matrices, i * 16));
    const entry: PropInstances = { kind, count: list.placements.length, matrices, cubbies: list.placements.map((x) => x.anchor.id) };
    if (kind === "photo_frame") entry.photoTiles = list.placements.map((x) => x.photo);
    out.push(entry);
  }
  return out;
}

/** The UV offset of an atlas tile (tile 0 top-left, row by row; the atlas is read with flipY off, so v grows downward). */
export function photoTileOffset(tile: number, atlas: { cols: number; rows: number } = SAMPLE_PHOTO_ATLAS): [number, number] {
  const t = ((Math.floor(tile) % (atlas.cols * atlas.rows)) + atlas.cols * atlas.rows) % (atlas.cols * atlas.rows);
  return [(t % atlas.cols) / atlas.cols, Math.floor(t / atlas.cols) / atlas.rows];
}

/** The per-instance attribute data of the photo slot: two floats (the tile's UV offset) per instance. */
export function photoTileAttribute(tiles: readonly number[], atlas: { cols: number; rows: number } = SAMPLE_PHOTO_ATLAS): Float32Array {
  const out = new Float32Array(tiles.length * 2);
  tiles.forEach((t, i) => {
    const [u, v] = photoTileOffset(t, atlas);
    out[i * 2] = u;
    out[i * 2 + 1] = v;
  });
  return out;
}

/** The photo slot's material name in memorial_props.glb, and the one the runtime replaces. */
export const PHOTO_MATERIAL = "M_photo";

/**
 * The portraits' one material: unlit, the atlas as its map, each instance's UV moved to its tile (`photoTile`, scaled
 * by `1 / cols`, `1 / rows`). The atlas texture is the caller's (configured with flipY off and sRGB).
 */
export function makePhotoMaterial(atlas: Texture, grid: { cols: number; rows: number } = SAMPLE_PHOTO_ATLAS): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map: atlas, toneMapped: true });
  m.name = "M_photo (atlas)";
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPhotoScale = { value: [1 / grid.cols, 1 / grid.rows] };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute vec2 photoTile;\nuniform vec2 uPhotoScale;\nvoid main() {")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = vMapUv * uPhotoScale + photoTile;\n#endif");
  };
  m.customProgramCacheKey = () => "cubby-photo-atlas";
  return m;
}

/** The props' meshes and what the caller must release with them (the copies made here; the loader keeps its own). */
export interface CubbyPropMeshes {
  group: Group;
  meshes: InstancedMesh[];
  own: Array<{ dispose(): void }>;
}

/**
 * The InstancedMeshes of `layout` from the loaded props scene: for each kind, one per mesh (material slot) under its
 * `prop__<kind>` node, sharing the loader's geometry and material — except the photo slot, which gets `photoMaterial`
 * and a copy of its geometry carrying the per-instance tiles. A kind the file lacks is skipped.
 */
export function buildCubbyPropMeshes(propsScene: Object3D, layout: readonly PropInstances[], photoMaterial: Material): CubbyPropMeshes {
  const group = new Group();
  group.name = "cubby_props";
  const meshes: InstancedMesh[] = [];
  const own: Array<{ dispose(): void }> = [];
  propsScene.updateMatrixWorld(true);
  const local = new Matrix4();
  const inv = new Matrix4();
  const m = new Matrix4();
  for (const entry of layout) {
    const node = propsScene.getObjectByName(`prop__${entry.kind}`);
    if (!node) continue;
    inv.copy(node.matrixWorld).invert();
    const parts: Mesh[] = [];
    node.traverse((o) => {
      if ((o as Mesh).isMesh) parts.push(o as Mesh);
    });
    for (const part of parts) {
      local.multiplyMatrices(inv, part.matrixWorld);
      const source = Array.isArray(part.material) ? part.material[0]! : part.material;
      const isPhoto = source.name === PHOTO_MATERIAL;
      let geometry: BufferGeometry = part.geometry;
      if (isPhoto) {
        geometry = part.geometry.clone();
        geometry.setAttribute("photoTile", new InstancedBufferAttribute(photoTileAttribute(entry.photoTiles ?? []), 2));
        own.push(geometry);
      }
      const mesh = new InstancedMesh(geometry, isPhoto ? photoMaterial : source, entry.count);
      mesh.name = `inst__${entry.kind}_${source.name}`;
      for (let i = 0; i < entry.count; i += 1) {
        m.fromArray(entry.matrices, i * 16).multiply(local);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      own.push(mesh);
      meshes.push(mesh);
      group.add(mesh);
    }
  }
  return { group, meshes, own };
}
