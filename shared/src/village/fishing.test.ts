import { describe, expect, it } from "vitest";
import {
  FISHING,
  FISHING_PHASES,
  FISH_KINDS,
  FISH_SIGNALS,
  FISH_TABLE,
  biteWindowMs,
  castLine,
  createFishingState,
  fishKindFromId,
  fishKindId,
  fishSeed,
  fishSpecies,
  fishingPhaseFromId,
  fishingPhaseId,
  fishingSync,
  floatPosition,
  holdLine,
  holdNeededMs,
  nearRentalPad,
  nearReturnPad,
  needsNet,
  nibbleTimesMs,
  phaseEndsAt,
  rentRod,
  returnRod,
  rollFish,
  seededRandom,
  sitDown,
  speciesShares,
  standUp,
  strikeLine,
  tickFishing,
  trophyTier,
  type FishKind,
  type FishingState,
} from "./fishing";
import { LAKE_FISHING_SPOTS, LAKE_RENTAL_PAD, LAKE_SHORE, distToPolygonEdge, inLakeWater, onLakeDeck } from "./lakeLayout";

const rented = (now = 0) => rentRod(createFishingState(), now, { nearRental: true, seated: false }).state;
const seated = (spot = 0, now = 1000) => sitDown(rented(), now, spot).state;
/** A cast at `now` with the dice pinned: random() = 0 gives the first band's lowest size, a value near 1 the last band's highest. */
function cast(kind: FishKind, now = 10_000, r = 0, night = 0, spot = 0): FishingState {
  const res = castLine(seated(spot, 1000), now, { seated: true, random: () => r, night, force: kind });
  if (!res.ok) throw new Error(`cast refused: ${res.reject}`);
  return res.state;
}

describe("fish table (design 8)", () => {
  it("has the 11 species with bands that sum to 1, the day shares summing to 100 and the eel only at night", () => {
    expect(FISH_TABLE.map((s) => s.kind)).toEqual([...FISH_KINDS]);
    for (const s of FISH_TABLE) {
      expect(s.bands.reduce((a, b) => a + b.p, 0), s.kind).toBeCloseTo(1, 9);
      for (const b of s.bands) expect(b.toCm).toBeGreaterThanOrEqual(b.fromCm);
    }
    expect(FISH_TABLE.reduce((a, s) => a + s.dayWeight, 0)).toBe(100);
    expect(fishSpecies("eel").dayWeight).toBe(0);
    expect(fishSpecies("eel").nightWeight).toBe(1.5);
    expect(speciesShares(0).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(speciesShares(1).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12); // the night weights sum to 91.5: renormalised
    expect(speciesShares(0)[FISH_KINDS.indexOf("eel")]).toBe(0);
  });

  it("the id tables round-trip, and the wire ids are stable", () => {
    expect(FISHING_PHASES).toEqual(["none", "carry", "ready", "casting", "settling", "waiting", "nibble", "bite", "hooked", "fighting", "lifting", "netting", "landed", "releasing", "missed"]);
    FISHING_PHASES.forEach((p, i) => {
      expect(fishingPhaseId(p)).toBe(i);
      expect(fishingPhaseFromId(i)).toBe(p);
    });
    expect(FISH_SIGNALS).toEqual(["none", "rise", "sink", "drag"]);
    FISH_KINDS.forEach((k, i) => {
      expect(fishKindId(k)).toBe(i + 1);
      expect(fishKindFromId(i + 1)).toBe(k);
    });
    expect(fishKindFromId(0)).toBeNull();
    expect(fishKindFromId(99)).toBeNull();
  });

  it("signals: the crucians rise, the small fish sink, the big ones drag (design 8)", () => {
    expect(["crucian_carp", "prussian_carp"].every((k) => fishSpecies(k as FishKind).signal === "rise")).toBe(true);
    expect(["bluegill", "minnow", "korean_bullhead"].every((k) => fishSpecies(k as FishKind).signal === "sink")).toBe(true);
    expect(["bass", "carp", "catfish", "mirror_carp", "snakehead", "eel"].every((k) => fishSpecies(k as FishKind).signal === "drag")).toBe(true);
    expect(biteWindowMs("rise")).toEqual([400, 2600]);
    expect(biteWindowMs("sink")).toEqual([0, 1200]);
    expect(biteWindowMs("drag")).toEqual([0, 2000]);
  });

  it("the invasive fish go to the bin, the others are released; who needs the net follows the table", () => {
    expect(FISH_TABLE.filter((s) => s.disposal === "bin").map((s) => s.kind)).toEqual(["bluegill", "bass"]);
    expect(needsNet("crucian_carp", 30)).toBe(false);
    expect(needsNet("crucian_carp", 31)).toBe(true); // 월척
    expect(needsNet("prussian_carp", 29)).toBe(false);
    expect(needsNet("prussian_carp", 30)).toBe(true);
    expect(needsNet("bass", 39)).toBe(false);
    expect(needsNet("bass", 40)).toBe(true);
    expect(needsNet("catfish", 39)).toBe(false);
    expect(needsNet("catfish", 40)).toBe(true);
    for (const k of ["carp", "mirror_carp", "snakehead", "eel"] as const) expect(needsNet(k, 1), k).toBe(true);
    for (const k of ["bluegill", "minnow", "korean_bullhead"] as const) expect(needsNet(k, 255), k).toBe(false);
  });

  it("the hold a big fish needs is 1.5 s + (cm - 40) x 80 ms, 1.5..5 s", () => {
    expect(holdNeededMs(20)).toBe(1500);
    expect(holdNeededMs(40)).toBe(1500);
    expect(holdNeededMs(50)).toBe(2300);
    expect(holdNeededMs(70)).toBe(3900);
    expect(holdNeededMs(85)).toBe(5000);
    expect(holdNeededMs(200)).toBe(5000);
  });

  it("trophy tiers: lake alerts at the 대물 sizes, the village only for 가물치, 장어 and a 4짜 붕어", () => {
    expect(trophyTier("crucian_carp", 30)).toBe("none");
    expect(trophyTier("crucian_carp", 31)).toBe("lake");
    expect(trophyTier("crucian_carp", 40)).toBe("village");
    expect(trophyTier("carp", 69)).toBe("none");
    expect(trophyTier("carp", 70)).toBe("lake");
    expect(trophyTier("snakehead", 45)).toBe("village");
    expect(trophyTier("eel", 40)).toBe("village");
    expect(trophyTier("bluegill", 22)).toBe("none");
    expect(trophyTier("minnow", 16)).toBe("none");
  });
});

/** P(cm >= x) for a species, from its bands (integer sizes, uniform inside a band). */
function pAtLeast(kind: FishKind, x: number): number {
  let p = 0;
  for (const b of fishSpecies(kind).bands) {
    const n = b.toCm - b.fromCm + 1;
    const ge = Math.max(0, Math.min(n, b.toCm - Math.max(b.fromCm, x) + 1));
    p += b.p * (ge / n);
  }
  return p;
}
/** What the table implies (pinned, so an edit of the table is noticed). Tuned to the design: ~4.6 % / ~7 % for >= 45 cm, ~0.7 % for >= 70 cm by day. */
const PINNED = { day45: 0.0461, night45: 0.0736, day70: 0.0070, night70: 0.0130 };
const analyticAtLeast = (night: number, x: number) => speciesShares(night).reduce((a, sh, i) => a + sh * pAtLeast(FISH_KINDS[i]!, x), 0);

describe("the odds (design 12.10: 1,000,000 samples, +-0.3 percentage points)", () => {
  for (const [name, night] of [["midday", 0], ["night", 1]] as const) {
    it(`${name}: each species' share and the big-fish rates match the table`, () => {
      const rnd = seededRandom(night === 0 ? 12345 : 67890);
      const N = 1_000_000;
      const count = new Map<FishKind, number>();
      let big45 = 0;
      let big70 = 0;
      let net = 0;
      for (let i = 0; i < N; i++) {
        const f = rollFish(rnd, night);
        count.set(f.kind, (count.get(f.kind) ?? 0) + 1);
        if (f.cm >= 45) big45++;
        if (f.cm >= 70) big70++;
        if (needsNet(f.kind, f.cm)) net++;
        if (f.cm < fishSpecies(f.kind).bands[0]!.fromCm) throw new Error("size below the species' smallest band");
      }
      const shares = speciesShares(night);
      FISH_KINDS.forEach((k, i) => expect(Math.abs((count.get(k) ?? 0) / N - shares[i]!), k).toBeLessThan(0.003));
      expect(Math.abs(big45 / N - analyticAtLeast(night, 45))).toBeLessThan(0.003);
      expect(Math.abs(big70 / N - analyticAtLeast(night, 70))).toBeLessThan(0.003);
      expect(analyticAtLeast(night, 45)).toBeCloseTo(night === 0 ? PINNED.day45 : PINNED.night45, 3);
      expect(analyticAtLeast(night, 70)).toBeCloseTo(night === 0 ? PINNED.day70 : PINNED.night70, 3);
      expect(net / N).toBeLessThan(0.3); // the hold stage (measured below) stays the exception
    });
  }

  it("garbage dice never throw and stay inside the table", () => {
    for (const bad of [NaN, Infinity, -5, 7]) {
      const f = rollFish(() => bad, 0.5);
      expect(FISH_KINDS).toContain(f.kind);
      expect(f.cm).toBeGreaterThan(0);
    }
  });
});


describe("public seeds: the float's place and the nibble splashes (design 9.4)", () => {
  it("floatPosition is a pure function of (spot, seq), scattered within 0.6 m of the spot's float", () => {
    expect(floatPosition(3, 7)).toEqual(floatPosition(3, 7));
    expect(floatPosition(3, 7)).not.toEqual(floatPosition(3, 8));
    expect(fishSeed(3, 7)).not.toBe(fishSeed(4, 7));
    LAKE_FISHING_SPOTS.forEach((s, i) => {
      for (let seq = 1; seq <= 50; seq++) {
        const p = floatPosition(i, seq);
        expect(Math.hypot(p.x - s.float.x, p.z - s.float.z), `${s.id}#${seq}`).toBeLessThanOrEqual(FISHING.floatScatterM + 1e-6);
      }
    });
    expect(floatPosition(99, 1)).toEqual({ x: 0, z: 0 });
  });

  it("every float lands on the water, off the decks and 1 m off the shore, and stays 3 m from every other float, at any scatter", () => {
    LAKE_FISHING_SPOTS.forEach((s, i) => {
      for (let seq = 1; seq <= 200; seq++) {
        const p = floatPosition(i, seq);
        expect(inLakeWater(p.x, p.z), `${s.id}#${seq} in water`).toBe(true);
        expect(onLakeDeck(p.x, p.z), `${s.id}#${seq} off the decks`).toBe(false);
        expect(distToPolygonEdge(p.x, p.z, LAKE_SHORE), `${s.id}#${seq} shore margin`).toBeGreaterThanOrEqual(FISHING.floatShoreMarginM - 1e-6);
      }
    });
    for (let a = 0; a < LAKE_FISHING_SPOTS.length; a++) {
      const pa = Array.from({ length: 60 }, (_, q) => floatPosition(a, q + 1));
      for (let b = a + 1; b < LAKE_FISHING_SPOTS.length; b++) {
        const fa = LAKE_FISHING_SPOTS[a]!.float;
        const fb = LAKE_FISHING_SPOTS[b]!.float;
        if (Math.hypot(fa.x - fb.x, fa.z - fb.z) > 8) continue;
        for (let q = 1; q <= 60; q++) {
          const pb = floatPosition(b, q);
          for (const p of pa) expect(Math.hypot(p.x - pb.x, p.z - pb.z), `${a}/${b}`).toBeGreaterThanOrEqual(FISHING.floatSpacingM - 1e-6);
        }
      }
    }
  });

  it("nibbleTimesMs is seeded, increasing, and keeps the stage under 2.5 s", () => {
    expect(nibbleTimesMs(2, 9)).toEqual(nibbleTimesMs(2, 9));
    for (let seq = 1; seq < 500; seq++) {
      const [a, b, c] = nibbleTimesMs(seq % 30, seq);
      expect(a).toBeGreaterThanOrEqual(650);
      expect(b).toBeGreaterThan(a);
      expect(c).toBeGreaterThan(b);
      expect(c + FISHING.nibbleTailMs).toBeLessThanOrEqual(2500);
    }
  });
});

describe("rent and return (design 12.3)", () => {
  it("rents only at the pad (2.6 m), once, and not while seated", () => {
    const s0 = createFishingState();
    expect(rentRod(s0, 0, { nearRental: false, seated: false })).toMatchObject({ ok: false, reject: "not_near_rental" });
    expect(rentRod(s0, 0, { nearRental: true, seated: true })).toMatchObject({ ok: false, reject: "stand_first" });
    expect(rentRod(s0, NaN, { nearRental: true, seated: false })).toMatchObject({ ok: false, reject: "invalid_time" });
    const r = rentRod(s0, 5, { nearRental: true, seated: false });
    expect(r).toMatchObject({ ok: true, action: "rod_rented", entered: ["carry"], state: { rod: true, phase: "carry" } });
    expect(rentRod(r.state, 5000, { nearRental: true, seated: false })).toMatchObject({ ok: false, reject: "already_has_rod" });
  });

  it("the pad distances: 2.6 m to rent, 4 m to return, from the pad's centre", () => {
    expect(nearRentalPad(LAKE_RENTAL_PAD.x + 2.6, LAKE_RENTAL_PAD.z)).toBe(true);
    expect(nearRentalPad(LAKE_RENTAL_PAD.x + 2.61, LAKE_RENTAL_PAD.z)).toBe(false);
    expect(nearReturnPad(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z + 4)).toBe(true);
    expect(nearReturnPad(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z + 4.1)).toBe(false);
  });

  it("returns standing near the office; automatically when leaving the lake; never without a rod", () => {
    const s = rented();
    expect(returnRod(createFishingState(), 0, { nearReturn: true, seated: false })).toMatchObject({ ok: false, reject: "no_rod" });
    expect(returnRod(s, 0, { nearReturn: false, seated: false })).toMatchObject({ ok: false, reject: "not_near_return" });
    expect(returnRod(s, 0, { nearReturn: true, seated: true })).toMatchObject({ ok: false, reject: "stand_first" });
    expect(returnRod(s, 0, { nearReturn: true, seated: false })).toMatchObject({ ok: true, action: "rod_returned", state: { rod: false, phase: "none" } });
    expect(returnRod(s, 0, { nearReturn: false, seated: true, auto: true })).toMatchObject({ ok: true, action: "auto_returned", state: { rod: false, phase: "none" } });
  });

  it("sitting on a fishing chair with a rod is ready; without one it is just sitting; standing puts the rod back on the shoulder", () => {
    expect(sitDown(createFishingState(), 0, 4)).toMatchObject({ ok: true, entered: [], state: { phase: "none", spot: 4, rod: false } });
    const s = sitDown(rented(), 1000, 4);
    expect(s).toMatchObject({ entered: ["ready"], state: { phase: "ready", spot: 4 } });
    expect(sitDown(rented(), 1000, -1)).toMatchObject({ state: { phase: "carry", spot: -1 } }); // a bench: still carrying
    const up = standUp(s.state, 5000);
    expect(up).toMatchObject({ action: "stood", entered: ["carry"], state: { phase: "carry", spot: -1, plan: null } });
    expect(standUp(sitDown(createFishingState(), 0, 2).state, 600).state.phase).toBe("none");
  });
});

describe("the stages and their boundary times (design 9.2)", () => {
  it("cast needs a rod, a seat, the ready stage and 1.5 s since the last cast", () => {
    const base = seated();
    const o = (extra = {}) => ({ seated: true, random: () => 0, ...extra });
    expect(castLine(createFishingState(), 0, o())).toMatchObject({ ok: false, reject: "no_rod" });
    expect(castLine(rented(), 2000, o())).toMatchObject({ ok: false, reject: "not_seated" }); // carrying, not on a chair
    expect(castLine(base, 2000, o({ seated: false }))).toMatchObject({ ok: false, reject: "not_seated" });
    expect(castLine(base, NaN, o())).toMatchObject({ ok: false, reject: "invalid_time" });
    const c = castLine(base, 10_000, o({ force: "carp" }));
    expect(c).toMatchObject({ ok: true, action: "cast", entered: ["casting"], state: { phase: "casting", seq: 1, lastResult: "cast" } });
    expect(castLine(c.state, 10_500, o())).toMatchObject({ ok: false, reject: "already_cast" });
    const lost = tickFishing(c.state, 10_000 + 60_000).state;
    expect(lost.phase).toBe("ready");
    expect(castLine({ ...lost, lastCastAt: 100_000 }, 100_000 + FISHING.castGapMs - 1, o())).toMatchObject({ ok: false, reject: "too_soon" });
    expect(castLine({ ...lost, lastCastAt: 100_000 }, 100_000 + FISHING.castGapMs, o()).ok).toBe(true);
  });

  it("every stage ends exactly at its time: casting 0.8 s, settling 2 s, waiting, nibble, bite window + grace", () => {
    const t0 = 10_000;
    const c = cast("crucian_carp", t0); // random 0: wait = 4 s, 1 nibble; rise
    const p = c.plan!;
    const nibbleMs = nibbleTimesMs(0, 1)[0]! + FISHING.nibbleTailMs;
    expect(p.nibbleAt).toBe(t0 + FISHING.castMs + FISHING.settleMs + FISHING.waitMinMs);
    expect(p.biteAt).toBe(p.nibbleAt + nibbleMs);
    expect([p.windowOpensAt - p.biteAt, p.windowClosesAt - p.biteAt]).toEqual([400, 2600]);
    const edges: Array<[number, string, string]> = [
      [t0 + FISHING.castMs, "casting", "settling"],
      [t0 + FISHING.castMs + FISHING.settleMs, "settling", "waiting"],
      [p.nibbleAt, "waiting", "nibble"],
      [p.biteAt, "nibble", "bite"],
      [p.windowClosesAt + c.graceMs, "bite", "missed"],
    ];
    for (const [at, before, after] of edges) {
      expect(tickFishing(c, at - 1).state.phase, `${before} just before ${at}`).toBe(before);
      expect(tickFishing(c, at).state.phase, `${after} at ${at}`).toBe(after);
    }
    const missed = tickFishing(c, p.windowClosesAt + c.graceMs).state;
    expect(missed.lastResult).toBe("missed");
    expect(phaseEndsAt(missed)).toBe(p.windowClosesAt + c.graceMs + FISHING.missedMs);
    expect(tickFishing(c, p.windowClosesAt + c.graceMs + FISHING.missedMs).state.phase).toBe("ready");
    // a very late tick passes every stage at its scheduled time and reports them in order
    const late = tickFishing(c, t0 + 10 * 60_000);
    expect(late.entered).toEqual(["settling", "waiting", "nibble", "bite", "missed", "ready"]);
  });

  it("the wait is 4..18 s (15 % shorter at night), the secret plan varies with the dice", () => {
    const t0 = 10_000;
    const lead = FISHING.castMs + FISHING.settleMs;
    expect(cast("crucian_carp", t0, 0, 0).plan!.nibbleAt - t0 - lead).toBe(4000);
    expect(cast("crucian_carp", t0, 0.999999, 0).plan!.nibbleAt - t0 - lead).toBe(18000);
    expect(cast("crucian_carp", t0, 0.999999, 1).plan!.nibbleAt - t0 - lead).toBe(Math.round(18000 * 0.85));
  });

  it("the cast number counts up, wraps from 65535 to 1, and the synced fields follow the stage", () => {
    const base = seated();
    expect(castLine({ ...base, seq: 65535 }, 10_000, { seated: true, random: () => 0 }).state.seq).toBe(1);
    expect(castLine({ ...base, seq: 41 }, 10_000, { seated: true, random: () => 0 }).state.seq).toBe(42);
    const c = cast("carp");
    expect(fishingSync(c)).toMatchObject({ rod: 1, fishSpot: 0, fishPhase: fishingPhaseId("casting"), fishSeq: 1, fishSig: 0, fishKind: 0, fishCm: 0 });
    const bite = tickFishing(c, c.plan!.biteAt).state;
    expect(fishingSync(bite)).toMatchObject({ fishPhase: fishingPhaseId("bite"), fishSig: 3, fishKind: 0 }); // drag; the fish stays secret
    expect(fishingSync(createFishingState())).toMatchObject({ rod: 0, fishSpot: -1, fishPhase: 0, fishAt: 0 });
  });
});

describe("strike: 3 signals x (in the nibble / inside the window / after it) = 9 cases (design 12.4)", () => {
  const kinds: Array<[FishKind, "rise" | "sink" | "drag"]> = [
    ["crucian_carp", "rise"],
    ["bluegill", "sink"],
    ["bass", "drag"],
  ];
  for (const [kind, signal] of kinds) {
    describe(`${signal} (${kind})`, () => {
      const c = cast(kind);
      const p = c.plan!;
      const [opens, closes] = biteWindowMs(signal);

      it("during the nibble it is ignored without penalty and the stage goes on", () => {
        const r = strikeLine(c, p.nibbleAt + 100);
        expect(r).toMatchObject({ ok: false, reject: "too_early", state: { phase: "nibble" } });
        const after = tickFishing(r.state, p.biteAt).state;
        expect(after.phase).toBe("bite"); // the bite still comes
        expect(after.lastResult).toBe("cast");
      });

      it("before the cast has settled (casting / settling / waiting) it is no_bite", () => {
        for (const at of [c.phaseAt + 100, c.phaseAt + FISHING.castMs + 100, p.nibbleAt - 1]) expect(strikeLine(c, at)).toMatchObject({ ok: false, reject: "no_bite" });
      });

      it("inside the window it hooks the fish: the first and the last moment, grace included", () => {
        const first = strikeLine(c, p.biteAt + opens);
        expect(first).toMatchObject({ ok: true, action: "struck", state: { phase: "hooked" } });
        expect(first.state.catch).toMatchObject({ kind });
        expect(strikeLine(c, p.biteAt + closes).ok).toBe(true);
        expect(strikeLine(c, p.biteAt + closes + c.graceMs - 1).ok).toBe(true); // late by less than the grace
        if (opens > 0) expect(strikeLine(c, p.biteAt + opens - 1)).toMatchObject({ ok: false, reject: "too_early", state: { phase: "bite" } });
      });

      it("after the window (and the grace) it is too late: the fish is gone", () => {
        const late = strikeLine(c, p.biteAt + closes + c.graceMs);
        expect(late).toMatchObject({ ok: false, reject: "bite_expired", state: { phase: "missed", lastResult: "missed", catch: null } });
        expect(late.entered).toContain("missed");
      });
    });
  }

  it("a strike needs the chair and the rod; the grace is the state's (min(250 ms, RTT / 2))", () => {
    expect(strikeLine(rented(), 5000)).toMatchObject({ ok: false, reject: "no_rod" }); // no chair
    const c = { ...cast("bluegill"), graceMs: 40 };
    const closes = c.plan!.windowClosesAt;
    expect(strikeLine(c, closes + 39).ok).toBe(true);
    expect(strikeLine(c, closes + 40).ok).toBe(false);
  });
});

describe("small fish: hooked, lifted, landed, released, ready again", () => {
  it("runs 0.4 + 1.0 + 2.5 + 0.8 s and clears the fish only when ready", () => {
    const c = cast("bluegill");
    const t = c.plan!.biteAt + 100;
    const h = strikeLine(c, t).state;
    expect(h.catch).toMatchObject({ kind: "bluegill", cm: 8, needsNet: false, disposal: "bin" });
    expect(fishingSync(h)).toMatchObject({ fishPhase: fishingPhaseId("hooked"), fishKind: fishKindId("bluegill"), fishCm: 8, fishSig: 0 });
    let s = tickFishing(h, t + FISHING.hookedMs);
    expect(s.state.phase).toBe("lifting");
    s = tickFishing(h, t + FISHING.hookedMs + FISHING.liftMs);
    expect(s.state.phase).toBe("landed");
    expect(s.state.lastResult).toBe("caught");
    expect(s.entered).toEqual(["lifting", "landed"]);
    s = tickFishing(h, t + FISHING.hookedMs + FISHING.liftMs + FISHING.landedMs);
    expect(s.state.phase).toBe("releasing");
    expect(s.state.catch).not.toBeNull();
    s = tickFishing(h, t + FISHING.hookedMs + FISHING.liftMs + FISHING.landedMs + FISHING.releaseMs);
    expect(s.state.phase).toBe("ready");
    expect(s.state.catch).toBeNull();
    expect(fishingSync(s.state).fishKind).toBe(0);
    expect(s.state.lastResult).toBe("caught");
  });

  it("standing up pulls the line out at any stage and drops the plan", () => {
    const c = cast("crucian_carp");
    for (const at of [c.phaseAt + 50, c.plan!.nibbleAt + 10, c.plan!.biteAt + 10]) {
      const s = tickFishing(c, at).state;
      expect(standUp(s, at).state).toMatchObject({ phase: "carry", plan: null, catch: null, spot: -1 });
    }
  });
});

describe("big fish: hold, decay, loss, net (design 7.1, 8)", () => {
  /** A hooked carp (always needs the net); r = 0 makes it 35 cm (hold 1.5 s), r near 1 makes it 85 cm (hold 5 s). */
  function fight(r = 0) {
    const c = cast("carp", 10_000, r);
    const t = c.plan!.biteAt + 50;
    const h = strikeLine(c, t).state;
    const f = tickFishing(h, t + FISHING.hookedMs);
    expect(f.state.phase).toBe("fighting");
    return { state: f.state, start: t + FISHING.hookedMs };
  }

  it("the fish needs the net, the hold is sized by its length", () => {
    const small = fight(0);
    expect(small.state.catch).toMatchObject({ cm: 35, needsNet: true });
    expect(small.state.holdNeedMs).toBe(1500);
    const big = fight(0.999999);
    expect(big.state.catch).toMatchObject({ cm: 85 });
    expect(big.state.holdNeedMs).toBe(5000);
  });

  it("holding long enough nets and lands it, then it is released and the rod is ready again", () => {
    const { state, start } = fight(0);
    let s = holdLine(state, start + 100, true);
    expect(s).toMatchObject({ ok: true, action: "hold", entered: [] });
    s = holdLine(s.state, start + 1100, true); // one message a second is within the 1.5 s a message counts for
    expect(s.state.holdMs).toBeGreaterThan(900);
    s = holdLine(s.state, start + 1700, true);
    expect(s.entered).toEqual(["lifting"]); // lake v2: no net, lifted out on the line
    expect(s.state.phase).toBe("lifting");
    const landed = tickFishing(s.state, start + 1700 + FISHING.liftMs);
    expect(landed.state.phase).toBe("landed");
    expect(landed.state.lastResult).toBe("caught");
    expect(tickFishing(s.state, start + 1700 + FISHING.liftMs + FISHING.landedMs + FISHING.releaseMs).state.phase).toBe("ready");
  });

  it("a Hold message counts for 1.5 s at most: forgetting the 'up' does not hold the fish for ever", () => {
    const { state, start } = fight(0.999999); // needs 5 s
    const s = holdLine(state, start, true).state;
    const t = tickFishing(s, start + 2000).state; // no more messages: 1.5 s credited, then half-speed decay for the last 0.5 s
    expect(t.phase).toBe("fighting");
    expect(t.holdMs).toBe(1250);
  });

  it("letting go pulls the progress back at half speed (the fish drags a little)", () => {
    const { state, start } = fight(0.999999);
    let s = holdLine(state, start, true).state;
    s = holdLine(s, start + 1000, false).state;
    expect(s.holdMs).toBe(1000);
    s = holdLine(s, start + 2000, false).state;
    expect(s.holdMs).toBe(500);
  });

  it("never pressing for 6 s loses the fish: missed, lost, no catch", () => {
    const { state, start } = fight(0);
    expect(tickFishing(state, start + FISHING.fightIdleMs - 1).state.phase).toBe("fighting");
    const lost = tickFishing(state, start + FISHING.fightIdleMs);
    expect(lost.state).toMatchObject({ phase: "missed", lastResult: "lost", catch: null, plan: null });
    expect(lost.entered).toEqual(["missed"]);
    expect(tickFishing(state, start + FISHING.fightIdleMs + FISHING.missedMs).state.phase).toBe("ready");
  });

  it("pressing once and then going idle loses it 6 s after the last pressing; the whole fight is capped at 30 s", () => {
    const { state, start } = fight(0.999999);
    const s = holdLine(state, start + 1000, true).state; // counts until start + 2500
    expect(tickFishing(s, start + 2500 + FISHING.fightIdleMs - 1).state.phase).toBe("fighting");
    expect(tickFishing(s, start + 2500 + FISHING.fightIdleMs).state.phase).toBe("missed");
    expect(phaseEndsAt(state)).toBe(start + FISHING.fightMaxMs);
  });

  it("a hold outside a fight is refused and changes nothing", () => {
    expect(holdLine(seated(), 5000, true)).toMatchObject({ ok: false, reject: "not_fighting" });
  });

  it("spamming Hold messages gains nothing: the credit is the real time pressed", () => {
    const { state, start } = fight(0.999999);
    let s = state;
    for (let i = 0; i < 400; i++) s = holdLine(s, start + i * 5, true).state; // 400 messages in 2 s
    expect(s.holdMs).toBeLessThanOrEqual(2000);
    expect(s.phase).toBe("fighting");
  });
});

describe("a full fish through every stage (smoke)", () => {
  it("rent, sit, cast, wait, nibble, strike, hold, net, show, release, cast again", () => {
    let s = rentRod(createFishingState(), 0, { nearRental: true, seated: false }).state;
    s = sitDown(s, 600, 9).state;
    s = castLine(s, 5000, { seated: true, random: seededRandom(3), force: "mirror_carp" }).state;
    s = tickFishing(s, s.plan!.biteAt).state;
    expect(s.phase).toBe("bite");
    s = strikeLine(s, s.plan!.windowOpensAt + 10).state;
    s = tickFishing(s, s.phaseAt + FISHING.hookedMs).state;
    expect(s.phase).toBe("fighting");
    const at = s.fightStartAt;
    for (let i = 0; i <= 5; i++) s = holdLine(s, at + i * 1000, true).state;
    expect(["lifting", "landed"]).toContain(s.phase);
    s = tickFishing(s, s.phaseAt + 60_000).state;
    expect(s.phase).toBe("ready");
    expect(s.lastResult).toBe("caught");
    expect(castLine(s, s.lastCastAt + 100_000, { seated: true, random: () => 0 }).ok).toBe(true);
  });
});
