import { describe, it, expect } from "vitest";
import { ATLAS_GRID, ROYAL_RECIPES, type AtlasCell } from "./royalPalette";
import { PEPLUM_HIDE_HIPS_Y, PEPLUM_SHOW_HIPS_Y, peplumVisibleForHipsY } from "./royalAttachments";
import { CHARACTERS } from "./constants";

/**
 * Atlas cells actually used by each royal's VISIBLE meshes (body parts + cape;
 * weapon/hat meshes are hidden by the preset, so their exclusive cells are
 * excluded on purpose). Source of truth: `node scripts/dump-uv-cells.mjs` —
 * these sets are copied verbatim from its per-mesh cell dump, so a recipe cell
 * that no visible mesh samples fails the containment test below.
 */
const USED_CELLS: Record<keyof typeof ROYAL_RECIPES, readonly string[]> = {
  // barbarian.glb: Arm L/R, Body, Head, Leg L/R, Barbarian_Cape
  king: [
    "0,0", "0,1", "0,2", "0,3", "1,0", "1,1", "1,2", "1,3",
    "2,0", "2,1", "2,2", "2,3", "3,0", "3,1", "3,4", "3,5",
    "6,0", "6,1", "7,0", "7,1", "7,2", "7,3", "7,4", "7,5",
  ],
  // mage.glb: Arm L/R, Body, Head, Leg L/R, Mage_Cape
  queen: [
    "0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "1,1", "1,2", "1,3",
    "2,0", "2,2", "2,3", "2,4", "2,5", "3,0", "3,1", "3,4", "3,5",
    "4,0", "4,1", "5,0", "5,1", "7,2", "7,3", "7,5",
  ],
  // rogue.glb: Arm L/R, Body, Head, Leg L/R, Rogue_Cape
  princess: [
    "0,0", "0,1", "0,2", "0,3", "1,0", "1,1", "1,2", "1,3", "2,0",
    "3,0", "3,1", "3,4", "3,5", "5,0", "5,1", "5,4", "5,5",
    "6,0", "6,1", "7,3",
  ],
  // knight.glb: Arm L/R, Body, Head, Leg L/R, Knight_Cape
  prince: [
    "0,0", "0,1", "0,2", "0,3", "1,0", "1,1", "1,2", "1,3",
    "2,0", "2,1", "2,2", "2,3", "3,0", "3,1", "4,0", "4,1",
    "6,0", "6,1", "7,0", "7,1", "7,2", "7,3",
  ],
};

const key = (cell: AtlasCell) => `${cell.col},${cell.row}`;
const royals = Object.keys(ROYAL_RECIPES) as (keyof typeof ROYAL_RECIPES)[];

// The palette swap is the royal look's core engine; these guards keep it honest:
// a recipe can never repaint skin (protected cells) and can never target a cell
// no visible mesh samples (dead config would rot silently otherwise).
describe("ROYAL_RECIPES integrity", () => {
  it("covers exactly the four royal presets in CHARACTERS", () => {
    const presetRoyals = CHARACTERS.map((c) => c.crown?.royal).filter(Boolean);
    expect([...presetRoyals].sort()).toEqual([...royals].sort());
    expect(royals).toHaveLength(4);
  });

  it("keeps every cell address inside the 8×8 atlas grid", () => {
    for (const royal of royals) {
      const { cells, protectedCells } = ROYAL_RECIPES[royal];
      for (const cell of [...cells, ...protectedCells]) {
        expect(cell.col).toBeGreaterThanOrEqual(0);
        expect(cell.col).toBeLessThan(ATLAS_GRID);
        expect(cell.row).toBeGreaterThanOrEqual(0);
        expect(cell.row).toBeLessThan(ATLAS_GRID);
      }
    }
  });

  it("never recolors a protected (skin/hair/eye) cell — per royal", () => {
    for (const royal of royals) {
      const { cells, protectedCells } = ROYAL_RECIPES[royal];
      const banned = new Set(protectedCells.map(key));
      for (const cell of cells) {
        expect(banned.has(key(cell)), `${royal} repaints protected (${key(cell)})`).toBe(false);
      }
    }
  });

  it("only recolors cells that the royal's VISIBLE meshes actually sample", () => {
    for (const royal of royals) {
      const used = new Set(USED_CELLS[royal]);
      for (const cell of ROYAL_RECIPES[royal].cells) {
        expect(used.has(key(cell)), `${royal} recolors unused cell (${key(cell)})`).toBe(true);
      }
    }
  });

  it("protects the measured skin cells (face for all; rogue legs; mage hands)", () => {
    for (const royal of royals) {
      const banned = new Set(ROYAL_RECIPES[royal].protectedCells.map(key));
      // Face skin band (0,0)/(0,1) — identical across all four atlases.
      expect(banned.has("0,0")).toBe(true);
      expect(banned.has("0,1")).toBe(true);
    }
    // Rogue: (0,1) is SHARED by Head and both legs (bare thighs) — the exact
    // collision the dump flagged; it must be under protection for the princess.
    expect(new Set(ROYAL_RECIPES.princess.protectedCells.map(key)).has("0,1")).toBe(true);
    // Mage: bare hands live at (7,4)/(7,5) on the arm meshes.
    const queenBanned = new Set(ROYAL_RECIPES.queen.protectedCells.map(key));
    expect(queenBanned.has("7,4")).toBe(true);
    expect(queenBanned.has("7,5")).toBe(true);
  });

  it("uses valid #rrggbb colors on every recolor cell", () => {
    for (const royal of royals) {
      for (const cell of ROYAL_RECIPES[royal].cells) {
        expect(cell.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

// The peplum hides off the ANIMATED hips height (the pose the server-driven
// seatIndex produces). Ranges below are measured from the GLB clips by
// scripts/dump-uv-cells.mjs and shared by all four models (same rig).
describe("peplumVisibleForHipsY (hysteresis — review v2-13 M2)", () => {
  it("shows the peplum through the whole idle/walk hips range, from either prior state", () => {
    expect(peplumVisibleForHipsY(0.3254, true)).toBe(true); // Walking_A min
    expect(peplumVisibleForHipsY(0.3921, false)).toBe(true); // Idle max — re-shows under 0.41
    expect(peplumVisibleForHipsY(0.4057, true)).toBe(true); // bind pose (first frame)
  });

  it("hides the peplum at the held seated pose and the stand-up peak", () => {
    expect(peplumVisibleForHipsY(0.4813, true)).toBe(false); // Sit_Chair_Idle
    expect(peplumVisibleForHipsY(0.5512, false)).toBe(false); // Sit_Chair_StandUp peak
  });

  it("suppresses StandUp flicker: in-band hips keep the PRIOR state", () => {
    // The StandUp curve crosses 0.44 both ways before settling; between the two
    // thresholds the previous visibility must win (single clean transition).
    expect(peplumVisibleForHipsY(0.42, true)).toBe(true);
    expect(peplumVisibleForHipsY(0.42, false)).toBe(false);
  });

  it("keeps both thresholds strictly between the measured ranges, show below hide", () => {
    expect(PEPLUM_SHOW_HIPS_Y).toBeGreaterThan(0.3921);
    expect(PEPLUM_SHOW_HIPS_Y).toBeLessThan(PEPLUM_HIDE_HIPS_Y);
    expect(PEPLUM_HIDE_HIPS_Y).toBeLessThan(0.4813);
  });
});
