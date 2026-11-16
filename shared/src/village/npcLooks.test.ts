import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { APPEARANCE_PRESETS, SLOT_OPTIONS, appearanceFromIds, DEFAULT_APPEARANCE } from "../appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS } from "../characterManifest";
import { GUIDES } from "./guides";
import {
  BUS_DRIVER,
  LAKE_SHOPKEEPER_NODE,
  NPC_CLIPS,
  NPC_GLB_HASH,
  NPC_GLB_MAX_BYTES,
  NPC_GLB_PATH,
  NPC_LOOKS,
  NPC_PART_PREFIX,
  npcPartNodes,
  type NpcClip,
} from "./npcLooks";
import { SIT_POSE } from "../sitPose";

// 테스트는 shared/ 에서 실행되므로 client/public 은 한 단계 위에서 찾는다(fishingAnims.test.ts와 같은 방식).
const PUBLIC = resolve(process.cwd(), "../client/public");
const NPC_GLB = resolve(PUBLIC, `.${NPC_GLB_PATH}`);
const CHAR_GLB = resolve(PUBLIC, "models/character.glb");

interface Gltf {
  nodes: { name?: string; mesh?: number; skin?: number; translation?: number[]; rotation?: number[]; children?: number[] }[];
  meshes?: { name?: string; primitives: { material?: number }[] }[];
  materials?: { name?: string }[];
  skins?: { joints: number[] }[];
  animations?: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number }[];
  }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

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

const npc = loadGlb(NPC_GLB);
const char = loadGlb(CHAR_GLB);
const nodeName = (g: Gltf, i: number) => g.nodes[i].name ?? "";
const clipNames = Object.keys(NPC_CLIPS) as NpcClip[];
const anim = (name: string) => {
  const a = npc.gltf.animations?.find((x) => x.name === name);
  expect(a, name).toBeDefined();
  return a!;
};
function spread(v: number[], w: number): number {
  let s = 0;
  for (let i = w; i < v.length; i += 1) s = Math.max(s, Math.abs(v[i] - v[i % w]));
  return s;
}

describe("NPC 전용 모습은 조립실·옷장에 없다 (owner 2026-11-16)", () => {
  const npcIds = Object.values(NPC_LOOKS).flatMap((l) =>
    Object.entries(l.parts).filter(([, id]) => id !== null && id.startsWith(NPC_PART_PREFIX)) as [string, string][],
  );

  it("every NPC look wears its own top (and the driver, the guide and the shopkeeper a hat of their own)", () => {
    expect(Object.keys(NPC_LOOKS).sort()).toEqual(["bus_driver", "lake_shopkeeper", "memorial_staff", "village_guide"]);
    for (const look of Object.values(NPC_LOOKS)) expect(look.parts.top?.startsWith(NPC_PART_PREFIX), look.id).toBe(true);
    expect(NPC_LOOKS.bus_driver.parts.hat).toBe("npc_driver_cap");
    expect(NPC_LOOKS.village_guide.parts.hat).toBe("npc_guide_hat");
    expect(NPC_LOOKS.village_guide.parts.item).toBe("npc_clipboard");
    expect(NPC_LOOKS.lake_shopkeeper.parts.hat).toBe("npc_shop_hat");
    expect(npcIds.length).toBeGreaterThanOrEqual(8);
    // the rest of each look (head, hair, face, trousers, shoes) is a character.glb part a player can also have
    for (const look of Object.values(NPC_LOOKS)) {
      for (const slot of CHARACTER_SLOTS) {
        const id = look.parts[slot];
        if (id === null || id.startsWith(NPC_PART_PREFIX)) continue;
        expect(CHARACTER_MANIFEST.slots[slot] as readonly string[], `${look.id} ${slot}`).toContain(id);
      }
    }
  });

  it("no NPC part is in the character manifest's slots, its labels, or the creator's SLOT_OPTIONS", () => {
    for (const [slot, id] of npcIds) {
      const s = slot as (typeof CHARACTER_SLOTS)[number];
      expect(CHARACTER_MANIFEST.slots[s] as readonly string[], `${slot}__${id}`).not.toContain(id);
      expect(Object.keys(CHARACTER_MANIFEST.labels[s] ?? {}), `${slot}__${id} label`).not.toContain(id);
      expect(SLOT_OPTIONS[s], `${slot}__${id} option`).not.toContain(id);
    }
    // 플레이어가 고를 수 있는 부품 어디에도 npc_ 머리말이 없다
    for (const slot of CHARACTER_SLOTS) for (const id of SLOT_OPTIONS[slot]) expect(id?.startsWith(NPC_PART_PREFIX) ?? false, `${slot}:${id}`).toBe(false);
  });

  it("a player appearance cannot name an NPC part (appearanceFromIds throws), and no preset uses one", () => {
    const colors = {
      hatColor: DEFAULT_APPEARANCE.hatColor, hairColor: DEFAULT_APPEARANCE.hairColor, skin: DEFAULT_APPEARANCE.skin,
      topColor: DEFAULT_APPEARANCE.topColor, bottomColor: DEFAULT_APPEARANCE.bottomColor, shoesColor: DEFAULT_APPEARANCE.shoesColor,
      itemColor: DEFAULT_APPEARANCE.itemColor, voice: DEFAULT_APPEARANCE.voice,
    };
    const base = { hat: null, hair: "short", face: "smile", top: "tee", bottom: "pants", shoes: "sneakers", item: null };
    for (const [slot, id] of npcIds) expect(() => appearanceFromIds({ ...base, [slot]: id }, colors), `${slot}:${id}`).toThrow();
    for (const p of APPEARANCE_PRESETS) {
      for (const slot of CHARACTER_SLOTS) expect(p.parts[slot]?.startsWith(NPC_PART_PREFIX) ?? false, `${p.id} ${slot}`).toBe(false);
    }
  });

  it("the two guides wear their NPC looks", () => {
    expect(GUIDES.find((g) => g.id === "plaza_guide")?.npc).toBe("village_guide");
    expect(GUIDES.find((g) => g.id === "hall_desk")?.npc).toBe("memorial_staff");
  });
});

describe("npc.glb (NPC 옷·소품·동작, 같은 뼈대)", () => {
  it("carries its content hash and stays within its own budget (1.5 MB)", () => {
    const sha = createHash("sha256").update(npc.buf).digest("hex");
    expect(NPC_GLB_HASH).toBe(sha.slice(0, 8));
    expect(NPC_GLB_MAX_BYTES).toBe(1.5 * 1024 * 1024);
    expect(statSync(NPC_GLB).size).toBeLessThanOrEqual(NPC_GLB_MAX_BYTES);
  });

  it("the lake's shopkeeper stands on the marker node of lake_structures.glb", () => {
    const lake = loadGlb(resolve(PUBLIC, "models/lake/lake_structures.glb"));
    expect(lake.gltf.nodes.some((n) => n.name === LAKE_SHOPKEEPER_NODE)).toBe(true);
  });

  it("ships exactly the NPC part meshes, every one skinned to one skin with character.glb's joints in the same order", () => {
    const meshNodes = npc.gltf.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name).sort();
    expect(meshNodes).toEqual(npcPartNodes());
    expect(npc.gltf.skins?.length).toBe(1);
    for (const n of npc.gltf.nodes.filter((x) => x.mesh !== undefined)) expect(n.skin, n.name).toBe(0);
    const joints = (g: Gltf) => g.skins![0].joints.map((j) => nodeName(g, j));
    expect(joints(npc.gltf)).toEqual(joints(char.gltf));
    // 같은 뼈대에서 내보냈으니 뼈의 쉼 자세 위치도 같다
    const charBones = new Map(char.gltf.nodes.map((n) => [n.name, n]));
    for (const j of npc.gltf.skins![0].joints) {
      const n = npc.gltf.nodes[j];
      const c = charBones.get(n.name)!;
      for (let k = 0; k < 3; k += 1) expect(Math.abs((n.translation ?? [0, 0, 0])[k] - (c.translation ?? [0, 0, 0])[k]), n.name).toBeLessThan(1e-4);
    }
  });

  it("uses only its own materials (no player tint): fixed colours, the badges' pictures and matte fabrics with a weave normal map", () => {
    const mats = (npc.gltf.materials ?? []) as { name?: string; normalTexture?: unknown; pbrMetallicRoughness?: { roughnessFactor?: number } }[];
    const names = mats.map((m) => m.name ?? "");
    for (const n of names) expect(/^npc(fab)?_/.test(n), n).toBe(true);
    expect(names).toEqual(expect.arrayContaining(["npc_badge", "npc_badge_memorial"]));
    const fabrics = mats.filter((m) => (m.name ?? "").startsWith("npcfab_"));
    expect(fabrics.map((m) => m.name).sort()).toEqual(["npcfab_canvas", "npcfab_cotton", "npcfab_mesh", "npcfab_poly", "npcfab_terry", "npcfab_wool"]);
    for (const f of fabrics) {
      expect(f.normalTexture, f.name).toBeDefined();
      expect(f.pbrMetallicRoughness?.roughnessFactor ?? 1, `${f.name} is matte`).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("ships exactly the NPC clips with their lengths", () => {
    expect((npc.gltf.animations ?? []).map((a) => a.name).sort()).toEqual([...clipNames].sort());
    for (const name of clipNames) {
      let end = 0;
      for (const s of anim(name).samplers) {
        const t = npc.floats(s.input).v;
        expect(t[0], name).toBeCloseTo(0, 5);
        end = Math.max(end, t[t.length - 1]);
      }
      expect(end, `${name} seconds`).toBeCloseTo(NPC_CLIPS[name].seconds, 3);
    }
  });

  it("every clip drives all 44 bones by name (a clip that left one out would leave it in the bind pose)", () => {
    const bones = new Set(char.gltf.skins![0].joints.map((j) => nodeName(char.gltf, j)));
    for (const name of clipNames) {
      const targets = new Set(anim(name).channels.map((c) => nodeName(npc.gltf, c.target.node)));
      for (const b of bones) expect(targets.has(b), `${name}: ${b}`).toBe(true);
    }
  });

  it("actually animates: every clip has changing tracks and rotating bones (nothing baked frozen)", () => {
    // 2026-11-09: 뼈대를 REST 자세로 둔 채 내보내 클립이 모두 굳은 채 나간 적이 있다(character-glb-export).
    for (const name of clipNames) {
      const a = anim(name);
      let changing = 0;
      const rotating = new Set<string>();
      for (const ch of a.channels) {
        const { v, w } = npc.floats(a.samplers[ch.sampler].output);
        const s = spread(v, w);
        if (s > 1e-3) changing += 1;
        if (ch.target.path === "rotation" && s > 0.01) rotating.add(nodeName(npc.gltf, ch.target.node));
      }
      expect(changing, `${name}: changing tracks`).toBeGreaterThanOrEqual(3);
      expect(rotating.size, `${name}: rotating bones`).toBeGreaterThanOrEqual(2);
    }
  });

  it("is not stuck in the T-pose: both upper arms hang or reach well away from the rest (arms-out) pose", () => {
    for (const bone of ["upperarm.l", "upperarm.r"]) {
      const idx = npc.gltf.nodes.findIndex((n) => n.name === bone);
      const rest = npc.gltf.nodes[idx].rotation ?? [0, 0, 0, 1];
      for (const name of clipNames) {
        const a = anim(name);
        const ch = a.channels.find((c) => c.target.node === idx && c.target.path === "rotation")!;
        const q = npc.floats(a.samplers[ch.sampler].output).v.slice(0, 4);
        const dot = Math.abs(q[0] * rest[0] + q[1] * rest[1] + q[2] * rest[2] + q[3] * rest[3]);
        const angle = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
        expect(angle, `${name}: ${bone} away from rest (deg)`).toBeGreaterThan(30);
      }
    }
  });

  it("the driving clips keep Sit_Chair_Idle's hips (the seat fit of SIT_POSE holds for the driver)", () => {
    const hipsN = npc.gltf.nodes.findIndex((n) => n.name === "hips");
    const hipsC = char.gltf.nodes.findIndex((n) => n.name === "hips");
    const sit = char.gltf.animations!.find((a) => a.name === "Sit_Chair_Idle")!;
    const chC = sit.channels.find((c) => c.target.node === hipsC && c.target.path === "translation")!;
    const want = char.floats(sit.samplers[chC.sampler].output).v.slice(0, 3);
    for (const name of ["Npc_Drive", "Npc_Drive_Left", "Npc_Drive_Right"] as const) {
      const a = anim(name);
      const ch = a.channels.find((c) => c.target.node === hipsN && c.target.path === "translation")!;
      const got = npc.floats(a.samplers[ch.sampler].output).v.slice(0, 3);
      for (let k = 0; k < 3; k += 1) expect(got[k], `${name} hips[${k}]`).toBeCloseTo(want[k], 3);
    }
  });
});

describe("버스 기사 자리 (bus-v3와의 약속)", () => {
  it("the driver's root sits the seated butt on the v3 driver's cushion and the wheel hub is ahead of the hips, within reach", () => {
    const root = { y: 0.34 + BUS_DRIVER.rootLift, z: -3.71 };
    expect(root.y).toBeCloseTo(0.34 + 0.452 - SIT_POSE.contactY, 6);
    // v3: hub (-0.62, 1.30, -3.94)
    const hub = { y: 1.3, z: -3.94 };
    expect(root.y - hub.y).toBeCloseTo(BUS_DRIVER.rootFromHub[1], 6);
    expect(root.z - hub.z).toBeCloseTo(BUS_DRIVER.rootFromHub[2], 6);
    // the hips (behind the root, +z) sit behind the wheel (-z ahead), the wheel no more than ~0.75 m ahead of them
    const hipsZ = root.z + SIT_POSE.hipsBehindRoot;
    expect(hub.z).toBeLessThan(hipsZ);
    expect(hipsZ - hub.z).toBeLessThan(0.75);
    expect(BUS_DRIVER.yaw).toBeCloseTo(Math.PI, 6);
    expect(BUS_DRIVER.fullWheelTurn).toBeCloseTo((40 * Math.PI) / 180, 6);
  });
});
