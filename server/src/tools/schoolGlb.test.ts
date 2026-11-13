/**
 * Tests for the pure parts of the school GLB tools (scripts/lib/schoolGlb.ts, schoolSpec.ts): GLB parsing,
 * collider extraction (rounding, sorting, rotation rejection), image sizes, triangle counts and the budget
 * checks. The CLIs (scripts/extract-colliders.ts, scripts/check-school-glb.ts) are covered at the end by
 * running them for real on a synthetic GLB. Lives in the server workspace like the teacher-key script's test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BOX_TOLERANCE,
  BUDGETS,
  CAMERA_BOX_MIN_HEIGHT,
  MAX_MATERIALS,
  MATERIAL_LIMITS,
  MAX_TEXTURE_SIDE,
  OBJ_ANCHOR_TOLERANCE,
  checkSchoolGlb,
  countFileTriangles,
  countTriangles,
  extractColliders,
  imageSize,
  parseGlb,
  renderColliderModule,
  roundToHundredth,
  tallColliders,
  worldTranslation,
  yawError,
} from "../../../scripts/lib/schoolGlb";
import type { Gltf, GltfNode, SchoolSpec } from "../../../scripts/lib/schoolGlb";
import {
  CUBBY_ANCHOR_TOLERANCE,
  HALL_WALL_IDS,
  KNOWN_PROP_HEIGHTS,
  MEMORIAL_NON_LIGHTMAPPED,
  VILLAGE_NON_LIGHTMAPPED,
  schoolSpec,
} from "../../../scripts/lib/schoolSpec";
import { cameraExportName } from "../../../scripts/extract-colliders";
import {
  VILLAGE_LAYOUT,
  colliderNode,
  cubbyAnchorNode,
  cubbyAnchors,
  greyboxColliders,
  hallWalls,
} from "../../../shared/src/village/villageLayout";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// ---------------------------------------------------------------------------------------------------------
// Helpers: build tiny GLBs and glTF documents.

function makeGlb(gltf: Gltf, bin?: Uint8Array, padTo = 0): Buffer {
  const jsonRaw = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = Buffer.alloc((4 - (jsonRaw.length % 4)) % 4, 0x20);
  const jsonChunk = Buffer.concat([jsonRaw, jsonPad]);
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  parts.push(header, jsonHead, jsonChunk);
  if (bin) {
    const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);
    const binChunk = Buffer.concat([Buffer.from(bin), binPad]);
    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(binChunk.length, 0);
    binHead.writeUInt32LE(0x004e4942, 4);
    parts.push(binHead, binChunk);
  }
  if (padTo > 0) parts.push(Buffer.alloc(padTo));
  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length, 8);
  return out;
}

/** A PNG signature + IHDR only: enough for imageSize. */
function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8;
  b[25] = 6;
  return b;
}

function webpVp8x(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

function webpVp8l(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8L", 12, "ascii");
  b.writeUInt32LE(5, 16);
  b[20] = 0x2f;
  const bits = (w - 1) | ((h - 1) << 14);
  b.writeUInt32LE(bits >>> 0, 21);
  return b;
}

function webpVp8(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(w, 26);
  b.writeUInt16LE(h, 28);
  return b;
}

function jpegHeader(w: number, h: number): Buffer {
  // SOI, APP0 (length 16), SOF0 (length 17).
  const b = Buffer.alloc(2 + 18 + 19);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe0;
  b.writeUInt16BE(16, 4);
  b[20] = 0xff;
  b[21] = 0xc0;
  b.writeUInt16BE(17, 22);
  b[24] = 8;
  b.writeUInt16BE(h, 25);
  b.writeUInt16BE(w, 27);
  return b;
}

const cubeNode = (name: string, t: number[], s: number[], extra: Partial<GltfNode> = {}): GltfNode => ({
  name,
  mesh: 0,
  translation: t,
  scale: s,
  ...extra,
});

/** A glTF whose accessors/meshes make one unit cube (mesh 0) and a quad (mesh 1, 2 triangles). */
function baseGltf(nodes: GltfNode[]): Gltf {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: [
      { name: "cube", primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
      { name: "quad", primitives: [{ attributes: { POSITION: 2 }, indices: 3 }] },
    ],
    accessors: [
      { count: 8, componentType: 5126, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { count: 36, componentType: 5123, type: "SCALAR" },
      { count: 4, componentType: 5126, type: "VEC3", min: [-1, 0, -1], max: [1, 0, 1] },
      { count: 6, componentType: 5123, type: "SCALAR" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------

describe("parseGlb", () => {
  it("reads the JSON chunk and the BIN chunk", () => {
    const g = baseGltf([{ name: "a" }]);
    const bin = Uint8Array.from([1, 2, 3, 4, 5]);
    const parsed = parseGlb(makeGlb(g, bin));
    expect(parsed.gltf.nodes?.[0]?.name).toBe("a");
    expect(parsed.bin).not.toBeNull();
    expect(Array.from(parsed.bin!.subarray(0, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns bin null when there is no BIN chunk", () => {
    expect(parseGlb(makeGlb(baseGltf([{ name: "a" }]))).bin).toBeNull();
  });

  it("rejects a wrong magic number, a wrong version and a truncated file", () => {
    const good = makeGlb(baseGltf([{ name: "a" }]));
    const badMagic = Buffer.from(good);
    badMagic.write("XXXX", 0, "ascii");
    expect(() => parseGlb(badMagic)).toThrow(/glTF/);
    const badVersion = Buffer.from(good);
    badVersion.writeUInt32LE(1, 4);
    expect(() => parseGlb(badVersion)).toThrow(/version/);
    expect(() => parseGlb(good.subarray(0, good.length - 10))).toThrow();
    expect(() => parseGlb(Buffer.alloc(4))).toThrow();
  });
});

describe("roundToHundredth", () => {
  it("rounds to 0.01 and never returns -0", () => {
    expect(roundToHundredth(1.234)).toBe(1.23);
    expect(roundToHundredth(-4.083)).toBe(-4.08);
    expect(roundToHundredth(2.999)).toBe(3);
    expect(Object.is(roundToHundredth(-0.001), 0)).toBe(true);
    expect(Object.is(roundToHundredth(-0), 0)).toBe(true);
  });
});

describe("extractColliders", () => {
  it("uses translation +- scale/2 on x and z, rounded to 0.01", () => {
    const g = baseGltf([cubeNode("col__a", [10.004, 0.5, -3.333], [2.006, 1, 1.5])]);
    const { colliders, problems } = extractColliders(g);
    expect(problems).toEqual([]);
    expect(colliders).toEqual([{ name: "col__a", box: { minX: 9, maxX: 11.01, minZ: -4.08, maxZ: -2.58 } }]);
  });

  it("sorts by minX, then minZ, then maxX, then maxZ (input order does not matter)", () => {
    const nodes = [
      cubeNode("col__c", [5, 0, 5], [2, 1, 2]), // minX 4, minZ 4
      cubeNode("col__a", [1, 0, 3], [2, 1, 2]), // minX 0, minZ 2
      cubeNode("col__b", [1, 0, -3], [2, 1, 2]), // minX 0, minZ -4
      cubeNode("col__d", [1, 0, -3], [4, 1, 2]), // minX -1, minZ -4 (wider)
    ];
    const forward = extractColliders(baseGltf(nodes)).colliders.map((c) => c.name);
    const backward = extractColliders(baseGltf([...nodes].reverse())).colliders.map((c) => c.name);
    expect(forward).toEqual(["col__d", "col__b", "col__a", "col__c"]);
    expect(backward).toEqual(forward);
  });

  it("ignores nodes that are not col__*", () => {
    const g = baseGltf([cubeNode("obj__x", [0, 0, 0], [1, 1, 1]), cubeNode("col__ok", [0, 0, 0], [1, 1, 1])]);
    expect(extractColliders(g).colliders.map((c) => c.name)).toEqual(["col__ok"]);
  });

  it("rejects a rotated col__ node and says which one", () => {
    const s = Math.SQRT1_2;
    const g = baseGltf([cubeNode("col__turned", [0, 0, 0], [2, 1, 1], { rotation: [0, s, 0, s] })]);
    const { problems } = extractColliders(g);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("col__turned");
    expect(problems[0]).toMatch(/회전/);
  });

  it("rejects a 180 degree turn too, but accepts a numerically-zero rotation", () => {
    expect(extractColliders(baseGltf([cubeNode("col__flip", [0, 0, 0], [1, 1, 1], { rotation: [0, 1, 0, 0] })])).problems).toHaveLength(1);
    const ok = extractColliders(baseGltf([cubeNode("col__ok", [0, 0, 0], [1, 1, 1], { rotation: [0, 1e-9, 0, 1] })]));
    expect(ok.problems).toEqual([]);
    const negated = extractColliders(baseGltf([cubeNode("col__neg", [0, 0, 0], [1, 1, 1], { rotation: [0, 0, 0, -1] })]));
    expect(negated.problems).toEqual([]);
  });

  it("rejects a col__ node with a parent or a matrix", () => {
    const g = baseGltf([{ name: "group", children: [1] }, cubeNode("col__child", [0, 0, 0], [1, 1, 1])]);
    expect(extractColliders(g).problems.join("\n")).toMatch(/col__child.*부모/);
    const m = baseGltf([cubeNode("col__m", [0, 0, 0], [1, 1, 1], { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })]);
    expect(extractColliders(m).problems.join("\n")).toMatch(/col__m.*matrix/);
  });

  it("rejects a zero-size box and a mesh that is not a unit cube", () => {
    expect(extractColliders(baseGltf([cubeNode("col__flat", [0, 0, 0], [1, 1, 0])])).problems.join("\n")).toMatch(/col__flat/);
    const big = baseGltf([cubeNode("col__big", [0, 0, 0], [1, 1, 1])]);
    big.accessors![0] = { count: 8, componentType: 5126, type: "VEC3", min: [-2, -0.5, -0.5], max: [2, 0.5, 0.5] };
    expect(extractColliders(big).problems.join("\n")).toMatch(/col__big.*(정육면체|cube)/);
  });

  it("uses the absolute scale (a mirrored box is the same box)", () => {
    const { colliders } = extractColliders(baseGltf([cubeNode("col__m", [1, 0, 1], [-2, 1, -2])]));
    expect(colliders[0]!.box).toEqual({ minX: 0, maxX: 2, minZ: 0, maxZ: 2 });
  });
});

describe("tallColliders (the camera boxes among the props)", () => {
  it("a box is tall from CAMERA_BOX_MIN_HEIGHT up, by the top of its node (translation.y + scale.y / 2)", () => {
    expect(CAMERA_BOX_MIN_HEIGHT).toBe(1.6);
    const g = baseGltf([
      cubeNode("col__lockers", [17, 1.1, -2.68], [4, 2.2, 0.64]), // 2.2 m: the hub's locker bank
      cubeNode("col__edge", [0, 0.8, 0], [1, 1.6, 1]), // exactly 1.6 m
      cubeNode("col__bench", [9, 0.5, 11], [1.84, 1, 0.54]), // 1 m
      cubeNode("col__almost", [0, 0.795, 0], [1, 1.59, 1]), // 1.59 m
    ]);
    const { colliders } = extractColliders(g);
    const tall = tallColliders(g, colliders);
    expect(tall.map((t) => [t.name, t.height]).sort()).toEqual([
      ["col__edge", 1.6],
      ["col__lockers", 2.2],
    ]);
    expect(tall.find((t) => t.name === "col__lockers")!.box).toEqual({ minX: 15, maxX: 19, minZ: -3, maxZ: -2.36 });
  });

  it("a 1 m cube whose prop is taller takes the height the room's spec gives for its name (without col__)", () => {
    const g = baseGltf([
      cubeNode("col__east_bookcase", [4.24, 0.5, -2.5], [0.52, 1, 1.84]),
      cubeNode("col__desk", [-4, 0.5, -1], [0.84, 1, 1.64]),
    ]);
    const { colliders } = extractColliders(g);
    expect(tallColliders(g, colliders).map((t) => t.name)).toEqual([]); // nothing tall without the spec
    const tall = tallColliders(g, colliders, { east_bookcase: 2.1, desk: 1.24 });
    expect(tall.map((t) => [t.name, t.height])).toEqual([["col__east_bookcase", 2.1]]);
    // A spec height never LOWERS a node that already states a taller one.
    const lockers = baseGltf([cubeNode("col__lockers", [0, 1.1, 0], [4, 2.2, 1])]);
    expect(tallColliders(lockers, extractColliders(lockers).colliders, { lockers: 1.7 })[0]!.height).toBe(2.2);
  });

  it("keeps the colliders' order", () => {
    const g = baseGltf([cubeNode("col__b", [5, 1.1, 5], [2, 2.2, 2]), cubeNode("col__a", [1, 1.1, 3], [2, 2.2, 2])]);
    const { colliders } = extractColliders(g);
    expect(tallColliders(g, colliders).map((t) => t.name)).toEqual(colliders.map((c) => c.name));
  });
});

describe("cameraExportName", () => {
  it("HUB_PROP_COLLIDERS -> HUB_PROP_CAMERA_BOXES; a name without the suffix gets one", () => {
    expect(cameraExportName("HUB_PROP_COLLIDERS")).toBe("HUB_PROP_CAMERA_BOXES");
    expect(cameraExportName("COUNSEL_PROP_COLLIDERS")).toBe("COUNSEL_PROP_CAMERA_BOXES");
    expect(cameraExportName("ROOM_BOXES")).toBe("ROOM_BOXES_CAMERA_BOXES");
  });
});

describe("renderColliderModule", () => {
  const colliders = [
    { name: "col__b", box: { minX: 0, maxX: 2, minZ: -1.5, maxZ: 0 } },
    { name: "col__a", box: { minX: 3, maxX: 4.25, minZ: 1, maxZ: 2 } },
  ];

  it("writes a typed const with one box per line and the node name as a comment", () => {
    const text = renderColliderModule({ exportName: "HUB_PROP_COLLIDERS", source: "hub.glb", colliders, collisionImport: "../../collision" });
    expect(text).toContain('import type { AABB } from "../../collision";');
    expect(text).toContain("export const HUB_PROP_COLLIDERS: readonly AABB[] = [");
    expect(text).toContain("  { minX: 0, maxX: 2, minZ: -1.5, maxZ: 0 }, // col__b");
    expect(text).toContain("  { minX: 3, maxX: 4.25, minZ: 1, maxZ: 2 }, // col__a");
    expect(text).toContain("scripts/extract-colliders.ts");
    expect(text).toContain("hub.glb");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("never prints a minus zero", () => {
    const text = renderColliderModule({
      exportName: "X",
      source: "x.glb",
      colliders: [{ name: "col__z", box: { minX: -0, maxX: 1, minZ: -0, maxZ: 1 } }],
      collisionImport: "../collision",
    });
    expect(text).not.toMatch(/-0[,\s]/);
  });

  it("is deterministic and handles an empty list", () => {
    const a = renderColliderModule({ exportName: "X", source: "x.glb", colliders, collisionImport: "../collision" });
    const b = renderColliderModule({ exportName: "X", source: "x.glb", colliders, collisionImport: "../collision" });
    expect(a).toBe(b);
    expect(renderColliderModule({ exportName: "X", source: "x.glb", colliders: [], collisionImport: "../collision" })).toContain("= [];");
  });

  it("rejects an export name that is not an identifier", () => {
    expect(() => renderColliderModule({ exportName: "bad name", source: "x.glb", colliders, collisionImport: "../collision" })).toThrow();
  });

  it("writes the tall props as a second export with their heights (and imports CameraBox only then)", () => {
    const tall = [{ name: "col__a", box: { minX: 3, maxX: 4.25, minZ: 1, maxZ: 2 }, height: 2.2 }];
    const text = renderColliderModule({
      exportName: "X_COLLIDERS",
      source: "x.glb",
      colliders,
      collisionImport: "../collision",
      tall: { exportName: "X_CAMERA_BOXES", boxes: tall },
    });
    expect(text).toContain('import type { AABB, CameraBox } from "../collision";');
    expect(text).toContain("export const X_CAMERA_BOXES: readonly CameraBox[] = [");
    expect(text).toContain("  { minX: 3, maxX: 4.25, minZ: 1, maxZ: 2, height: 2.2 }, // col__a");
    expect(text.indexOf("X_COLLIDERS")).toBeLessThan(text.indexOf("X_CAMERA_BOXES"));
    const none = renderColliderModule({ exportName: "X_COLLIDERS", source: "x.glb", colliders, collisionImport: "../collision", tall: { exportName: "X_CAMERA_BOXES", boxes: [] } });
    expect(none).toContain("X_CAMERA_BOXES: readonly CameraBox[] = [];");
    expect(renderColliderModule({ exportName: "X", source: "x.glb", colliders, collisionImport: "../collision" })).not.toContain("CameraBox");
    expect(() =>
      renderColliderModule({ exportName: "X", source: "x.glb", colliders, collisionImport: "../collision", tall: { exportName: "X", boxes: [] } }),
    ).toThrow();
  });
});

describe("imageSize", () => {
  it("reads PNG, JPEG and the three WebP flavours", () => {
    expect(imageSize(pngHeader(2048, 1024))).toEqual({ width: 2048, height: 1024 });
    expect(imageSize(jpegHeader(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(webpVp8x(2048, 640))).toEqual({ width: 2048, height: 640 });
    expect(imageSize(webpVp8l(512, 256))).toEqual({ width: 512, height: 256 });
    expect(imageSize(webpVp8(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it("returns null for anything else", () => {
    expect(imageSize(Buffer.from("not an image at all"))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
  });
});

describe("countTriangles", () => {
  it("counts indexed triangles, per node instance, and only for meshes in the scene", () => {
    const g = baseGltf([
      { name: "q1", mesh: 1 },
      { name: "q2", mesh: 1 }, // the same mesh again: counted again
      { name: "empty" },
    ]);
    expect(countTriangles(g)).toBe(4); // 2 quads x 2 triangles
    g.scenes![0]!.nodes = [0]; // q2 is no longer in the scene
    expect(countTriangles(g)).toBe(2);
  });

  it("multiplies a GPU-instanced node (EXT_mesh_gpu_instancing) by its instance count; the file count does not", () => {
    const g = baseGltf([{ name: "trees", mesh: 1, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 4 } } } }]);
    g.accessors!.push({ count: 25, componentType: 5126, type: "VEC3" });
    expect(countTriangles(g)).toBe(50); // 25 instances x 2 triangles
    expect(countFileTriangles(g)).toBe(2);
    // ROTATION / SCALE alone also give the count; a dangling instancing accessor throws instead of counting 1
    g.nodes![0]!.extensions = { EXT_mesh_gpu_instancing: { attributes: { SCALE: 4 } } };
    expect(countTriangles(g)).toBe(50);
    g.nodes![0]!.extensions = { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 99 } } };
    expect(() => countTriangles(g)).toThrow(/accessor 99/);
  });

  it("does not count col__ boxes (the game hides them), nor anything under one", () => {
    const g = baseGltf([cubeNode("col__box", [0, 0, 0], [1, 1, 1], { children: [1] }), { name: "inside", mesh: 1 }, { name: "visible", mesh: 1 }]);
    g.scenes = [{ nodes: [0, 2] }];
    expect(countTriangles(g)).toBe(2); // only "visible"
  });

  it("falls back to the POSITION count without indices, and counts strips and fans", () => {
    const g = baseGltf([{ name: "n", mesh: 0 }]);
    g.meshes = [
      { primitives: [{ attributes: { POSITION: 2 } }] }, // 4 vertices, no indices -> 1 triangle
      { primitives: [{ attributes: { POSITION: 2 }, indices: 3, mode: 5 }] }, // strip of 6 -> 4
      { primitives: [{ attributes: { POSITION: 2 }, indices: 3, mode: 6 }] }, // fan of 6 -> 4
      { primitives: [{ attributes: { POSITION: 2 }, indices: 3, mode: 1 }] }, // lines -> 0
    ];
    g.nodes = [{ mesh: 0 }, { mesh: 1 }, { mesh: 2 }, { mesh: 3 }];
    g.scenes = [{ nodes: [0, 1, 2, 3] }];
    expect(countTriangles(g)).toBe(1 + 4 + 4 + 0);
  });

  it("reads Draco primitives from the accessor counts that the extension keeps in the JSON", () => {
    const g = baseGltf([{ name: "n", mesh: 0 }]);
    g.meshes![0]!.primitives[0]!.extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } };
    expect(countTriangles(g)).toBe(12);
  });

  it("throws on a dangling accessor index instead of counting 0", () => {
    const g = baseGltf([{ name: "n", mesh: 1 }]);
    g.meshes![1]!.primitives[0]!.indices = 42;
    expect(() => countTriangles(g)).toThrow(/accessor 42/);
    const h = baseGltf([{ name: "n", mesh: 1 }]);
    h.meshes![1]!.primitives[0]!.attributes = { POSITION: 17 };
    delete (h.meshes![1]!.primitives[0] as { indices?: number }).indices;
    expect(() => countTriangles(h)).toThrow(/accessor 17/);
  });

  it("walks children and does not loop on a cycle", () => {
    const g = baseGltf([{ name: "root", children: [1] }, { name: "child", mesh: 1, children: [0] }]);
    g.scenes = [{ nodes: [0] }];
    expect(countTriangles(g)).toBe(2);
  });
});

describe("worldTranslation", () => {
  it("is the node's own translation for a root node", () => {
    const g = baseGltf([{ name: "n", translation: [1, 2, 3] }]);
    expect(worldTranslation(g, 0)).toEqual([1, 2, 3]);
  });

  it("composes the parents' translation, rotation and scale", () => {
    // parent: scale 2, rotated 90 degrees about y, at (10, 0, 0); child at local (1, 0, 0).
    const s = Math.SQRT1_2;
    const g = baseGltf([
      { name: "parent", translation: [10, 0, 0], rotation: [0, s, 0, s], scale: [2, 2, 2], children: [1] },
      { name: "child", translation: [1, 0, 0] },
    ]);
    const [x, y, z] = worldTranslation(g, 1);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-2, 6); // +x rotated 90 degrees about y points to -z
  });
});

// ---------------------------------------------------------------------------------------------------------

/** A spec small enough to build by hand. */
function tinySpec(over: Partial<SchoolSpec> = {}): SchoolSpec {
  return {
    kind: "memorial",
    requiredNodes: ["obj__a", "obj__b"],
    requiredPrefixes: [{ prefix: "col__", min: 1 }],
    placements: [
      { node: "obj__a", x: 1, z: 2 },
      { node: "obj__b", x: -1, z: -2 },
    ],
    identityRotationPrefixes: ["obj__"],
    ...over,
  };
}

function goodGltf(): Gltf {
  const g = baseGltf([
    { name: "obj__a", translation: [1.1, 0, 2.1] },
    { name: "obj__b", translation: [-1, 0, -2.2], mesh: 1 },
    cubeNode("col__wall", [0, 0, 0], [2, 1, 2]),
  ]);
  g.materials = [{ name: "M_one", extensions: { KHR_materials_unlit: {} } }];
  g.extensionsUsed = ["KHR_materials_unlit"];
  return g;
}

const run = (g: Gltf, over: Partial<Parameters<typeof checkSchoolGlb>[0]> = {}) =>
  checkSchoolGlb({ kind: "memorial", fileBytes: 1_000_000, gltf: g, bin: null, spec: tinySpec(), lightmap: null, ...over });
const failed = (results: ReturnType<typeof run>) => results.filter((r) => r.level === "fail");

describe("checkSchoolGlb", () => {
  it("passes a good file and prints each check", () => {
    const results = run(goodGltf());
    expect(failed(results)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(results.every((r) => r.label.length > 0 && r.detail.length > 0)).toBe(true);
  });

  it("pins the budgets from the plan", () => {
    expect(BUDGETS.village).toEqual({ maxBytes: 8 * 1024 * 1024, maxTriangles: 260_000 });
    expect(BUDGETS.memorial).toEqual({ maxBytes: 1.5 * 1024 * 1024, maxTriangles: 60_000 }); // Task 9: actual 0.33 MB, 17k
    expect(BOX_TOLERANCE).toBeCloseTo(0.011, 6);
    expect(MAX_MATERIALS).toBe(24);
    // one more for the village: the fountain's live-lit crescent (M_moon)
    expect(MATERIAL_LIMITS).toEqual({ village: 25, memorial: 24 });
    expect(MAX_TEXTURE_SIDE).toBe(2048);
    expect(OBJ_ANCHOR_TOLERANCE).toBe(0.25);
  });

  it("fails a file over its size budget (memorial 1.5 MB, village 8 MB) and accepts the limit itself", () => {
    expect(failed(run(goodGltf(), { fileBytes: 1.5 * 1024 * 1024 + 1 })).map((r) => r.label).join()).toMatch(/크기/);
    expect(failed(run(goodGltf(), { fileBytes: 1.5 * 1024 * 1024 }))).toEqual([]);
    expect(failed(run(goodGltf(), { kind: "village", fileBytes: 8 * 1024 * 1024 + 1, spec: tinySpec({ kind: "village" }) })).map((r) => r.label).join()).toMatch(/크기/);
    expect(failed(run(goodGltf(), { kind: "village", fileBytes: 8 * 1024 * 1024, spec: tinySpec({ kind: "village" }) }))).toEqual([]);
  });

  it("fails when a required node is missing and names it", () => {
    const g = goodGltf();
    g.nodes![1]!.name = "obj__renamed";
    const res = failed(run(g));
    expect(res.map((r) => r.detail).join("\n")).toContain("obj__b");
  });

  it("fails when too few col__ (or other prefixed) nodes exist", () => {
    const g = goodGltf();
    g.nodes!.pop();
    g.scenes![0]!.nodes = [0, 1];
    expect(failed(run(g)).map((r) => r.detail).join("\n")).toContain("col__");
  });

  it("fails an obj__ node more than 0.25 m from its anchor, passes at 0.24 m", () => {
    const far = goodGltf();
    far.nodes![0]!.translation = [1.3, 0, 2]; // 0.30 m
    expect(failed(run(far)).map((r) => r.detail).join("\n")).toMatch(/obj__a/);
    const near = goodGltf();
    near.nodes![0]!.translation = [1.24, 0, 2]; // 0.24 m
    expect(failed(run(near))).toEqual([]);
  });

  it("fails a rotated col__ node and a rotated obj__ node", () => {
    const s = Math.SQRT1_2;
    const col = goodGltf();
    col.nodes![2]!.rotation = [0, s, 0, s];
    expect(failed(run(col)).map((r) => r.detail).join("\n")).toContain("col__wall");
    const obj = goodGltf();
    obj.nodes![0]!.rotation = [0, s, 0, s];
    expect(failed(run(obj)).map((r) => r.detail).join("\n")).toContain("obj__a");
  });

  it("fails too many triangles (memorial 60k, village 260k)", () => {
    const g = goodGltf();
    // The quad mesh (obj__b) supplies all the triangles; the cube of col__wall is hidden in the game and not counted.
    g.accessors![3]!.count = 3 * (60_000 + 1);
    expect(failed(run(g)).map((r) => r.label).join()).toMatch(/삼각형/);
    g.accessors![3]!.count = 3 * 60_000;
    expect(failed(run(g))).toEqual([]);
    g.accessors![3]!.count = 3 * (260_000 + 1);
    expect(failed(run(g, { kind: "village", spec: tinySpec({ kind: "village" }) })).map((r) => r.label).join()).toMatch(/삼각형/);
  });

  it("fails more than 24 materials", () => {
    const g = goodGltf();
    g.materials = Array.from({ length: 25 }, (_, i) => ({ name: `M_${i}`, extensions: { KHR_materials_unlit: {} } }));
    expect(failed(run(g)).map((r) => r.label).join()).toMatch(/재질/);
    g.materials = g.materials.slice(0, 24);
    expect(failed(run(g))).toEqual([]);
  });

  it("the village may have 25 materials (the crescent's M_moon), not 26", () => {
    const g = goodGltf();
    const spec = tinySpec({ kind: "village" });
    g.materials = Array.from({ length: 26 }, (_, i) => ({ name: `M_${i}`, extensions: { KHR_materials_unlit: {} } }));
    expect(failed(run(g, { kind: "village", spec })).map((r) => r.label).join()).toMatch(/재질/);
    g.materials = g.materials.slice(0, 25);
    expect(failed(run(g, { kind: "village", spec })).map((r) => r.label).join()).not.toMatch(/재질 수/);
  });

  it("fails an embedded texture larger than 2048 on a side", () => {
    const g = goodGltf();
    const bin = Buffer.concat([pngHeader(4096, 16), webpVp8x(2048, 2048)]);
    g.bufferViews = [
      { buffer: 0, byteOffset: 0, byteLength: 33 },
      { buffer: 0, byteOffset: 33, byteLength: 30 },
    ];
    g.images = [{ bufferView: 0, mimeType: "image/png" }];
    expect(failed(run(g, { bin })).map((r) => r.label).join()).toMatch(/텍스처/);
    g.images = [{ bufferView: 1, mimeType: "image/webp" }];
    expect(failed(run(g, { bin }))).toEqual([]);
  });

  it("fails an image whose size cannot be read", () => {
    const g = goodGltf();
    g.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 8 }];
    g.images = [{ bufferView: 0, mimeType: "image/webp" }];
    expect(failed(run(g, { bin: Buffer.alloc(8) })).map((r) => r.label).join()).toMatch(/텍스처/);
  });

  it("requires KHR_materials_unlit in extensionsUsed; Draco is optional both ways", () => {
    const none = goodGltf();
    none.extensionsUsed = [];
    expect(failed(run(none)).map((r) => r.label).join()).toMatch(/unlit/);

    const draco = goodGltf();
    draco.extensionsUsed = ["KHR_materials_unlit", "KHR_draco_mesh_compression"];
    const res = run(draco);
    expect(failed(res)).toEqual([]);
    expect(res.map((r) => r.detail).join("\n")).toMatch(/Draco/);
    expect(run(goodGltf()).map((r) => r.detail).join("\n")).toMatch(/Draco/);
  });

  it("needs the light-map WebP only when LM_* materials exist, and checks that it fits 2048", () => {
    const g = goodGltf();
    expect(failed(run(g))).toEqual([]); // no LM_ material: nothing to find
    g.materials = [{ name: "LM_palette", extensions: { KHR_materials_unlit: {} } }];
    expect(failed(run(g, { lightmap: null })).map((r) => r.label).join()).toMatch(/라이트맵/);
    expect(failed(run(g, { lightmap: { path: "hub_lightmap.webp", width: 2048, height: 2048 } }))).toEqual([]);
    expect(failed(run(g, { lightmap: { path: "hub_lightmap.webp", width: 4096, height: 4096 } })).map((r) => r.label).join()).toMatch(/라이트맵/);
  });

  it("fails a light map whose size could not be read (0x0 or one side 0) instead of letting it pass as 'fits'", () => {
    const g = goodGltf();
    g.materials = [{ name: "LM_palette", extensions: { KHR_materials_unlit: {} } }];
    for (const [width, height] of [[0, 0], [2048, 0], [0, 2048]] as const) {
      const f = failed(run(g, { lightmap: { path: "hub_lightmap.webp", width, height } }));
      expect(f.map((r) => r.label).join(), `${width}x${height}`).toMatch(/라이트맵/);
      expect(f.map((r) => r.detail).join("\n"), `${width}x${height}`).toMatch(/읽을 수 없어요/);
    }
  });

  it("fails a primitive that points at an accessor that does not exist (it must not count as 0 triangles)", () => {
    const g = goodGltf();
    g.meshes![1]!.primitives[0]!.indices = 99; // dangling
    const f = failed(run(g));
    expect(f.map((r) => r.label).join()).toMatch(/삼각형 수/);
    expect(f.map((r) => r.detail).join("\n")).toMatch(/accessor 99/);
    const noPos = goodGltf();
    delete (noPos.meshes![1]!.primitives[0] as { indices?: number }).indices;
    (noPos.meshes![1]!.primitives[0] as { attributes: Record<string, number> }).attributes = {};
    expect(failed(run(noPos)).map((r) => r.label).join()).toMatch(/삼각형 수/);
  });

  it("fails a light-mapped primitive that has no TEXCOORD_1", () => {
    const g = goodGltf();
    g.materials = [{ name: "LM_wood", extensions: { KHR_materials_unlit: {} } }];
    g.meshes![1]!.primitives[0]!.material = 0; // the quad uses LM_wood but has only POSITION
    const lm = { path: "x_lightmap.webp", width: 2048, height: 2048 };
    expect(failed(run(g, { lightmap: lm })).map((r) => r.detail).join("\n")).toMatch(/TEXCOORD_1/);
    g.meshes![1]!.primitives[0]!.attributes.TEXCOORD_1 = 2;
    expect(failed(run(g, { lightmap: lm }))).toEqual([]);
  });
});

describe("checkSchoolGlb: required col__ boxes (village)", () => {
  const boxSpec = (box: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
    tinySpec({ requiredNodes: ["col__wall"], placements: [], requiredBoxes: [{ node: "col__wall", box, camera: false }] });

  it("passes when the box matches the layout rectangle (within 0.01 m on each side)", () => {
    const res = run(goodGltf(), { spec: boxSpec({ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }) });
    expect(failed(res)).toEqual([]);
    expect(res.find((r) => r.label === "col__ 상자 크기")?.detail).toMatch(/1 \/ 1개/);
    expect(failed(run(goodGltf(), { spec: boxSpec({ minX: -1.01, maxX: 1, minZ: -1, maxZ: 1.01 }) }))).toEqual([]);
  });

  it("fails a moved or resized box and names it", () => {
    for (const box of [{ minX: -0.5, maxX: 1.5, minZ: -1, maxZ: 1 }, { minX: -1, maxX: 1, minZ: -1, maxZ: 1.5 }]) {
      const f = failed(run(goodGltf(), { spec: boxSpec(box) }));
      expect(f.map((r) => r.label)).toContain("col__ 상자 크기");
      expect(f.map((r) => r.detail).join("\n")).toContain("col__wall");
    }
  });

  it("a missing required box is reported once, by the required-node check", () => {
    const spec = tinySpec({
      requiredNodes: ["col__gone"],
      placements: [],
      requiredBoxes: [{ node: "col__gone", box: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, camera: false }],
    });
    const f = failed(run(goodGltf(), { spec }));
    expect(f.map((r) => r.label)).toEqual(["필수 노드"]);
    // ...and the found count says "0 / 1" rather than looking like success
    expect(run(goodGltf(), { spec }).find((r) => r.label === "col__ 상자 크기")?.detail).toMatch(/0 \/ 1개/);
  });

  it("a box's height must match the layout's camera flag, both ways (top >= 1.6 m <=> camera box)", () => {
    const box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const spec = (camera: boolean) =>
      tinySpec({ requiredNodes: ["col__wall"], placements: [], requiredBoxes: [{ node: "col__wall", box, camera }] });
    // the 1 m cube (top 0.5): fine as a looked-over box, wrong as a camera box
    expect(failed(run(goodGltf(), { spec: spec(false) }))).toEqual([]);
    const low = failed(run(goodGltf(), { spec: spec(true) }));
    expect(low.map((r) => r.label)).toEqual(["col__ 상자 크기"]);
    expect(low[0]!.detail).toMatch(/카메라 상자인데/);
    // a 2 m tall box (top 2.0, like the old fountain box): wrong when the layout says the camera looks over it
    const tall = goodGltf();
    tall.nodes![2] = cubeNode("col__wall", [0, 1, 0], [2, 2, 2]);
    const high = failed(run(tall, { spec: spec(false) }));
    expect(high.map((r) => r.label)).toEqual(["col__ 상자 크기"]);
    expect(high[0]!.detail).toMatch(/넘어보는/);
    expect(failed(run(tall, { spec: spec(true) }))).toEqual([]);
    // exactly 1.6 counts as a camera box (the extractor's threshold), 1.59 does not
    tall.nodes![2] = cubeNode("col__wall", [0, 0.8, 0], [2, 1.6, 2]);
    expect(failed(run(tall, { spec: spec(true) }))).toEqual([]);
    tall.nodes![2] = cubeNode("col__wall", [0, 0.795, 0], [2, 1.59, 2]);
    expect(failed(run(tall, { spec: spec(false) }))).toEqual([]);
  });
});

describe("checkSchoolGlb: required materials and GPU instancing (village)", () => {
  it("required non-light-mapped materials must exist by name, and must not be LM_*", () => {
    const g = goodGltf();
    g.materials = [{ name: "M_window", extensions: { KHR_materials_unlit: {} } }, { name: "M_lamp", extensions: { KHR_materials_unlit: {} } }];
    const ok = run(g, { spec: tinySpec({ requiredMaterials: ["M_window", "M_lamp"] }) });
    expect(failed(ok)).toEqual([]);
    expect(ok.find((r) => r.label === "필수 재질")?.detail).toMatch(/2 \/ 2개/);
    const missing = failed(run(g, { spec: tinySpec({ requiredMaterials: ["M_window", "M_water"] }) }));
    expect(missing.map((r) => r.label)).toEqual(["필수 재질"]);
    expect(missing[0]!.detail).toContain("M_water");
    g.materials.push({ name: "LM_window", extensions: { KHR_materials_unlit: {} } });
    const lm = failed(run(g, { spec: tinySpec({ requiredMaterials: ["LM_window"] }) }));
    expect(lm.map((r) => r.detail).join("\n")).toMatch(/LM_ 이름이면 안 돼요/);
  });

  const instanced = (n: number, counts: { T?: number; R?: number; S?: number } = {}) => {
    const g = goodGltf();
    g.extensionsUsed = ["KHR_materials_unlit", "EXT_mesh_gpu_instancing"];
    const base = g.accessors!.length;
    g.accessors!.push(
      { count: counts.T ?? n, componentType: 5126, type: "VEC3" },
      { count: counts.R ?? n, componentType: 5126, type: "VEC4" },
      { count: counts.S ?? n, componentType: 5126, type: "VEC3" },
    );
    g.nodes!.push({
      name: "inst__trees",
      mesh: 1,
      extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: base, ROTATION: base + 1, SCALE: base + 2 } } },
    });
    g.scenes![0]!.nodes!.push(g.nodes!.length - 1);
    return g;
  };

  it("an instanced node needs the extension in extensionsUsed and equal TRANSLATION/ROTATION/SCALE counts", () => {
    const good = run(instanced(10));
    expect(failed(good)).toEqual([]);
    expect(good.find((r) => r.label === "GPU 인스턴스")?.detail).toMatch(/인스턴스 10개/);
    const noExt = instanced(10);
    noExt.extensionsUsed = ["KHR_materials_unlit"];
    expect(failed(run(noExt)).map((r) => r.label)).toEqual(["GPU 인스턴스"]);
    const uneven = failed(run(instanced(10, { R: 9 })));
    expect(uneven.map((r) => r.label)).toEqual(["GPU 인스턴스"]);
    expect(uneven[0]!.detail).toMatch(/ROTATION 9/);
    // no instanced node: no instancing line at all
    expect(run(goodGltf()).some((r) => r.label === "GPU 인스턴스")).toBe(false);
  });

  it("the triangle budget counts the drawn instances: under budget stored, over budget drawn -> FAIL", () => {
    // memorial budget 60k; the instanced quad (2 triangles) x 30,001 instances = 60,002 drawn, while the file stores 4
    const g = instanced(30_001);
    const res = run(g);
    const tri = res.find((r) => r.label === "삼각형 수")!;
    expect(tri.level).toBe("fail");
    expect(tri.detail).toMatch(/GPU 인스턴스 포함 \(파일에 든 것 4개\)/);
    expect(countFileTriangles(g)).toBe(4);
    expect(failed(run(instanced(25_000)))).toEqual([]);
  });
});

describe("checkSchoolGlb: anchors with height and facing, clear discs, the ceiling slab (memorial)", () => {
  const yawQuat = (yaw: number) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

  it("yawError: 0 for the right turn about +y (either quaternion sign), large for another facing or a tilt", () => {
    expect(yawError({ rotation: yawQuat(-Math.PI / 2) }, -Math.PI / 2)).toBeLessThan(1e-9);
    expect(yawError({ rotation: yawQuat(-Math.PI / 2).map((v) => -v) }, -Math.PI / 2)).toBeLessThan(1e-9);
    expect(yawError({}, 0)).toBe(0);
    expect(yawError({}, -Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
    const s = Math.SQRT1_2;
    expect(yawError({ rotation: [s, 0, 0, s] }, 0)).toBeGreaterThan(1); // tipped over about x
  });

  it("a placement with y, yaw and a tolerance: within 2 cm and facing right passes; off in height or facing fails", () => {
    const spec = (y: number, yaw: number) =>
      tinySpec({ placements: [{ node: "obj__a", x: 1.1, y, z: 2.1, yaw, tolerance: 0.02 }], identityRotationPrefixes: [] });
    const g = goodGltf();
    g.nodes![0]!.translation = [1.1, 0.345, 2.1];
    g.nodes![0]!.rotation = yawQuat(-Math.PI / 2);
    expect(failed(run(g, { spec: spec(0.36, -Math.PI / 2) }))).toEqual([]);
    expect(failed(run(g, { spec: spec(0.4, -Math.PI / 2) })).map((r) => r.label)).toEqual(["앵커 위치"]);
    const turned = failed(run(g, { spec: spec(0.345, 0) }));
    expect(turned.map((r) => r.label)).toEqual(["앵커 위치"]);
    expect(turned[0]!.detail).toMatch(/방향/);
  });

  it("clear discs: a col__ box reaching into the door pad fails and is named; one beside it passes", () => {
    const spec = (x: number) => tinySpec({ clearDiscs: [{ name: "문 발판", x, z: 0, radius: 1 }] });
    expect(failed(run(goodGltf(), { spec: spec(2.1) }))).toEqual([]); // the 2 m box ends at x = 1
    const f = failed(run(goodGltf(), { spec: spec(1.5) }));
    expect(f.map((r) => r.label)).toEqual(["비워 둘 자리"]);
    expect(f[0]!.detail).toContain("col__wall");
    // ...unless that box is one the disc ignores (a room wall the door pad lies against)
    const ignoring = tinySpec({ clearDiscs: [{ name: "문 발판", x: 1.5, z: 0, radius: 1, ignore: ["col__wall"] }] });
    expect(failed(run(goodGltf(), { spec: ignoring }))).toEqual([]);
  });

  it("ceiling: the slab's underside at the ceiling height and covering the room passes; low, small or missing fails", () => {
    const room = { minX: -4.5, maxX: 4.5, minZ: -6, maxZ: 6 };
    const spec = tinySpec({ ceiling: { node: "ceil__hall", y: 3.4, room } });
    const g = goodGltf();
    g.nodes!.push({ name: "ceil__hall", translation: [0, 3.45, 0], scale: [9, 0.1, 12] });
    expect(failed(run(g, { spec }))).toEqual([]);
    g.nodes![3]!.translation = [0, 3.3, 0];
    expect(failed(run(g, { spec })).map((r) => r.label)).toEqual(["천장"]);
    g.nodes![3] = { name: "ceil__hall", translation: [0, 3.45, 0], scale: [8, 0.1, 12] };
    expect(failed(run(g, { spec }))[0]!.detail).toMatch(/덮지/);
    g.nodes!.pop();
    expect(failed(run(g, { spec })).map((r) => r.label)).toEqual(["천장"]);
  });
});

describe("schoolSpec", () => {
  it("memorial: an anchor per cubby (2 cm, facing), the hall walls and both cubby units as camera boxes, clear door pad and arrival, the ceiling", () => {
    const spec = schoolSpec("memorial");
    const anchors = cubbyAnchors(VILLAGE_LAYOUT);
    const inn = VILLAGE_LAYOUT.memorial.interior;
    expect(spec.kind).toBe("memorial");
    expect(anchors).toHaveLength(364);
    for (const a of anchors) expect(spec.requiredNodes).toContain(cubbyAnchorNode(a.id));
    expect(spec.placements).toHaveLength(364);
    expect(spec.placements[0]).toEqual({ node: "anchor__cubby_n_0_0", x: anchors[0]!.x, y: anchors[0]!.y, z: anchors[0]!.z, yaw: 0, tolerance: CUBBY_ANCHOR_TOLERANCE });
    expect(CUBBY_ANCHOR_TOLERANCE).toBe(0.02);
    expect(spec.requiredBoxes!.slice(0, 4)).toEqual(HALL_WALL_IDS.map((id, i) => ({ node: `col__${id}`, box: hallWalls(VILLAGE_LAYOUT)[i], camera: true })));
    expect(spec.requiredBoxes!.find((b) => b.node === "col__cubby_n")!.box).toEqual({ minX: 292.5, maxX: 307.5, minZ: -6, maxZ: -5.61 });
    expect(spec.requiredBoxes!.find((b) => b.node === "col__cubby_e")!.box).toEqual({ minX: 307.11, maxX: 307.5, minZ: -5.61, maxZ: 2.065 });
    expect(spec.requiredBoxes!.every((b) => b.camera)).toBe(true);
    expect(spec.requiredMaterials).toEqual([...MEMORIAL_NON_LIGHTMAPPED]);
    expect(spec.clearDiscs!.map((d) => [d.x, d.z])).toEqual([[300, 5.2], [inn.spawn.x, inn.spawn.z]]);
    expect(spec.clearDiscs![0]!.ignore).toEqual(HALL_WALL_IDS.map((id) => `col__${id}`));
    expect(spec.ceiling).toEqual({ node: "ceil__hall", y: 4.5, room: inn.room });
    expect(spec.requiredNodes).toContain("ceil__hall");
    expect(KNOWN_PROP_HEIGHTS.memorial).toEqual({});
  });

  it("village: every layout collider is a required col__ node with its exact layout box, and light__ points exist", () => {
    const spec = schoolSpec("village");
    const colliders = greyboxColliders(VILLAGE_LAYOUT);
    expect(spec.kind).toBe("village");
    expect(spec.requiredNodes).toEqual(colliders.map((c) => colliderNode(c.id)));
    expect(spec.requiredBoxes).toEqual(colliders.map((c) => ({ node: colliderNode(c.id), box: c.box, camera: c.camera })));
    expect(spec.requiredBoxes!.filter((b) => !b.camera).map((b) => b.node)).toContain("col__plaza_fountain");
    expect(spec.requiredBoxes!.filter((b) => !b.camera).map((b) => b.node)).toContain("col__pavilion");
    expect(spec.requiredMaterials).toEqual(["M_window", "M_lamp", "M_water", "M_glow_plot", "M_moon"]);
    expect(VILLAGE_NON_LIGHTMAPPED.every((m) => !m.startsWith("LM_"))).toBe(true);
    expect(spec.requiredNodes).toContain("col__plaza_fountain");
    expect(spec.requiredNodes).toContain("col__memorial_back");
    expect(spec.requiredPrefixes).toEqual([
      { prefix: "col__", min: colliders.length },
      { prefix: "light__", min: 1 },
    ]);
    expect(KNOWN_PROP_HEIGHTS.village).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------
// The CLIs, run for real (npx tsx --tsconfig server/tsconfig.json scripts/<x>.ts).

const TSX = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const TSCONFIG = path.join(REPO_ROOT, "server", "tsconfig.json");
const runTs = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, [TSX, "--tsconfig", TSCONFIG, path.join(REPO_ROOT, "scripts", script), ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });

describe("CLIs", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-school-glb-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("check-school-glb: a missing file is a FAIL (exit 1), and so is a bad room name", () => {
    const missing = runTs("check-school-glb.ts", path.join(tmp, "nope.glb"), "village");
    expect(missing.status).toBe(1);
    expect(missing.stderr + missing.stdout).toContain("파일 없음");
    const badKind = runTs("check-school-glb.ts", path.join(tmp, "nope.glb"), "library");
    expect(badKind.status).toBe(1);
    expect(badKind.stderr + badKind.stdout).toMatch(/village\|memorial/);
  });

  it("check-school-glb village: the layout's boxes, light points and village_lm.webp next to the GLB -> PASS (exit 0)", () => {
    const colliders = greyboxColliders(VILLAGE_LAYOUT);
    const nodes: GltfNode[] = colliders.map((c) => {
      const h = c.camera ? 4 : 1; // camera boxes stand >= 1.6 m, looked-over boxes stay low
      return cubeNode(colliderNode(c.id), [(c.box.minX + c.box.maxX) / 2, h / 2, (c.box.minZ + c.box.maxZ) / 2], [c.box.maxX - c.box.minX, h, c.box.maxZ - c.box.minZ]);
    });
    nodes.push({ name: "light__lamp_1", translation: [0, 4, 0] }, { name: "village_lm_11", mesh: 1 });
    const g = baseGltf(nodes);
    g.materials = [
      { name: "LM_plaza", extensions: { KHR_materials_unlit: {} } },
      ...VILLAGE_NON_LIGHTMAPPED.map((name) => ({ name, extensions: { KHR_materials_unlit: {} } })),
    ];
    g.meshes![1]!.primitives[0]!.material = 0;
    g.meshes![1]!.primitives[0]!.attributes.TEXCOORD_1 = 2;
    g.extensionsUsed = ["KHR_materials_unlit"];
    const file = path.join(tmp, "village.glb");
    fs.writeFileSync(file, makeGlb(g));
    fs.writeFileSync(path.join(tmp, "village_lm.webp"), webpVp8x(2048, 2048));
    const ok = runTs("check-school-glb.ts", file, "village");
    expect(ok.stdout + ok.stderr).toContain("PASS");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/OK\s+col__ 상자 크기/);
    // one layout box moved by 0.5 m: FAIL, exit 1
    nodes[0]!.translation = [nodes[0]!.translation![0]! + 0.5, 0.5, nodes[0]!.translation![2]!];
    fs.writeFileSync(file, makeGlb(baseGltf(nodes)));
    const bad = runTs("check-school-glb.ts", file, "village");
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/FAIL\s+col__ 상자 크기/);
  });

  it("check-school-glb memorial: anchors, walls, cubby units, the ceiling and memorial_lm.webp -> PASS; one anchor 5 cm off -> FAIL", () => {
    const spec = schoolSpec("memorial");
    const nodes: GltfNode[] = spec.requiredBoxes!.map((b) =>
      cubeNode(b.node, [(b.box.minX + b.box.maxX) / 2, 1.75, (b.box.minZ + b.box.maxZ) / 2], [b.box.maxX - b.box.minX, 3.5, b.box.maxZ - b.box.minZ]),
    );
    for (const p of spec.placements) nodes.push({ name: p.node, translation: [p.x, p.y!, p.z], rotation: [0, Math.sin(p.yaw! / 2), 0, Math.cos(p.yaw! / 2)] });
    nodes.push({ name: "ceil__hall", translation: [300, 4.55, 0], scale: [15, 0.1, 12] }, { name: "hall_lm", mesh: 1 });
    const g = baseGltf(nodes);
    g.materials = [
      { name: "LM_floor", extensions: { KHR_materials_unlit: {} } },
      ...MEMORIAL_NON_LIGHTMAPPED.map((name) => ({ name, extensions: { KHR_materials_unlit: {} } })),
    ];
    g.meshes![1]!.primitives[0]!.material = 0;
    g.meshes![1]!.primitives[0]!.attributes.TEXCOORD_1 = 2;
    g.extensionsUsed = ["KHR_materials_unlit"];
    const file = path.join(tmp, "memorial.glb");
    fs.writeFileSync(file, makeGlb(g));
    fs.writeFileSync(path.join(tmp, "memorial_lm.webp"), webpVp8x(2048, 2048));
    const ok = runTs("check-school-glb.ts", file, "memorial");
    expect(ok.stdout + ok.stderr).toContain("PASS");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/OK\s+앵커 위치: 364개/);
    const k = nodes.findIndex((n) => n.name === "anchor__cubby_e_3_7");
    nodes[k]!.translation = [nodes[k]!.translation![0]! - 0.05, nodes[k]!.translation![1]!, nodes[k]!.translation![2]!];
    fs.writeFileSync(file, makeGlb(g));
    const bad = runTs("check-school-glb.ts", file, "memorial");
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/FAIL\s+앵커 위치: .*anchor__cubby_e_3_7/);
  });

  it("check-school-glb: an empty glTF fails the village checks with exit 1", () => {
    const file = path.join(tmp, "village.glb");
    fs.writeFileSync(file, makeGlb(baseGltf([{ name: "x" }])));
    const res = runTs("check-school-glb.ts", file, "village");
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("col__");
    expect(res.stdout).toContain("FAIL");
  });

  it("check-school-glb: a malformed glTF is one 'FAIL: ...' line and exit 1, never a stack trace", () => {
    const file = path.join(tmp, "village.glb");
    // A null material makes the light-map check throw a TypeError.
    const g = baseGltf([{ name: "x" }]);
    (g as unknown as { materials: unknown[] }).materials = [null];
    fs.writeFileSync(file, makeGlb(g));
    const res = runTs("check-school-glb.ts", file, "village");
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/FAIL: .*village\.glb/);
    expect(res.stderr + res.stdout).not.toMatch(/\n\s+at /);
  });

  it("check-school-glb: a malformed %-escape in an image uri is a texture FAIL (exit 1), not a crash", () => {
    const file = path.join(tmp, "village.glb");
    const g = baseGltf([{ name: "x" }]);
    g.images = [{ uri: "%E0%A4%A.png" }];
    fs.writeFileSync(file, makeGlb(g));
    const res = runTs("check-school-glb.ts", file, "village");
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/FAIL\s+텍스처 크기/);
    expect(res.stderr + res.stdout).not.toMatch(/URIError|\n\s+at /);
  });

  it("extract-colliders: writes the sorted module; a rotated col__ node is a FAIL that writes nothing", () => {
    const glb = path.join(tmp, "room.glb");
    const out = path.join(tmp, "gen", "roomColliders.ts");
    fs.writeFileSync(
      glb,
      makeGlb(baseGltf([cubeNode("col__b", [5, 0, 5], [2, 1, 2]), cubeNode("col__a", [1.004, 0, 1], [2, 1, 2])])),
    );
    const ok = runTs("extract-colliders.ts", glb, "ROOM_PROP_COLLIDERS", out);
    expect(ok.status).toBe(0);
    const text = fs.readFileSync(out, "utf8");
    expect(text).toContain("export const ROOM_PROP_COLLIDERS: readonly AABB[] = [");
    expect(text.indexOf("col__a")).toBeLessThan(text.indexOf("col__b"));
    expect(text).toContain("{ minX: 0, maxX: 2, minZ: 0, maxZ: 2 }, // col__a");
    // ...with no tall props here (1 m cubes) the camera-box export is empty.
    expect(text).toContain("export const ROOM_PROP_CAMERA_BOXES: readonly CameraBox[] = [];");

    const out2 = path.join(tmp, "gen", "bad.ts");
    const s = Math.SQRT1_2;
    fs.writeFileSync(glb, makeGlb(baseGltf([cubeNode("col__spin", [0, 0, 0], [2, 1, 2], { rotation: [0, s, 0, s] })])));
    const bad = runTs("extract-colliders.ts", glb, "ROOM_PROP_COLLIDERS", out2);
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).toContain("col__spin");
    expect(fs.existsSync(out2)).toBe(false);
  });

  it("extract-colliders: no col__ nodes is a FAIL, and a usage error exits 1", () => {
    const glb = path.join(tmp, "room.glb");
    fs.writeFileSync(glb, makeGlb(baseGltf([{ name: "x" }])));
    expect(runTs("extract-colliders.ts", glb, "ROOM_PROP_COLLIDERS", path.join(tmp, "o.ts")).status).toBe(1);
    expect(runTs("extract-colliders.ts").status).toBe(1);
  });
});
