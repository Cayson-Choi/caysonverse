/**
 * M1 PBR library: every set's files exist, are the KTX2 the loader expects (size, mips, codec, colour transfer), match
 * the manifest's bytes and hashes, and stay inside the budgets of the art-director's PLAN.md (section 3 and 7):
 * PC texture memory ~180 MB, phone ~60 MB, and a lazy library (nothing loads at import).
 * The loader is checked with a stub KTX2Loader (the unit tests have no WebGL): colour spaces, wrapping, anisotropy,
 * cache sharing, the material wiring (ORM in three slots, roughness = metalness = 1, glTF normalScale.y) and repeats.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CompressedTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, type WebGLRenderer } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCalls: string[] = [];
vi.mock("three/examples/jsm/loaders/KTX2Loader.js", () => {
  class KTX2Loader {
    setTranscoderPath() {
      return this;
    }
    setWorkerLimit() {
      return this;
    }
    detectSupport() {
      return this;
    }
    dispose() {}
    loadAsync(url: string) {
      loadCalls.push(url);
      const t = new CompressedTexture([], 4, 4);
      t.colorSpace = url.includes("_albedo") ? SRGBColorSpace : NoColorSpace;
      return Promise.resolve(t);
    }
  }
  return { KTX2Loader };
});

import { PBR_SETS } from "./pbrManifest.generated";
import {
  PBR_COLOR_SPACE,
  PBR_IDS,
  _resetPbrCacheForTests,
  createPbrMaterial,
  getPbrSet,
  pbrDownloadBytes,
  pbrFileTier,
  pbrGpuBytes,
  pbrRepeatFor,
  pbrSetInfo,
  pbrTierFor,
  pbrUrl,
  releasePbrSet,
} from "./pbrLibrary";

const PUBLIC = fileURLToPath(new URL("../../../public", import.meta.url));
const SIZE = { "2k": 2048, "1k": 1024 } as const;
const MB = 1024 * 1024;

/** The KTX2 fields we care about (KTX 2.0 spec: header, index, the first DFD basic block). */
function readKtx2(buf: Buffer) {
  const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  const ok = magic.every((b, i) => buf[i] === b);
  const u32 = (o: number) => buf.readUInt32LE(o);
  const dfd = u32(48);
  return {
    ok,
    vkFormat: u32(12),
    width: u32(20),
    height: u32(24),
    levels: u32(40),
    supercompression: u32(44), // 1 = BasisLZ (ETC1S), 2 = Zstandard
    colorModel: buf[dfd + 12], // 163 = ETC1S, 166 = UASTC
    transfer: buf[dfd + 14], // 1 = linear, 2 = sRGB
  };
}

const allFiles = () =>
  PBR_SETS.flatMap((s) => Object.entries(s.tiers).flatMap(([tier, maps]) => Object.entries(maps).map(([kind, f]) => ({ id: s.id, tier: tier as "2k" | "1k", kind, f }))));

describe("PBR manifest and files", () => {
  it("has every set of the plan's surface table, uniquely named", () => {
    expect(PBR_IDS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(PBR_IDS).size).toBe(PBR_IDS.length);
    for (const want of ["asphalt", "sidewalk_pavers", "plaza_granite", "granite_flamed", "grass", "dirt_path", "gravel", "stucco_white", "ceramic_siding", "wood_siding", "metal_roof_seam", "roof_shingle", "concrete_exposed", "brick_red", "floor_wood", "floor_laminate", "tile_white", "wallpaper", "steel_painted", "aluminium_brushed", "cast_iron", "fabric_upholstery", "wood_deck", "rock"])
      expect(PBR_IDS).toContain(want);
  });

  it("every set has a 1K albedo/normal/ORM and a 2K albedo; CC0 source; a real tile size", () => {
    for (const s of PBR_SETS) {
      expect(Object.keys(s.tiers["1k"] ?? {}).sort(), s.id).toEqual(["albedo", "normal", "orm"]);
      expect(s.tiers["2k"]?.albedo, s.id).toBeTruthy();
      expect(s.source?.license, s.id).toBe("CC0 1.0 Universal");
      expect(s.source?.page, s.id).toMatch(/^https:\/\/(polyhaven\.com|ambientcg\.com)\//);
      expect(s.tileMeters, s.id).toBeGreaterThan(0.2);
      expect(s.meanAlbedo?.length, s.id).toBe(3);
    }
  });

  it("every file exists, matches the manifest's size and hash, and is the KTX2 the loader expects", () => {
    for (const { id, tier, kind, f } of allFiles()) {
      const path = join(PUBLIC, "textures", "pbr", tier, `${id}_${kind}.ktx2`);
      expect(existsSync(path), path).toBe(true);
      const buf = readFileSync(path);
      expect(buf.length, path).toBe(f.bytes);
      expect(createHash("md5").update(buf).digest("hex").slice(0, 10), path).toBe(f.hash);
      const k = readKtx2(buf);
      expect(k.ok, path).toBe(true);
      expect(k.vkFormat, path).toBe(0); // Basis Universal payload
      expect([k.width, k.height], path).toEqual([SIZE[tier], SIZE[tier]]);
      expect(k.levels, `${path} full mip chain`).toBe(Math.log2(SIZE[tier]) + 1);
      if (kind === "albedo") {
        expect([k.colorModel, k.transfer, k.supercompression], `${path} ETC1S sRGB`).toEqual([163, 2, 1]);
      } else {
        expect([k.colorModel, k.transfer, k.supercompression], `${path} UASTC linear zstd`).toEqual([166, 1, 2]);
      }
    }
  });

  it("ships no stray files: the pbr folder holds exactly the manifest's files and the transcoder", () => {
    const want = new Set(allFiles().map(({ id, tier, kind }) => `${tier}/${id}_${kind}.ktx2`));
    for (const tier of ["2k", "1k"]) {
      const dir = join(PUBLIC, "textures", "pbr", tier);
      for (const name of readdirSync(dir)) expect(want.has(`${tier}/${name}`), `${tier}/${name}`).toBe(true);
    }
    for (const name of ["basis_transcoder.js", "basis_transcoder.wasm"])
      expect(existsSync(join(PUBLIC, "textures", "pbr", "basis", name)), name).toBe(true);
  });
});

describe("PBR budgets (PLAN.md)", () => {
  it("per-file sizes stay small (download)", () => {
    const cap = { albedo: { "2k": 1.6 * MB, "1k": 0.5 * MB }, normal: { "2k": 5 * MB, "1k": 1.5 * MB }, orm: { "2k": 0, "1k": 1.5 * MB } } as const;
    for (const { id, tier, kind, f } of allFiles()) expect(f.bytes, `${id} ${tier} ${kind}`).toBeLessThanOrEqual(cap[kind as "albedo"][tier]);
  });

  it("a phone set downloads under 3.2 MB; the whole library stays under 90 MB on disk", () => {
    let total = 0;
    for (const s of PBR_SETS) {
      expect(pbrDownloadBytes(s.id, "1k"), s.id).toBeLessThanOrEqual(3.2 * MB);
      for (const m of Object.values(s.tiers)) for (const f of Object.values(m)) total += f.bytes;
    }
    const dir = join(PUBLIC, "textures", "pbr", "basis");
    for (const n of readdirSync(dir)) total += statSync(join(dir, n)).size;
    expect(total).toBeLessThanOrEqual(90 * MB);
  });

  it("GPU memory: 16 phone sets fit 60 MB, 14 PC sets fit 180 MB", () => {
    const phone = Math.max(...PBR_IDS.map((id) => pbrGpuBytes(id, "1k", "mobile")));
    const pc = Math.max(...PBR_IDS.map((id) => pbrGpuBytes(id, "2k", "desktop")));
    expect(phone * 16).toBeLessThanOrEqual(60 * MB);
    expect(pc * 14).toBeLessThanOrEqual(180 * MB);
  });
});

describe("PBR loader API", () => {
  const renderer = { capabilities: { getMaxAnisotropy: () => 8 } } as unknown as WebGLRenderer;
  beforeEach(() => {
    _resetPbrCacheForTests();
    loadCalls.length = 0;
  });

  it("maps quality tiers and file tiers", () => {
    expect(pbrTierFor("high")).toBe("2k");
    expect(pbrTierFor("low")).toBe("1k");
    const granite = pbrSetInfo("plaza_granite");
    expect(pbrFileTier(granite, "2k", "normal")).toBe("2k");
    expect(pbrFileTier(granite, "2k", "orm")).toBe("1k");
    expect(pbrFileTier(pbrSetInfo("asphalt"), "2k", "normal")).toBe("1k");
    expect(pbrUrl("asphalt", "2k", "albedo")).toMatch(/^\/textures\/pbr\/2k\/asphalt_albedo\.ktx2\?v=[0-9a-f]{10}$/);
    expect(pbrUrl("asphalt", "2k", "orm")).toMatch(/^\/textures\/pbr\/1k\/asphalt_orm\.ktx2\?v=/);
    expect(() => pbrSetInfo("nope")).toThrow(/unknown PBR set/);
  });

  it("colour spaces: only the albedo is sRGB", () => {
    expect(PBR_COLOR_SPACE).toEqual({ albedo: SRGBColorSpace, normal: NoColorSpace, orm: NoColorSpace });
  });

  it("loads nothing until asked, then each set once (concurrent calls share the load)", async () => {
    expect(loadCalls).toEqual([]);
    const [a, b] = await Promise.all([getPbrSet("grass", "1k", renderer), getPbrSet("grass", "1k", renderer)]);
    expect(a).toBe(b);
    expect(loadCalls.length).toBe(3);
    expect(a.map.colorSpace).toBe(SRGBColorSpace);
    expect(a.normalMap.colorSpace).toBe(NoColorSpace);
    expect(a.orm.colorSpace).toBe(NoColorSpace);
    for (const t of [a.map, a.normalMap, a.orm]) {
      expect(t.wrapS).toBe(RepeatWrapping);
      expect(t.wrapT).toBe(RepeatWrapping);
      expect(t.anisotropy).toBe(8); // tier wants 8 on 1k; clamped by the GPU's 8
      expect(t.channel).toBe(0);
    }
    const pc = await getPbrSet("grass", "2k", renderer);
    expect(pc.map.anisotropy).toBe(8); // wants 16, GPU max 8
    await releasePbrSet("grass", "1k");
    await getPbrSet("grass", "1k", renderer);
    expect(loadCalls.length).toBe(9);
  });

  it("builds a MeshStandardMaterial with the ORM in three slots and real-world repeats", async () => {
    const set = await getPbrSet("plaza_granite", "2k", renderer);
    const mat = createPbrMaterial(set, { repeatMeters: [18, 9] });
    expect(mat.aoMap).toBe(mat.roughnessMap);
    expect(mat.metalnessMap).toBe(mat.roughnessMap);
    expect(mat.roughness).toBe(1);
    expect(mat.metalness).toBe(1);
    expect(mat.normalScale.y).toBe(-1); // glTF v-down, derivative tangents
    const [ru, rv] = pbrRepeatFor("plaza_granite", [18, 9]);
    expect(ru).toBeCloseTo(18 / set.info.tileMeters);
    expect(mat.map!.repeat.x).toBeCloseTo(ru);
    expect(mat.map!.repeat.y).toBeCloseTo(rv);
    expect(mat.map).not.toBe(set.map); // a clone...
    expect(mat.map!.source).toBe(set.map.source); // ...sharing the GPU upload
    expect(set.map.repeat.x).toBe(1); // the cached original is untouched
    const tangents = createPbrMaterial(set, { meshHasTangents: true, normalStrength: 0.5 });
    expect(tangents.normalScale.toArray()).toEqual([0.5, 0.5]);
  });
});
