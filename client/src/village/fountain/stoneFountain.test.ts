import { describe, expect, it } from "vitest";
import { GATE_FOUNTAIN, STAR_FOUNTAIN, STAR_SPOUTS } from "./fountainDesigns";
import {
  STONE_GROUP,
  arc,
  buildCurtainGeometry,
  buildDropGeometry,
  buildFountainStone,
  buildJetGeometry,
  buildPoolGeometry,
  curtainFall,
  jetFlight,
  profile,
  type FountainDesign,
} from "./stoneFountain";

const DESIGNS: Array<[string, FountainDesign]> = [
  ["gate", GATE_FOUNTAIN],
  ["star", STAR_FOUNTAIN],
];

describe("stoneFountain: the turned stone", () => {
  it.each(DESIGNS)("%s: finite, closed groups, unit normals, a sane budget", (_name, d) => {
    for (const low of [false, true]) {
      const g = buildFountainStone(d, low);
      const pos = g.getAttribute("position");
      const n = g.getAttribute("normal");
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
      }
      const dry = g.groups.find((x) => x.materialIndex === STONE_GROUP.dry)!;
      const wet = g.groups.find((x) => x.materialIndex === STONE_GROUP.wet)!;
      expect(dry.count).toBeGreaterThan(0);
      expect(wet.count).toBeGreaterThan(0);
      const tris = g.index!.count / 3;
      // the PC tier stays under 42k triangles a fountain, the phone's about half
      expect(tris).toBeLessThan(low ? 22000 : 42000);
    }
  }, 30000); // (a per-vertex walk of two tiers: slow on a loaded machine)

  it("faces point out of the stone (the basin's outer wall outward, its floor up)", () => {
    const g = buildFountainStone(GATE_FOUNTAIN, false);
    const pos = g.getAttribute("position");
    const n = g.getAttribute("normal");
    let outer = 0;
    let floor = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      const radial = (pos.getX(i) * n.getX(i) + pos.getZ(i) * n.getZ(i)) / (r || 1);
      if (Math.abs(r - 1.545) < 0.01 && pos.getY(i) > 0.22 && pos.getY(i) < 0.36) {
        expect(radial).toBeGreaterThan(0.8);
        outer++;
      }
      if (pos.getY(i) < 0.051 && r > 1.0 && r < 1.34) {
        expect(n.getY(i)).toBeGreaterThan(0.9);
        floor++;
      }
    }
    expect(outer).toBeGreaterThan(0);
    expect(floor).toBeGreaterThan(0);
  });

  it("keeps a hard arris at a sharp corner and stays smooth on a curve", () => {
    const d: FountainDesign = { ...GATE_FOUNTAIN, pieces: [{ profile: profile([1, 0], [1, 1], [0, 1]), tint: [1, 1, 1], sides: 16 }] };
    const g = buildFountainStone(d, false);
    // the corner (1, 1): two rings, one facing out, one facing up
    const pos = g.getAttribute("position");
    const n = g.getAttribute("normal");
    let side = 0;
    let top = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - 1) > 1e-6 || Math.abs(Math.hypot(pos.getX(i), pos.getZ(i)) - 1) > 1e-6) continue;
      if (n.getY(i) > 0.99) top++;
      else if (Math.abs(n.getY(i)) < 0.01) side++;
    }
    expect(side).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    const smooth = buildFountainStone({ ...d, pieces: [{ profile: arc(0, 0, 1, -90, 90, 24), tint: [1, 1, 1], sides: 16 }] }, false);
    // a half circle turned: one ring per point (no doubling), 25 rings of 17
    expect(smooth.getAttribute("position").count).toBe(25 * 17);
  });

  it("quantises u round a ring to whole tiles (no seam in the stone's texture)", () => {
    const g = buildFountainStone(GATE_FOUNTAIN, false);
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      if (Math.abs(u - Math.round(u)) < 1e-6) continue;
    }
    // every ring's last column is a whole number of tiles
    const sides = GATE_FOUNTAIN.pieces[0]!.sides!;
    for (let row = 0; row < 5; row++) expect(Number.isInteger(Math.round(uv.getX(row * (sides + 1) + sides) * 1e6) / 1e6)).toBe(true);
  });
});

describe("stoneFountain: where the water goes", () => {
  it.each(DESIGNS)("%s: every sheet lands inside the pool below it, clear of its wall", (_name, d) => {
    for (const c of d.curtains) {
      const { landR } = curtainFall(d, c);
      const pool = d.pools[c.pool]!;
      expect(landR).toBeGreaterThan(c.lipR);
      expect(landR).toBeLessThan(pool.r - 0.05);
      expect(c.lipY).toBeGreaterThan(pool.y);
    }
  });

  it.each(DESIGNS)("%s: every jet lands in its pool", (_name, d) => {
    for (const j of d.jets) {
      const f = jetFlight(d, j);
      expect(f.flight).toBeGreaterThan(0);
      expect(Math.abs(f.landR)).toBeLessThan(d.pools[j.pool]!.r);
      expect(f.apexY).toBeGreaterThan(j.y);
    }
  });

  it("the star fountain's rim jets clear the pedestal and land short of the bowl's sheet", () => {
    const j = STAR_FOUNTAIN.jets[0]!;
    const f = jetFlight(STAR_FOUNTAIN, j);
    expect(f.landR).toBeGreaterThan(1.3);
    expect(f.landR).toBeGreaterThan(curtainFall(STAR_FOUNTAIN, STAR_FOUNTAIN.curtains[0]!).landR + 0.2);
    expect(j.r).toBeLessThan(STAR_SPOUTS.r);
  });

  it.each(DESIGNS)("%s: water geometry builds, the light tier is lighter", (_name, d) => {
    for (const build of [buildPoolGeometry, buildCurtainGeometry, buildJetGeometry]) {
      const hi = build(d, false);
      const lo = build(d, true);
      expect(lo.index!.count).toBeLessThanOrEqual(hi.index!.count);
    }
    const hiDrops = buildDropGeometry(d, false).count;
    const loDrops = buildDropGeometry(d, true).count;
    expect(loDrops).toBeLessThan(hiDrops / 2);
    expect(hiDrops).toBeLessThan(3000);
  });
});
