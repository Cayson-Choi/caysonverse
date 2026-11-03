/**
 * scripts/lib/schoolGlb.ts — 학교 GLB 도구의 순수 부분 (extract-colliders.ts, check-school-glb.ts가 쓴다).
 *
 * GLB 읽기, `col__*` 충돌 상자 추출(0.01 반올림·정렬·회전 거부), 이미지 크기, 삼각형 수, 예산 점검.
 * 파일 읽기·출력은 여기 없다: 함수는 값을 받아 값을 돌려준다(테스트: server/src/tools/schoolGlb.test.ts).
 * 의존성 없음(node 내장·타입만). Draco는 풀지 않는다: 삼각형 수는 확장이 JSON에 남기는 accessor `count`로 센다
 * (KHR_draco_mesh_compression 규격상 압축된 primitive도 indices/POSITION accessor의 count를 그대로 적는다).
 */

import type { AABB } from "../../shared/src/collision";

// ---------------------------------------------------------------------------------------------------------
// glTF document (only the fields these tools read).

export interface GltfNode {
  name?: string;
  mesh?: number;
  /** EXT_mesh_gpu_instancing: { attributes: { TRANSLATION?, ROTATION?, SCALE? } } (accessor indices). */
  extensions?: Record<string, unknown>;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
  extensions?: Record<string, unknown>;
}

export interface GltfAccessor {
  count: number;
  componentType?: number;
  type?: string;
  min?: number[];
  max?: number[];
  bufferView?: number;
}

export interface Gltf {
  asset?: { version?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: Array<{ name?: string; primitives: GltfPrimitive[] }>;
  materials?: Array<{ name?: string; extensions?: Record<string, unknown> }>;
  accessors?: GltfAccessor[];
  bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength: number }>;
  images?: Array<{ uri?: string; mimeType?: string; bufferView?: number; name?: string }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface ParsedGlb {
  gltf: Gltf;
  /** The BIN chunk, or null when the file has none. */
  bin: Uint8Array | null;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Reads a binary glTF: 12-byte header, then chunks (length, type, payload). Throws on anything malformed. */
export function parseGlb(data: Uint8Array): ParsedGlb {
  if (data.length < 20) throw new Error("GLB가 너무 짧아요");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("GLB가 아니에요 (glTF 머리말 없음)");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB version ${version}은 지원하지 않아요 (2만)`);
  const total = view.getUint32(8, true);
  if (total > data.length) throw new Error(`GLB가 잘렸어요 (머리말 ${total} 바이트, 파일 ${data.length} 바이트)`);
  let gltf: Gltf | null = null;
  let bin: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > total) throw new Error("GLB 덩어리가 파일 밖으로 나가요");
    if (type === CHUNK_JSON && gltf === null) {
      gltf = JSON.parse(Buffer.from(data.buffer, data.byteOffset + start, length).toString("utf8")) as Gltf;
    } else if (type === CHUNK_BIN && bin === null) {
      bin = new Uint8Array(data.buffer, data.byteOffset + start, length);
    }
    offset = start + length;
  }
  if (gltf === null) throw new Error("GLB에 JSON 덩어리가 없어요");
  return { gltf, bin };
}

// ---------------------------------------------------------------------------------------------------------
// Node transforms.

type Mat4 = number[]; // column-major, like glTF

function localMatrix(n: GltfNode): Mat4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.slice();
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mulMat(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function parentMap(nodes: readonly GltfNode[]): Map<number, number> {
  const parent = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parent.set(c, i);
  });
  return parent;
}

/** World-space translation (x, y, z) of node `index`: its parents' transforms applied. */
export function worldTranslation(gltf: Gltf, index: number): [number, number, number] {
  const nodes = gltf.nodes ?? [];
  const parent = parentMap(nodes);
  const chain: number[] = [];
  const seen = new Set<number>();
  for (let i: number | undefined = index; i !== undefined && !seen.has(i); i = parent.get(i)) {
    seen.add(i);
    chain.push(i);
  }
  let world: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let k = chain.length - 1; k >= 0; k -= 1) world = mulMat(world, localMatrix(nodes[chain[k]!]!));
  return [world[12]!, world[13]!, world[14]!];
}

/** True when the node has no rotation (a quaternion whose x, y, z are all ~0; w = +-1 is the same turn). */
export function hasNoRotation(n: GltfNode, eps = 1e-6): boolean {
  const r = n.rotation;
  if (!r) return true;
  return Math.abs(r[0] ?? 0) <= eps && Math.abs(r[1] ?? 0) <= eps && Math.abs(r[2] ?? 0) <= eps;
}

// ---------------------------------------------------------------------------------------------------------
// col__* -> AABB.

/** Rounds to 0.01 and never returns -0. */
export function roundToHundredth(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

export interface NamedBox {
  name: string;
  box: AABB;
}

export interface ColliderExtraction {
  /** Sorted by minX, minZ, maxX, maxZ, then name. */
  colliders: NamedBox[];
  /** Why a col__ node cannot be turned into a box (empty = all good). */
  problems: string[];
}

const COLLIDER_PREFIX = "col__";
const UNIT_CUBE_TOLERANCE = 0.01;

/**
 * Every `col__*` node is a unit cube with a translation and a scale, no rotation, no parent, so its box on the
 * ground plane is translation +- scale/2 on x and z (rounded to 0.01). Anything that would make that wrong
 * (rotation, matrix, parent, zero size, a mesh that is not a unit cube) is reported in `problems`.
 */
export function extractColliders(gltf: Gltf): ColliderExtraction {
  const nodes = gltf.nodes ?? [];
  const parent = parentMap(nodes);
  const colliders: NamedBox[] = [];
  const problems: string[] = [];
  nodes.forEach((n, i) => {
    const name = n.name ?? "";
    if (!name.startsWith(COLLIDER_PREFIX)) return;
    let ok = true;
    if (parent.has(i)) {
      problems.push(`${name}: 부모 노드가 있어요 (col__ 노드는 장면 맨 위에 있어야 해요)`);
      ok = false;
    }
    if (n.matrix) {
      problems.push(`${name}: matrix로 저장됐어요 (translation·scale만 쓸 수 있어요)`);
      ok = false;
    }
    if (!hasNoRotation(n)) {
      problems.push(`${name}: 회전이 있어요 rotation=[${(n.rotation ?? []).join(", ")}] (충돌 상자는 회전할 수 없어요)`);
      ok = false;
    }
    const [sx, sz] = [Math.abs(n.scale?.[0] ?? 1), Math.abs(n.scale?.[2] ?? 1)];
    if (!(sx >= 0.01 && sz >= 0.01)) {
      problems.push(`${name}: 크기가 0이에요 (scale x=${n.scale?.[0] ?? 1}, z=${n.scale?.[2] ?? 1})`);
      ok = false;
    }
    const cubeProblem = notUnitCube(gltf, n);
    if (cubeProblem) {
      problems.push(`${name}: 정육면체가 아니에요 (cube) ${cubeProblem}`);
      ok = false;
    }
    if (!ok) return;
    const x = n.translation?.[0] ?? 0;
    const z = n.translation?.[2] ?? 0;
    colliders.push({
      name,
      box: {
        minX: roundToHundredth(x - sx / 2),
        maxX: roundToHundredth(x + sx / 2),
        minZ: roundToHundredth(z - sz / 2),
        maxZ: roundToHundredth(z + sz / 2),
      },
    });
  });
  colliders.sort(
    (a, b) =>
      a.box.minX - b.box.minX ||
      a.box.minZ - b.box.minZ ||
      a.box.maxX - b.box.maxX ||
      a.box.maxZ - b.box.maxZ ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return { colliders, problems };
}

/** A description of why the node's mesh is not a unit cube on x and z, or "" when it is (or has no mesh/bounds). */
function notUnitCube(gltf: Gltf, n: GltfNode): string {
  if (n.mesh === undefined) return "";
  for (const prim of gltf.meshes?.[n.mesh]?.primitives ?? []) {
    const acc = gltf.accessors?.[prim.attributes.POSITION ?? -1];
    if (!acc?.min || !acc.max) continue;
    for (const axis of [0, 2]) {
      const lo = acc.min[axis]!;
      const hi = acc.max[axis]!;
      if (Math.abs(lo + 0.5) > UNIT_CUBE_TOLERANCE || Math.abs(hi - 0.5) > UNIT_CUBE_TOLERANCE) {
        return `(${axis === 0 ? "x" : "z"} ${lo}..${hi}, 필요: -0.5..0.5)`;
      }
    }
  }
  return "";
}

/** From this height up (m) a prop is a box the camera must not see through (lower furniture is looked over). */
export const CAMERA_BOX_MIN_HEIGHT = 1.6;

export interface TallBox {
  name: string;
  box: AABB;
  /** How tall the prop stands (m, 0.01). */
  height: number;
}

/**
 * The `col__*` boxes whose prop stands `CAMERA_BOX_MIN_HEIGHT` or higher: the camera boxes among the props.
 * A box's height is the top of its node (translation.y + scale.y / 2: the hub's locker banks are 2.2 m boxes)
 * or, when the art kept the box a plain 1 m cube although the prop is taller (every counselling-room box),
 * the height `known` gives for its name without the `col__` prefix (schoolSpec.ts: measured from the model).
 * Same order as `colliders`.
 */
export function tallColliders(gltf: Gltf, colliders: readonly NamedBox[], known: Readonly<Record<string, number>> = {}): TallBox[] {
  const byName = new Map<string, GltfNode>();
  for (const n of gltf.nodes ?? []) if (n.name !== undefined && !byName.has(n.name)) byName.set(n.name, n);
  const out: TallBox[] = [];
  for (const c of colliders) {
    const n = byName.get(c.name);
    const nodeTop = n ? (n.translation?.[1] ?? 0) + Math.abs(n.scale?.[1] ?? 1) / 2 : 0;
    const key = c.name.slice(COLLIDER_PREFIX.length);
    const stated = Object.prototype.hasOwnProperty.call(known, key) ? known[key]! : 0;
    const height = roundToHundredth(Math.max(nodeTop, stated));
    if (height >= CAMERA_BOX_MIN_HEIGHT) out.push({ name: c.name, box: c.box, height });
  }
  return out;
}

export interface ColliderModuleInput {
  /** The exported const's name, e.g. HUB_PROP_COLLIDERS. */
  exportName: string;
  /** The GLB's file name, written into the header. */
  source: string;
  colliders: readonly NamedBox[];
  /** Import path of shared/src/collision as seen from the output file, e.g. "../../collision". */
  collisionImport: string;
  /** The tall props, as a second export (camera boxes with their heights). Omitted: only the collider list is written. */
  tall?: { exportName: string; boxes: readonly TallBox[] };
}

/** The text of the generated TypeScript module (one box per line, node name as a comment). */
export function renderColliderModule(input: ColliderModuleInput): string {
  const isIdentifier = (name: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  if (!isIdentifier(input.exportName)) {
    throw new Error(`내보낼 이름이 식별자가 아니에요: ${input.exportName}`);
  }
  if (input.tall && (!isIdentifier(input.tall.exportName) || input.tall.exportName === input.exportName)) {
    throw new Error(`카메라 상자를 내보낼 이름이 식별자가 아니거나 같아요: ${input.tall.exportName}`);
  }
  const num = (v: number) => String(roundToHundredth(v));
  const lines = input.colliders.map(
    (c) =>
      `  { minX: ${num(c.box.minX)}, maxX: ${num(c.box.maxX)}, minZ: ${num(c.box.minZ)}, maxZ: ${num(c.box.maxZ)} }, // ${c.name}`,
  );
  const body = lines.length ? `[\n${lines.join("\n")}\n]` : "[]";
  const out = [
    "// GENERATED by scripts/extract-colliders.ts — 손으로 고치지 않는다",
    `// ${input.source}의 col__* 노드에서 뽑은 충돌 상자(바닥 평면, 0.01 단위, minX·minZ 순 정렬).`,
    "// 모델을 고치면 `npx tsx --tsconfig server/tsconfig.json scripts/extract-colliders.ts`로 다시 만든다.",
    "",
    `import type { ${input.tall ? "AABB, CameraBox" : "AABB"} } from "${input.collisionImport}";`,
    "",
    `export const ${input.exportName}: readonly AABB[] = ${body};`,
    "",
  ];
  if (input.tall) {
    const tallLines = input.tall.boxes.map(
      (t) =>
        `  { minX: ${num(t.box.minX)}, maxX: ${num(t.box.maxX)}, minZ: ${num(t.box.minZ)}, maxZ: ${num(t.box.maxZ)}, height: ${num(t.height)} }, // ${t.name}`,
    );
    out.push(
      `// 위 상자 가운데 ${CAMERA_BOX_MIN_HEIGHT} m 이상 큰 소품(사물함·책장…): 카메라가 뚫고 보면 안 되는 상자(높이 포함).`,
      `export const ${input.tall.exportName}: readonly CameraBox[] = ${tallLines.length ? `[\n${tallLines.join("\n")}\n]` : "[]"};`,
      "",
    );
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------
// Images and triangles.

export interface ImageSize {
  width: number;
  height: number;
}

/** Pixel size from the file header of a PNG, JPEG or WebP (VP8, VP8L, VP8X); null if unreadable. */
export function imageSize(b: Uint8Array): ImageSize | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) return null;
      const marker = buf[p + 1]!;
      if (marker === 0xff) {
        p += 1;
        continue;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
      p += 2 + buf.readUInt16BE(p + 2);
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = buf.toString("ascii", 12, 16);
    if (fourcc === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (fourcc === "VP8L" && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  }
  return null;
}

const GPU_INSTANCING = "EXT_mesh_gpu_instancing";

/**
 * How many times a node's mesh is drawn: 1, or the instance count of its EXT_mesh_gpu_instancing attributes
 * (the count of the TRANSLATION / ROTATION / SCALE accessor; a reference to a missing accessor throws).
 */
export function instanceCount(gltf: Gltf, n: GltfNode): number {
  const ext = n.extensions?.[GPU_INSTANCING] as { attributes?: Record<string, number> } | undefined;
  if (!ext) return 1;
  const attrs = ext.attributes ?? {};
  for (const key of ["TRANSLATION", "ROTATION", "SCALE"]) {
    const index = attrs[key];
    if (index === undefined) continue;
    const accessor = gltf.accessors?.[index];
    if (!accessor) throw new Error(`${n.name ?? "노드"}의 ${GPU_INSTANCING} ${key}가 없는 accessor ${index}를 가리켜요`);
    return accessor.count;
  }
  return 1;
}

/** Triangles stored in the file: each mesh counted once per node that uses it (instancing not multiplied). */
export function countFileTriangles(gltf: Gltf): number {
  return countTrianglesWith(gltf, () => 1);
}

/**
 * Triangles drawn: each mesh primitive counted once per node that uses it — times the node's GPU instance count
 * (EXT_mesh_gpu_instancing) — for nodes reachable from the default scene (or all scenes / all nodes when the
 * document has none). TRIANGLES, STRIP and FAN modes count; points and lines do not. `col__*` boxes (and anything
 * under them) are not counted: the game hides them at load.
 */
export function countTriangles(gltf: Gltf): number {
  return countTrianglesWith(gltf, (n) => instanceCount(gltf, n));
}

function countTrianglesWith(gltf: Gltf, times: (n: GltfNode) => number): number {
  const nodes = gltf.nodes ?? [];
  const roots = rootNodes(gltf);
  let total = 0;
  const visit = (index: number, path: Set<number>): void => {
    if (path.has(index)) return;
    const n = nodes[index];
    if (!n || (n.name ?? "").startsWith(COLLIDER_PREFIX)) return;
    if (n.mesh !== undefined) total += meshTriangles(gltf, n.mesh) * times(n);
    path.add(index);
    for (const c of n.children ?? []) visit(c, path);
    path.delete(index);
  };
  for (const r of roots) visit(r, new Set());
  return total;
}

function rootNodes(gltf: Gltf): number[] {
  const scenes = gltf.scenes ?? [];
  if (scenes.length > 0) {
    const scene = scenes[gltf.scene ?? 0] ?? scenes[0];
    return scene?.nodes ?? [];
  }
  const parent = parentMap(gltf.nodes ?? []);
  return (gltf.nodes ?? []).map((_, i) => i).filter((i) => !parent.has(i));
}

/** The accessor a primitive's triangle count comes from. A reference to an accessor that is not there throws (a broken file must FAIL, not count as 0). */
function countAccessor(gltf: Gltf, meshIndex: number, primIndex: number, what: string, index: number | undefined): number {
  if (index === undefined) throw new Error(`메시 ${meshIndex}의 primitive ${primIndex}에 ${what}가 없어요`);
  const accessor = gltf.accessors?.[index];
  if (!accessor) throw new Error(`메시 ${meshIndex}의 primitive ${primIndex}가 없는 accessor ${index}(${what})를 가리켜요`);
  return accessor.count;
}

function meshTriangles(gltf: Gltf, meshIndex: number): number {
  let sum = 0;
  (gltf.meshes?.[meshIndex]?.primitives ?? []).forEach((prim, primIndex) => {
    const count =
      prim.indices !== undefined
        ? countAccessor(gltf, meshIndex, primIndex, "indices", prim.indices)
        : countAccessor(gltf, meshIndex, primIndex, "POSITION", prim.attributes.POSITION);
    const mode = prim.mode ?? 4;
    if (mode === 4) sum += Math.floor(count / 3);
    else if (mode === 5 || mode === 6) sum += Math.max(0, count - 2);
  });
  return sum;
}

// ---------------------------------------------------------------------------------------------------------
// The budget checks.

export type SchoolKind = "hub" | "counsel" | "village";
export type Level = "ok" | "fail" | "warn";

export interface CheckResult {
  level: Level;
  label: string;
  detail: string;
}

const MB = 1024 * 1024;
/**
 * Plan Global Constraints: hub (hall + corridor) <= 3.5 MB, classroom <= 5 MB; triangles from Task 22.
 * 케이슨 마을 (village plan, Global Constraints): village.glb <= 8 MB and <= 260k triangles.
 */
export const BUDGETS: Record<SchoolKind, { maxBytes: number; maxTriangles: number }> = {
  hub: { maxBytes: 3.5 * MB, maxTriangles: 150_000 },
  counsel: { maxBytes: 5 * MB, maxTriangles: 120_000 },
  village: { maxBytes: 8 * MB, maxTriangles: 260_000 },
};
/** A required col__ box may differ from its layout box by at most this much on each side (m; boxes are read at 0.01). */
export const BOX_TOLERANCE = 0.011;
export const MAX_MATERIALS = 24;
export const MAX_TEXTURE_SIDE = 2048;
/** An obj__ node's origin may differ from the TS anchor by at most this much (m, on the ground plane). */
export const OBJ_ANCHOR_TOLERANCE = 0.25;

const UNLIT = "KHR_materials_unlit";
const DRACO = "KHR_draco_mesh_compression";
const LIGHTMAP_MATERIAL_PREFIX = "LM_";

/** What the model must contain, derived from the TS layout data (see schoolSpec.ts). */
export interface SchoolSpec {
  kind: SchoolKind;
  requiredNodes: string[];
  /** At least `min` nodes whose name starts with `prefix` (col__ boxes, shaft__ points). */
  requiredPrefixes: Array<{ prefix: string; min: number }>;
  /** The node's world position (x, z) must be within OBJ_ANCHOR_TOLERANCE of this point. */
  placements: Array<{ node: string; x: number; z: number }>;
  /** Nodes with these prefixes must have no rotation (the code animates them from the authored pose). */
  identityRotationPrefixes: string[];
  /**
   * col__ boxes that must exist with exactly this rectangle on the ground plane (within BOX_TOLERANCE per side):
   * the village's layout colliders (shared/src/village/villageLayout.ts), which the game's colliders are generated from.
   * `camera`: the layout's camera flag. The collider extraction makes a box a camera box when its node's top
   * (translation.y + scale.y / 2) is CAMERA_BOX_MIN_HEIGHT or more, so that must agree with the flag.
   */
  requiredBoxes?: Array<{ node: string; box: AABB; camera: boolean }>;
  /** Materials that must exist by exact name and must not be light-mapped (not LM_*): the game drives them itself. */
  requiredMaterials?: string[];
}

export interface LightmapFile {
  path: string;
  width: number;
  height: number;
}

export interface CheckInput {
  kind: SchoolKind;
  fileBytes: number;
  gltf: Gltf;
  /** The GLB's BIN chunk (embedded images are read from it). */
  bin: Uint8Array | null;
  spec: SchoolSpec;
  /** The separate light-map WebP found next to the GLB, or null when there is none. */
  lightmap: LightmapFile | null;
  /** Reads an image referenced by `uri` (the CLI passes a file reader). */
  readUri?: (uri: string) => Uint8Array | null;
}

const fmtMB = (bytes: number) => `${(bytes / MB).toFixed(2)} MB`;
const result = (ok: boolean, label: string, detail: string): CheckResult => ({ level: ok ? "ok" : "fail", label, detail });
const nameList = (names: readonly string[], max = 8) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} 외 ${names.length - max}개`;

/** Runs every budget/contract check and returns one result per check (a failed check has level "fail"). */
export function checkSchoolGlb(input: CheckInput): CheckResult[] {
  const { kind, gltf, spec } = input;
  const budget = BUDGETS[kind];
  const nodes = gltf.nodes ?? [];
  const names = new Set(nodes.map((n) => n.name ?? ""));
  const out: CheckResult[] = [];

  out.push(
    result(
      input.fileBytes <= budget.maxBytes,
      "파일 크기",
      `${fmtMB(input.fileBytes)} (${input.fileBytes} 바이트), 한도 ${fmtMB(budget.maxBytes)}`,
    ),
  );

  const missing = spec.requiredNodes.filter((n) => !names.has(n));
  out.push(
    result(
      missing.length === 0,
      "필수 노드",
      missing.length === 0 ? `${spec.requiredNodes.length}개 모두 있어요` : `없는 노드 ${missing.length}개: ${nameList(missing)}`,
    ),
  );

  const prefixProblems: string[] = [];
  const prefixInfo: string[] = [];
  for (const { prefix, min } of spec.requiredPrefixes) {
    const found = nodes.filter((n) => (n.name ?? "").startsWith(prefix)).length;
    prefixInfo.push(`${prefix}* ${found}개`);
    if (found < min) prefixProblems.push(`${prefix}* 노드가 ${found}개 (최소 ${min}개)`);
  }
  out.push(result(prefixProblems.length === 0, "노드 묶음", prefixProblems.length === 0 ? prefixInfo.join(", ") : prefixProblems.join("; ")));

  const placementProblems: string[] = [];
  let maxDist = 0;
  let checked = 0;
  for (const p of spec.placements) {
    const index = nodes.findIndex((n) => n.name === p.node);
    if (index < 0) continue; // already reported as missing
    const [x, , z] = worldTranslation(gltf, index);
    const dist = Math.hypot(x - p.x, z - p.z);
    checked += 1;
    maxDist = Math.max(maxDist, dist);
    if (dist > OBJ_ANCHOR_TOLERANCE + 1e-9) {
      placementProblems.push(`${p.node} 위치 (${x.toFixed(2)}, ${z.toFixed(2)}) 이 앵커 (${p.x}, ${p.z})에서 ${dist.toFixed(2)} m`);
    }
  }
  out.push(
    result(
      placementProblems.length === 0,
      "앵커 위치",
      placementProblems.length === 0
        ? `${checked}개, 가장 먼 것 ${maxDist.toFixed(2)} m (한도 ${OBJ_ANCHOR_TOLERANCE} m)`
        : `${placementProblems.join("; ")} (한도 ${OBJ_ANCHOR_TOLERANCE} m)`,
    ),
  );

  const colliders = extractColliders(gltf);
  out.push(
    result(
      colliders.problems.length === 0,
      "col__ 충돌 상자",
      colliders.problems.length === 0 ? `${colliders.colliders.length}개, 회전·부모 없음` : colliders.problems.join("; "),
    ),
  );
  if (spec.requiredBoxes && spec.requiredBoxes.length > 0) out.push(checkRequiredBoxes(gltf, spec.requiredBoxes, colliders.colliders));
  if (spec.requiredMaterials && spec.requiredMaterials.length > 0) out.push(checkRequiredMaterials(gltf, spec.requiredMaterials));
  const instancing = checkInstancing(gltf);
  if (instancing) out.push(instancing);

  const rotated = nodes
    .filter((n) => spec.identityRotationPrefixes.some((p) => (n.name ?? "").startsWith(p)) && !hasNoRotation(n))
    .map((n) => n.name ?? "");
  if (spec.identityRotationPrefixes.length > 0) {
    out.push(
      result(
        rotated.length === 0,
        "회전 없는 노드",
        rotated.length === 0 ? `${spec.identityRotationPrefixes.join(", ")} 노드에 회전이 없어요` : `회전이 있는 노드: ${nameList(rotated)}`,
      ),
    );
  }

  try {
    const triangles = countTriangles(gltf);
    const stored = countFileTriangles(gltf);
    const instanced = stored === triangles ? "" : `, GPU 인스턴스 포함 (파일에 든 것 ${stored}개)`;
    out.push(
      result(triangles <= budget.maxTriangles, "삼각형 수", `${triangles}개 (col__ 상자 제외${instanced}), 한도 ${budget.maxTriangles}개`),
    );
  } catch (err) {
    out.push(result(false, "삼각형 수", `셀 수 없어요: ${(err as Error).message}`));
  }

  const materials = gltf.materials ?? [];
  out.push(result(materials.length <= MAX_MATERIALS, "재질 수", `${materials.length}개, 한도 ${MAX_MATERIALS}개`));

  out.push(checkTextures(input));

  const used = new Set(gltf.extensionsUsed ?? []);
  out.push(result(used.has(UNLIT), "KHR_materials_unlit", used.has(UNLIT) ? "extensionsUsed에 있어요" : "extensionsUsed에 KHR_materials_unlit이 없어요"));
  const drawn = new Set<string>();
  for (const mesh of gltf.meshes ?? []) for (const prim of mesh.primitives) for (const k of Object.keys(prim.extensions ?? {})) drawn.add(k);
  const draco = used.has(DRACO) || drawn.has(DRACO);
  out.push(
    result(
      !drawn.has(DRACO) || used.has(DRACO),
      "Draco(선택)",
      draco
        ? `Draco 압축 GLB (삼각형은 accessor count로 셌어요)${used.has(DRACO) ? "" : ", 그런데 extensionsUsed에 빠져 있어요"}`
        : "Draco 없음 (괜찮아요)",
    ),
  );

  out.push(...checkLightmap(input));
  return out;
}

/**
 * Every required col__ box exists (as a valid box) with the layout's rectangle, and its height agrees with the layout's
 * camera flag (top >= CAMERA_BOX_MIN_HEIGHT exactly when camera). Missing nodes are reported by "필수 노드".
 */
function checkRequiredBoxes(
  gltf: Gltf,
  required: ReadonlyArray<{ node: string; box: AABB; camera: boolean }>,
  found: readonly NamedBox[],
): CheckResult {
  const byName = new Map(found.map((c) => [c.name, c.box]));
  const nodes = gltf.nodes ?? [];
  const problems: string[] = [];
  let checked = 0;
  for (const r of required) {
    const b = byName.get(r.node);
    if (!b) continue;
    checked += 1;
    const sides = [b.minX - r.box.minX, b.maxX - r.box.maxX, b.minZ - r.box.minZ, b.maxZ - r.box.maxZ];
    if (sides.some((d) => Math.abs(d) > BOX_TOLERANCE)) {
      problems.push(
        `${r.node} (${b.minX}..${b.maxX}, ${b.minZ}..${b.maxZ}) ≠ 배치 (${r.box.minX}..${r.box.maxX}, ${r.box.minZ}..${r.box.maxZ})`,
      );
    }
    const n = nodes.find((x) => x.name === r.node);
    const top = roundToHundredth((n?.translation?.[1] ?? 0) + Math.abs(n?.scale?.[1] ?? 1) / 2);
    if (top >= CAMERA_BOX_MIN_HEIGHT !== r.camera) {
      problems.push(
        r.camera
          ? `${r.node} 높이 ${top} m: 배치 자료는 카메라 상자인데 ${CAMERA_BOX_MIN_HEIGHT} m보다 낮아요`
          : `${r.node} 높이 ${top} m: 배치 자료는 카메라가 넘어보는 상자인데 ${CAMERA_BOX_MIN_HEIGHT} m 이상이에요`,
      );
    }
  }
  return result(
    problems.length === 0,
    "col__ 상자 크기",
    problems.length === 0
      ? `배치 자료의 상자 ${checked} / ${required.length}개가 위치·크기·카메라 높이 그대로예요`
      : `${problems.join("; ")} (찾은 상자 ${checked} / ${required.length}개)`,
  );
}

/** Required materials exist by exact name and none of them is a light-mapped LM_* material. */
function checkRequiredMaterials(gltf: Gltf, required: readonly string[]): CheckResult {
  const names = new Set((gltf.materials ?? []).map((m) => m.name ?? ""));
  const missing = required.filter((n) => !names.has(n));
  const lm = required.filter((n) => n.startsWith(LIGHTMAP_MATERIAL_PREFIX));
  const ok = missing.length === 0 && lm.length === 0;
  return result(
    ok,
    "필수 재질",
    ok
      ? `${required.length} / ${required.length}개가 있고 라이트맵을 쓰지 않아요 (${required.join(", ")})`
      : [missing.length ? `없는 재질: ${missing.join(", ")}` : "", lm.length ? `LM_ 이름이면 안 돼요: ${lm.join(", ")}` : ""]
          .filter(Boolean)
          .join("; "),
  );
}

/**
 * EXT_mesh_gpu_instancing: when a node uses it, the extension is in extensionsUsed (or three draws one copy) and the
 * TRANSLATION / ROTATION / SCALE accessors it names have the same count. null when no node is instanced.
 */
function checkInstancing(gltf: Gltf): CheckResult | null {
  const nodes = (gltf.nodes ?? []).filter((n) => n.extensions?.[GPU_INSTANCING] !== undefined);
  if (nodes.length === 0) return null;
  const problems: string[] = [];
  if (!(gltf.extensionsUsed ?? []).includes(GPU_INSTANCING)) problems.push(`extensionsUsed에 ${GPU_INSTANCING}이 없어요`);
  let total = 0;
  for (const n of nodes) {
    const attrs = (n.extensions?.[GPU_INSTANCING] as { attributes?: Record<string, number> }).attributes ?? {};
    const counts = Object.entries(attrs)
      .filter(([k]) => k === "TRANSLATION" || k === "ROTATION" || k === "SCALE")
      .map(([k, i]) => [k, gltf.accessors?.[i]?.count] as const);
    if (counts.length === 0 || counts.some(([, c]) => c === undefined)) {
      problems.push(`${n.name ?? "노드"}: 인스턴스 속성 accessor가 없어요`);
      continue;
    }
    if (new Set(counts.map(([, c]) => c)).size > 1) {
      problems.push(`${n.name ?? "노드"}: 인스턴스 수가 달라요 (${counts.map(([k, c]) => `${k} ${c}`).join(", ")})`);
    }
    total += counts[0]![1]!;
  }
  return result(
    problems.length === 0,
    "GPU 인스턴스",
    problems.length === 0 ? `노드 ${nodes.length}개, 인스턴스 ${total}개, TRANSLATION·ROTATION·SCALE 수가 같아요` : problems.join("; "),
  );
}

function imageBytes(input: CheckInput, index: number): Uint8Array | null {
  const image = input.gltf.images?.[index];
  if (!image) return null;
  if (image.bufferView !== undefined) {
    const view = input.gltf.bufferViews?.[image.bufferView];
    if (!view || !input.bin) return null;
    const start = view.byteOffset ?? 0;
    if (start + view.byteLength > input.bin.length) return null;
    return input.bin.subarray(start, start + view.byteLength);
  }
  if (image.uri !== undefined) {
    if (image.uri.startsWith("data:")) {
      const comma = image.uri.indexOf(",");
      return comma < 0 ? null : Uint8Array.from(Buffer.from(image.uri.slice(comma + 1), "base64"));
    }
    return input.readUri ? input.readUri(image.uri) : null;
  }
  return null;
}

function checkTextures(input: CheckInput): CheckResult {
  const images = input.gltf.images ?? [];
  const problems: string[] = [];
  let biggest = 0;
  images.forEach((image, i) => {
    const label = image.name ? `#${i} ${image.name}` : `#${i}`;
    const bytes = imageBytes(input, i);
    const size = bytes ? imageSize(bytes) : null;
    if (!size) {
      problems.push(`이미지 ${label}의 크기를 읽을 수 없어요`);
      return;
    }
    biggest = Math.max(biggest, size.width, size.height);
    if (size.width > MAX_TEXTURE_SIDE || size.height > MAX_TEXTURE_SIDE) {
      problems.push(`이미지 ${label}이 ${size.width}x${size.height}`);
    }
  });
  return result(
    problems.length === 0,
    "텍스처 크기",
    problems.length === 0
      ? `${images.length}장, 가장 큰 한 변 ${biggest}px (한도 ${MAX_TEXTURE_SIDE}px)`
      : `${problems.join("; ")} (한 변 한도 ${MAX_TEXTURE_SIDE}px)`,
  );
}

/** LM_* materials are light-mapped by the game code: they need the separate light-map WebP and TEXCOORD_1. */
function checkLightmap(input: CheckInput): CheckResult[] {
  const { gltf } = input;
  const lmIndexes = new Set<number>();
  (gltf.materials ?? []).forEach((m, i) => {
    if ((m.name ?? "").startsWith(LIGHTMAP_MATERIAL_PREFIX)) lmIndexes.add(i);
  });
  if (lmIndexes.size === 0) {
    return [{ level: "ok", label: "라이트맵", detail: "LM_ 재질이 없어서 라이트맵 파일이 필요 없어요" }];
  }
  const out: CheckResult[] = [];
  const lm = input.lightmap;
  if (!lm) {
    out.push(result(false, "라이트맵 파일", `LM_ 재질이 ${lmIndexes.size}개 있는데 GLB 옆에서 <방>_lightmap.webp(또는 <방>_lm.webp)를 찾지 못했어요`));
  } else {
    // A size that could not be read (0x0) is a failure too: it must not pass as "fits".
    const readable = lm.width > 0 && lm.height > 0;
    const fits = readable && lm.width <= MAX_TEXTURE_SIDE && lm.height <= MAX_TEXTURE_SIDE;
    out.push(
      result(
        fits,
        "라이트맵 파일",
        !readable
          ? `${lm.path}의 크기를 읽을 수 없어요 (${lm.width}x${lm.height})`
          : `${lm.path} ${lm.width}x${lm.height}${fits ? "" : ` (한 변 한도 ${MAX_TEXTURE_SIDE}px)`}`,
      ),
    );
  }
  const noUv: string[] = [];
  (gltf.nodes ?? []).forEach((n) => {
    if (n.mesh === undefined) return;
    (gltf.meshes?.[n.mesh]?.primitives ?? []).forEach((prim, pi) => {
      if (prim.material !== undefined && lmIndexes.has(prim.material) && prim.attributes.TEXCOORD_1 === undefined) {
        noUv.push(`${n.name ?? `mesh ${n.mesh}`}#${pi}`);
      }
    });
  });
  const uniqueNoUv = [...new Set(noUv)];
  out.push(
    result(
      uniqueNoUv.length === 0,
      "라이트맵 UV",
      uniqueNoUv.length === 0 ? "LM_ 재질을 쓰는 모든 primitive에 TEXCOORD_1이 있어요" : `TEXCOORD_1이 없는 라이트맵 메시: ${nameList(uniqueNoUv)}`,
    ),
  );
  return out;
}
