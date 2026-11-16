import { describe, it, expect } from "vitest";
import { FISH_PHASE, FISH_SIG, FISH_SPECIES, catchBadge, needsNet, parsePersonalState, parseTrophy, phaseName, rejectText, sigName, species } from "./lakeProtocol";

describe("the lake protocol names (design 9.2 / 9.3 / 9.4 / 8)", () => {
  it("phases are numbered in the diagram order and named back", () => {
    expect(Object.values(FISH_PHASE)).toEqual([...Array(15).keys()]);
    for (const [name, n] of Object.entries(FISH_PHASE)) expect(phaseName(n)).toBe(name);
    expect(phaseName(99)).toBe("none");
  });
  it("signals", () => {
    expect([sigName(1), sigName(2), sigName(3), sigName(0), sigName(9)]).toEqual(["rise", "sink", "drag", "none", "none"]);
    expect(FISH_SIG.rise).toBe(1);
  });
  it("11 species in the order of design 8's table", () => {
    expect(FISH_SPECIES.map((s) => s.label)).toEqual(["붕어", "블루길", "피라미", "떡붕어", "배스", "잉어", "동자개", "메기", "향어", "가물치", "장어"]);
    expect(species(0)?.label).toBe("붕어");
    expect(species(20)).toBeNull();
  });
  it("invasive species go to the bin: bluegill and bass only", () => {
    expect(FISH_SPECIES.filter((s) => s.invasive).map((s) => s.id)).toEqual(["bluegill", "bass"]);
  });
  it("the net: crucian from 30, bass from 40, carp always, minnow never", () => {
    expect(needsNet(0, 29.9)).toBe(false);
    expect(needsNet(0, 30)).toBe(true);
    expect(needsNet(4, 39)).toBe(false);
    expect(needsNet(4, 40)).toBe(true);
    expect(needsNet(5, 12)).toBe(true);
    expect(needsNet(2, 16)).toBe(false);
  });
  it("월척 is 30.3 cm of a crucian, 4짜 is 40; a carp of 70 is 대물; a small one has no badge", () => {
    expect(catchBadge(0, 30.3)).toBe("월척!");
    expect(catchBadge(0, 30.2)).toBe("");
    expect(catchBadge(0, 40.5)).toBe("4짜!");
    expect(catchBadge(5, 72)).toBe("대물!");
    expect(catchBadge(5, 40)).toBe("");
    expect(catchBadge(2, 13)).toBe("");
  });
  it("the personal state is read tolerantly", () => {
    expect(parsePersonalState(null)).toBeNull();
    expect(parsePersonalState({ phase: 7, progress: 3, catch: { kind: 0, cm: 31, first: true }, junk: 1 })).toEqual({ phase: 7, progress: 1, catch: { kind: 0, cm: 31, first: true } });
    expect(parsePersonalState({ phase: "x" })).toEqual({});
  });
  it("a trophy needs a name, a kind and a length", () => {
    expect(parseTrophy({ name: "가나", kind: 5, cm: 72, scope: "lake" })).toEqual({ name: "가나", kind: 5, cm: 72, scope: "lake" });
    expect(parseTrophy({ name: "가나" })).toBeNull();
  });
  it("every refusal is Korean words, never the code", () => {
    for (const r of ["not_near_rental", "already_has_rod", "rod_required", "spot_taken", "no_free_spot", "too_soon", "not_yet", "???"]) expect(rejectText(r)).toMatch(/[가-힣]/);
  });
});
