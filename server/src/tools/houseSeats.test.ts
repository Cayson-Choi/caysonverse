/**
 * scripts/gen-house-seats.ts (집 실내 P0): the contract check of a house GLB and its seat file, on the committed blockout
 * (client/public/models/village/houses/house_1.glb) and on tampered copies of its glTF JSON.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractColliders, parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";
import { houseNumberFromFile, readHouse, render } from "../../../scripts/gen-house-seats";
import { HOUSE_1_SEAT_MARKERS } from "@caysonverse/shared/village/generated/houses/house_1_seats";
import { HOUSE_1_COLLIDERS } from "@caysonverse/shared/village/generated/houses/house_1_colliders";
import { HOUSE_SEAT_PLAN, houseFloorBounds, houseKeepClear, localRectToWorld } from "@caysonverse/shared/village/houseAreas";

const GLB = path.resolve(__dirname, "../../../client/public/models/village/houses/house_1.glb");
const SEATS_TS = path.resolve(__dirname, "../../../shared/src/village/generated/houses/house_1_seats.ts");

function load(): Gltf {
  return parseGlb(fs.readFileSync(GLB)).gltf;
}

type Node = NonNullable<Gltf["nodes"]>[number] & { extras?: Record<string, unknown> };
const nodeNamed = (g: Gltf, name: string) => (g.nodes ?? []).find((n) => n.name === name) as Node;

describe("gen-house-seats on the house 1 blockout", () => {
  it("reads the house number from the file name only", () => {
    expect(houseNumberFromFile("x/house_1.glb")).toBe(1);
    expect(houseNumberFromFile("house_10.glb")).toBe(10);
    expect(houseNumberFromFile("house_11.glb")).toBeNull();
    expect(houseNumberFromFile("house_1_lm.glb")).toBeNull();
  });

  it("passes the contract with the planned 12 seats, and the committed seat file is its output", () => {
    const { seats, problems } = readHouse(load(), 1);
    expect(problems).toEqual([]);
    expect(seats).toHaveLength(12);
    expect(seats.filter((s) => s.floor === 1 && s.kind === "backed")).toHaveLength(HOUSE_SEAT_PLAN[1][1].backed!);
    expect(render(1, seats)).toBe(fs.readFileSync(SEATS_TS, "utf8").replace(/\r\n/g, "\n"));
    expect(HOUSE_1_SEAT_MARKERS).toEqual(seats);
  });

  it("keeps the committed colliders equal to the GLB's and out of the keep-clear zones", () => {
    const { colliders, problems } = extractColliders(load());
    expect(problems).toEqual([]);
    expect(colliders.map((c) => c.box)).toEqual([...HOUSE_1_COLLIDERS]);
    for (const floor of [1, 2] as const) {
      const b = houseFloorBounds(1, floor);
      for (const zone of houseKeepClear(1, floor)) {
        const z = localRectToWorld(1, floor, zone.box);
        for (const c of colliders) {
          if (/_wall_/.test(c.name) || c.box.minZ > b.maxZ + 1 || c.box.maxZ < b.minZ - 1) continue;
          const hit = c.box.minX < z.maxX && z.minX < c.box.maxX && c.box.minZ < z.maxZ && z.minZ < c.box.maxZ;
          expect(hit, `${c.name} in ${zone.name}`).toBe(false);
        }
      }
    }
  });

  it("names what is wrong in a tampered house", () => {
    const g = load();
    nodeNamed(g, "spawn__h1_in").translation = [366, 0, -3.1];
    delete nodeNamed(g, "seat__h1_2_0").extras!.approach;
    nodeNamed(g, "seat__h1_1_0").extras!.kind = "backless";
    nodeNamed(g, "seat__h1_1_7").name = "seat__h1_1_9";
    g.nodes = (g.nodes ?? []).filter((n) => n.name !== "ceil__h1_2");
    const { problems } = readHouse(g, 1);
    const text = problems.join("\n");
    expect(text).toMatch(/spawn__h1_in: 약속 자리/);
    expect(text).toMatch(/seat__h1_2_0: extras가 빠졌어요 \(approach\)/);
    expect(text).toMatch(/seat__h1_1_0: sofa는 backed/);
    expect(text).toMatch(/빈칸 없이/);
    expect(text).toMatch(/ceil__h1_2: 필수 노드가 없어요/);
    expect(text).toMatch(/1번 집 2층: backless 자리 2개 — 설계표는 3개/);
  });

  it("refuses a house built for another number", () => {
    expect(readHouse(load(), 2).problems.join("\n")).toMatch(/stair__h2_up: 필수 노드가 없어요/);
  });
});
