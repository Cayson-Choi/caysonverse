/**
 * memorial_props.glb (케이슨 마을 Task 8's cubby props) is what Task 9 instances: one InstancedMesh per prop and
 * primitive, the photo and the name card given per-instance content. Task 8 review m1: nothing checked the file, so
 * Task 9 loaded it blind. This reads the real file and pins its contract.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Gltf } from "../../../scripts/lib/schoolGlb";
import { MEMORIAL_PROP_NAMES, MEMORIAL_PROPS_BUDGET, checkMemorialProps, parseGlb } from "../../../scripts/lib/schoolGlb";

const FILE = path.resolve(__dirname, "../../../client/public/models/village/memorial_props.glb");

function load(): { gltf: Gltf; size: number } {
  const bytes = fs.readFileSync(FILE);
  return { gltf: parseGlb(new Uint8Array(bytes)).gltf, size: bytes.length };
}

const failed = (r: ReturnType<typeof checkMemorialProps>) => r.filter((x) => x.level === "fail");

describe("memorial_props.glb (Task 9: the props Task 9 instances)", () => {
  it("the real file passes: nine prop__ meshes, M_photo and M_name in their own slots, unlit, within budget", () => {
    const { gltf, size } = load();
    const results = checkMemorialProps(gltf, size);
    expect(failed(results)).toEqual([]);
    expect(results.length).toBe(7);
    expect(gltf.nodes!.filter((n) => n.name?.startsWith("prop__"))).toHaveLength(9);
    expect(MEMORIAL_PROP_NAMES).toHaveLength(9);
    expect(size).toBeLessThanOrEqual(MEMORIAL_PROPS_BUDGET.maxBytes);
  });

  it("a missing prop, a shared photo slot, a light-mapped material and a fat file each fail", () => {
    const { gltf, size } = load();
    const noBear: Gltf = { ...gltf, nodes: gltf.nodes!.filter((n) => n.name !== "prop__plush_bear") };
    expect(failed(checkMemorialProps(noBear, size)).map((r) => r.label)).toContain("소품 노드");

    // the photo's material also on the urn: the slot is no longer the photo frame's own
    const photo = gltf.materials!.findIndex((m) => m.name === "M_photo");
    const urn = gltf.nodes!.find((n) => n.name === "prop__urn_wood")!.mesh!;
    const shared: Gltf = {
      ...gltf,
      meshes: gltf.meshes!.map((m, i) => (i === urn ? { ...m, primitives: m.primitives.map((p) => ({ ...p, material: photo })) } : m)),
    };
    expect(failed(checkMemorialProps(shared, size)).map((r) => r.label)).toContain("M_photo 자리");

    const lm: Gltf = { ...gltf, materials: gltf.materials!.map((m) => (m.name === "M_props" ? { ...m, name: "LM_props" } : m)) };
    expect(failed(checkMemorialProps(lm, size)).map((r) => r.label)).toContain("소품 재질");

    expect(failed(checkMemorialProps(gltf, MEMORIAL_PROPS_BUDGET.maxBytes + 1)).map((r) => r.label)).toEqual(["소품 파일 크기"]);
  });
});
