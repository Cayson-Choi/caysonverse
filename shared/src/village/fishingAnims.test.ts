import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { FISHING_ANIMS_GLB_HASH, FISHING_ANIMS_MAX_BYTES, FISHING_ANIMS_PATH, FISHING_CLIPS, RIGHT_ARM_BONES } from "./fishingAnims";

// 테스트는 shared/ 에서 실행되므로 client/public 은 한 단계 위에서 찾는다(characterManifest.test.ts와 같은 방식).
const PUBLIC = resolve(process.cwd(), "../client/public");
const FISH_GLB = resolve(PUBLIC, `.${FISHING_ANIMS_PATH}`);
const CHAR_GLB = resolve(PUBLIC, "models/character.glb");

interface Gltf {
  nodes: { name?: string; mesh?: number; skin?: number; translation?: number[]; rotation?: number[]; children?: number[] }[];
  meshes?: unknown[];
  skins?: unknown[];
  animations?: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[];
  }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

/** GLB 하나를 읽어 JSON과 float 접근자 읽기 함수를 돌려준다. */
function loadGlb(path: string) {
  const buf = readFileSync(path);
  expect(buf.toString("ascii", 0, 4)).toBe("glTF");
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const bin = buf.subarray(20 + jsonLength + 8);
  const floats = (index: number): { v: number[]; w: number } => {
    const a = gltf.accessors[index];
    const view = gltf.bufferViews[a.bufferView];
    const w = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] ?? 1;
    expect(a.componentType).toBe(5126);
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = view.byteStride ?? w * 4;
    const v: number[] = [];
    for (let i = 0; i < a.count; i += 1) for (let k = 0; k < w; k += 1) v.push(bin.readFloatLE(start + i * stride + k * 4));
    return { v, w };
  };
  return { buf, gltf, floats };
}

const fish = loadGlb(FISH_GLB);
const char = loadGlb(CHAR_GLB);
const nodeName = (g: Gltf, i: number) => g.nodes[i].name ?? "";
const clipNames = Object.keys(FISHING_CLIPS) as (keyof typeof FISHING_CLIPS)[];
const anim = (name: string) => {
  const a = fish.gltf.animations?.find((x) => x.name === name);
  expect(a, name).toBeDefined();
  return a!;
};
/** 한 트랙의 키값이 첫 키에서 가장 멀리 벗어난 정도. */
function spread(v: number[], w: number): number {
  let s = 0;
  for (let i = w; i < v.length; i += 1) s = Math.max(s, Math.abs(v[i] - v[i % w]));
  return s;
}

describe("fishing_anims.glb (낚시 동작 9개, 설계 6.3)", () => {
  it("carries its content hash and stays within its own budget (700 KB)", () => {
    const sha = createHash("sha256").update(fish.buf).digest("hex");
    expect(FISHING_ANIMS_GLB_HASH).toBe(sha.slice(0, 8));
    expect(FISHING_ANIMS_MAX_BYTES).toBe(716_800);
    expect(statSync(FISH_GLB).size).toBeLessThanOrEqual(FISHING_ANIMS_MAX_BYTES);
  });

  it("is bones + clips only: no mesh, no skin", () => {
    expect(fish.gltf.meshes ?? []).toEqual([]);
    expect(fish.gltf.skins ?? []).toEqual([]);
    expect(fish.gltf.nodes.filter((n) => n.mesh !== undefined || n.skin !== undefined)).toEqual([]);
  });

  it("ships exactly the 9 design clips with their lengths", () => {
    expect((fish.gltf.animations ?? []).map((a) => a.name).sort()).toEqual([...clipNames].sort());
    for (const name of clipNames) {
      const a = anim(name);
      let end = 0;
      for (const s of a.samplers) {
        const t = fish.floats(s.input).v;
        expect(t[0], name).toBeCloseTo(0, 5);
        end = Math.max(end, t[t.length - 1]);
      }
      expect(end, `${name} seconds`).toBeCloseTo(FISHING_CLIPS[name].seconds, 3);
    }
  });

  it("every track names a character.glb bone, whose rest offset matches (clips retarget by bone name)", () => {
    const charBones = new Map(char.gltf.nodes.map((n) => [n.name, n]));
    for (const a of fish.gltf.animations ?? []) {
      for (const ch of a.channels) {
        const name = nodeName(fish.gltf, ch.target.node);
        expect(charBones.has(name), `${a.name}: ${name}`).toBe(true);
      }
    }
    // 같은 뼈대에서 내보냈으니 뼈의 쉼 자세 위치가 같아야 한다(위치 트랙 값이 그대로 맞는다).
    for (const n of fish.gltf.nodes) {
      const c = charBones.get(n.name);
      expect(c, n.name).toBeDefined();
      const a = n.translation ?? [0, 0, 0];
      const b = c!.translation ?? [0, 0, 0];
      for (let k = 0; k < 3; k += 1) expect(Math.abs(a[k] - b[k]), `${n.name} rest translation`).toBeLessThan(1e-4);
    }
  });

  it("actually animates: every clip's sampler outputs change over time and its arm bones rotate (nothing baked frozen)", () => {
    // 2026-11-09: 뼈대를 REST 자세로 둔 채 내보내 클립이 모두 굳은 채 나간 적이 있다(character-glb-export).
    for (const name of clipNames) {
      const a = anim(name);
      let changing = 0;
      const rotating = new Set<string>();
      for (const ch of a.channels) {
        const { v, w } = fish.floats(a.samplers[ch.sampler].output);
        const s = spread(v, w);
        if (s > 1e-3) changing += 1;
        if (ch.target.path === "rotation" && s > 0.01) rotating.add(nodeName(fish.gltf, ch.target.node));
      }
      const arms = [...rotating].filter((b) => /^(upperarm|lowerarm|wrist|hand)\./.test(b));
      expect(changing, `${name}: tracks whose keys change`).toBeGreaterThanOrEqual(3);
      expect(arms.length, `${name}: arm bones that rotate`).toBeGreaterThanOrEqual(FISHING_CLIPS[name].part === "rightArm" ? 2 : 3);
    }
  });

  it("is not stuck in the T-pose: the right upper arm hangs well below the rest (arms-out) pose", () => {
    // 쉼 자세(팔 벌림)의 upperarm.r 회전과 각 클립 첫 키의 각도 차가 커야 한다.
    const restNode = fish.gltf.nodes.findIndex((n) => n.name === "upperarm.r");
    const rest = fish.gltf.nodes[restNode].rotation ?? [0, 0, 0, 1];
    for (const name of clipNames) {
      const a = anim(name);
      const ch = a.channels.find((c) => c.target.node === restNode && c.target.path === "rotation");
      expect(ch, name).toBeDefined();
      const q = fish.floats(a.samplers[ch!.sampler].output).v.slice(0, 4);
      const dot = Math.abs(q[0] * rest[0] + q[1] * rest[1] + q[2] * rest[2] + q[3] * rest[3]);
      const angle = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      expect(angle, `${name}: upperarm.r away from rest (deg)`).toBeGreaterThan(30);
    }
  });

  it("Carry_Rod only moves the right arm (it overlays the walk and idle)", () => {
    const bones = new Set(anim("Carry_Rod").channels.map((c) => nodeName(fish.gltf, c.target.node)));
    expect([...bones].sort()).toEqual([...RIGHT_ARM_BONES].sort());
    for (const name of clipNames) {
      if (FISHING_CLIPS[name].part !== "body") continue;
      const b = new Set(anim(name).channels.map((c) => nodeName(fish.gltf, c.target.node)));
      for (const must of ["hips", "spine", "chest", "head", "upperleg.l", "upperleg.r", ...RIGHT_ARM_BONES, "upperarm.l"]) {
        expect(b.has(must), `${name}: ${must}`).toBe(true);
      }
    }
  });

  it("loops close seamlessly (first key = last key)", () => {
    for (const name of clipNames) {
      if (!FISHING_CLIPS[name].loop) continue;
      const a = anim(name);
      for (const ch of a.channels) {
        const { v, w } = fish.floats(a.samplers[ch.sampler].output);
        for (let k = 0; k < w; k += 1) {
          expect(Math.abs(v[k] - v[v.length - w + k]), `${name} ${nodeName(fish.gltf, ch.target.node)} ${ch.target.path}`).toBeLessThan(1e-3);
        }
      }
    }
  });

  it("seated clips sit exactly where Sit_Chair_Idle sits (same hips), so chair alignment holds", () => {
    const hipsF = fish.gltf.nodes.findIndex((n) => n.name === "hips");
    const hipsC = char.gltf.nodes.findIndex((n) => n.name === "hips");
    const sit = char.gltf.animations!.find((a) => a.name === "Sit_Chair_Idle")!;
    const sitCh = sit.channels.find((c) => c.target.node === hipsC && c.target.path === "translation")!;
    const ref = char.floats(sit.samplers[sitCh.sampler].output).v.slice(0, 3);
    for (const name of ["Fish_Sit_Idle", "Fish_Sit_Cast", "Fish_Sit_Strike", "Fish_Sit_Fight", "Fish_Sit_Lift", "Fish_Net", "Fish_Stand_Show"]) {
      const a = anim(name);
      const ch = a.channels.find((c) => c.target.node === hipsF && c.target.path === "translation")!;
      const v = fish.floats(a.samplers[ch.sampler].output).v.slice(0, 3);
      for (let k = 0; k < 3; k += 1) expect(Math.abs(v[k] - ref[k]), `${name} hips[${k}]`).toBeLessThan(1e-3);
    }
  });
});
