/**
 * Every auto door's leaves, swept over their whole travel, against the models' own triangles (owner 2026-11-17: "자동문이 주위의
 * 물체와 겹치잖아 제발 좀 꼼꼼하게 확인해" — the hall's open leaves ran through the tea corner's shelves and sign and the hall map).
 *
 * A leaf slides straight along x, so the space it sweeps from shut to fully open is exactly the box hull of its two ends
 * (autoDoorParts.ts `sweptX`). Each swept box, and each part the door adds (header, track, side-lights), is tested against every
 * triangle of the GLB the door stands in (Draco decoded here, the same file the game loads) with the separating-axis test, shrunk
 * by 1 mm so parts that only touch (a frame on a sill) pass. Hidden collider boxes (`col__*`) are not drawn and are left out; the
 * door's own leaves are left out of their own check. Instanced nodes are checked by their instances' boxes.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import {
  ENTRANCE,
  ENTRANCE_SLIDE_M,
  HALL_LEAF_AUTHORED,
  HALL_LEAF_MOUNT_Z,
  HALL_REVEAL_OUTER_Z,
  boxesOverlap,
  entranceRig,
  hallDoorRig,
  sweptX,
  type Box,
  type DoorRig,
} from "./autoDoorParts";
import { CLOSED_AUTO_DOOR, PUBLIC_AUTO_DOOR, stepAutoDoor } from "@caysonverse/shared/village/autoDoor";
import { doorObservation, stepShownOpening } from "./publicAutoDoorModel";

const MODELS = fileURLToPath(new URL("../../public/models/village/", import.meta.url));
const require = createRequire(import.meta.url);

// ───────────────────────────────────────── GLB reading (positions only) ─────────────────────────────────────────

type Json = {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: {
    name?: string;
    mesh?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
    extensions?: { EXT_mesh_gpu_instancing?: { attributes: Record<string, number> } };
  }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; extensions?: { KHR_draco_mesh_compression?: { bufferView: number; attributes: Record<string, number> } } }[] }[];
  accessors: { bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string; min?: number[]; max?: number[]; normalized?: boolean }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
};

interface Mesh3 {
  node: string;
  /** World triangles, 9 floats each. */
  tris: Float32Array;
}

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

interface DracoModule {
  Decoder: new () => any;
  DecoderBuffer: new () => any;
  Mesh: new () => any;
  DracoFloat32Array: new () => any;
  DracoInt32Array: new () => any;
  destroy(o: unknown): void;
}
let D: DracoModule;

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
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType]!;
  const stride = v.byteStride ?? n * size;
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[] = [];
  for (let k = 0; k < a.count; k++)
    for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * size;
      out.push(
        a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : a.componentType === 5121 ? bin.readUInt8(o) : a.componentType === 5122 ? bin.readInt16LE(o) : bin.readInt8(o),
      );
    }
  return out;
}

function decodePrimitive(json: Json, bin: Buffer, prim: Json["meshes"][number]["primitives"][number]): { pos: Float32Array | number[]; faces: Uint32Array | number[] } {
  const ext = prim.extensions?.KHR_draco_mesh_compression;
  if (!ext) {
    const pos = readAccessor(json, bin, prim.attributes.POSITION!);
    const faces = prim.indices !== undefined ? readAccessor(json, bin, prim.indices) : [...Array(pos.length / 3).keys()];
    return { pos, faces };
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

/** Every drawn mesh node of a GLB whose world box reaches `near`, as world triangles; instanced nodes as their instances' boxes. */
function loadNear(file: string, near: Box): { meshes: Mesh3[]; instanceBoxes: { node: string; box: Box }[]; nodeBoxes: Map<string, Box> } {
  const { json, bin } = readGlb(file);
  const meshes: Mesh3[] = [];
  const instanceBoxes: { node: string; box: Box }[] = [];
  const nodeBoxes = new Map<string, Box>();
  const boxOf = (m: M4, lo: number[], hi: number[]): Box => {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const x of [lo[0]!, hi[0]!]) for (const y of [lo[1]!, hi[1]!]) for (const z of [lo[2]!, hi[2]!]) {
      const p = apply(m, x, y, z);
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k]!, p[k]!);
        mx[k] = Math.max(mx[k]!, p[k]!);
      }
    }
    return { min: mn as unknown as Box["min"], max: mx as unknown as Box["max"] };
  };
  const walk = (i: number, parent: M4) => {
    const n = json.nodes[i]!;
    const m = mul(parent, n.matrix ?? trs(n.translation, n.rotation, n.scale));
    if (n.mesh !== undefined) {
      const prims = json.meshes[n.mesh]!.primitives;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const p of prims) {
        const a = json.accessors[p.attributes.POSITION!]!;
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, a.min![k]!);
          hi[k] = Math.max(hi[k]!, a.max![k]!);
        }
      }
      const name = n.name ?? `#${i}`;
      const inst = n.extensions?.EXT_mesh_gpu_instancing;
      if (inst) {
        const t = inst.attributes.TRANSLATION !== undefined ? readAccessor(json, bin, inst.attributes.TRANSLATION) : null;
        const r = inst.attributes.ROTATION !== undefined ? readAccessor(json, bin, inst.attributes.ROTATION) : null;
        const s = inst.attributes.SCALE !== undefined ? readAccessor(json, bin, inst.attributes.SCALE) : null;
        const count = json.accessors[(inst.attributes.TRANSLATION ?? inst.attributes.ROTATION ?? inst.attributes.SCALE)!]!.count;
        for (let k = 0; k < count; k++) {
          const im = trs(t ? t.slice(k * 3, k * 3 + 3) : undefined, r ? r.slice(k * 4, k * 4 + 4) : undefined, s ? s.slice(k * 3, k * 3 + 3) : undefined);
          instanceBoxes.push({ node: name, box: boxOf(mul(m, im), lo, hi) });
        }
      } else {
        const wb = boxOf(m, lo, hi);
        nodeBoxes.set(name, wb);
        if (!name.startsWith("col__") && boxesOverlap(wb, near, -0.01)) {
          const tris: number[] = [];
          for (const p of prims) {
            const { pos, faces } = decodePrimitive(json, bin, p);
            for (let f = 0; f < faces.length; f += 3) {
              const v = [0, 1, 2].map((c) => apply(m, pos[faces[f + c]! * 3]!, pos[faces[f + c]! * 3 + 1]!, pos[faces[f + c]! * 3 + 2]!));
              // only the triangles near the door (a quick box cull)
              const tmin = [0, 1, 2].map((k) => Math.min(v[0]![k]!, v[1]![k]!, v[2]![k]!));
              const tmax = [0, 1, 2].map((k) => Math.max(v[0]![k]!, v[1]![k]!, v[2]![k]!));
              if ([0, 1, 2].some((k) => tmax[k]! < near.min[k]! || tmin[k]! > near.max[k]!)) continue;
              for (const q of v) tris.push(...q);
            }
          }
          meshes.push({ node: name, tris: new Float32Array(tris) });
        }
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const r of json.scenes[json.scene ?? 0]!.nodes) walk(r, I4);
  return { meshes, instanceBoxes, nodeBoxes };
}

// ───────────────────────────────────────── triangle / box (separating axes) ─────────────────────────────────────────

/** Whether a triangle crosses the open box shrunk by `eps` (Akenine-Möller's separating-axis test: 13 axes). */
export function triangleHitsBox(t: ArrayLike<number>, o: number, b: Box, eps = 0.001): boolean {
  const c = [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2);
  const h = [0, 1, 2].map((k) => (b.max[k]! - b.min[k]!) / 2 - eps);
  if (h.some((e) => e <= 0)) return false;
  const v = [0, 1, 2].map((i) => [0, 1, 2].map((k) => t[o + i * 3 + k]! - c[k]!));
  const e = [0, 1, 2].map((i) => [0, 1, 2].map((k) => v[(i + 1) % 3]![k]! - v[i]![k]!));
  const sep = (ax: number[]) => {
    if (Math.abs(ax[0]!) + Math.abs(ax[1]!) + Math.abs(ax[2]!) < 1e-12) return false;
    const p = v.map((q) => q[0]! * ax[0]! + q[1]! * ax[1]! + q[2]! * ax[2]!);
    const r = h[0]! * Math.abs(ax[0]!) + h[1]! * Math.abs(ax[1]!) + h[2]! * Math.abs(ax[2]!);
    return Math.min(...p) >= r || Math.max(...p) <= -r;
  };
  for (const ei of e) for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) if (sep([a[1]! * ei[2]! - a[2]! * ei[1]!, a[2]! * ei[0]! - a[0]! * ei[2]!, a[0]! * ei[1]! - a[1]! * ei[0]!])) return false;
  for (let k = 0; k < 3; k++) if (sep(k === 0 ? [1, 0, 0] : k === 1 ? [0, 1, 0] : [0, 0, 1])) return false;
  const n = [e[0]![1]! * e[1]![2]! - e[0]![2]! * e[1]![1]!, e[0]![2]! * e[1]![0]! - e[0]![0]! * e[1]![2]!, e[0]![0]! * e[1]![1]! - e[0]![1]! * e[1]![0]!];
  return !sep(n);
}

interface Hit {
  what: string;
  node: string;
  triangles: number;
  near: [number, number, number];
}

/** Every model mesh a door's swept leaves or added parts cross (none for a clear door). */
function clashes(rig: DoorRig, scene: ReturnType<typeof loadNear>, skip: readonly string[]): Hit[] {
  const volumes = [
    ...rig.leaves.map((l) => ({ what: `${l.name} swept`, box: sweptX(l.closed, l.slideX) })),
    ...rig.parts.map((p) => ({ what: p.name, box: p.box })),
  ];
  const hits: Hit[] = [];
  for (const vol of volumes) {
    for (const m of scene.meshes) {
      if (skip.includes(m.node)) continue;
      let n = 0;
      let first: [number, number, number] = [0, 0, 0];
      for (let o = 0; o < m.tris.length; o += 9)
        if (triangleHitsBox(m.tris, o, vol.box)) {
          if (n === 0) first = [m.tris[o]!, m.tris[o + 1]!, m.tris[o + 2]!].map((x) => +x.toFixed(3)) as [number, number, number];
          n++;
        }
      if (n) hits.push({ what: vol.what, node: m.node, triangles: n, near: first });
    }
    for (const ib of scene.instanceBoxes) if (boxesOverlap(vol.box, ib.box)) hits.push({ what: vol.what, node: ib.node, triangles: -1, near: [...ib.box.min] as [number, number, number] });
  }
  return hits;
}

/** Leaves must not run into each other's or the door's own fixed parts either. */
function selfClashes(rig: DoorRig): string[] {
  const out: string[] = [];
  const swept = rig.leaves.map((l) => ({ n: l.name, b: sweptX(l.closed, l.slideX) }));
  for (const s of swept) for (const p of rig.parts) if (boxesOverlap(s.b, p.box)) out.push(`${s.n} x ${p.name}`);
  // the two leaves only meet at the centre line, never overlap
  if (rig.leaves.length === 2 && boxesOverlap(rig.leaves[0]!.closed, rig.leaves[1]!.closed)) out.push("leaves overlap shut");
  return out;
}

const around = (rig: DoorRig, pad = 0.6): Box => {
  const all = [...rig.leaves.map((l) => sweptX(l.closed, l.slideX)), ...rig.parts.map((p) => p.box)];
  return {
    min: [0, 1, 2].map((k) => Math.min(...all.map((b) => b.min[k]!)) - pad) as unknown as Box["min"],
    max: [0, 1, 2].map((k) => Math.max(...all.map((b) => b.max[k]!)) + pad) as unknown as Box["max"],
  };
};

beforeAll(async () => {
  D = (await (require("draco3d") as { createDecoderModule(o: object): Promise<DracoModule> }).createDecoderModule({})) as DracoModule;
});

describe("the memorial hall's door (inside): its leaves never pass through anything", () => {
  let hall: ReturnType<typeof loadNear>;
  // the near region covers the old mount too, so the regression case below sees the tea corner and the map
  const near = around(hallDoorRig(0), 0.8);
  beforeAll(() => {
    hall = loadNear("memorial.glb", near);
  });

  it("the model's leaves are where autoDoorParts.ts says they are authored", () => {
    for (const [node, b] of [["door__leaf_l", HALL_LEAF_AUTHORED.left], ["door__leaf_r", HALL_LEAF_AUTHORED.right]] as const) {
      const got = hall.nodeBoxes.get(node)!;
      expect(got, node).toBeDefined();
      for (let k = 0; k < 3; k++) {
        expect(got.min[k]!, `${node} min[${k}]`).toBeCloseTo(b.min[k]!, 2);
        expect(got.max[k]!, `${node} max[${k}]`).toBeCloseTo(b.max[k]!, 2);
      }
    }
  });

  it("swept from shut to fully open, the leaves, the header and the track cross no triangle of the hall", () => {
    // the room round the door is really there: its shell, the tea corner, the map, the flower stand (thousands of triangles)
    const triangles = hall.meshes.reduce((n, m) => n + m.tris.length / 9, 0);
    expect(triangles).toBeGreaterThan(1000);
    const hits = clashes(hallDoorRig(), hall, ["door__leaf_l", "door__leaf_r"]);
    expect(hits).toEqual([]);
    expect(selfClashes(hallDoorRig())).toEqual([]);
  });

  it("(regression) hung on the room's face as before, they ran through the tea corner and the hall map: the check sees it", () => {
    const hits = clashes(hallDoorRig(0), hall, ["door__leaf_l", "door__leaf_r"]).filter((h) => h.what.includes("swept"));
    expect(hits.length).toBeGreaterThan(0);
    // both sides: toward the tea corner (x < 299) and toward the map and the flower stand (x > 301)
    expect(hits.some((h) => h.what === "door__leaf_l swept")).toBe(true);
    expect(hits.some((h) => h.what === "door__leaf_r swept")).toBe(true);
  });

  it("the leaves hang past the reveal (outer face) and the sweep is all behind the wall's collider, out of every avatar's reach", () => {
    const wall = hall.nodeBoxes.get("col__hall_wall_s")!;
    expect(HALL_LEAF_MOUNT_Z).toBeGreaterThan(0);
    for (const l of hallDoorRig().leaves) {
      const s = sweptX(l.closed, l.slideX);
      expect(s.min[2], l.name).toBeGreaterThan(HALL_REVEAL_OUTER_Z);
      expect(s.min[2], l.name).toBeGreaterThanOrEqual(wall.min[2]);
      expect(s.min[0]).toBeGreaterThanOrEqual(wall.min[0]);
      expect(s.max[0]).toBeLessThanOrEqual(wall.max[0]);
    }
  });
});

describe("the memorial's entrance (village): its leaves never pass through anything", () => {
  let village: ReturnType<typeof loadNear>;
  beforeAll(() => {
    village = loadNear("village.glb", around(entranceRig(), 0.4));
  });

  it("swept from shut to fully open, the leaves, side-lights, header, sensor and track cross no triangle of the village", () => {
    const triangles = village.meshes.reduce((n, m) => n + m.tris.length / 9, 0);
    expect(triangles).toBeGreaterThan(50); // the porch's walls, floor, ceiling and portal
    expect(clashes(entranceRig(), village, [])).toEqual([]);
    expect(selfClashes(entranceRig())).toEqual([]);
  });

  it("the open leaves stop short of the porch's side walls and run behind the side-lights", () => {
    const rig = entranceRig();
    const lights = rig.parts.filter((p) => p.name.startsWith("side_light"));
    for (const l of rig.leaves) {
      const s = sweptX(l.closed, l.slideX);
      expect(s.min[0]).toBeGreaterThan(ENTRANCE.x - ENTRANCE.wallX);
      expect(s.max[0]).toBeLessThan(ENTRANCE.x + ENTRANCE.wallX);
      // behind (inside of) the side-lights, not through them
      for (const p of lights) expect(s.max[2]).toBeLessThan(p.box.min[2]);
    }
    expect(ENTRANCE_SLIDE_M).toBeGreaterThan(0.9); // a clear way of about 2 m
  });
});

describe("the door holds for every avatar and never snaps through one", () => {
  const pad = VILLAGE_LAYOUT.memorial.exterior.doorPad.centre;
  it("another player in the doorway keeps it from closing while the local player is far away", () => {
    const far = { x: pad.x + 30, z: pad.z + 30 };
    const obs = doorObservation(pad, far, [{ x: pad.x, z: pad.z - 1.5 }], 1.15);
    expect(obs.playerDistancesM.length).toBe(2);
    let s = stepAutoDoor(CLOSED_AUTO_DOOR, 0, obs);
    expect(s.phase).toBe("opening");
    s = stepAutoDoor(s, 10_000, obs);
    s = stepAutoDoor(s, 20_000, obs);
    expect(s.phase).toBe("open");
  });

  it("a closing door that someone steps into turns round where it is (no jump back to shut)", () => {
    let state = stepAutoDoor(CLOSED_AUTO_DOOR, 0, { playerDistancesM: [1], doorwayOccupied: true });
    let shown = 0;
    let t = 0;
    const tick = (obs: { playerDistancesM: number[]; doorwayOccupied: boolean }, ms: number) => {
      t += ms;
      state = stepAutoDoor(state, t, obs);
      const before = shown;
      shown = stepShownOpening(shown, state, ms, PUBLIC_AUTO_DOOR);
      expect(Math.abs(shown - before)).toBeLessThanOrEqual(ms / Math.min(PUBLIC_AUTO_DOOR.openingMs, PUBLIC_AUTO_DOOR.closingMs) + 1e-9);
    };
    for (let i = 0; i < 40; i++) tick({ playerDistancesM: [1], doorwayOccupied: true }, 16);
    expect(shown).toBe(1);
    for (let i = 0; i < 90; i++) tick({ playerDistancesM: [9], doorwayOccupied: false }, 16); // clear: waits, then closes
    expect(state.phase).toBe("closing");
    const half = shown;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    for (let i = 0; i < 40; i++) tick({ playerDistancesM: [0.5], doorwayOccupied: true }, 16);
    expect(shown).toBe(1);
  });
});
