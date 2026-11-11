import { describe, expect, it } from "vitest";
import {
  FISHING,
  FISH_SPECIES,
  castLine,
  createFishingState,
  distanceSquared,
  rentRod,
  reelLine,
  tickFishing,
  withinFishingReach,
} from "./fishing";

describe("fishing geometry and reach", () => {
  it("uses x/z distance and inclusive reach", () => {
    expect(distanceSquared({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(25);
    expect(withinFishingReach({ x: 0, z: 0 }, { x: 1, z: 1 }, Math.SQRT2)).toBe(true);
    expect(withinFishingReach({ x: 0, z: 0 }, { x: 1, z: 1 }, 1.4)).toBe(false);
  });
});

describe("fishing state machine", () => {
  it("requires the rental point, then keeps one rented rod", () => {
    const initial = createFishingState();
    expect(rentRod(initial, 0, false)).toMatchObject({ ok: false, reject: "not_near_rental" });
    const rented = rentRod(initial, 0, true);
    expect(rented).toMatchObject({ ok: true, event: "rod_rented", state: { phase: "ready", rodRented: true } });
    expect(rentRod(rented.state, 300, true)).toMatchObject({ ok: false, reject: "already_has_rod" });
  });

  it("casts, submerges the bobber after the hidden delay, and catches only during the bite window", () => {
    const rented = rentRod(createFishingState(), 0, true).state;
    const cast = castLine(rented, 300, true, () => 0);
    expect(cast).toMatchObject({ ok: true, event: "cast", state: { phase: "waiting", castId: 1 } });
    expect(cast.state.biteAt).toBe(300 + FISHING.minBiteDelayMs);
    expect(reelLine(cast.state, cast.state.biteAt! - 1)).toMatchObject({ ok: false, reject: "no_bite" });

    const bite = tickFishing(cast.state, cast.state.biteAt!);
    expect(bite).toMatchObject({ ok: true, event: "bite", state: { phase: "submerged", lastResult: "bite" } });
    const caught = reelLine(bite.state, bite.state.biteUntil! - 1, () => 0);
    expect(caught).toMatchObject({ ok: true, event: "caught", state: { phase: "ready", lastResult: "caught" } });
    expect(caught.state.catch?.kind).toBe("minnow");
  });

  it("lets a bobber resurface and records a miss when the player waits too long", () => {
    const rented = rentRod(createFishingState(), 0, true).state;
    const cast = castLine(rented, 300, true, () => 0);
    const miss = tickFishing(cast.state, cast.state.biteAt! + FISHING.biteWindowMs);
    expect(miss).toMatchObject({ ok: true, event: "missed", state: { phase: "ready", lastResult: "missed" } });
    expect(reelLine(miss.state, miss.state.biteUntil! + 1)).toMatchObject({ ok: false, reject: "bite_expired" });
  });

  it("rejects duplicate casts while the line is in the water", () => {
    const rented = rentRod(createFishingState(), 0, true).state;
    const cast = castLine(rented, 300, true, () => 0);
    expect(castLine(cast.state, 1_300, true, () => 0)).toMatchObject({ ok: false, reject: "already_cast" });
  });

  it("keeps large fish rare through the weighted table", () => {
    const total = FISH_SPECIES.reduce((sum, item) => sum + item.weight, 0);
    expect(total).toBe(100);
    expect(FISH_SPECIES.find((item) => item.kind === "giant_catfish")?.weight).toBeLessThan(2);
    const rented = rentRod(createFishingState(), 0, true).state;
    const cast = castLine(rented, 300, true, () => 0);
    const bite = tickFishing(cast.state, cast.state.biteAt!);
    const large = reelLine(bite.state, bite.state.biteUntil! - 1, () => 0.999999);
    expect(large.state.catch?.kind).toBe("giant_catfish");
  });
});

