import { describe, expect, it } from "vitest";
import { Color } from "three";
import {
  CrowdImpostors,
  FULL_BUDGET,
  IMPOSTOR_HYST_M,
  IMPOSTOR_MAX_M,
  IMPOSTOR_MIN_M,
  PART,
  buildFigureGeometry,
  crowdThreshold,
  impostorColors,
  wantsImpostor,
} from "./crowdImpostor";
import { lookFromAppearance } from "./characterLook";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";

const COLORS = [new Color("#c08060"), new Color("#402010"), new Color("#2050c0"), new Color("#102050"), new Color("#c02020")];

describe("wantsImpostor (hysteresis)", () => {
  it("a full avatar becomes a stand-in only past the threshold plus the margin", () => {
    expect(wantsImpostor(false, true, 20 + IMPOSTOR_HYST_M - 0.01, 20)).toBe(false);
    expect(wantsImpostor(false, true, 20 + IMPOSTOR_HYST_M + 0.01, 20)).toBe(true);
  });
  it("a stand-in becomes a full avatar again only inside the threshold minus the margin", () => {
    expect(wantsImpostor(true, true, 20 - IMPOSTOR_HYST_M + 0.01, 20)).toBe(true);
    expect(wantsImpostor(true, true, 20 - IMPOSTOR_HYST_M - 0.01, 20)).toBe(false);
  });
  it("an avatar that cannot be a stand-in (seated, riding, hopping...) never is, at any distance", () => {
    expect(wantsImpostor(true, false, 90, 20)).toBe(false);
    expect(wantsImpostor(false, false, 90, 20)).toBe(false);
  });
});

describe("crowdThreshold", () => {
  const list = (...d: number[]) => Float32Array.from(d);
  it("is the far limit while everyone fits in the budget", () => {
    expect(crowdThreshold(list(3, 9, 40), 3, 3)).toBe(IMPOSTOR_MAX_M);
  });
  it("is the distance of the budget-th nearest avatar, between the near and far limits", () => {
    expect(crowdThreshold(list(30, 5, 18, 22, 40, 3), 6, 3)).toBe(18); // sorted 3, 5, 18: the 3rd nearest
  });
  it("never reaches below the near limit: whoever is closer than it stays a full avatar", () => {
    expect(crowdThreshold(list(1, 2, 3, 4, 5, 6), 6, 2)).toBe(IMPOSTOR_MIN_M);
  });
  it("never goes beyond the far limit", () => {
    expect(crowdThreshold(list(50, 60, 70, 80), 4, 2)).toBe(IMPOSTOR_MAX_M);
  });
  it("has a lighter budget on the touch tier", () => {
    expect(FULL_BUDGET.lite.count).toBeLessThan(FULL_BUDGET.rich.count);
    
    
  });
});

describe("the figure", () => {
  const g = buildFigureGeometry();
  it("is a few hundred triangles with a part id and a swing rig on every vertex", () => {
    const tris = g.index!.count / 3;
    expect(tris).toBeGreaterThan(200);
    expect(tris).toBeLessThan(1200);
    const n = g.getAttribute("position").count;
    expect(g.getAttribute("aPart").count).toBe(n);
    expect(g.getAttribute("aRig").count).toBe(n);
  });
  it("uses every colour part", () => {
    const seen = new Set<number>();
    const a = g.getAttribute("aPart");
    for (let i = 0; i < a.count; i++) seen.add(a.getX(i));
    for (const p of Object.values(PART)) expect(seen.has(p)).toBe(true);
  });
  it("stands on the floor, about 1.8 m tall", () => {
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
    expect(g.boundingBox!.min.y).toBeLessThan(0.02);
    expect(g.boundingBox!.max.y).toBeGreaterThan(1.7);
    expect(g.boundingBox!.max.y).toBeLessThan(1.95);
  });
});

describe("impostorColors", () => {
  it("takes the avatar's own colours", () => {
    const look = lookFromAppearance(DEFAULT_APPEARANCE);
    const c = impostorColors(look);
    expect(c).toHaveLength(5);
    expect(c[0].getHex()).toBe(new Color(look.colors.skin).getHex());
    expect(c[2].getHex()).toBe(new Color(look.colors.top).getHex());
  });
  it("tints the cap by the hat when there is one, and by the skin when the head is bare", () => {
    const look = lookFromAppearance(DEFAULT_APPEARANCE);
    const bald = { ...look, parts: { ...look.parts, hair: null, hat: null } };
    expect(impostorColors(bald)[1].getHex()).toBe(new Color(look.colors.skin).getHex());
    const hatted = { ...look, parts: { ...look.parts, hat: "x" } };
    expect(impostorColors(hatted)[1].getHex()).toBe(new Color(look.colors.hat).getHex());
  });
});

describe("CrowdImpostors slots", () => {
  it("hands out slots, reuses a freed one, and says when it is full", () => {
    const crowd = new CrowdImpostors(null, 0.45, 3);
    const a = crowd.acquire(COLORS);
    const b = crowd.acquire(COLORS);
    const c = crowd.acquire(COLORS);
    expect([a, b, c]).toEqual([0, 1, 2]);
    expect(crowd.acquire(COLORS)).toBe(-1);
    crowd.release(b);
    expect(crowd.count).toBe(2);
    expect(crowd.acquire(COLORS)).toBe(1);
  });
  it("draws as many instances as the highest slot, and a released one collapses to nothing", () => {
    const crowd = new CrowdImpostors(null, 0.45, 4);
    const a = crowd.acquire(COLORS);
    crowd.place(a, 3, 0.5, -2, Math.PI / 2, 1.4, 0, 0);
    const m = crowd.mesh.instanceMatrix.array;
    expect(crowd.mesh.count).toBe(1);
    expect([m[12], m[13], m[14]]).toEqual([3, 0.5, -2]);
    // yaw 90 deg: +Z (the figure's front) -> +X
    expect(m[8]).toBeCloseTo(1);
    expect(m[10]).toBeCloseTo(0);
    crowd.release(a);
    expect(m[0]).toBe(0);
    expect(m[5]).toBe(0);
  });
  it("writes the avatar's colours into its slot", () => {
    const crowd = new CrowdImpostors(null, 0.45, 2);
    crowd.acquire(COLORS);
    const s = crowd.acquire(COLORS.slice().reverse());
    const top = crowd.mesh.geometry.getAttribute("aTop");
    expect(top.getX(s)).toBeCloseTo(COLORS[2].r); // reversed list: slot 1's "top" is COLORS[2] again
    const skin = crowd.mesh.geometry.getAttribute("aSkin");
    expect(skin.getX(s)).toBeCloseTo(COLORS[4].r);
  });
  it("sets the threshold from the distances reported in the frame before", () => {
    const crowd = new CrowdImpostors(null, 0.45, 4);
    crowd.budget = 2;
    for (const d of [5, 40, 20, 33]) crowd.report(d);
    crowd.startFrame();
    expect(crowd.thresholdM).toBe(20); // sorted 5, 20, 33, 40: the 2nd nearest
  });
});
