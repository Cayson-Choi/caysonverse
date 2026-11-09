import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { BODY_MESHES, CHARACTER_GLB_HASH, CHARACTER_MANIFEST, CHARACTER_SLOTS } from "./characterManifest";

// 테스트는 shared/ 에서 실행되므로 client/public 은 한 단계 위에서 찾는다.
// (import.meta.url은 쓰지 않는다: 서버 typecheck가 이 파일도 CommonJS 설정으로 검사한다.)
const GLB = resolve(process.cwd(), "../client/public/models/character.glb");

interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
}
interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: { baseColorTexture?: unknown };
}
interface Gltf {
  nodes: GltfNode[];
  meshes: { primitives: GltfPrimitive[] }[];
  materials: GltfMaterial[];
  skins?: unknown[];
  animations?: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number }[];
  }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  extensionsUsed?: string[];
}

/** GLB = 12바이트 머리 + JSON 청크(길이 4바이트 @12, 종류 4바이트, 내용 @20). */
function readGltfJson(buf: Buffer): Gltf {
  expect(buf.toString("ascii", 0, 4)).toBe("glTF");
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
}

const glbBuf = readFileSync(GLB);
const gltf = readGltfJson(glbBuf);
/** BIN 청크 내용(JSON 청크 바로 뒤, 8바이트 머리 다음). */
const binChunk = glbBuf.subarray(20 + glbBuf.readUInt32LE(12) + 8);
/** float 접근자 하나를 숫자 배열로 읽는다(애니메이션 키값 검사용). */
function readFloats(index: number): number[] {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] ?? 1;
  expect(a.componentType).toBe(5126);
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? width * 4;
  const out: number[] = [];
  for (let i = 0; i < a.count; i += 1) for (let k = 0; k < width; k += 1) out.push(binChunk.readFloatLE(start + i * stride + k * 4));
  return out;
}
const meshNodes = gltf.nodes.filter((n) => n.mesh !== undefined);
const meshNodeNames = new Set(meshNodes.map((n) => n.name));

const BASE_CLIPS = ["Idle", "Walking_A", "Running_A", "Sit_Chair_Down", "Sit_Chair_Idle", "Sit_Chair_StandUp", "Jump_Full_Short"];
const PART_NODE = /^(body|hat|hair|face|top|bottom|shoes|item)__/;

describe("character manifest ↔ character.glb", () => {
  it("carries the GLB's content hash (sha256, first 8 hex) for the versioned model URL", () => {
    // The client loads /models/character.glb?v=CHARACTER_GLB_HASH; a GLB copied in without re-running
    // scripts/sync-character-assets.mjs would keep the old URL and let browsers serve the old cached model.
    const sha = createHash("sha256").update(readFileSync(GLB)).digest("hex");
    expect(CHARACTER_GLB_HASH).toMatch(/^[0-9a-f]{8}$/);
    expect(CHARACTER_GLB_HASH).toBe(sha.slice(0, 8));
  });

  it("ships every manifest part, hat variant, npcOnly part and body mesh as a mesh node", () => {
    expect(BODY_MESHES).toEqual(["body__head", "body__hands", "body__torso", "body__legs", "body__feet"]);

    const expected: string[] = [...BODY_MESHES];
    for (const slot of CHARACTER_SLOTS) {
      for (const id of CHARACTER_MANIFEST.slots[slot]) expected.push(`${slot}__${id}`);
    }
    for (const mesh of Object.values(CHARACTER_MANIFEST.hatVariants)) expected.push(mesh);
    for (const [slot, ids] of Object.entries(CHARACTER_MANIFEST.npcOnly)) {
      for (const id of ids) expected.push(`${slot}__${id}`);
    }

    expect(expected.filter((name) => !meshNodeNames.has(name))).toEqual([]);
    // 모자용 머리카락은 조립실 머리카락마다 하나씩 있어야 한다.
    expect(Object.keys(CHARACTER_MANIFEST.hatVariants).sort()).toEqual([...CHARACTER_MANIFEST.slots.hair].sort());
    // 조립실 목록에 없는 NPC 전용 부품이 slots 로 새지 않는다.
    for (const [slot, ids] of Object.entries(CHARACTER_MANIFEST.npcOnly)) {
      const listed: readonly string[] = CHARACTER_MANIFEST.slots[slot as keyof typeof CHARACTER_MANIFEST.slots];
      for (const id of ids) expect(listed).not.toContain(id);
    }
    // 투구류는 실제 모자여야 한다.
    for (const id of CHARACTER_MANIFEST.hatHidesHair) expect(CHARACTER_MANIFEST.slots.hat).toContain(id);
  });

  it("ships exactly the manifest clips: the 7 base clips plus the skirt variants", () => {
    // 기본 7개의 이름은 바뀌지 않는다. 나머지는 하의 변형 클립이다(지금 13개 = 7 + 롱스커트 3 + 짧은 치마 3).
    const manifestClips = [...CHARACTER_MANIFEST.clips];
    expect(manifestClips).toEqual(expect.arrayContaining(BASE_CLIPS));
    expect(new Set(manifestClips).size).toBe(manifestClips.length);
    expect((gltf.animations ?? []).map((a) => a.name).sort()).toEqual([...manifestClips].sort());
  });

  it("actually animates: every base clip turns the leg and arm bones (no clip baked in the rest pose)", () => {
    // 2026-11-09: a re-export with the armature left in REST pose shipped every clip frozen (T-pose sliding).
    for (const clip of BASE_CLIPS) {
      const anim = gltf.animations?.find((a) => a.name === clip);
      expect(anim, clip).toBeDefined();
      let moving = 0;
      for (const ch of anim!.channels) {
        const bone = gltf.nodes[ch.target.node].name ?? "";
        if (ch.target.path !== "rotation" || !/^(upperleg|lowerleg|upperarm|lowerarm)\./.test(bone)) continue;
        const v = readFloats(anim!.samplers[ch.sampler].output);
        let spread = 0;
        for (let i = 4; i < v.length; i += 1) spread = Math.max(spread, Math.abs(v[i] - v[i % 4]));
        if (spread > 0.01) moving += 1;
      }
      expect(moving, `${clip}: limb bones that rotate`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the bare legs under every short bottom identical (cloth fitting must never move skin)", () => {
    // 2026-11-10: the bottoms refit (clothfix v7) projected the shorts' own skin legs (mat_skin) as if they were cloth,
    // up to 14.5 cm, so every look with bare legs under shorts showed torn skin flaps (발주자 신고). The shorts, skirts
    // and petal skirt all carry the same bare-leg mesh (the skirts' copies are identical; the shorts' copy was tuned
    // by up to 8.5 mm at the calf long before), so each skin primitive must stay within 1 cm of the skirt's legs.
    const skinMat = gltf.materials.findIndex((m) => m.name === "mat_skin");
    expect(skinMat).toBeGreaterThanOrEqual(0);
    const legs = new Map<string, number[]>();
    for (const node of meshNodes) {
      if (!node.name?.startsWith("bottom__")) continue;
      const prim = gltf.meshes[node.mesh!].primitives.find((p) => p.material === skinMat);
      if (prim) legs.set(node.name, readFloats(prim.attributes.POSITION));
    }
    expect([...legs.keys()].sort()).toEqual(["bottom__longskirt", "bottom__petal_skirt", "bottom__shorts", "bottom__skirt"]);
    const ref = legs.get("bottom__skirt")!;
    for (const [name, pos] of legs) {
      expect(pos.length, name).toBe(ref.length);
      let worst = 0;
      for (let i = 0; i < ref.length; i += 1) worst = Math.max(worst, Math.abs(pos[i] - ref[i]));
      expect(worst, `${name}: bare-leg vertices moved (m)`).toBeLessThan(0.01);
    }
  });

  it("clipVariants only names real bottom parts and real clips", () => {
    const variants: Record<string, Record<string, string>> = CHARACTER_MANIFEST.clipVariants;
    const bottoms: readonly string[] = CHARACTER_MANIFEST.slots.bottom;
    const clips: readonly string[] = CHARACTER_MANIFEST.clips;
    expect(Object.keys(variants).length).toBeGreaterThan(0);
    for (const [bottom, map] of Object.entries(variants)) {
      expect(bottoms).toContain(bottom); // 키 = 실제 bottom 부품 id
      expect(Object.keys(map).length).toBeGreaterThan(0);
      for (const [base, variant] of Object.entries(map)) {
        expect(BASE_CLIPS).toContain(base); // 기본 클립(= CLIP 값)만 키가 된다
        expect(clips).toContain(variant); // 변형도 manifest·GLB에 실제로 있다
        expect(BASE_CLIPS).not.toContain(variant);
        expect(variant).not.toBe(base);
      }
    }
  });

  it("stays within maxBytes (4.5 MB) and is not Draco-compressed", () => {
    expect(CHARACTER_MANIFEST.maxBytes).toBe(4_718_592);
    expect(statSync(GLB).size).toBeLessThanOrEqual(CHARACTER_MANIFEST.maxBytes);
    expect(CHARACTER_MANIFEST.draco).toBe(false);
    expect(gltf.extensionsUsed ?? []).not.toContain("KHR_draco_mesh_compression");
  });

  it("meets the merge preconditions: identity part transforms, one skin, indexed primitives", () => {
    const parts = meshNodes.filter((n) => PART_NODE.test(n.name ?? ""));
    expect(parts.length).toBeGreaterThan(0);
    // 이름으로 부품을 찾으므로 이름이 겹치면 안 된다.
    expect(new Set(parts.map((n) => n.name)).size).toBe(parts.length);
    expect(gltf.skins).toHaveLength(1);

    const allowedAttributes = new Set(["POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0", "TEXCOORD_0"]);
    const requiredAttributes = ["POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0"];
    for (const node of parts) {
      const where = node.name;
      expect({ where, translation: node.translation }).toEqual({ where, translation: undefined });
      expect({ where, rotation: node.rotation }).toEqual({ where, rotation: undefined });
      expect({ where, scale: node.scale }).toEqual({ where, scale: undefined });
      expect({ where, matrix: node.matrix }).toEqual({ where, matrix: undefined });
      expect({ where, skin: node.skin }).toEqual({ where, skin: 0 });
      for (const primitive of gltf.meshes[node.mesh as number].primitives) {
        expect({ where, indexed: primitive.indices !== undefined }).toEqual({ where, indexed: true });
        const attributes = Object.keys(primitive.attributes);
        expect({ where, extra: attributes.filter((a) => !allowedAttributes.has(a)) }).toEqual({ where, extra: [] });
        expect({ where, missing: requiredAttributes.filter((a) => !attributes.includes(a)) }).toEqual({ where, missing: [] });
      }
    }
  });

  it("classifies every material: only mat_face_* is textured", () => {
    expect(gltf.materials.length).toBeGreaterThan(0);
    const names = gltf.materials.map((m) => m.name ?? "");
    for (const material of gltf.materials) {
      const name = material.name ?? "";
      expect(name).toMatch(/^mat_(skin|tint_\w+|fixed_\w+|face_\w+)$/);
      const textured = material.pbrMetallicRoughness?.baseColorTexture !== undefined;
      expect({ name, textured }).toEqual({ name, textured: name.startsWith("mat_face_") });
    }
    // 외형 색으로 물들이는 재질(manifest tintMaterials)은 모두 GLB 에 실제로 있다.
    for (const material of Object.values(CHARACTER_MANIFEST.tintMaterials)) {
      expect(names).toContain(material);
    }
  });

  it("pins the v1 part counts (spec §4) and the crown and tiara gold defaults", () => {
    expect(CHARACTER_SLOTS).toEqual(["hat", "hair", "face", "top", "bottom", "shoes", "item"]);
    expect(Object.fromEntries(CHARACTER_SLOTS.map((s) => [s, CHARACTER_MANIFEST.slots[s].length]))).toEqual({
      hat: 11,
      hair: 5,
      face: 6,
      top: 12,
      bottom: 7,
      shoes: 8,
      item: 12,
    });
    expect(CHARACTER_MANIFEST.defaultColors.hat.crown).toBe("#D4A93A");
    expect(CHARACTER_MANIFEST.defaultColors.hat.tiara).toBe("#D4A93A");
    expect(CHARACTER_MANIFEST.npcOnly).toEqual({ top: ["android"], bottom: ["android"], shoes: ["android"] });
  });
});
