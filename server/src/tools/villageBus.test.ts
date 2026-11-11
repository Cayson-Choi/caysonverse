/**
 * village_bus.glb (the bus parked at the stop, art/village/tools/build_bus.py) is its own file but always drawn with the
 * village. Bus review: no check counted it (the village's 260k triangles were village.glb's alone). This reads the real
 * files and pins the bus's contract, its budget and the village scene's total.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUS_MIRROR_REACH, VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import type { Gltf } from "../../../scripts/lib/schoolGlb";
import {
  BUDGETS,
  VILLAGE_BUS_BUDGET,
  VILLAGE_BUS_GROUND_CLEARANCE,
  VILLAGE_BUS_MATERIALS,
  VILLAGE_GROUND_TOP,
  VILLAGE_SCENE_MAX_TRIANGLES,
  checkVillageBus,
  checkVillageSceneTriangles,
  countTriangles,
  parseGlb,
} from "../../../scripts/lib/schoolGlb";

const DIR = path.resolve(__dirname, "../../../client/public/models/village");

function load(file: string): { gltf: Gltf; size: number; bin: Uint8Array | null } {
  const bytes = fs.readFileSync(path.join(DIR, file));
  const parsed = parseGlb(new Uint8Array(bytes));
  return { gltf: parsed.gltf, size: bytes.length, bin: parsed.bin };
}

const failed = (r: ReturnType<typeof checkVillageBus>) => r.filter((x) => x.level === "fail");

describe("village_bus.glb (bus review: its budget is checked)", () => {
  it("the real file passes: one village_bus node, four materials one primitive each, within budget", () => {
    const { gltf, size, bin } = load("village_bus.glb");
    const results = checkVillageBus(gltf, size, bin);
    expect(failed(results)).toEqual([]);
    expect(results.map((r) => r.label)).toEqual([
      "버스 노드",
      "버스 재질·그리기",
      "버스 라이트맵 없음",
      "버스 파일 크기",
      "버스 삼각형 수",
      "버스 텍스처 크기",
      "버스 바닥 판 높이",
    ]);
    expect(VILLAGE_BUS_MATERIALS).toHaveLength(4);
    expect(size).toBeLessThanOrEqual(VILLAGE_BUS_BUDGET.maxBytes);
    expect(countTriangles(gltf)).toBeLessThanOrEqual(VILLAGE_BUS_BUDGET.maxTriangles);
  });

  it("what the body has past the bus's box is the rabbit-ear mirrors, inside their colliders' reach (bus review r3)", () => {
    const { gltf } = load("village_bus.glb");
    const node = gltf.nodes!.find((n) => n.name === "village_bus")!;
    const prim = gltf.meshes![node.mesh!]!.primitives.find((p) => gltf.materials![p.material!]!.name === "M_bus")!;
    const a = gltf.accessors![prim.attributes.POSITION!]!;
    const [minX, , minZ] = a.min as number[];
    const [maxX, , maxZ] = a.max as number[];
    const box = VILLAGE_LAYOUT.busStop.bus.size;
    // the file's nose is -z (north), as the village places it: the mirrors' heads are the furthest out and ahead
    expect(Math.max(-minX!, maxX!)).toBeGreaterThan(box.x / 2); // they do stand out (the colliders are needed)
    expect(Math.max(-minX!, maxX!)).toBeLessThanOrEqual(box.x / 2 + BUS_MIRROR_REACH.side);
    expect(-minZ!).toBeLessThanOrEqual(box.z / 2 + BUS_MIRROR_REACH.ahead);
    // at the back only the bumper's lip (under any head; a body's radius covers it)
    expect(maxZ!).toBeLessThanOrEqual(box.z / 2 + 0.05);
  });

  it("the village and the bus together stay within the village's 260k plus the bus's 40k", () => {
    expect(VILLAGE_SCENE_MAX_TRIANGLES).toBe(BUDGETS.village.maxTriangles + VILLAGE_BUS_BUDGET.maxTriangles);
    const r = checkVillageSceneTriangles(load("village.glb").gltf, load("village_bus.glb").gltf);
    expect(r.level).toBe("ok");
  });

  it("a second mesh node, a missing material, a fat file, a light-mapped material, a sunk ground quad and too many triangles each fail", () => {
    const { gltf, size, bin } = load("village_bus.glb");
    const node = gltf.nodes!.find((n) => n.name === "village_bus")!;
    const twoNodes: Gltf = { ...gltf, nodes: [...gltf.nodes!, { ...node, name: "village_bus_copy" }] };
    expect(failed(checkVillageBus(twoNodes, size, bin)).map((r) => r.label)).toContain("버스 노드");

    const mesh = gltf.meshes![node.mesh!]!;
    const noGround: Gltf = {
      ...gltf,
      meshes: gltf.meshes!.map((m) => (m === mesh ? { ...m, primitives: m.primitives.filter((p) => gltf.materials![p.material!]!.name !== "M_bus_ground") } : m)),
    };
    expect(failed(checkVillageBus(noGround, size, bin)).map((r) => r.label)).toContain("버스 재질·그리기");

    expect(failed(checkVillageBus(gltf, VILLAGE_BUS_BUDGET.maxBytes + 1, bin)).map((r) => r.label)).toEqual(["버스 파일 크기"]);

    const lm: Gltf = { ...gltf, materials: gltf.materials!.map((m) => (m.name === "M_bus" ? { ...m, name: "LM_bus" } : m)) };
    expect(failed(checkVillageBus(lm, size, bin)).map((r) => r.label)).toContain("버스 라이트맵 없음");

    // the ground quad back at y 0, under the road (bus review r3: the depth test hid it), or at 2 cm, under the paving
    const prim = mesh.primitives.find((p) => gltf.materials![p.material!]!.name === "M_bus_ground")!;
    const acc = prim.attributes.POSITION!;
    const at = (y: number): Gltf => ({
      ...gltf,
      accessors: gltf.accessors!.map((a, i) => (i === acc ? { ...a, min: [a.min![0]!, y, a.min![2]!], max: [a.max![0]!, y, a.max![2]!] } : a)),
    });
    for (const y of [0, 0.02]) expect(failed(checkVillageBus(at(y), size, bin)).map((r) => r.label)).toEqual(["버스 바닥 판 높이"]);
    expect(gltf.accessors![acc]!.min![1]!).toBeGreaterThanOrEqual(VILLAGE_GROUND_TOP + VILLAGE_BUS_GROUND_CLEARANCE);

    // every primitive counted three times over: past the 40k
    const fat: Gltf = { ...gltf, meshes: gltf.meshes!.map((m) => (m === mesh ? { ...m, primitives: [...m.primitives, ...m.primitives, ...m.primitives] } : m)) };
    expect(failed(checkVillageBus(fat, size, bin)).map((r) => r.label)).toContain("버스 삼각형 수");
  });
});

// ── bus review r4 polish (P7): what the file's geometry does, read from its decoded triangles ──

type Vec = [number, number, number];
interface Tris {
  pos: Float32Array;
  uv: Float32Array | null;
  faces: Uint32Array;
}
interface DracoModule {
  draco(): Promise<unknown>;
  decodeDraco(json: unknown, bin: Buffer, prim: unknown): { attrs: Record<string, { values: Float32Array }>; faces: Uint32Array };
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec): Vec => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vert = (t: Tris, i: number): Vec => [t.pos[i * 3]!, t.pos[i * 3 + 1]!, t.pos[i * 3 + 2]!];
const corners = (t: Tris, f: number): [Vec, Vec, Vec] => [vert(t, t.faces[f * 3]!), vert(t, t.faces[f * 3 + 1]!), vert(t, t.faces[f * 3 + 2]!)];
/** A triangle's outward normal (glTF's front face: counter-clockwise). */
const normalOf = ([a, b, c]: [Vec, Vec, Vec]) => unit(cross(sub(b, a), sub(c, a)));

/** Möller-Trumbore: the distance along `d` (unit) from `o` to the triangle, or null. */
function hit(o: Vec, d: Vec, [a, b, c]: [Vec, Vec, Vec]): number | null {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const s = sub(o, a);
  const u = dot(s, p) / det;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = cross(s, e1);
  const v = dot(d, q) / det;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const t = dot(e2, q) / det;
  return t > 1e-5 ? t : null;
}

/** The nearest hit along a ray among some triangles (null: none within `reach`). */
function nearest(o: Vec, d: Vec, t: Tris, faces: number[], reach: number): number | null {
  let best: number | null = null;
  for (const f of faces) {
    const tt = hit(o, d, corners(t, f));
    if (tt !== null && tt <= reach && (best === null || tt < best)) best = tt;
  }
  return best;
}

/** The wordmark decals' atlas region (make_bus_textures.py R["wordmark"], px of the 1024 atlas; glTF v = px from the top). */
const WORDMARK = { x: 8, y: 784, w: 496, h: 100, size: 1024 };

describe("village_bus.glb geometry: the wordmark decals and the signs behind glass (bus review r4 polish, P7)", () => {
  let tris: Record<string, Tris> = {};

  beforeAll(async () => {
    const M = (await import(pathToFileURL(path.resolve(__dirname, "../../../scripts/patch-village-moon.mjs")).href)) as DracoModule;
    await M.draco();
    const bytes = fs.readFileSync(path.join(DIR, "village_bus.glb"));
    const { gltf, bin } = parseGlb(new Uint8Array(bytes));
    const node = gltf.nodes!.find((n) => n.name === "village_bus")!;
    expect(node.translation ?? [0, 0, 0]).toEqual([0, 0, 0]); // the file's frame is the bus's (nose -z, doors +x)
    for (const prim of gltf.meshes![node.mesh!]!.primitives) {
      const d = M.decodeDraco(gltf, Buffer.from(bin!), prim);
      tris[gltf.materials![prim.material!]!.name!] = { pos: d.attrs.POSITION!.values, uv: d.attrs.TEXCOORD_0?.values ?? null, faces: d.faces };
    }
  }, 60000);

  afterAll(() => {
    tris = {};
  });

  it("the wordmark decals stand 2-6 mm proud of the paint (4 mm built) on both sides and the rear, nowhere hanging off it", () => {
    const body = tris.M_bus!;
    const nf = body.faces.length / 3;
    const inWordmark = (i: number) => {
      const px = body.uv![i * 2]! * WORDMARK.size;
      const py = body.uv![i * 2 + 1]! * WORDMARK.size;
      return px >= WORDMARK.x - 1 && px <= WORDMARK.x + WORDMARK.w + 1 && py >= WORDMARK.y - 1 && py <= WORDMARK.y + WORDMARK.h + 1;
    };
    const decal: number[] = [];
    const paint: number[] = [];
    for (let f = 0; f < nf; f++) {
      const all = [0, 1, 2].every((k) => inWordmark(body.faces[f * 3 + k]!));
      (all ? decal : paint).push(f);
    }
    expect(decal.length).toBe(20); // 2 a side, 16 on the rear (8 strips following its bow)
    const groups = { right: [] as number[], left: [] as number[], rear: [] as number[] };
    const gaps: Record<keyof typeof groups, number[]> = { right: [], left: [], rear: [] };
    for (const f of decal) {
      const c3 = corners(body, f);
      const n = normalOf(c3);
      const side = n[0] > 0.9 ? "right" : n[0] < -0.9 ? "left" : n[2] > 0.9 ? "rear" : null;
      expect(side, `decal face ${f} faces ${n.map((v) => v.toFixed(2))}`).not.toBeNull();
      groups[side!].push(f);
      // the paint behind: near the decal only (the ray goes inward along the decal's normal)
      const lo = [0, 1, 2].map((k) => Math.min(...c3.map((p) => p[k]!)) - 0.05);
      const hi = [0, 1, 2].map((k) => Math.max(...c3.map((p) => p[k]!)) + 0.05);
      const near = paint.filter((g) => {
        const q = corners(body, g);
        return [0, 1, 2].every((k) => Math.max(...q.map((p) => p[k]!)) >= lo[k]! && Math.min(...q.map((p) => p[k]!)) <= hi[k]!);
      });
      const mid: Vec = [0, 1, 2].map((k) => (c3[0][k]! + c3[1][k]! + c3[2][k]!) / 3) as Vec;
      // the corners a tenth of the way in toward the middle (on the decal's plane), and the middle
      const samples = [...c3.map((p) => p.map((v, k) => v + (mid[k]! - v) * 0.1) as Vec), mid];
      for (const s of samples) {
        const t = nearest(s, [-n[0], -n[1], -n[2]], body, near, 0.05);
        expect(t, `decal face ${f} (${side}) at ${s.map((v) => v.toFixed(3))}: no paint behind within 5 cm`).not.toBeNull();
        gaps[side!].push(t!);
      }
    }
    expect(groups.right).toHaveLength(2);
    expect(groups.left).toHaveLength(2);
    expect(groups.rear).toHaveLength(16);
    for (const [side, g] of Object.entries(gaps)) {
      expect(Math.min(...g), side).toBeGreaterThanOrEqual(0.002);
      expect(Math.max(...g), side).toBeLessThanOrEqual(0.006);
    }
  });

  it("the front sign has no pane in front of it; the kerb-side and rear signs stand a few cm behind the windows' glass", () => {
    const led = tris.M_bus_led!;
    const glass = tris.M_bus_glass!;
    const allGlass = Array.from({ length: glass.faces.length / 3 }, (_, f) => f);
    const signs: Record<string, number[]> = { front: [], side: [], rear: [], other: [] };
    for (let f = 0; f < led.faces.length / 3; f++) {
      const c3 = corners(led, f);
      const n = normalOf(c3);
      const kind = n[2] < -0.5 ? "front" : n[0] > 0.9 ? "side" : n[2] > 0.9 ? "rear" : "other";
      signs[kind]!.push(f);
      // every face looks out of the body (the file's frame is centred on the bus): no back of a sign turned into the cabin
      const mid = [0, 1, 2].map((k) => (c3[0][k]! + c3[1][k]! + c3[2][k]!) / 3);
      expect(mid[0]! * n[0] + mid[2]! * n[2], `${kind} sign face ${f} faces into the cabin`).toBeGreaterThan(0);
    }
    expect(signs.front!.length).toBeGreaterThan(0);
    expect(signs.side!.length).toBeGreaterThan(0);
    expect(signs.rear!.length).toBeGreaterThan(0);
    // the three signs and nothing else (polish tech r1): the glass clears in front of the signs it finds among these
    // faces (client villageBusPrep.ts busSignsBehindGlass, BUS_SIGN_SLOTS = 2: the kerb side's and the rear's); a face
    // any other way would compete for those two slots
    expect(signs.other, "LED faces neither front, kerb side nor rear").toEqual([]);
    // the kerb-side and rear signs are each one flat panel (one box each for the glass's test)
    const spread = (fs: number[], k: number) => {
      const v = fs.flatMap((f) => corners(led, f).map((p) => p[k]!));
      return Math.max(...v) - Math.min(...v);
    };
    expect(spread(signs.side!, 0)).toBeLessThan(0.002);
    expect(spread(signs.rear!, 2)).toBeLessThan(0.002);
    const gapOut = (f: number) => {
      const c3 = corners(led, f);
      const n = normalOf(c3);
      const mid: Vec = [0, 1, 2].map((k) => (c3[0][k]! + c3[1][k]! + c3[2][k]!) / 3) as Vec;
      return nearest(mid, n, glass, allGlass, 0.3);
    };
    for (const f of signs.front!) expect(gapOut(f), "the front sign: open to the street").toBeNull();
    for (const k of ["side", "rear"] as const) {
      for (const f of signs[k]!) {
        const g = gapOut(f);
        expect(g, `${k} sign face ${f}: glass in front`).not.toBeNull();
        expect(g!).toBeLessThan(0.1);
      }
    }
  });
});
