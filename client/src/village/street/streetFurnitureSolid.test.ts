import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isBlocked } from "@caysonverse/shared/collision";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { pathPlantShift } from "@caysonverse/shared/village/pathPlants";
import { A8_TREE_MOVES } from "@caysonverse/shared/village/a8Staging";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { BANNER_POLES, LAMP_POSTS } from "./streetLayout";

// owner 2026-11-21 ("조명이랑 그냥 통과해버리네", "의자도 통과해버리네"): the village's street furniture is solid too.
const o = villageGeometry.obstacles;

describe("the village's street furniture is solid", () => {
  it("every lamp post and every plaza banner/light post stops a walker 0.5 m from its base, from four sides", () => {
    const posts = [...LAMP_POSTS.map((l) => ({ id: l.light, x: l.x, z: l.z })), ...BANNER_POLES.map((b, i) => ({ id: `banner_${i}`, x: b.x, z: b.z }))];
    expect(posts.length).toBeGreaterThanOrEqual(19);
    const loose: string[] = [];
    for (const p of posts) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!isBlocked(p.x + dx * 0.55, p.z + dz * 0.55, PLAYER_RADIUS, o)) loose.push(`${p.id} (${p.x}, ${p.z}) ${dx},${dz}`);
    }
    expect(loose).toEqual([]);
  });

  it("every named prop box of village.glb is a collider (benches, planters, tables, kiosk, cafe chairs, shrubs, trunks)", () => {
    const b = readFileSync(fileURLToPath(new URL("../../../public/models/village/village.glb", import.meta.url)));
    const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8")) as { nodes: Array<{ name?: string; translation?: number[] }> };
    const counts: Record<string, number> = {};
    for (const n of j.nodes) {
      if (!n.name?.startsWith("col__") || !n.translation) continue;
      const kind = n.name.slice(5).replace(/_\d+.*$/, "").replace(/_e\d?$|_[nsew]\d?$/, "");
      if (!/^(bench|picnic|planter|plaza_planter|kiosk|kiosk_planter|cafe_terrace_chair|cafe_terrace_table|cafe_planter|shrub|bush|tree|plaza_fountain|plaza_zelkova|pavilion|memorial_bench)$/.test(kind)) continue;
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (A8_TREE_MOVES.some((m) => `col__${m.id}` === n.name)) continue; // the A8 houses move these (a8Staging.ts); their colliders stand at the new spots
      const sh = pathPlantShift(n.translation[0]!, n.translation[2]!); // (the plants moved off the paths stand at their new spots)
      expect(isBlocked(n.translation[0]! + (sh?.dx ?? 0), n.translation[2]! + (sh?.dz ?? 0), 0.05, o), n.name).toBe(true);
    }
    expect(counts.bench).toBe(8);
    expect(counts.picnic).toBe(4);
    expect(counts.cafe_terrace_chair).toBe(12);
  });
});
