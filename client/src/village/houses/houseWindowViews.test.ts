/**
 * What each house window looks onto, from both models (owner 2026-11-27: through the clear glass a window showed a strange
 * blue-white panel — the room behind it, house_N.glb drawn by HouseShowcase, has its own windows and doors elsewhere in the wall).
 *
 * Every window of the ten shells (village_houses.glb, M_glass clustered as the client does) is mapped into its floor's room (the
 * interior frame, exteriorWindows.ts) and looked through with straight rays against the room's triangles as HouseShowcase draws
 * them (Draco decoded here, the same files the game loads). A window whose looks meet a door or opening at knee height ("door"), or
 * meet the room's own window opening over 10-75 % of its width ("jamb": its edge and the dark slot beside it in the glass), must be
 * in houseShutters.ts HOUSE_CLOSED_WINDOWS, and nothing else may be: re-baking a room or moving a window shows up here.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_A8, HOUSE_BODY_BACK, HOUSE_BODY_FRONT, HOUSE_BODY_HALF, houseWorldToLocal } from "@caysonverse/shared/village/houseExterior";
import { HOUSE_NUMBERS, HOUSE_ROOM, houseOrigin, type HouseNumber } from "@caysonverse/shared/village/houseAreas";
import {
  CLOSED_OVER,
  HOUSE_CLOSED_WINDOWS,
  closedShutterParts,
  closedWindowRects,
  clusterWindows,
  houseShutterParts,
  onOpenLeafOfClosed,
  windowAt,
  windowFloor,
  type AnyWall,
  type ClosedReason,
} from "./houseShutters";

// ───────────────────────────────────────── GLB reading (positions only) ─────────────────────────────────────────

const MODELS = fileURLToPath(new URL("../../../public/models/village/", import.meta.url));
const require = createRequire(import.meta.url);

type Json = {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; extensions?: { KHR_draco_mesh_compression?: { bufferView: number; attributes: Record<string, number> } } }[] }[];
  materials?: { name?: string }[];
  accessors: { bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
};
type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function trs(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]): M4 {
  const [x, y, z, w] = r as [number, number, number, number];
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0]!, t[1]!, t[2]!, 1];
  for (let i = 0; i < 3; i++) {
    m[i]! *= s[0]!;
    m[4 + i]! *= s[1]!;
    m[8 + i]! *= s[2]!;
  }
  return m;
}
function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}
const apply = (m: M4, x: number, y: number, z: number): [number, number, number] => [
  m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
  m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
  m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let D: any = null;

function readGlb(file: string): { json: Json; bin: Buffer } {
  const b = readFileSync(MODELS + file);
  let off = 12;
  let json: Json | null = null;
  let bin = Buffer.alloc(0);
  while (off < b.readUInt32LE(8)) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    const body = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8")) as Json;
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  return { json: json!, bin };
}
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(json: Json, bin: Buffer, i: number): number[] {
  const a = json.accessors[i]!;
  const v = json.bufferViews[a.bufferView!]!;
  const n = COMPONENTS[a.type]!;
  const size = ({ 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 } as Record<number, number>)[a.componentType]!;
  const stride = v.byteStride ?? n * size;
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[] = [];
  for (let k = 0; k < a.count; k++)
    for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * size;
      out.push(a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o));
    }
  return out;
}
function decode(json: Json, bin: Buffer, prim: Json["meshes"][number]["primitives"][number]): { pos: ArrayLike<number>; faces: ArrayLike<number> } {
  const ext = prim.extensions?.KHR_draco_mesh_compression;
  if (!ext) {
    const pos = readAccessor(json, bin, prim.attributes.POSITION!);
    return { pos, faces: prim.indices !== undefined ? readAccessor(json, bin, prim.indices) : [...Array(pos.length / 3).keys()] };
  }
  const v = json.bufferViews[ext.bufferView]!;
  const data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  const dec = new D.Decoder();
  const buf = new D.DecoderBuffer();
  buf.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
  const mesh = new D.Mesh();
  const st = dec.DecodeBufferToMesh(buf, mesh);
  if (!st.ok()) throw new Error("Draco: " + st.error_msg());
  const nf = mesh.num_faces();
  const np = mesh.num_points();
  const faces = new Uint32Array(nf * 3);
  const ia = new D.DracoInt32Array();
  for (let f = 0; f < nf; f++) {
    dec.GetFaceFromMesh(mesh, f, ia);
    faces[f * 3] = ia.GetValue(0);
    faces[f * 3 + 1] = ia.GetValue(1);
    faces[f * 3 + 2] = ia.GetValue(2);
  }
  D.destroy(ia);
  const att = dec.GetAttributeByUniqueId(mesh, ext.attributes.POSITION!);
  const fa = new D.DracoFloat32Array();
  dec.GetAttributeFloatForAllPoints(mesh, att, fa);
  const pos = new Float32Array(np * 3);
  for (let i = 0; i < np * 3; i++) pos[i] = fa.GetValue(i);
  for (const o of [fa, mesh, buf, dec]) D.destroy(o);
  return { pos, faces };
}

interface Prim {
  node: string;
  root: string;
  material: string;
  /** World triangles (9 floats each). */
  tris: Float32Array;
}
function primsOf(file: string, keep: (node: string, root: string) => boolean): Prim[] {
  const { json, bin } = readGlb(file);
  const out: Prim[] = [];
  const walk = (i: number, parent: M4, root: string) => {
    const n = json.nodes[i]!;
    const name = n.name ?? `#${i}`;
    const m = mul(parent, n.matrix ?? trs(n.translation, n.rotation, n.scale));
    if (n.mesh !== undefined && keep(name, root)) {
      for (const p of json.meshes[n.mesh]!.primitives) {
        const { pos, faces } = decode(json, bin, p);
        const tris = new Float32Array(faces.length * 3);
        for (let f = 0; f < faces.length; f++) {
          const q = apply(m, pos[faces[f]! * 3]!, pos[faces[f]! * 3 + 1]!, pos[faces[f]! * 3 + 2]!);
          tris.set(q, f * 3);
        }
        out.push({ node: name, root, material: json.materials?.[p.material ?? -1]?.name ?? "", tris });
      }
    }
    for (const c of n.children ?? []) walk(c, m, root);
  };
  for (const r of json.scenes[json.scene ?? 0]!.nodes) walk(r, I4, json.nodes[r]!.name ?? "");
  return out;
}

function rayTri(o: number[], d: number[], t: Float32Array, i: number): number {
  const ax = t[i]!, ay = t[i + 1]!, az = t[i + 2]!;
  const e1x = t[i + 3]! - ax, e1y = t[i + 4]! - ay, e1z = t[i + 5]! - az;
  const e2x = t[i + 6]! - ax, e2y = t[i + 7]! - ay, e2z = t[i + 8]! - az;
  const px = d[1]! * e2z - d[2]! * e2y, py = d[2]! * e2x - d[0]! * e2z, pz = d[0]! * e2y - d[1]! * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const sx = o[0]! - ax, sy = o[1]! - ay, sz = o[2]! - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return tt > 1e-4 ? tt : Infinity;
}

// ───────────────────────────────────────── what each window looks onto ─────────────────────────────────────────

type Wall = AnyWall;
const W = HOUSE_ROOM.width;
const DEP = HOUSE_ROOM.depth;

/** A house's glass as the client sees it (world triangles, non-indexed). */
function glassOf(prims: readonly Prim[], id: string): BufferGeometry[] {
  return prims
    .filter((p) => p.root === `houseshell__${id}` && p.material === "M_glass")
    .map((p) => {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(p.tris, 3));
      return g;
    });
}

/** One floor of a house's rooms in the interior frame, as HouseShowcase draws it (triangles wholly outside the floor dropped). */
interface Floor {
  tris: Float32Array;
  cols: Array<{ name: string; min: number[]; max: number[] }>;
}
function floorsOf(n: HouseNumber): Map<1 | 2, Floor> {
  const inner = primsOf(`houses/house_${n}.glb`, () => true);
  const out = new Map<1 | 2, Floor>();
  for (const floor of [1, 2] as const) {
    const o = houseOrigin(n, floor);
    const tris: number[] = [];
    const cols: Floor["cols"] = [];
    for (const p of inner) {
      if (p.material === "M_view" || p.material === "M_glass") continue;
      if (/^(spawn|seat|door|stair|floor|ceil)__/.test(p.node)) continue;
      const isCol = p.node.startsWith("col__");
      const mn = [Infinity, Infinity, Infinity];
      const mx = [-Infinity, -Infinity, -Infinity];
      for (let t = 0; t + 8 < p.tris.length; t += 9) {
        const v = [0, 1, 2].map((k) => [p.tris[t + k * 3]! - o.x, p.tris[t + k * 3 + 1]!, o.z - p.tris[t + k * 3 + 2]!]);
        if (!v.some((q) => q[0]! >= -0.02 && q[0]! <= W + 0.02 && q[2]! >= -0.02 && q[2]! <= DEP + 0.02)) continue;
        if (isCol) {
          for (const q of v) for (let k = 0; k < 3; k++) (mn[k] = Math.min(mn[k]!, q[k]!)), (mx[k] = Math.max(mx[k]!, q[k]!));
          continue;
        }
        for (const q of v) tris.push(...q);
      }
      if (isCol && Number.isFinite(mn[0])) cols.push({ name: p.node, min: mn, max: mx });
    }
    out.set(floor, { tris: new Float32Array(tris), cols });
  }
  return out;
}

/** A wall in the interior frame: inward normal, and a point at s along it, y up, d in from its inner face. */
function wallFrame(wall: Wall): { n: number[]; face: (s: number, y: number, d: number) => number[] } {
  switch (wall) {
    case "front": return { n: [0, 0, 1], face: (s, y, d) => [s, y, d] };
    case "back": return { n: [0, 0, -1], face: (s, y, d) => [s, y, DEP - d] };
    case "left": return { n: [1, 0, 0], face: (s, y, d) => [d, y, s] };
    case "right": return { n: [-1, 0, 0], face: (s, y, d) => [W - d, y, s] };
  }
}

/**
 * Straight looks through a window's glass (12 across, at the glass's mid height and at knee height) into its floor's room: the
 * share meeting the room's own window opening (past the wall's inner face), and the share meeting an opening at knee height (a door
 * or a patio door: no window goes that low).
 */
function looks(fl: Floor, wall: Wall, s0: number, s1: number, yMid: number): { open: number; door: number } {
  const f = wallFrame(wall);
  let open = 0;
  let door = 0;
  const N = 12;
  for (let k = 0; k < N; k++) {
    const s = s0 + ((k + 0.5) / N) * (s1 - s0);
    for (const [y, knee] of [[yMid, false], [0.5, true]] as const) {
      const o = f.face(s, y, -0.35);
      let best = Infinity;
      for (let i = 0; i + 8 < fl.tris.length; i += 9) best = Math.min(best, rayTri(o, f.n, fl.tris, i));
      if (best - 0.35 <= 0.05) continue;
      if (knee) door++;
      else open++;
    }
  }
  return { open: open / N, door: door / N };
}

interface Seen {
  wall: Wall;
  floor: 1 | 2;
  at: number;
  open: number;
  door: number;
  why: ClosedReason | null;
}

let prims: Prim[] = [];
const seen = new Map<string, Seen[]>();

beforeAll(async () => {
  D = await (require("draco3d") as { createDecoderModule(o: object): Promise<unknown> }).createDecoderModule({});
  prims = primsOf("village_houses.glb", (_n, root) => root.startsWith("houseshell__") || root.startsWith("housedetail__"));
  for (const n of HOUSE_NUMBERS) {
    const h = a8(n);
    const floors = floorsOf(n);
    const list: Seen[] = [];
    for (const w of clusterWindows(glassOf(prims, h.id), h, ["front", "back", "left", "right"])) {
      const floor = windowFloor(w);
      // the gable's attic lights (no room behind) and the front door's two lights stay as they are
      if (floor === 3 || w.v1 - w.v0 < 1.2) continue;
      const base = HOUSE_A8.floorLift + (floor - 1) * HOUSE_ROOM.storey;
      const at = windowAt(w);
      const half = (w.u1 - w.u0) / 2;
      const { open, door } = looks(floors.get(floor)!, w.wall, at - half, at + half, (w.v0 + w.v1) / 2 - base);
      const why: ClosedReason | null = door > 0 ? "door" : open >= 0.1 && open <= 0.75 ? "jamb" : null;
      list.push({ wall: w.wall, floor, at: Math.round(at * 100) / 100, open, door, why });
    }
    seen.set(h.id, list);
  }
}, 300000);

function a8(n: HouseNumber) {
  return VILLAGE_LAYOUT.sceneryHouses.find((s) => s.id === `house_${n}`)!;
}

describe("windows that look onto a door or a misplaced room window are shuttered (2026-11-27)", () => {
  it("finds every house's windows on all four walls", () => {
    for (const n of HOUSE_NUMBERS) {
      const list = seen.get(`house_${n}`)!;
      // 2 + 3 front (the door's lights left out), 4 back (house 9: a patio door and 2), 4 a side
      expect(list.filter((w) => w.wall === "front").length).toBe(5);
      expect(list.filter((w) => w.wall === "left").length).toBe(4);
      expect(list.filter((w) => w.wall === "right").length).toBe(4);
      expect(list.filter((w) => w.wall === "back").length).toBe(n === 9 ? 3 : 4);
    }
  });

  it("HOUSE_CLOSED_WINDOWS is exactly the windows whose view meets a door or the edge of the room's own window", () => {
    for (const n of HOUSE_NUMBERS) {
      const id = `house_${n}`;
      const want = seen
        .get(id)!
        .filter((w) => w.why)
        .map((w) => `${w.wall} ${w.floor} ${w.at.toFixed(2)} ${w.why}`)
        .sort();
      const have = (HOUSE_CLOSED_WINDOWS[id] ?? []).map(([wall, floor, at, why]) => `${wall} ${floor} ${at.toFixed(2)} ${why}`).sort();
      expect(have, id).toEqual(want);
    }
  });

  it("every listed window is found in the glass, and its closed leaves cover the glass from edge to edge", () => {
    for (const n of HOUSE_NUMBERS) {
      const h = a8(n);
      const glass = glassOf(prims, h.id);
      const rects = closedWindowRects(glass, h);
      expect(rects.length, h.id).toBe(HOUSE_CLOSED_WINDOWS[h.id]!.length);
      const all = clusterWindows(glass, h, ["front", "back", "left", "right"]);
      const parts = closedShutterParts(glass, h);
      // ~34 triangles a window: 2 leaves x (face 2, edges 8, heart 4, hinges 4) + the latch 2
      expect(parts.wood.pos.length / 9, h.id).toBe(rects.length * 38);
      for (const r of rects) {
        // the glass's own cluster (an ajar pane aside) lies within the rectangle the leaves are built over
        const g = all.find((o) => o.wall === r.wall && windowFloor(o) === windowFloor(r) && Math.abs(windowAt(o) - windowAt(r)) < 0.35)!;
        expect(r.v0).toBeCloseTo(g.v0, 3);
        expect(r.v1).toBeCloseTo(g.v1, 3);
        expect(r.u1 - r.u0).toBeGreaterThan(0.5);
        // the leaves' faces span the glass plus the overlap on every side
        const out = parts.wood.pos;
        let lo = Infinity, hi = -Infinity, bot = Infinity, top = -Infinity;
        for (let i = 0; i < out.length; i += 3) {
          const l = houseWorldToLocal(h, out[i]!, out[i + 2]!);
          const u = r.wall === "front" || r.wall === "back" ? l.lx : l.lz;
          const y = out[i + 1]!;
          if (u < r.u0 - 0.2 || u > r.u1 + 0.2 || y < r.v0 - 0.2 || y > r.v1 + 0.2) continue;
          const d = r.wall === "front" ? l.lz - HOUSE_BODY_FRONT : r.wall === "back" ? HOUSE_BODY_BACK - l.lz : r.wall === "right" ? l.lx - HOUSE_BODY_HALF : -HOUSE_BODY_HALF - l.lx;
          if (d < (r.g ?? 0)) continue;
          lo = Math.min(lo, u), hi = Math.max(hi, u), bot = Math.min(bot, y), top = Math.max(top, y);
        }
        expect(lo).toBeLessThanOrEqual(r.u0 - CLOSED_OVER.side + 1e-6);
        expect(hi).toBeGreaterThanOrEqual(r.u1 + CLOSED_OVER.side - 1e-6);
        expect(bot).toBeLessThanOrEqual(r.v0 - CLOSED_OVER.bottom + 1e-6);
        expect(top).toBeGreaterThanOrEqual(r.v1 + CLOSED_OVER.top - 1e-6);
      }
    }
  });

  it("a closed window keeps no open leaves: none of ours, and the model's own (front, back upper floor) come out of the detail", () => {
    for (const n of HOUSE_NUMBERS) {
      const h = a8(n);
      const glass = glassOf(prims, h.id);
      const rects = closedWindowRects(glass, h);
      // ours: the side and back leaves are built beside no closed window
      const open = houseShutterParts(glass, h);
      for (let i = 0; i < open.wood.pos.length; i += 3) {
        const l = houseWorldToLocal(h, open.wood.pos[i]!, open.wood.pos[i + 2]!);
        const y = open.wood.pos[i + 1]!;
        for (const r of rects) {
          const u = r.wall === "front" || r.wall === "back" ? l.lx : l.lz;
          const d = r.wall === "front" ? l.lz - HOUSE_BODY_FRONT : r.wall === "back" ? HOUSE_BODY_BACK - l.lz : r.wall === "right" ? l.lx - HOUSE_BODY_HALF : -HOUSE_BODY_HALF - l.lx;
          const sw = (r.u1 - r.u0) / 2 + 0.03;
          const beside = Math.abs(d) < 0.2 && y > r.v0 && y < r.v1 && u > r.u0 - sw && u < r.u1 + sw;
          expect(beside, `${h.id} ${r.wall} ${windowAt(r).toFixed(2)}`).toBe(false);
        }
      }
      // the model's: every closed front window (not house 3's patio door) had a pair of kit leaves, wholly in the zone taken out
      const detail = prims.filter((p) => p.root === `housedetail__${h.id}` && (p.material === "LM_wood" || p.material === "LM_metal"));
      for (const r of rects.filter((w) => w.wall === "front" && w.u1 - w.u0 < 1.5)) {
        let gone = 0;
        for (const p of detail)
          for (let o = 0; o + 8 < p.tris.length; o += 9) {
            const one = [rects.find((x) => x === r)!];
            if ([0, 1, 2].every((k) => onOpenLeafOfClosed(h, one, p.tris[o + k * 3]!, p.tris[o + k * 3 + 1]!, p.tris[o + k * 3 + 2]!))) gone++;
          }
        expect(gone, `${h.id} front ${windowAt(r).toFixed(2)}`).toBeGreaterThan(20);
      }
    }
  });
});
