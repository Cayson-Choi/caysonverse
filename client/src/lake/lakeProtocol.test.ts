import { describe, it, expect } from "vitest";
import { FISHING_PHASES, FISH_KINDS, FISH_SIGNALS, fishKindId } from "@caysonverse/shared/village/fishing";
import { FISH_PHASE, FISH_SIG, FISH_SPECIES, catchBadge, needsNet, parsePersonalState, parseTrophy, phaseName, rejectText, sigName, species } from "./lakeProtocol";

describe("the lake protocol is the server's own numbers (shared fishing.ts, design 9.2 / 9.3 / 9.4 / 8)", () => {
  it("phases are FISHING_PHASES' indexes and named back", () => {
    expect(Object.keys(FISH_PHASE)).toEqual([...FISHING_PHASES]);
    expect(Object.values(FISH_PHASE)).toEqual([...Array(FISHING_PHASES.length).keys()]);
    for (const [name, n] of Object.entries(FISH_PHASE)) expect(phaseName(n)).toBe(name);
    expect(phaseName(99)).toBe("none");
    // the order the server sends: fighting before lifting
    expect(FISH_PHASE.fighting).toBe(9);
    expect(FISH_PHASE.lifting).toBe(10);
  });
  it("signals", () => {
    expect([sigName(1), sigName(2), sigName(3), sigName(0), sigName(9)]).toEqual(["rise", "sink", "drag", "none", "none"]);
    expect(Object.keys(FISH_SIG)).toEqual([...FISH_SIGNALS]);
  });
  it("11 species, fishKind = FISH_KINDS index + 1", () => {
    expect(FISH_SPECIES.map((s) => s.label)).toEqual(["붕어", "블루길", "피라미", "떡붕어", "배스", "잉어", "동자개", "메기", "향어", "가물치", "장어"]);
    expect(FISH_SPECIES.map((s) => s.id)).toEqual([...FISH_KINDS]);
    FISH_SPECIES.forEach((s, i) => expect(s.kind).toBe(i + 1));
    expect(species(1)?.label).toBe("붕어");
    expect(species(11)?.label).toBe("장어");
    expect(species(0)).toBeNull();
    expect(species(20)).toBeNull();
  });
  it("invasive species go to the bin: bluegill and bass only", () => {
    expect(FISH_SPECIES.filter((s) => s.invasive).map((s) => s.id)).toEqual(["bluegill", "bass"]);
  });
  it("the net is the server's rule: crucian from 31, bass from 40, carp always, minnow never", () => {
    const k = (n: (typeof FISH_KINDS)[number]) => fishKindId(n);
    expect(needsNet(k("crucian_carp"), 30)).toBe(false);
    expect(needsNet(k("crucian_carp"), 31)).toBe(true);
    expect(needsNet(k("bass"), 39)).toBe(false);
    expect(needsNet(k("bass"), 40)).toBe(true);
    expect(needsNet(k("carp"), 12)).toBe(true);
    expect(needsNet(k("minnow"), 16)).toBe(false);
    expect(needsNet(0, 50)).toBe(false);
  });
  it("월척 is a 31 cm crucian (the server's integer line), 4짜 is 40; a carp of 72 is 대물; a small one has no badge", () => {
    const k = (n: (typeof FISH_KINDS)[number]) => fishKindId(n);
    expect(catchBadge(k("crucian_carp"), 31)).toBe("월척!");
    expect(catchBadge(k("crucian_carp"), 30)).toBe("");
    expect(catchBadge(k("crucian_carp"), 41)).toBe("4짜!");
    expect(catchBadge(k("carp"), 72)).toBe("대물!");
    expect(catchBadge(k("carp"), 40)).toBe("");
    expect(catchBadge(k("minnow"), 13)).toBe("");
  });
  it("the personal state (FishingStatePayload) is read tolerantly into numbers", () => {
    expect(parsePersonalState(null)).toBeNull();
    expect(parsePersonalState({ phase: "fighting", holdMs: 3000, holdNeedMs: 2000, catch: { kind: "carp", cm: 61, label: "잉어" }, junk: 1 })).toEqual({
      phase: FISH_PHASE.fighting,
      progress: 1,
      catch: { kind: fishKindId("carp"), cm: 61 },
    });
    expect(parsePersonalState({ phase: "x" })).toEqual({});
    expect(parsePersonalState({ phase: 3 })).toEqual({});
  });
  it("a trophy (FishingTrophyPayload) needs who, a kind name and a length", () => {
    expect(parseTrophy({ sid: "s", by: "가나", kind: "carp", label: "잉어", cm: 72, tier: "lake" })).toEqual({ name: "가나", kind: fishKindId("carp"), cm: 72, scope: "lake" });
    expect(parseTrophy({ by: "가나" })).toBeNull();
    expect(parseTrophy({ by: "가나", kind: "shark", cm: 3 })).toBeNull();
  });
  it("every refusal is Korean words, never the code", () => {
    for (const r of ["not_near_rental", "already_has_rod", "no_rod", "not_near_return", "stand_first", "too_soon", "not_seated", "bad_spot", "spot_taken", "too_far", "already_cast", "too_early", "no_bite", "bite_expired", "wrong_phase", "invalid_time", "???"])
      expect(rejectText(r)).toMatch(/[가-힣]/);
    expect(rejectText("not_fighting")).toBe(""); // the hold's last repeats after the fight: silent
  });
});
