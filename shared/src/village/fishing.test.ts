import { describe, expect, it } from "vitest";
import { fightCycles, fightCommand, fightSchedule, FIGHT } from "./fishFight";
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
  fightSeedOf,
  packReel,
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

  it("a big fish takes floor(cm / 15) run + pull cycles, 1..6 (fishFight.ts)", () => {
    expect([20, 35, 45, 60, 75, 90, 200].map(fightCycles)).toEqual([1, 2, 3, 4, 5, 6, 6]);
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

describe("big fish: the pull / release fight (fishFight.ts)", () => {
  /** A hooked carp (always a fight); r = 0 makes it 35 cm (2 cycles), r near 1 makes it 85 cm (5 cycles). */
  function fight(r = 0) {
    const c = cast("carp", 10_000, r);
    const t = c.plan!.biteAt + 50;
    const h = strikeLine(c, t).state;
    const f = tickFishing(h, t + FISHING.hookedMs);
    expect(f.state.phase).toBe("fighting");
    return { state: f.state, start: t + FISHING.hookedMs };
  }

  /** The angler: sends Hold(true / false) when the wanted button state changes (after `lagMs` of reaction) and repeats a press every 500 ms. */
  function play(state: FishingState, start: number, want: (sinceStartMs: number, kind: "pull" | "run") => boolean, lagMs = 150, maxMs = 60_000) {
    const sched = fightSchedule(state.catch!.cm, fightSeedOf(state));
    let s = state;
    let down = false;
    let lastSent = -1e9;
    for (let t = 0; t <= maxMs; t += 50) {
      if (s.phase !== "fighting") break;
      const kind = fightCommand(sched, Math.max(0, t - lagMs)).kind;
      const w = want(t, kind);
      const r =
        w !== down || (w && t - lastSent >= 500)
          ? holdLine(s, start + t, w)
          : tickFishing(s, start + t);
      s = r.state;
      if (w !== down || (w && t - lastSent >= 500)) {
        down = w;
        lastSent = t;
      }
    }
    return s;
  }

  it("the fish is a fight: the schedule is the public one and the fight starts a little way in, nothing pulled yet", () => {
    const { state } = fight(0);
    expect(state.catch).toMatchObject({ cm: 35, needsNet: true });
    expect(state.fightProgress).toBeCloseTo(FIGHT.startProgress, 6);
    expect(state.fightTension).toBe(0);
    expect(fightSchedule(state.catch!.cm, fightSeedOf(state)).length).toBe(5); // 2 cycles: pull run pull run pull
    expect(fight(0.999999).state.catch).toMatchObject({ cm: 85 });
  });

  it("doing what the prompt says (pull on 当기세요, let go on 놓아주세요) lifts the fish out on the line, lands it and frees the rod", () => {
    for (const r of [0, 0.5, 0.999999]) {
      const { state, start } = fight(r);
      const s = play(state, start, (_t, kind) => kind === "pull");
      expect(s.phase, `r ${r}`).toBe("lifting");
      const landed = tickFishing(s, s.phaseAt + FISHING.liftMs);
      expect(landed.state.phase).toBe("landed");
      expect(landed.state.lastResult).toBe("caught");
      expect(tickFishing(s, s.phaseAt + FISHING.liftMs + FISHING.landedMs + FISHING.releaseMs).state.phase).toBe("ready");
    }
  });

  it("holding the button all the time snaps the line: missed, lost ('snap'), no catch", () => {
    for (const r of [0, 0.999999]) {
      const { state, start } = fight(r);
      const s = play(state, start, () => true);
      expect(s).toMatchObject({ phase: "missed", lastResult: "lost", lostWhy: "snap", catch: null, plan: null });
    }
  });

  it("never pulling loses it: the fish escapes ('escape') within a few seconds", () => {
    const { state, start } = fight(0.5);
    expect(tickFishing(state, start + 1000).state.phase).toBe("fighting");
    const s = tickFishing(state, start + 4000).state; // the fish gained its distance back in the first two pull stages
    expect(s).toMatchObject({ lastResult: "lost", lostWhy: "escape", catch: null }); // (missed for a second, then ready again)
    expect(["missed", "ready"]).toContain(s.phase);
    expect(tickFishing(state, start + 4000 + FISHING.missedMs).state.phase).toBe("ready");
  });

  it("a Hold message counts for `holdGapMs` (2.5 s) at most: forgetting the 'up' does not hold the button for ever (the tension falls again)", () => {
    const { state, start } = fight(0.999999);
    const pressed = holdLine(state, start + 600, true).state; // pulling in the first pull stage
    const a = tickFishing(pressed, start + 600 + 1200).state; // still counted: tension climbed
    const b = tickFishing(pressed, start + 600 + FISHING.holdGapMs + 1500).state; // lapsed 1.5 s ago
    expect(a.fightTension).toBeGreaterThan(0);
    expect(b.fightTension).toBeLessThan(a.fightTension);
  });

  it("a hold outside a fight (also during `hooked`) is refused and changes nothing", () => {
    expect(holdLine(seated(), 5000, true)).toMatchObject({ ok: false, reject: "not_fighting" });
    const c = cast("carp", 10_000, 0);
    const t = c.plan!.biteAt + 50;
    const h = strikeLine(c, t).state;
    expect(holdLine(h, t + 100, true)).toMatchObject({ ok: false, reject: "not_fighting" });
  });

  it("spamming Hold messages gains nothing: the credit is the real time pressed", () => {
    const { state, start } = fight(0.999999);
    const once = tickFishing(holdLine(state, start + 700, true).state, start + 700 + 100).state;
    let s = state;
    for (let i = 0; i < 400; i++) s = holdLine(s, start + 700 + i * 0.25, true).state; // 400 messages in 0.1 s
    s = tickFishing(s, start + 800).state;
    expect(s.fightProgress).toBeLessThanOrEqual(once.fightProgress + 1e-6);
  });

  it("the wire: packReel carries progress, the held bit and the tension; the sync shows them only while fighting", () => {
    expect(packReel(0.5, 0.25, true)).toBe(50 | 128 | (25 << 8));
    expect(packReel(2, -1, false)).toBe(100);
    const { state, start } = fight(0.5);
    const held = holdLine(state, start + 700, true).state;
    const sync = fishingSync(tickFishing(held, start + 1700).state);
    expect(sync.fishReel & 128).toBe(128);
    expect(sync.fishReel & 127).toBeGreaterThan(10);
    expect(fishingSync(seated()).fishReel).toBe(0);
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
    {
      const sched = fightSchedule(s.catch!.cm, fightSeedOf(s));
      const at = s.fightStartAt;
      let down = false;
      for (let t = 0; t <= 40_000 && s.phase === "fighting"; t += 100) {
        const w = fightCommand(sched, Math.max(0, t - 150)).kind === "pull";
        s = w !== down || (w && t % 500 === 0) ? holdLine(s, at + t, w).state : tickFishing(s, at + t).state;
        down = w;
      }
    }
    expect(["lifting", "landed"]).toContain(s.phase);
    s = tickFishing(s, s.phaseAt + 60_000).state;
    expect(s.phase).toBe("ready");
    expect(s.lastResult).toBe("caught");
    expect(castLine(s, s.lastCastAt + 100_000, { seated: true, random: () => 0 }).ok).toBe(true);
  });
});
