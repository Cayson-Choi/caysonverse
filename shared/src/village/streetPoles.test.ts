import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { bannerSpots, lampSpots, streetPoleColliders } from "./streetPoles";
import { VILLAGE_LAYOUT as L, villageGeometry } from "./villageLayout";

describe("street lamps and banner poles are solid (owner 2026-11-15)", () => {
  it("the spots follow the art script: 5 plaza lamps, the ring's lamps at r 38.4 and 8 banner poles at r 26", () => {
    const lamps = lampSpots(L);
    expect(lamps.slice(0, 5)).toEqual(L.plaza.lamps.map((p) => ({ x: p.x, z: p.z })));
    const ring = lamps.slice(5);
    expect(ring.length).toBeGreaterThan(8);
    expect(ring.length).toBeLessThanOrEqual(18);
    for (const p of ring) expect(Math.hypot(p.x, p.z)).toBeCloseTo(38.4, 9);
    expect(bannerSpots()).toHaveLength(8);
    for (const p of bannerSpots()) expect(Math.hypot(p.x, p.z)).toBeCloseTo(26, 9);
  });

  it("the map blocks a body walking into each one, and the way past stays open", () => {
    const cols = streetPoleColliders(L);
    expect(cols).toHaveLength(lampSpots(L).length + bannerSpots().length);
    for (const s of [...lampSpots(L), ...bannerSpots()]) {
      expect(isBlocked(s.x, s.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(true);
      expect(isBlocked(s.x + 0.3 + PLAYER_RADIUS, s.z, PLAYER_RADIUS, cols)).toBe(false);
    }
  });

  it("no lamp or banner pole stands on a lane, the bus stop pad or the ring road's lanes", () => {
    const cols = streetPoleColliders(L);
    for (const lane of L.lanes) {
      for (let i = 0; i + 1 < lane.points.length; i++) {
        const a = lane.points[i]!;
        const b = lane.points[i + 1]!;
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const z = a.z + ((b.z - a.z) * k) / n;
          expect(isBlocked(x, z, PLAYER_RADIUS, cols), `${lane.id} ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
        }
      }
    }
    // the road itself (the bus lane band R 31 .. 37) is free of them
    for (let a = 0; a < 360; a += 0.5) {
      for (const r of [32, 34, 35.4, 36.5]) {
        const x = r * Math.cos((a * Math.PI) / 180);
        const z = r * Math.sin((a * Math.PI) / 180);
        expect(isBlocked(x, z, PLAYER_RADIUS, cols), `${r} @ ${a}`).toBe(false);
      }
    }
  });
});
