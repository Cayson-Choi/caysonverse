import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { BufferAttribute } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { VILLAGE_MODEL_COLLIDERS } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_LOTS, lotLocalToWorld } from "@caysonverse/shared/village/villageLots";
import { VILLAGE_SEAT_MARKERS } from "@caysonverse/shared/village/generated/villageSeatMarkers";
import { PATH_PLANT_MOVES, movedBox, pathPlantShift } from "@caysonverse/shared/village/pathPlants";
import { isBlocked, type AABB } from "@caysonverse/shared/collision";
import { LANES, laneShape } from "../ground/groundPaths";
import { PLAZA_BEDS, bedAt, placeFlowers } from "./flowerPlacement";
import { CARD_TRIGGER_M, GROUND_FLOOR_MAX, cardsOffPaving } from "./floraOffPaving";
import { PLANT_CLEAR_M, TRUNK_CLEAR_M, pavedClearance } from "./pavedGround";
import { LOT_TREE_SPECS, VILLAGE_TREE_SPECS, WILLOW_SPECS, YOUNG_SPECS } from "./treeSkeleton";
import { readCards, type Card } from "./vegCards";

/** The sweep (owner 2026-11-21, the temple path: a tree trunk and a flower bed stood on the cobbles). */
const same = (a: AABB, b: AABB): boolean => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

const MODELS = fileURLToPath(new URL("../../../public/models/village/", import.meta.url));
const require = createRequire(import.meta.url);

type Json = any;
let D: any;
function readGlb(file: string): { json: Json; bin: Buffer } {
  const b = readFileSync(MODELS + file);
  let off = 12, json: Json = null, bin = Buffer.alloc(0);
  while (off < b.readUInt32LE(8)) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4), body = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  return { json, bin };
}
const N: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(json: Json, bin: Buffer, i: number): number[] {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = N[a.type]!;
  const size = ({ 5126: 4, 5125: 4, 5123: 2, 5121: 1 } as Record<number, number>)[a.componentType]!;
  const stride = v.byteStride ?? n * size, base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out: number[] = [];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = base + k * stride + c * size;
    out.push(a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o));
  }
  return out;
}
/** A Draco primitive's attribute (positions / uv / colour) and indices. */
function decode(json: Json, bin: Buffer, prim: any): { att: Record<string, { n: number; data: Float32Array }>; index: Uint32Array } {
  const ext = prim.extensions.KHR_draco_mesh_compression;
  const v = json.bufferViews[ext.bufferView];
  const data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  const dec = new D.Decoder(), buf = new D.DecoderBuffer();
  buf.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
  const mesh = new D.Mesh();
  if (!dec.DecodeBufferToMesh(buf, mesh).ok()) throw new Error("draco");
  const nf = mesh.num_faces(), np = mesh.num_points();
  const index = new Uint32Array(nf * 3), ia = new D.DracoInt32Array();
  for (let f = 0; f < nf; f++) { dec.GetFaceFromMesh(mesh, f, ia); for (let k = 0; k < 3; k++) index[f * 3 + k] = ia.GetValue(k); }
  const att: Record<string, { n: number; data: Float32Array }> = {};
  for (const [name, id] of Object.entries(ext.attributes as Record<string, number>)) {
    const a = dec.GetAttributeByUniqueId(mesh, id), n = a.num_components();
    const fa = new D.DracoFloat32Array();
    dec.GetAttributeFloatForAllPoints(mesh, a, fa);
    const d = new Float32Array(np * n);
    for (let i = 0; i < np * n; i++) d[i] = fa.GetValue(i);
    D.destroy(fa);
    att[name] = { n, data: d };
  }
  for (const o of [ia, mesh, buf, dec]) D.destroy(o);
  return { att, index };
}
beforeAll(async () => {
  D = await (require("draco3d") as { createDecoderModule(o: object): Promise<unknown> }).createDecoderModule({});
});
const attr = (a: { n: number; data: Float32Array } | undefined, _count?: number) => (a ? new BufferAttribute(a.data, a.n) : null) as unknown as { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } | null;

/** Every flower / grass card of village.glb's M_leaf_flora meshes. */
function villageCards(): Card[] {
  const { json, bin } = readGlb("village.glb");
  const cards: Card[] = [];
  json.meshes.forEach((m: any) => {
    m.primitives.forEach((p: any) => {
      if (json.materials[p.material]?.name !== "M_leaf_flora" || !m.name.startsWith("village_leaf_")) return;
      const { att, index } = decode(json, bin, p);
      const pos = att.POSITION!;
      const count = pos.data.length / 3;
      cards.push(...readCards(attr(pos, count)!, index, attr(att.TEXCOORD_0, count) as never, attr(att.COLOR_0, count) as never));
    });
  });
  return cards.map((c, i) => ({ ...c, id: i }));
}


// ───────────────────────────────────────────── the sweep ─────────────────────────────────────────────

const inPlaza = (x: number, z: number): boolean => Math.hypot(x, z) < 30; // the plaza's tree pits, planters and fountain beds are designed
const moved = (x: number, z: number, kind: "tree" | "shrub"): [number, number] => {
  const s = pathPlantShift(x, z, kind);
  return s ? [x + s.dx, z + s.dz] : [x, z];
};

/** Every trunk, shrub and instance of the model, where the game puts it (the moves applied). */
function plantSpots(): Array<{ what: string; x: number; z: number; need: number }> {
  const { json, bin } = readGlb("village.glb");
  const out: Array<{ what: string; x: number; z: number; need: number }> = [];
  for (const n of json.nodes) {
    if (!n.name) continue;
    if (n.translation && /^col__(tree|shrub|bush)_/.test(n.name)) {
      const kind = n.name.startsWith("col__tree") ? "tree" : "shrub";
      const [x, z] = moved(n.translation[0], n.translation[2], kind);
      out.push({ what: n.name, x, z, need: kind === "tree" ? TRUNK_CLEAR_M : PLANT_CLEAR_M });
    }
    const inst = n.extensions?.EXT_mesh_gpu_instancing;
    if (inst && inst.attributes.TRANSLATION !== undefined && /street|orchard|shrub|meadow/.test(n.name)) {
      const t = accessor(json, bin, inst.attributes.TRANSLATION);
      const tree = /street|orchard/.test(n.name);
      for (let k = 0; k < t.length / 3; k++) {
        const [x, z] = moved(t[k * 3]!, t[k * 3 + 2]!, tree ? "tree" : "shrub");
        out.push({ what: `${n.name}[${k}]`, x, z, need: tree ? TRUNK_CLEAR_M : PLANT_CLEAR_M });
      }
    }
  }
  for (const s of [...VILLAGE_TREE_SPECS, ...LOT_TREE_SPECS, ...WILLOW_SPECS, ...YOUNG_SPECS]) {
    const [x, z] = moved(s.x, s.z, "tree");
    out.push({ what: `spec ${s.kind}#${s.index}`, x, z, need: TRUNK_CLEAR_M });
  }
  // the lots' own trunks (the temple's pines, the school's trees): their collider boxes in the world
  for (const lot of VILLAGE_LOTS) {
    for (const c of lot.colliders) {
      if (!/pine|tree/.test(c.suffix)) continue;
      const a = lotLocalToWorld(lot, c.rect.x0, c.rect.z0);
      const b = lotLocalToWorld(lot, c.rect.x1, c.rect.z1);
      out.push({ what: `${lot.id}_${c.suffix}`, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, need: TRUNK_CLEAR_M });
    }
  }
  return out;
}

describe("nothing grows on a paved surface (lanes, ring road and sidewalk, bus pad, bridge, doorsteps)", () => {
  it("every tree trunk keeps 0.8 m off the paving; every shrub and meadow tuft stays off it", () => {
    const bad = plantSpots()
      .filter((p) => !inPlaza(p.x, p.z) && pavedClearance(p.x, p.z) < p.need - 1e-6)
      .map((p) => `${p.what} (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) clear ${pavedClearance(p.x, p.z).toFixed(2)} < ${p.need}`);
    expect(bad).toEqual([]);
  });

  it("the plants that stood on a path were moved (the model's six street plants and the sidewalk cherry)", () => {
    expect(PATH_PLANT_MOVES.map((m) => m.id).sort()).toEqual(["shrub_1", "shrub_14", "shrub_16", "shrub_3", "tree_11", "tree_37", "tree_44"]);
    for (const m of PATH_PLANT_MOVES) {
      expect(pavedClearance(m.from.x, m.from.z), `${m.id} stood on paving`).toBeLessThan(m.kind === "tree" ? TRUNK_CLEAR_M : 0);
      expect(pavedClearance(m.to.x, m.to.z), `${m.id} now`).toBeGreaterThanOrEqual(m.kind === "tree" ? 1 : 0.8);
    }
  });

  it("the game's colliders follow: the moved boxes stand at the new spots and clear of everything else", () => {
    for (const m of PATH_PLANT_MOVES) {
      expect(VILLAGE_MODEL_COLLIDERS.obstacles.some((b) => same(b, m.box)), `${m.id} old box still there`).toBe(false);
      const nb = movedBox(m);
      expect(VILLAGE_MODEL_COLLIDERS.obstacles.some((b) => same(b, nb)), `${m.id} new box`).toBe(true);
      const cx = (nb.minX + nb.maxX) / 2;
      const cz = (nb.minZ + nb.maxZ) / 2;
      const rad = (nb.maxX - nb.minX) / 2;
      // nothing else solid within 0.3 m of the plant's box (a house, a wall, another trunk), the plants themselves excepted
      const others = VILLAGE_MODEL_COLLIDERS.obstacles.filter((b) => !same(b, nb) && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) >= 0.45);
      expect(isBlocked(cx, cz, rad + 0.3, others), `${m.id} crowded`).toBe(false);
    }
  });

  it("the flower and grass cards the model bakes on the paving are moved to the grass beside it", () => {
    const cards = villageCards();
    const m = cardsOffPaving(cards, PLAZA_BEDS);
    expect(m.moved.length).toBeGreaterThanOrEqual(10);
    const bad: string[] = [];
    m.cards.forEach((c) => {
      const cx = (c.ax + c.bx) / 2;
      const cz = (c.az + c.bz) / 2;
      if (c.floor > GROUND_FLOOR_MAX || bedAt(PLAZA_BEDS, cx, cz, c.floor)) return;
      if (pavedClearance(cx, cz) < CARD_TRIGGER_M - 1e-6) bad.push(`card ${cx.toFixed(1)},${cz.toFixed(1)} clear ${pavedClearance(cx, cz).toFixed(2)}`);
    });
    expect(bad).toEqual([]);
    // how far a card travels: along the path's edge, a metre or two, never across the village
    for (const i of m.moved) expect(Math.hypot(m.cards[i]!.x - cards[i]!.x, m.cards[i]!.z - cards[i]!.z), `card ${i}`).toBeLessThan(3);
  }, 120000);

  it("every flower the placement plants off a bed lies off the paving", () => {
    const cards = villageCards();
    const placed = placeFlowers(cardsOffPaving(cards, PLAZA_BEDS).cards, PLAZA_BEDS);
    const bad = placed.plants
      .filter((p) => p.y <= GROUND_FLOOR_MAX + 0.05 && !bedAt(PLAZA_BEDS, p.x, p.z, p.y) && pavedClearance(p.x, p.z) < -0.001)
      .map((p) => `plant ${p.x.toFixed(2)},${p.z.toFixed(2)} clear ${pavedClearance(p.x, p.z).toFixed(2)}`);
    expect(bad).toEqual([]);
  }, 120000);

  it("the owner's spot: the temple lane's cobbles are clear from the road to the gate", () => {
    // sample the nw lane's whole centre line (its cobbles) against every plant spot, with the shrub / trunk radii
    const lane = laneShape(LANES.find((l) => l.id === "nw")!).centre;
    for (const p of plantSpots()) {
      if (inPlaza(p.x, p.z)) continue;
      const d = Math.min(...lane.map((c) => Math.hypot(c.x - p.x, c.z - p.z)));
      expect(d, `${p.what} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) from the temple lane`).toBeGreaterThan(1.5 + (p.need > 0 ? 0.8 : 0));
    }
  });

  it("no plant stands in front of a bench, chair or porch seat (1 m of its standing spot)", () => {
    const seats: Array<{ id: string; x: number; z: number }> = VILLAGE_SEAT_MARKERS.map((m) => ({ id: m.id, x: m.standX ?? m.x, z: m.standZ ?? m.z }));
    for (const lot of VILLAGE_LOTS) for (const s of lot.seats) seats.push({ id: s.id, ...lotLocalToWorld(lot, s.lx, s.lz) });
    const plants = plantSpots().filter((p) => !inPlaza(p.x, p.z) && !/^spec |^inst__|meadow/.test(p.what));
    const bad: string[] = [];
    for (const s of seats) for (const p of plants) if (Math.hypot(p.x - s.x, p.z - s.z) < 0.9) bad.push(`${p.what} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) by ${s.id}`);
    expect(bad).toEqual([]);
  });
});
