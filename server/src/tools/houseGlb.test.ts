/**
 * scripts/check-school-glb.ts, kind `house` (집 실내 G): the contract check of a house GLB on the committed blockout and on tampered
 * copies of its glTF JSON, the props budget, and the image-file budgets.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkHouseImages, checkHousesProps, checkSchoolGlb, parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";
import { schoolSpec } from "../../../scripts/lib/schoolSpec";
import { main } from "../../../scripts/check-school-glb";
import { HOUSE_BUDGET } from "@caysonverse/shared/village/houseAreas";

const GLB = path.resolve(__dirname, "../../../client/public/models/village/houses/house_1.glb");

function load(): { gltf: Gltf; bytes: number; bin: Uint8Array | null } {
  const data = fs.readFileSync(GLB);
  const parsed = parseGlb(data);
  return { gltf: parsed.gltf, bytes: data.length, bin: parsed.bin };
}

function check(gltf: Gltf, bytes: number, bin: Uint8Array | null) {
  return checkSchoolGlb({ kind: "house", fileBytes: bytes, gltf, bin, spec: schoolSpec("house", 1), lightmap: null });
}
const fails = (r: ReturnType<typeof check>) => r.filter((x) => x.level === "fail").map((x) => `${x.label}: ${x.detail}`);

type Node = NonNullable<Gltf["nodes"]>[number];
const nodeNamed = (g: Gltf, name: string) => (g.nodes ?? []).find((n) => n.name === name) as Node;

describe("check-school-glb kind house on the house 1 blockout", () => {
  it("passes every check: required nodes at their places, ≥ 20 colliders, ceilings, clear zones, budgets", () => {
    const { gltf, bytes, bin } = load();
    const r = check(gltf, bytes, bin);
    expect(fails(r)).toEqual([]);
    expect(r.map((x) => x.label)).toEqual(expect.arrayContaining(["필수 노드", "앵커 위치", "비워 둘 곳", "천장"]));
    expect(r.filter((x) => x.label === "천장")).toHaveLength(2); // one per floor
  });

  it("fails a missing required node", () => {
    const { gltf, bytes, bin } = load();
    nodeNamed(gltf, "stair__h1_up").name = "stair__h1_xx";
    expect(fails(check(gltf, bytes, bin)).join("|")).toContain("stair__h1_up");
  });

  it("fails a pad moved off its contract place by more than 5 cm", () => {
    const { gltf, bytes, bin } = load();
    const n = nodeNamed(gltf, "door__h1_exit");
    n.translation = [n.translation![0]! + 0.2, n.translation![1]!, n.translation![2]!];
    expect(fails(check(gltf, bytes, bin)).join("|")).toContain("앵커 위치");
  });

  it("fails a collider in the entry corridor (furniture in front of the door), but not a wall", () => {
    const { gltf, bytes, bin } = load();
    const n = nodeNamed(gltf, "col__h1_1_plant_back");
    n.translation = [365.3, 0.4, -2.0]; // the corridor x 4.3..6.3 local = world 364.3..366.3
    expect(fails(check(gltf, bytes, bin)).join("|")).toContain("비워 둘 곳");
  });

  it("fails a ceiling that is not 3.7 m high", () => {
    const { gltf, bytes, bin } = load();
    const c = nodeNamed(gltf, "ceil__h1_2");
    c.translation = [c.translation![0]!, 3.6, c.translation![2]!];
    expect(fails(check(gltf, bytes, bin)).join("|")).toContain("천장");
  });

  it("fails more than 24 materials and too few colliders", () => {
    const { gltf, bytes, bin } = load();
    gltf.materials = [...(gltf.materials ?? []), ...Array.from({ length: 20 }, (_, i) => ({ name: `M_x${i}` }))];
    expect(fails(check(gltf, bytes, bin)).join("|")).toContain("재질 수");
    const again = load();
    for (const n of again.gltf.nodes ?? []) if ((n.name ?? "").startsWith("col__h1_1_") && !n.name!.includes("wall")) n.name = `x${n.name}`;
    expect(fails(check(again.gltf, again.bytes, again.bin)).join("|")).toContain("노드 묶음");
  });

  it("fails a file over 1 MB and a LM_ material without a light-map file (the blockout has none and needs none)", () => {
    const { gltf, bytes, bin } = load();
    expect(fails(check(gltf, HOUSE_BUDGET.glb.maxBytes + 1, bin)).join("|")).toContain("파일 크기");
    gltf.materials![0]!.name = "LM_wall";
    expect(fails(check(gltf, bytes, bin)).join("|")).toContain("라이트맵 파일");
  });

  it("the CLI: PASS (exit 0) on house_1.glb as `house`; a file not called house_<N>.glb is refused", () => {
    expect(main([GLB, "house"])).toBe(0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "house-glb-"));
    const tmp = path.join(dir, "kitchen.glb");
    fs.copyFileSync(GLB, tmp);
    try {
      expect(main([tmp, "house"])).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("houses_props.glb and the image files", () => {
  it("the props budget: ≤ 0.6 MB and ≤ 25 000 triangles", () => {
    const { gltf } = load();
    expect(checkHousesProps(gltf, 0.3 * 1024 * 1024).every((r) => r.level === "ok")).toBe(true);
    expect(checkHousesProps(gltf, 0.7 * 1024 * 1024).some((r) => r.level === "fail")).toBe(true);
  });

  it("a missing light map or panorama is a WARN, a present one must fit its size and bytes", () => {
    const file = (bytes: number, w: number, h: number) => ({ path: "x", bytes, width: w, height: h });
    const out = checkHouseImages([
      { kind: "lm", label: "낮 2048", file: null },
      { kind: "lm", label: "밤 2048", file: file(400 * 1024, 2048, 2048) },
      { kind: "lm1k", label: "낮 1k", file: file(300 * 1024, 1024, 1024) },
      { kind: "view", label: "창 밖", file: file(900 * 1024, 2048, 512) },
    ]);
    expect(out.map((r) => r.level)).toEqual(["warn", "ok", "fail", "fail"]);
  });
});
