import { describe, expect, it } from "vitest";
import { DOOR_JOINERY, fieldedPanel, leafParts, type LeafSpec } from "./lotDoors";

const leaf = (hinge: "s0" | "s1"): LeafSpec => (hinge === "s0" ? { s0: -1.1, s1: 0, hinge, y0: 0.03, y1: 3.37, ht: 0.04 } : { s0: 0, s1: 1.1, hinge, y0: 0.03, y1: 3.37, ht: 0.04 });

function bounds(pos: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k]!, pos[i + k]!);
    max[k] = Math.max(max[k]!, pos[i + k]!);
  }
  return { min, max };
}

describe("the library's and the church's real doors", () => {
  it.each(["library", "church"] as const)("builds the %s leaves inside their own span, as joinery on both faces", (style) => {
    for (const hinge of ["s0", "s1"] as const) {
      const L = leaf(hinge);
      const p = leafParts(style, L, [1, 1, 1], [1, 1, 1]);
      const b = bounds(p.oak.g.pos);
      // the oak stays within the leaf (the astragal laps the meeting edge by under 3 cm), the bolections and astragal stand off a little
      expect(b.min[0]).toBeGreaterThanOrEqual(L.s0 - 0.03 - 1e-9);
      expect(b.max[0]).toBeLessThanOrEqual(L.s1 + 0.03 + 1e-9);
      expect(b.min[1]).toBeGreaterThanOrEqual(L.y0 - 0.02);
      expect(b.max[1]).toBeLessThanOrEqual(L.y1 + 0.02);
      expect(b.max[2]).toBeLessThanOrEqual(L.ht + 0.02);
      expect(b.min[2]).toBeGreaterThanOrEqual(-L.ht - 0.02);
      // fittings stand off the faces by no more than a handle's reach
      const m = bounds(p.metal.g.pos);
      expect(m.max[2]).toBeLessThan(L.ht + 0.08);
      expect(m.min[2]).toBeGreaterThan(-L.ht - 0.08);
      // the library has its glazed light, the church none
      expect(!!p.glass).toBe(style === "library");
      // light enough for a door: a few thousand triangles a leaf at most
      const tris = (p.oak.g.idx.length + p.metal.g.idx.length) / 3;
      expect(tris).toBeLessThan(2600);
      expect(tris).toBeGreaterThan(200);
    }
  });

  it("gives every quad a unit normal that agrees with its winding", () => {
    const p = leafParts("church", leaf("s1"), [1, 1, 1], [1, 1, 1]);
    const { pos, nor, idx } = p.oak.g;
    let bad = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map((i) => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!]);
      const e1 = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
      const e2 = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-12) continue;
      const i = idx[t]!;
      const nn = [nor[3 * i]!, nor[3 * i + 1]!, nor[3 * i + 2]!];
      expect(Math.hypot(nn[0]!, nn[1]!, nn[2]!)).toBeCloseTo(1, 5);
      if (n[0]! * nn[0]! + n[1]! * nn[1]! + n[2]! * nn[2]! <= 0) bad++;
    }
    expect(bad).toBe(0);
  });

  it("raises each panel's field proud of its edge on both faces", () => {
    // a lone panel: its field at ±panelField, its edge at ±panelEdge
    const k = leafParts("church", leaf("s0"), [1, 1, 1], [1, 1, 1]).oak;
    const before = k.g.pos.length;
    fieldedPanel(k, 0, 0.8, 0, 1);
    const ts = new Set<number>();
    for (let i = before; i < k.g.pos.length; i += 3) ts.add(Math.round(k.g.pos[i + 2]! * 1000) / 1000);
    for (const t of [DOOR_JOINERY.panelField, -DOOR_JOINERY.panelField, DOOR_JOINERY.panelEdge, -DOOR_JOINERY.panelEdge]) expect(ts.has(Math.round(t * 1000) / 1000)).toBe(true);
  });
});
