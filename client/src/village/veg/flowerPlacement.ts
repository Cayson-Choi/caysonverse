import { FLORA_ROW, floraRow, type Card } from "./vegCards";
import { hashUnit, mulberry32, valueNoise3 } from "./vegRandom";

/**
 * Where the 3D flowers grow (veg3d): read from the old flower cards themselves, so they stand exactly where the art
 * script planted its beds (plaza planters, fountain corners, square planters, house borders, the ring's sidewalk
 * strip, the memorial strips, window boxes, the kiosk) and nothing is laid out twice. Pure and seeded (unit-tested).
 *
 *  - A card's row of `T_flora` picks the planting: pink -> petunias, yellow -> pansies (yellow, orange), purple spikes ->
 *    a spring mix of grape hyacinths (muscari), violas and tulips (research spec §2.4: April under the cherries).
 *  - Candidates: each card's centre and points scattered within 24 cm of it (the centres were scattered inside the
 *    bed's shape by the art script, so the union of these discs is the bed), thinned by a minimum distance per species
 *    (spacing as gardeners plant: petunias 20-25 cm, pansies 15-20 cm): a bed is planted full, as the Seoul beds are.
 *    The plaza's raised beds clip them to their soil.
 *  - Colours come in drifts of 2-5 plants (a low-frequency hash), with a small per-plant jitter; plants on a raised
 *    bed's rim lean out over it.
 *  - Flower cards mixed into the meadow grass tufts (grass cards right next to them) are wild patches, not beds: they
 *    are planted the same way but sparser (WILD_SPACING), as flowers come up among grass.
 *  - Every grass card (the meadow's tufts, the reeds by the water) becomes a 3D tuft of blades (vegGeometry.grassTuft)
 *    standing where the card stood, as tall as it was: the "plants" of species grass and reed.
 */

export const SPECIES = { petunia: 0, pansy: 1, muscari: 2, tulip: 3, grass: 4, reed: 5 } as const;
export type Species = (typeof SPECIES)[keyof typeof SPECIES];
export const SPECIES_COUNT = 6;

/** Minimum distance between two plants of a species (m): the planting spacing x 0.85 (the tufts: one per old card). */
export const SPACING: Readonly<Record<Species, number>> = { 0: 0.19, 1: 0.135, 2: 0.11, 3: 0.14, 4: 0, 5: 0 };

/** The wild patches in the meadow's grass are this much sparser than a bed. */
export const WILD_SPACING = 1.7;

/** A grass tuft's and a reed clump's height (m) and spread (radius) at scale 1 (vegGeometry.grassTuft). */
export const TUFT = { grass: { h: 0.4, r: 0.26 }, reed: { h: 1.0, r: 0.3 } } as const;
/** Grass cards taller than this (m) are reeds. */
export const REED_H = 0.6;

/** Candidate points per card and how far round its centre they fall (m). */
export const CANDIDATES_PER_CARD = 12;
export const CANDIDATE_RADIUS = 0.24;

export interface Plant {
  x: number;
  y: number;
  z: number;
  species: Species;
  yaw: number;
  scale: number;
  /** Lean: a small rotation (rad) about x and z, applied before the yaw. */
  leanX: number;
  leanZ: number;
  /** Linear-light colour the petals are multiplied by. */
  tint: [number, number, number];
  /** Baked light where the plant stands (the replaced card's COLOR_0 luminance). */
  light: number;
  /** A per-plant hash in [0, 1) (LOD thinning, wind phase). */
  seed: number;
}

/** A raised bed on the plaza: plants are kept on its soil, and those near its rim lean out over it. */
export type Bed =
  | { kind: "ring"; x: number; z: number; rMin: number; rMax: number; lean: number }
  | { kind: "square"; x: number; z: number; half: number; hole: number; lean: number }
  | { kind: "fountain"; half: number; rMin: number; lean: number };

const rad = (d: number) => (d * Math.PI) / 180;

/** The plaza's raised beds (art/village/tools: parts_trees.plaza_trees + planter, parts_props.plaza_details). */
export const PLAZA_BEDS: readonly Bed[] = [
  // the six round stone planters under the cherries (r 1.5, soil to r 1.3, cards in 0.3 .. 1.25)
  ...[-118, -62, -16, 40, 65, 138].map((d): Bed => ({ kind: "ring", x: 19 * Math.cos(rad(d)), z: 19 * Math.sin(rad(d)), rMin: 0.34, rMax: 1.2, lean: 0.95 })),
  // four square granite planters (2.2 m, soil 1.9 m, a clipped shrub r 0.55 in the middle)
  ...[-135, -65, 75, 140].map((d): Bed => ({ kind: "square", x: 24.5 * Math.cos(rad(d)), z: 24.5 * Math.sin(rad(d)), half: 0.9, hole: 0.6, lean: 0.7 })),
  // the fountain's four corner beds (square half-width 5.8 minus the circle r 6.25)
  { kind: "fountain", half: 5.75, rMin: 6.32, lean: 5.45 },
];

/** The grid step (m) candidates are laid on over a raised bed. */
export const BED_GRID = 0.07;

/** A raised bed's bounding box [x0, x1, z0, z1]. */
export function bedBox(bed: Bed): [number, number, number, number] {
  if (bed.kind === "ring") return [bed.x - bed.rMax, bed.x + bed.rMax, bed.z - bed.rMax, bed.z + bed.rMax];
  if (bed.kind === "square") return [bed.x - bed.half, bed.x + bed.half, bed.z - bed.half, bed.z + bed.half];
  return [-bed.half, bed.half, -bed.half, bed.half];
}

/** Which bed a point is on (or null), and whether it is allowed there. */
export function bedAt(beds: readonly Bed[], x: number, z: number): { bed: Bed; ok: boolean; out: [number, number] } | null {
  for (const bed of beds) {
    if (bed.kind === "ring") {
      const dx = x - bed.x;
      const dz = z - bed.z;
      const r = Math.hypot(dx, dz);
      if (r > 1.6) continue;
      const ok = r >= bed.rMin && r <= bed.rMax;
      const lean = r > bed.lean ? (r - bed.lean) / (bed.rMax - bed.lean) : 0;
      return { bed, ok, out: r > 1e-6 ? [(dx / r) * lean, (dz / r) * lean] : [0, 0] };
    }
    if (bed.kind === "square") {
      const dx = x - bed.x;
      const dz = z - bed.z;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > 1.2) continue;
      const ok = Math.abs(dx) <= bed.half && Math.abs(dz) <= bed.half && Math.hypot(dx, dz) >= bed.hole;
      const ex = Math.abs(dx) > bed.lean ? Math.sign(dx) * (Math.abs(dx) - bed.lean) / (bed.half - bed.lean) : 0;
      const ez = Math.abs(dz) > bed.lean ? Math.sign(dz) * (Math.abs(dz) - bed.lean) / (bed.half - bed.lean) : 0;
      return { bed, ok, out: [ex, ez] };
    }
    // fountain corners: inside the square, outside the circle
    if (Math.abs(x) > 6.1 || Math.abs(z) > 6.1 || Math.hypot(x, z) < 6.0) continue;
    const ok = Math.abs(x) <= bed.half && Math.abs(z) <= bed.half && Math.hypot(x, z) >= bed.rMin;
    const ex = Math.abs(x) > bed.lean ? Math.sign(x) * (Math.abs(x) - bed.lean) / (bed.half - bed.lean) : 0;
    const ez = Math.abs(z) > bed.lean ? Math.sign(z) * (Math.abs(z) - bed.lean) / (bed.half - bed.lean) : 0;
    return { bed, ok, out: [ex, ez] };
  }
  return null;
}

/** sRGB hex -> linear rgb. */
export function linearHex(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** Colour palettes (sRGB, weight). Petunias as in the Seoul beds (magenta, pink, white, purple, red). */
export const PALETTES = {
  petunia: [
    ["#C2187A", 3],
    ["#E8559A", 3],
    ["#F7B2CF", 2],
    ["#FBF7F9", 2],
    ["#6E2C93", 1.5],
    ["#D0203F", 1],
  ],
  pansy: [
    ["#F7CC17", 3],
    ["#F59A1C", 2],
    ["#FFE575", 1.5],
    ["#E5661A", 1],
    ["#F4EFD8", 1],
  ],
  viola: [
    ["#5A3EA8", 3],
    ["#8467CC", 2],
    ["#F4F0FA", 2],
    ["#3B2D8C", 1],
    ["#F2D24A", 0.7],
  ],
  muscari: [
    ["#3448B4", 3],
    ["#4A5ECC", 2],
    ["#2A3592", 1.5],
    ["#6474D2", 1],
  ],
  tulip: [
    ["#D8262F", 3],
    ["#F4C51C", 2],
    ["#EE6FA2", 2],
    ["#F8F4EB", 1.5],
    ["#E9731F", 1],
    ["#8D3B9D", 1],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, number]>>;

export type PaletteName = keyof typeof PALETTES;

function pick(palette: ReadonlyArray<readonly [string, number]>, u: number): string {
  let total = 0;
  for (const [, w] of palette) total += w;
  let t = u * total;
  for (const [hex, w] of palette) {
    if (t < w) return hex;
    t -= w;
  }
  return palette[palette.length - 1]![0];
}

/** The drift a point belongs to: a hash of a warped 0.55 m lattice, so colours come in clumps of a few plants. */
function driftUnit(x: number, z: number, salt: number): number {
  const wx = x + 0.35 * (valueNoise3(x * 1.3, 0.5, z * 1.3, 11) - 0.5);
  const wz = z + 0.35 * (valueNoise3(x * 1.3, 2.5, z * 1.3, 13) - 0.5);
  return hashUnit(Math.floor(wx / 0.55), Math.floor(wz / 0.55), salt);
}

/** Which species a candidate from a card of `row` at (x, z) becomes. */
export function speciesFor(row: number, x: number, z: number): { species: Species; palette: PaletteName } {
  if (row === FLORA_ROW.pink) return { species: SPECIES.petunia, palette: "petunia" };
  if (row === FLORA_ROW.yellow) return { species: SPECIES.pansy, palette: "pansy" };
  // the purple-spike row: drifts of muscari, violas and tulips (bigger patches: a 0.9 m warped lattice)
  const n = valueNoise3(x / 0.9, 7.5, z / 0.9, 5);
  if (n < 0.5) return { species: SPECIES.muscari, palette: "muscari" };
  if (n < 0.72) return { species: SPECIES.pansy, palette: "viola" };
  return { species: SPECIES.tulip, palette: "tulip" };
}

export interface PlacementResult {
  plants: Plant[];
  /** Cards replaced by plants or tufts (their triangles are hidden). */
  replaced: Card[];
}

/** True for flower cards with a grass card (row 3) on the same floor within 1.2 m: the meadow's tufts. */
function inGrassTuft(card: Card, grid: Map<string, Card[]>): boolean {
  const gx = Math.floor(card.x / 2);
  const gz = Math.floor(card.z / 2);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      for (const g of grid.get(`${gx + i},${gz + j}`) ?? []) {
        if (Math.abs(g.floor - card.floor) < 0.15 && Math.hypot(g.x - card.x, g.z - card.z) < 1.2) return true;
      }
    }
  return false;
}

/** Plants for the flower cards (rows 0-2) among `cards`, and a tuft for each grass card (row 3). */
export function placeFlowers(cards: readonly Card[], beds: readonly Bed[] = PLAZA_BEDS, seed = 20261110): PlacementResult {
  const rand = mulberry32(seed);
  const grass = cards.filter((c) => c.h > 0.05 && floraRow(c.v) === FLORA_ROW.grass);
  const grassGrid = new Map<string, Card[]>();
  for (const g of grass) {
    const k = `${Math.floor(g.x / 2)},${Math.floor(g.z / 2)}`;
    let l = grassGrid.get(k);
    if (!l) grassGrid.set(k, (l = []));
    l.push(g);
  }
  const replaced: Card[] = [];
  const plants: Plant[] = [];
  // a spatial hash of placed plants (0.25 m cells) for the minimum distance
  const cell = 0.25;
  const grid = new Map<number, Plant[]>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  const tooClose = (x: number, y: number, z: number, d: number) => {
    const i0 = Math.floor(x / cell);
    const j0 = Math.floor(z / cell);
    const r = Math.ceil(d / cell);
    for (let i = i0 - r; i <= i0 + r; i++)
      for (let j = j0 - r; j <= j0 + r; j++) {
        const list = grid.get(key(i, j));
        if (!list) continue;
        for (const p of list) if (Math.abs(p.y - y) < 0.3 && (p.x - x) ** 2 + (p.z - z) ** 2 < d * d) return true;
      }
    return false;
  };
  // 1. candidates: scattered round each card's centre (the union of these discs is the bed), or, on the plaza's raised
  //    beds, a jittered grid over the whole bed (its cards are too few to cover it: a planter is planted full)
  type Candidate = { x: number; z: number; y: number; row: number; light: number; wild?: boolean };
  const candidates: Candidate[] = [];
  const bedCards = new Map<Bed, Card[]>();
  for (const card of cards) {
    if (card.h < 0.05) continue; // flat cards are not flower strips
    const row = floraRow(card.v);
    if (row > FLORA_ROW.purple) continue;
    replaced.push(card);
    const cx = (card.ax + card.bx) / 2;
    const cz = (card.az + card.bz) / 2;
    if (inGrassTuft(card, grassGrid)) {
      for (let k = 0; k < CANDIDATES_PER_CARD / 2; k++) {
        const r = k === 0 ? 0 : CANDIDATE_RADIUS * 1.2 * Math.sqrt(rand());
        const t = rand() * Math.PI * 2;
        candidates.push({ x: cx + r * Math.cos(t), z: cz + r * Math.sin(t), y: card.floor, row, light: card.light, wild: true });
      }
      continue;
    }
    const onBed = bedAt(beds, cx, cz);
    if (onBed) {
      let list = bedCards.get(onBed.bed);
      if (!list) bedCards.set(onBed.bed, (list = []));
      list.push(card);
      continue;
    }
    for (let k = 0; k < CANDIDATES_PER_CARD; k++) {
      const r = k === 0 ? 0 : CANDIDATE_RADIUS * Math.sqrt(rand());
      const t = rand() * Math.PI * 2;
      candidates.push({ x: cx + r * Math.cos(t), z: cz + r * Math.sin(t), y: card.floor, row, light: card.light });
    }
  }
  for (const [bed, list] of bedCards) {
    const [x0, x1, z0, z1] = bedBox(bed);
    const step = BED_GRID;
    for (let x = x0; x <= x1; x += step)
      for (let z = z0; z <= z1; z += step) {
        const px = x + (rand() - 0.5) * step;
        const pz = z + (rand() - 0.5) * step;
        const at = bedAt([bed], px, pz);
        if (!at || !at.ok) continue;
        // the planting (row) and the light of the nearest old card
        let best = list[0]!;
        let bd = Infinity;
        for (const c of list) {
          const d = (c.x - px) ** 2 + (c.z - pz) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        candidates.push({ x: px, z: pz, y: best.floor, row: floraRow(best.v), light: best.light });
      }
  }
  // 2. a random order (no grid or card-order bias), then thinning by the species' spacing
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = t;
  }
  for (const c of candidates) {
    const { x, y, z, row } = c;
    const onBed = bedAt(beds, x, z);
    if (onBed && !onBed.ok) continue;
    const { species, palette } = speciesFor(row, x, z);
    if (tooClose(x, y, z, SPACING[species] * (c.wild ? WILD_SPACING : 1))) continue;
    const drift = driftUnit(x, z, species * 7 + row);
    const base = linearHex(pick(PALETTES[palette], drift));
    const bright = 0.92 + 0.16 * rand();
    const tint: [number, number, number] = [Math.min(1, base[0] * bright), Math.min(1, base[1] * bright), Math.min(1, base[2] * bright)];
    const out = onBed?.out ?? [0, 0];
    const leanOut = 0.18 + 0.22 * rand(); // 10-23 degrees over a rim
    const p: Plant = {
      x,
      y,
      z,
      species,
      yaw: rand() * Math.PI * 2,
      scale: 1.0 + 0.4 * rand(),
      // lean toward +x tips the top toward +x: a rotation about z of -angle; toward +z: about x of +angle
      leanX: out[1] * leanOut + (rand() - 0.5) * 0.12,
      leanZ: -out[0] * leanOut + (rand() - 0.5) * 0.12,
      tint,
      light: c.light,
      seed: rand(),
    };
    plants.push(p);
    const k = key(Math.floor(x / cell), Math.floor(z / cell));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(p);
  }
  // 3. the grass: a tuft where each grass card stood, as tall as the card, turned at random
  for (const g of grass) {
    const reed = g.h > REED_H;
    const size = reed ? TUFT.reed : TUFT.grass;
    const k = 0.92 + 0.14 * rand();
    plants.push({
      x: (g.ax + g.bx) / 2,
      y: g.floor,
      z: (g.az + g.bz) / 2,
      species: reed ? SPECIES.reed : SPECIES.grass,
      yaw: rand() * Math.PI * 2,
      scale: Math.max(0.5, g.h / size.h) * (0.9 + 0.2 * rand()),
      leanX: (rand() - 0.5) * 0.1,
      leanZ: (rand() - 0.5) * 0.1,
      tint: [k * (0.94 + 0.12 * rand()), k, k * (0.92 + 0.1 * rand())],
      light: g.light,
      seed: rand(),
    });
    replaced.push(g);
  }
  return { plants, replaced };
}
