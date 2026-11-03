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

  it("the exact signs", () => {
    expect(plotSignText(plot("plot_ne"))).toBe("곧 지어져요 · 성당");
    expect(plotSignText(plot("plot_e"))).toBe("곧 지어져요 · 학교");
    expect(plotSignText(plot("plot_nw"))).toBe("곧 지어져요 · 절");
    expect(plotSignText(plot("plot_s"))).toBe("곧 지어져요 · 교회");
  });

  it("the plot under construction (the library) says 공사 중, not 곧 지어져요", () => {
    expect(SIGN_UNDER_CONSTRUCTION).toBe("공사 중");
    const library = plot("plot_w");
    expect(library.underConstruction).toBe(true);
    expect(plotSignText(library)).toBe("공사 중 · 도서관");
    expect(plotSignLines(library)).toEqual(["공사 중", "도서관"]);
    // It is the only one.
    expect(VILLAGE_LAYOUT.plots.filter((p) => p.underConstruction).map((p) => p.id)).toEqual(["plot_w"]);
  });

  it("the memorial hall's plot (plot_n) has no sign and no marker", () => {
    expect(plotSignText(plot("plot_n"))).toBeNull();
    expect(plotSignLines(plot("plot_n"))).toBeNull();
    expect(plotMarkerSpecs().map((m) => m.id)).not.toContain("plot_n");
  });

  it("one marker per plot that has a sign, in the layout's order", () => {
    const expected = VILLAGE_LAYOUT.plots.filter((p) => p.sign !== null).map((p) => p.id);
    expect(plotMarkerSpecs().map((m) => m.id)).toEqual(expected);
    expect(expected).toHaveLength(5);
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
