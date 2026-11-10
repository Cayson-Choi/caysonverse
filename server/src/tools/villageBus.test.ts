/**
 * village_bus.glb (the bus parked at the stop, art/village/tools/build_bus.py) is its own file but always drawn with the
 * village. Bus review: no check counted it (the village's 260k triangles were village.glb's alone). This reads the real
 * files and pins the bus's contract, its budget and the village scene's total.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Gltf } from "../../../scripts/lib/schoolGlb";
import {
  BUDGETS,
  VILLAGE_BUS_BUDGET,
  VILLAGE_BUS_MATERIALS,
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
    expect(results.map((r) => r.label)).toEqual(["버스 노드", "버스 재질·그리기", "버스 라이트맵 없음", "버스 파일 크기", "버스 삼각형 수", "버스 텍스처 크기"]);
    expect(VILLAGE_BUS_MATERIALS).toHaveLength(4);
    expect(size).toBeLessThanOrEqual(VILLAGE_BUS_BUDGET.maxBytes);
    expect(countTriangles(gltf)).toBeLessThanOrEqual(VILLAGE_BUS_BUDGET.maxTriangles);
  });

  it("the village and the bus together stay within the village's 260k plus the bus's 40k", () => {
    expect(VILLAGE_SCENE_MAX_TRIANGLES).toBe(BUDGETS.village.maxTriangles + VILLAGE_BUS_BUDGET.maxTriangles);
    const r = checkVillageSceneTriangles(load("village.glb").gltf, load("village_bus.glb").gltf);
    expect(r.level).toBe("ok");
  });

  it("a second mesh node, a missing material, a fat file, too many triangles and a light-mapped material each fail", () => {
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

    // every primitive counted three times over: past the 40k
    const fat: Gltf = { ...gltf, meshes: gltf.meshes!.map((m) => (m === mesh ? { ...m, primitives: [...m.primitives, ...m.primitives, ...m.primitives] } : m)) };
    expect(failed(checkVillageBus(fat, size, bin)).map((r) => r.label)).toContain("버스 삼각형 수");
  });
});
