import { describe, it, expect } from "vitest";
import { LAKE_FISHING_SPOTS, LAKE_SHORE, LAKE_WATER_Y, distToPolygonEdge, insidePolygon, onLakeDeck } from "@caysonverse/shared/village/lakeLayout";
import { CAST_S, FLOAT_TOP_M, RISE_S, SCATTER_M, SETTLE_S, biteMotion, floatPose, hash01, scatter, tugDip, tugIndex, type FloatPose } from "./lakeFloat";
import { FISH_PHASE, FISH_SIG, emptyFishView } from "./lakeProtocol";

const out = (): FloatPose => ({ visible: false, x: 0, z: 0, top: 0, y: 0, dive: 0, flying: false, flight: 0, stand: 1, taut: false });
const view = (phase: number, extra = {}) => ({ ...emptyFishView(), rod: 1, spot: 4, phase, seq: 3, ...extra });
const target = { x: 100, z: 0 };
const side = { x: 0, z: 1 };

describe("where the float lands", () => {
  it("is deterministic and within 0.6 m of the mark of the spot", () => {
    for (const s of LAKE_FISHING_SPOTS)
      for (let seq = 0; seq < 40; seq++) {
        const a = scatter(s, seq);
        const b = scatter(s, seq);
        expect(a).toEqual(b);
        expect(Math.hypot(a.x - s.float.x, a.z - s.float.z)).toBeLessThanOrEqual(SCATTER_M + 1e-9);
      }
  });
  it("differs from cast to cast", () => {
    const s = LAKE_FISHING_SPOTS[0]!;
    const pts = new Set(Array.from({ length: 30 }, (_, i) => scatter(s, i).x.toFixed(3)));
    expect(pts.size).toBeGreaterThan(25);
  });
  it("every scattered float of all 30 spots is in the water, off the decks and clear of the shore (12.4)", () => {
    for (const s of LAKE_FISHING_SPOTS)
      for (let seq = 0; seq < 60; seq++) {
        const p = scatter(s, seq);
        expect(insidePolygon(p.x, p.z, LAKE_SHORE), `${s.id} seq ${seq}`).toBe(true);
        expect(onLakeDeck(p.x, p.z), `${s.id} seq ${seq} on a deck`).toBe(false);
        expect(distToPolygonEdge(p.x, p.z, LAKE_SHORE), `${s.id} seq ${seq} at the shore`).toBeGreaterThan(0.3);
      }
  });
  it("hash01 stays in 0..1", () => {
    for (let i = 0; i < 1000; i++) {
      const h = hash01(i, i * 7, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("the float of one angler, by phase (design 8)", () => {
  it("nothing without a rod, a spot, or in the quiet phases", () => {
    expect(floatPose({ ...view(FISH_PHASE.waiting), rod: 0 }, target, side, 1000, out()).visible).toBe(false);
    expect(floatPose({ ...view(FISH_PHASE.waiting), spot: -1 }, target, side, 1000, out()).visible).toBe(false);
    for (const p of [FISH_PHASE.none, FISH_PHASE.carry, FISH_PHASE.ready, FISH_PHASE.landed, FISH_PHASE.releasing]) expect(floatPose(view(p), target, side, 500, out()).visible, String(p)).toBe(false);
  });
  it("the cast flies for 0.8 s, from the rod tip to the water", () => {
    const a = floatPose(view(FISH_PHASE.casting), target, side, 0, out());
    expect(a.flying).toBe(true);
    expect(a.flight).toBe(0);
    const b = floatPose(view(FISH_PHASE.casting), target, side, CAST_S * 1000, out());
    expect(b.flight).toBe(1);
    expect(floatPose(view(FISH_PHASE.casting), target, side, 99999, out()).flight).toBe(1);
  });
  it("after landing it lies, then stands over 2 s up to the 25 cm top", () => {
    const lie = floatPose(view(FISH_PHASE.settling), target, side, 0, out());
    const up = floatPose(view(FISH_PHASE.settling), target, side, SETTLE_S * 1000, out());
    expect(lie.stand).toBe(0);
    expect(up.stand).toBe(1);
    expect(up.top).toBeCloseTo(FLOAT_TOP_M);
  });
  it("waiting bobs a few millimetres around the standing top", () => {
    for (let ms = 0; ms < 5000; ms += 250) expect(Math.abs(floatPose(view(FISH_PHASE.waiting), target, side, ms, out()).top - FLOAT_TOP_M)).toBeLessThan(0.01);
  });
  it("the tugs dip the float a few centimetres and come back, in a rhythm", () => {
    expect(tugDip(0.05, 3)).toBe(0);
    let max = 0;
    for (let t = 0; t < 6; t += 0.02) max = Math.max(max, tugDip(t, 3));
    expect(max).toBeGreaterThan(0.03);
    expect(max).toBeLessThan(0.1);
    expect(tugIndex(0.1)).toBe(-1);
    expect(tugIndex(0.3)).toBe(0);
    expect(tugIndex(0.15 + 0.62 + 0.1)).toBe(1);
  });
  it("rise goes up two segments over 2 s and holds; sink goes under in 0.35 s; drag slides 45 cm while it goes under", () => {
    const rise0 = biteMotion(FISH_SIG.rise, 0);
    const rise1 = biteMotion(FISH_SIG.rise, RISE_S);
    expect(rise0.top).toBeCloseTo(FLOAT_TOP_M);
    expect(rise1.top).toBeCloseTo(FLOAT_TOP_M + 0.22);
    expect(biteMotion(FISH_SIG.rise, 10).top).toBeCloseTo(rise1.top);
    expect(biteMotion(FISH_SIG.sink, 0.35).top).toBeLessThan(0);
    const drag = biteMotion(FISH_SIG.drag, 0.8);
    expect(drag.slide).toBeCloseTo(0.45);
    expect(drag.top).toBeLessThan(0);
  });
  it("a bite by signal is a pure function of the schema fields and the elapsed time (the same on every screen)", () => {
    for (const sig of [FISH_SIG.rise, FISH_SIG.sink, FISH_SIG.drag]) {
      const a = floatPose(view(FISH_PHASE.bite, { sig }), target, side, 1234, out());
      const b = floatPose(view(FISH_PHASE.bite, { sig }), target, side, 1234, out());
      expect(a).toEqual(b);
    }
    const sink = floatPose(view(FISH_PHASE.bite, { sig: FISH_SIG.sink }), target, side, 800, out());
    expect(sink.dive).toBe(1);
    const rise = floatPose(view(FISH_PHASE.bite, { sig: FISH_SIG.rise }), target, side, 800, out());
    expect(rise.dive).toBe(0);
    expect(rise.top).toBeGreaterThan(FLOAT_TOP_M);
  });
  it("hooked and fighting: the float is under, the line taut", () => {
    for (const p of [FISH_PHASE.hooked, FISH_PHASE.fighting]) {
      const f = floatPose(view(p, { sig: FISH_SIG.sink }), target, side, 700, out());
      expect(f.taut).toBe(true);
      expect(f.top).toBeLessThan(0);
    }
  });
  it("its y follows the water level", () => {
    const f = floatPose(view(FISH_PHASE.waiting), target, side, 300, out());
    expect(f.y).toBeCloseTo(LAKE_WATER_Y + f.top - 0.14);
  });
});
