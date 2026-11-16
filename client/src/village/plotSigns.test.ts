import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, type PlotId } from "@caysonverse/shared/village/villageLayout";
import { SIGN_UNDER_CONSTRUCTION, plotMarkerSpecs, plotSignLines, plotSignText, sideYaw } from "./plotSigns";

const plot = (id: PlotId) => VILLAGE_LAYOUT.plots.find((p) => p.id === id)!;

describe("plotSigns — the words and places come from the layout", () => {
  it("an empty plot's sign reads '<sign> · <label>' from the layout", () => {
    for (const p of VILLAGE_LAYOUT.plots) {
      if (p.sign === null || p.underConstruction) continue;
      expect(plotSignText(p)).toBe(`${p.sign} · ${p.label}`);
      expect(plotSignLines(p)).toEqual([p.sign, p.label]);
    }
  });

  // vrb2 (owner 2026-11-17: "건설중이라는 크레인도 건물을 다 올릴거니까 빼고"): real buildings are coming on every plot, so
  // no plot has a sign, a sign post or a construction site; the words still work for a plot that has them
  it("no plot has a sign or a construction site any more", () => {
    for (const p of VILLAGE_LAYOUT.plots) {
      expect(plotSignText(p), p.id).toBeNull();
      expect(p.signPost, p.id).toBeNull();
      expect(p.underConstruction, p.id).toBe(false);
    }
    expect(plotMarkerSpecs()).toEqual([]);
  });

  it("the words, for a plot that has a sign (곧 지어져요 / 공사 중)", () => {
    expect(SIGN_UNDER_CONSTRUCTION).toBe("공사 중");
    expect(plotSignText({ sign: "곧 지어져요", label: "성당", underConstruction: false })).toBe("곧 지어져요 · 성당");
    expect(plotSignLines({ sign: "곧 지어져요", label: "도서관", underConstruction: true })).toEqual(["공사 중", "도서관"]);
  });

  it("the memorial hall's plot (plot_n) has no sign and no marker", () => {
    expect(plotSignText(plot("plot_n"))).toBeNull();
    expect(plotSignLines(plot("plot_n"))).toBeNull();
    expect(plotMarkerSpecs().map((m) => m.id)).not.toContain("plot_n");
  });

  it("one marker per plot that has a sign, in the layout's order", () => {
    const expected = VILLAGE_LAYOUT.plots.filter((p) => p.sign !== null).map((p) => p.id);
    expect(plotMarkerSpecs().map((m) => m.id)).toEqual(expected);
    expect(expected).toHaveLength(0);
  });

  it("each marker's outline is its plot's rectangle and its post is the layout's sign post, inside the plot", () => {
    for (const m of plotMarkerSpecs()) {
      const p = plot(m.id);
      expect(m.rect.maxX - m.rect.minX).toBe(p.size.x);
      expect(m.rect.maxZ - m.rect.minZ).toBe(p.size.z);
      expect((m.rect.minX + m.rect.maxX) / 2).toBe(p.centre.x);
      expect((m.rect.minZ + m.rect.maxZ) / 2).toBe(p.centre.z);
      expect(m.post).toEqual({ x: p.signPost!.x, z: p.signPost!.z });
      expect(m.post.x).toBeGreaterThanOrEqual(m.rect.minX);
      expect(m.post.x).toBeLessThanOrEqual(m.rect.maxX);
      expect(m.post.z).toBeGreaterThanOrEqual(m.rect.minZ);
      expect(m.post.z).toBeLessThanOrEqual(m.rect.maxZ);
      expect(m.text).toBe(plotSignText(p));
      expect(m.underConstruction).toBe(p.underConstruction);
    }
  });

  it("sideYaw follows the game's convention (0 faces +z, PI faces -z, PI/2 faces +x)", () => {
    expect(sideYaw("s")).toBe(0);
    expect(sideYaw("n")).toBe(Math.PI);
    expect(sideYaw("e")).toBe(Math.PI / 2);
    expect(sideYaw("w")).toBe(-Math.PI / 2);
  });

  it("every sign faces the plaza (the way it faces points from its post toward the fountain)", () => {
    const plaza = VILLAGE_LAYOUT.plaza.centre;
    for (const m of plotMarkerSpecs()) {
      const dirX = Math.sin(m.yaw);
      const dirZ = Math.cos(m.yaw);
      const toPlaza = (plaza.x - m.post.x) * dirX + (plaza.z - m.post.z) * dirZ;
      expect(toPlaza, m.id).toBeGreaterThan(0);
    }
  });
});
