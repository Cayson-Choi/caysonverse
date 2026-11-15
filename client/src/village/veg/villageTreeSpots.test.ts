import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VILLAGE_TREE_SPECS, YOUNG_SPECS } from "./treeSkeleton";

/**
 * The 3D trees grow where these specs say; the file's old flat cards are cut where the specs say too. When the art moves
 * a tree (houses milestone 1 moved nine village trees clear of the bigger buildings and the memorial's young trees with
 * the bigger memorial) and the specs do not follow, the 3D tree grows at the old spot and the old flat cards stay at the
 * new one (owner 2026-11-15: "벚꽃나무는 왜 평면이고 초록색나무는 왜 이모양이야"). So every spec is checked against the
 * file's trunk boxes (parts_fill.tree_boxes: a col__tree_<n> box centred on every trunk in the walk bounds).
 */
function trunkBoxes(): Array<{ name: string; x: number; z: number }> {
  const file = fileURLToPath(new URL("../../../public/models/village/village.glb", import.meta.url));
  const b = readFileSync(file);
  const jsonLength = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + jsonLength).toString("utf8")) as { nodes: Array<{ name?: string; translation?: number[] }> };
  return gltf.nodes
    .filter((n) => n.name?.startsWith("col__tree_"))
    .map((n) => ({ name: n.name!, x: n.translation?.[0] ?? 0, z: n.translation?.[2] ?? 0 }));
}

describe("village tree specs stand where village.glb's trees stand", () => {
  const boxes = trunkBoxes();
  const nearest = (x: number, z: number) => Math.min(...boxes.map((b) => Math.hypot(b.x - x, b.z - z)));

  it("the file has trunk boxes to check against", () => {
    expect(boxes.length).toBeGreaterThanOrEqual(40);
  });

  it("every village tree with a trunk box has its spec on that trunk (within 1 cm)", () => {
    // (-31, 46.5) has no box: parts_fill.tree_boxes skips a trunk box that would narrow a lane or touch a collider
    const unboxed = VILLAGE_TREE_SPECS.filter((s) => nearest(s.x, s.z) > 0.01).map((s) => [s.kind, s.x, s.z]);
    expect(unboxed).toEqual([["cherry", -31, 46.5]]);
  });

  it("every memorial young tree stands on a trunk box of the file", () => {
    for (const s of YOUNG_SPECS) expect(nearest(s.x, s.z), `young (${s.x}, ${s.z})`).toBeLessThan(0.01);
  });

  it("no trunk box of the memorial's and the village's own trees is left without a spec (no tree the 3D vegetation would miss)", () => {
    // parts_trees.TREES lists the memorial's young trees, then the village trees (col__tree_1..36); the boxes after them
    // are the instanced street and orchard trees, placed by the file's instance matrices (no spec to check)
    const specs = [...VILLAGE_TREE_SPECS, ...YOUNG_SPECS];
    const own = boxes.filter((b) => Number(b.name.slice("col__tree_".length)) <= YOUNG_SPECS.length + VILLAGE_TREE_SPECS.length - 1);
    expect(own).toHaveLength(36);
    const orphans = own.filter((b) => !specs.some((s) => Math.hypot(s.x - b.x, s.z - b.z) < 0.01)).map((b) => b.name);
    expect(orphans).toEqual([]);
  });
});
