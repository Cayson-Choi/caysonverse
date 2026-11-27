import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isBlocked } from "@caysonverse/shared/collision";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { BANNER_POLES, LAMP_POSTS } from "./streetLayout";
import { GATE_BOARD } from "../lots/gateBoard";
import { GATE_BOARD_PLAN } from "@caysonverse/shared/village/villageLots";

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

  it("every named prop box of village.glb is a collider (benches, planters, tables, kiosk, cafe chairs; the plants are swept as drawn: veg/vegOffPaths.test.ts)", () => {
    const b = readFileSync(fileURLToPath(new URL("../../../public/models/village/village.glb", import.meta.url)));
    const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8")) as { nodes: Array<{ name?: string; translation?: number[] }> };
    const counts: Record<string, number> = {};
    for (const n of j.nodes) {
      if (!n.name?.startsWith("col__") || !n.translation) continue;
      const kind = n.name.slice(5).replace(/_\d+.*$/, "").replace(/_e\d?$|_[nsew]\d?$/, "");
      if (!/^(bench|picnic|planter|plaza_planter|kiosk|kiosk_planter|cafe_terrace_chair|cafe_terrace_table|cafe_planter|plaza_fountain|plaza_zelkova|pavilion|memorial_bench)$/.test(kind)) continue;
      counts[kind] = (counts[kind] ?? 0) + 1;
      expect(isBlocked(n.translation[0]!, n.translation[2]!, 0.05, o), n.name).toBe(true);
    }
    expect(counts.bench).toBe(8);
    expect(counts.picnic).toBe(4);
    expect(counts.cafe_terrace_chair).toBe(12);
  });

  it("the gate welcome board: the solid follows the board that is drawn (its place, its turn, its two posts)", () => {
    expect(GATE_BOARD_PLAN.x).toBe(GATE_BOARD.x);
    expect(GATE_BOARD_PLAN.z).toBe(GATE_BOARD.z);
    expect([...GATE_BOARD_PLAN.look]).toEqual([...GATE_BOARD.look]);
    // the posts stand a frame and 7.5 cm outside the panel's ends (gateBoard.ts postX)
    expect(GATE_BOARD_PLAN.halfSpan).toBeGreaterThan(GATE_BOARD.width / 2 + 0.07);
    expect(GATE_BOARD_PLAN.halfSpan).toBeLessThan(GATE_BOARD.width / 2 + 0.2);
    const n = Math.hypot(GATE_BOARD.look[0], GATE_BOARD.look[1]);
    for (const t of [-1, 0, 1]) {
      const x = GATE_BOARD.x + (GATE_BOARD.look[1] / n) * GATE_BOARD_PLAN.halfSpan * t;
      const z = GATE_BOARD.z - (GATE_BOARD.look[0] / n) * GATE_BOARD_PLAN.halfSpan * t;
      expect(isBlocked(x, z, 0.05, o), `board ${t}`).toBe(true);
    }
  });
});
