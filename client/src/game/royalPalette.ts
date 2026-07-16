/**
 * Royal atlas palette swap (v2 Task 13). Each KayKit body ships one 1024²
 * gradient-atlas texture laid out as an 8×8 grid of color cells (measured by
 * scripts/dump-uv-cells.mjs — cell coordinates below come from THAT dump, not
 * guesswork). Recoloring a cell with the canvas `color` blend mode swaps its
 * hue/saturation while keeping the painted luminosity gradient, so "gray armor
 * → gold, red cloth → royal blue" costs one offscreen canvas per royal.
 *
 * Skin/hair/eye cells are PROTECTED: they are listed per recipe and a unit test
 * enforces that no recolor cell ever overlaps them (rogue shares its face-skin
 * cell (0,1) with both legs; the mage's bare hands live at (7,4)/(7,5)).
 *
 * One CanvasTexture is built lazily PER ROYAL and cached at module level —
 * every avatar clone of that royal shares it (never per-instance).
 */

import { CanvasTexture, SRGBColorSpace, type Texture } from "three";
import type { RoyalId } from "./constants";

/** Atlas grid resolution (8×8 cells of 128px; verified by the UV dump). */
export const ATLAS_GRID = 8;

/** One atlas cell address. `row` counts image-top→down (v=0 top, flipY=false). */
export interface AtlasCell {
  col: number;
  row: number;
}

/** A cell to repaint with the given CSS color (canvas `color` blend). */
export interface RecolorCell extends AtlasCell {
  color: string;
}

/** Per-royal repaint plan over its body atlas. */
export interface RoyalRecipe {
  /** Cells to repaint (hue/sat replaced, luminosity gradient kept). */
  cells: readonly RecolorCell[];
  /** Skin/hair/eye cells that must NEVER be repainted (unit-test enforced). */
  protectedCells: readonly AtlasCell[];
}

/**
 * The atlas pairs each 128px column with the one below it as a light→dark
 * gradient band (rows 0+1, 2+3, 4+5, 6+7 belong together), so recipes repaint
 * both halves with one hue. `band(col, b, color)` expands to those two cells.
 */
function band(col: number, b: number, color: string): [RecolorCell, RecolorCell] {
  return [
    { col, row: b * 2, color },
    { col, row: b * 2 + 1, color },
  ];
}

/** Protected (never repainted) band — same two-row expansion, no color. */
function keep(col: number, b: number): [AtlasCell, AtlasCell] {
  return [
    { col, row: b * 2 },
    { col, row: b * 2 + 1 },
  ];
}

// ── Royal palette hues. The `color` blend keeps the atlas luminosity, so one
//    fill hue yields a light top / dark bottom gradient automatically. ──
const GOLD = "#ecb62a"; // armor / metal trim → regal gold (screenshot-tuned hue)
const ROYAL_RED = "#b01c30"; // king: cloth, leather, cape → deep royal red
const ROYAL_BLUE = "#2e55e0"; // prince: tunic + cape → royal blue
const NAVY = "#2c3d85"; // prince: joints/greaves → deep navy accents
const ROYAL_PURPLE = "#9134cf"; // queen: robe/cape — magenta-leaning so it reads
// PURPLE in the scene light, not indigo (the mage atlas base is a slate blue)
const ROSE = "#e0559a"; // princess: hood/outfit/cape/boots → rose
const PALE_GOLD = "#d9a960"; // princess: leather straps → pale gold
const SILVER = "#a9b2c8"; // princess: boot leather → desaturated cool silver

/**
 * Recolor recipes, cell-verified against scripts/dump-uv-cells.mjs output:
 * every recolor cell below appears in the dumped used-cell set of a mesh that
 * stays VISIBLE on that royal (weapon-only cells are pointless and excluded),
 * and never overlaps the protected skin/hair/eye cells. See the unit test.
 */
export const ROYAL_RECIPES: Record<RoyalId, RoyalRecipe> = {
  // 왕 = barbarian: blue cloth + leather harness + cape → deep red, metal → gold.
  king: {
    cells: [
      ...band(0, 1, ROYAL_RED), // body cloth (was blue)
      ...band(1, 1, ROYAL_RED), // arm wraps (was blue)
      ...band(6, 0, ROYAL_RED), // leather harness/torso → red garment
      ...band(7, 0, ROYAL_RED), // cape + dark leather (Barbarian_Cape lives here)
      ...band(3, 2, ROYAL_RED), // leg wraps/boots (rows 4..5)
      ...band(3, 0, GOLD), // gray metal (bracelets, buckles)
      ...band(7, 1, GOLD), // gray leg/body bits (rows 2..3)
      ...band(7, 2, GOLD), // gray arm bits (rows 4..5)
    ],
    // Face skin, gray hair/beard, eyes — and the white fur trim stays ermine.
    protectedCells: [...keep(0, 0), ...keep(1, 0), ...keep(2, 0), ...keep(2, 1)],
  },
  // 왕비 = mage: purple-blue robe stays purple but deeper, all trim → gold.
  queen: {
    cells: [
      ...band(0, 1, ROYAL_PURPLE), // robe body/arms
      ...band(1, 1, ROYAL_PURPLE), // hood/collar cloth on the head mesh
      // Mage_Cape (was magenta) → deep-RED royal train: painted the robe's
      // purple it disappeared into the gown; red echoes the king (screenshot).
      ...band(2, 1, ROYAL_RED),
      ...band(2, 2, ROYAL_PURPLE), // teal pouches/accents (rows 4..5)
      ...band(7, 1, ROYAL_PURPLE), // navy under-robe (rows 2..3)
      ...band(3, 2, ROYAL_PURPLE), // brown boots (rows 4..5)
      ...band(3, 0, GOLD), // gray trim
      ...band(4, 0, GOLD), // gray arm cuffs
      ...band(5, 0, GOLD), // orange sash/trim
    ],
    // Face skin, black hair, eyes — and the BARE HANDS at (7,4)/(7,5).
    protectedCells: [...keep(0, 0), ...keep(1, 0), ...keep(2, 0), ...keep(7, 2)],
  },
  // 공주 = rogue: green outfit/cape → rose, leather → pale gold, boots → silver.
  princess: {
    cells: [
      ...band(0, 1, ROSE), // outfit greens
      ...band(1, 1, ROSE), // cape + tunic greens
      ...band(3, 2, ROSE), // tan boots (rows 4..5)
      ...band(5, 0, PALE_GOLD), // leather straps
      ...band(6, 0, PALE_GOLD), // belts/pouches
      ...band(5, 2, PALE_GOLD), // bracers (rows 4..5)
      { col: 7, row: 3, color: SILVER }, // boot leather — (7,2) is unused, so single cell
    ],
    // Face skin — (0,1) is SHARED with both legs (bare thighs) — hair, eyes.
    protectedCells: [...keep(0, 0), ...keep(1, 0), ...keep(2, 0)],
  },
  // 왕자 = knight: gray plate → gold, red tunic + cape → royal blue, navy accents.
  prince: {
    cells: [
      ...band(3, 0, GOLD), // main plate (helmet/arms/body/legs)
      ...band(7, 0, GOLD), // secondary plate
      ...band(2, 1, GOLD), // chainmail bits on the body (rows 2..3)
      ...band(0, 1, ROYAL_BLUE), // tunic + Knight_Cape (was red)
      ...band(4, 0, NAVY), // dark joint plates
      ...band(7, 1, NAVY), // greaves/boots (rows 2..3)
    ],
    protectedCells: [...keep(0, 0), ...keep(1, 0), ...keep(2, 0)],
  },
};

/** Module-level cache: exactly one palette texture per royal, shared by clones. */
const paletteCache = new Map<RoyalId, CanvasTexture>();

/**
 * Repaint the recipe cells over the source atlas on an offscreen canvas. The
 * `color` composite op replaces hue/saturation but keeps the destination
 * luminosity, so the atlas' baked gradients (and the narrow shadow strip inside
 * each cell) survive the swap.
 */
function buildRoyalTexture(recipe: RoyalRecipe, source: Texture): CanvasTexture {
  const image = source.image as HTMLImageElement | ImageBitmap;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const cellW = canvas.width / ATLAS_GRID;
  const cellH = canvas.height / ATLAS_GRID;
  ctx.globalCompositeOperation = "color";
  for (const cell of recipe.cells) {
    ctx.fillStyle = cell.color;
    ctx.fillRect(cell.col * cellW, cell.row * cellH, cellW, cellH);
  }
  const texture = new CanvasTexture(canvas);
  // GLTF texture convention: v=0 is the image top — three's default flipY=true
  // would mirror every cell, so it MUST be false (like the loader-created map).
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  // Sampling must match the original atlas texture exactly.
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.generateMipmaps = source.generateMipmaps;
  texture.anisotropy = source.anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The (cached) royal palette texture for `royal`, built on first use from the
 * body's original atlas texture. Callers must NOT dispose it — module lifetime.
 */
export function getRoyalTexture(royal: RoyalId, source: Texture): Texture {
  const cached = paletteCache.get(royal);
  if (cached) return cached;
  const built = buildRoyalTexture(ROYAL_RECIPES[royal], source);
  paletteCache.set(royal, built);
  return built;
}

declare global {
  interface Window {
    /** Dev/E2E hook: which royal palettes have been built in this page. */
    __cvRoyalPalettes?: () => string[];
  }
}

// Dev-only E2E hook (tree-shaken in production, same pattern as debug.ts).
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__cvRoyalPalettes = () => [...paletteCache.keys()];
}
