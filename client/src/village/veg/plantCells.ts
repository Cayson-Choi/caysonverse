/**
 * The plant atlas's cells (vegPlantAtlas.ts draws them, vegPlants.ts maps its pieces onto them). 4 x 4 cells; uv (0, 0)
 * is the canvas's top-left (the texture is not flipped), v grows down the canvas.
 */
export const PLANT_GRID = 4;
export const PLANT_CELL = {
  boxA: 0, // a boxwood (회양목) sprig: opposite pairs of small rounded leaves, 1.5-2 cm, on a 16 cm card
  boxB: 1, // another boxwood sprig (a different branching)
  boxIn: 2, // the boxwood's inside: denser, darker, older leaves
  azSprig: 3, // an azalea (철쭉) shoot: whorls of 3-4 cm elliptic leaves
  azFlower: 4, // an azalea truss: two or three five-lobed funnels (white: the bush's tint colours them)
  pansy: 5, // a pansy face, front on (white petals, dark blotch and whiskers, yellow eye)
  petunia: 6, // a petunia trumpet, front on (five fused lobes, net veins, darker throat)
  marigold: 7, // a French marigold head, from above (ruffled florets in rings)
  muscari: 8, // grape-hyacinth bells (wraps round the spike: u around, v along, bells hang toward v 1)
  leafPansy: 9, // a pansy leaf (ovate, scalloped), base at the bottom middle
  leafPetunia: 10, // a petunia leaf (soft, ovate)
  leafMarigold: 11, // a marigold frond (pinnate, toothed leaflets)
  mulch: 12, // bark-chip mulch, an irregular patch
  solid: 13, // white: stems, cores and anything untextured
  tulip: 14, // a tulip petal (white with faint streaks and a darker base)
  strap: 15, // a strap leaf (parallel veins): muscari, tulip
} as const;
export type PlantCell = (typeof PLANT_CELL)[keyof typeof PLANT_CELL];

/** UV of (u, v) in 0..1 inside a cell, with a margin (no bleeding into the neighbours at small mip levels). */
export function plantUv(cell: number, u: number, v: number, margin = 0.03): [number, number] {
  const cx = cell % PLANT_GRID;
  const cy = Math.floor(cell / PLANT_GRID);
  const s = 1 / PLANT_GRID;
  return [(cx + margin + u * (1 - 2 * margin)) * s, (cy + margin + v * (1 - 2 * margin)) * s];
}

/** The middle of the white cell: what untextured vertices sample. */
export const SOLID_UV: [number, number] = plantUv(PLANT_CELL.solid, 0.5, 0.5);
