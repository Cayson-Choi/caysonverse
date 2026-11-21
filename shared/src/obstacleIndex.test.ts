import { describe, expect, it } from "vitest";
import { isBlocked, obstacleIndex, type AABB } from "./collision";
import { PLAYER_RADIUS } from "./worldMap";
import { parkGeometry } from "./village/parkArea";
import { villageGeometry } from "./village/villageLayout";

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe("obstacleIndex: the server's drop test from a grid (2026-11-21)", () => {
  it("answers exactly what the scan of the whole list answers: 60,000 spots in the village and the park, three radii", () => {
    for (const geo of [villageGeometry, parkGeometry]) {
      const index = obstacleIndex(geo.obstacles);
      const rnd = seeded(geo.obstacles.length);
      const b = geo.bounds;
      let blocked = 0;
      for (let i = 0; i < 30000; i++) {
        // (half of them hug a box: its faces and corners are where an index could differ)
        let x = b.minX - 3 + rnd() * (b.maxX - b.minX + 6);
        let z = b.minZ - 3 + rnd() * (b.maxZ - b.minZ + 6);
        if (i % 2) {
          const o = geo.obstacles[Math.floor(rnd() * geo.obstacles.length)]!;
          x = o.minX - 0.6 + rnd() * (Math.min(o.maxX - o.minX, 30) + 1.2);
          z = o.minZ - 0.6 + rnd() * (Math.min(o.maxZ - o.minZ, 30) + 1.2);
        }
        const r = [PLAYER_RADIUS, 0.05, 1][i % 3]!;
        const want = isBlocked(x, z, r, geo.obstacles);
        if (want) blocked++;
        expect(index.isBlocked(x, z, r), `${geo.id} (${x}, ${z}) r ${r}`).toBe(want);
      }
      expect(blocked).toBeGreaterThan(3000);
      expect(blocked).toBeLessThan(27000);
    }
  }, 120000);

  it("a larger radius, a custom slack and a spot far outside the map fall back to the same answers", () => {
    const o = villageGeometry.obstacles;
    const index = obstacleIndex(o);
    for (const [x, z, r, slack] of [[0, 0, 3, 0.01], [12.3, -40.2, 0.4, 0], [1e6, -1e6, 0.4, 0.01], [Number.NaN, 0, 0.4, 0.01], [20, 20, 0.4, 0.2]] as const) {
      expect(index.isBlocked(x, z, r, slack)).toBe(isBlocked(x, z, r, o, slack));
    }
  });

  it("is built once for a list, and a cell holds a handful of boxes, not the map", () => {
    const index = obstacleIndex(villageGeometry.obstacles);
    expect(obstacleIndex(villageGeometry.obstacles)).toBe(index);
    expect(villageGeometry.obstacles.length).toBeGreaterThan(1000);
    expect(index.stats.maxPerCell).toBeLessThan(80);
    expect(index.stats.large).toBeLessThan(60);
    const park = obstacleIndex(parkGeometry.obstacles);
    expect(park).not.toBe(index);
    expect(park.stats.maxPerCell).toBeLessThan(60);
  });

  it("an empty list and a single box", () => {
    const none: AABB[] = [];
    expect(obstacleIndex(none).isBlocked(0, 0, 0.4)).toBe(false);
    const one: AABB[] = [{ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }];
    expect(obstacleIndex(one).isBlocked(1.3, 0.5, 0.4)).toBe(true);
    expect(obstacleIndex(one).isBlocked(1.45, 0.5, 0.4)).toBe(false);
  });
});
