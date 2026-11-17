/**
 * The Colmar houses' window boxes and hanging baskets (2026-11-17, owner: "이런 동화 같은 집의 느낌" — the Petite Venise photo's
 * geraniums under every window): the soil rectangles the house build wrote (docs/designs/house-exteriors/tools/
 * build_house_body.py --boxes-out, world game axes), as flower beds for the village vegetation. village_houses.glb carries a
 * row of planting cards (M_leaf_flora) in each box; with these beds the vegetation fills the whole box with 3D geraniums
 * that trail over its rims, instead of scattering plants round each card (which would float off a 0.2 m box).
 */
import table from "@caysonverse/shared/village/generated/house_flower_boxes.json";
import type { Bed } from "../veg/flowerPlacement";

interface BoxRow {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
}

/** Every house's window boxes and baskets as `box` beds. */
export function houseFlowerBoxBeds(): Bed[] {
  const houses = (table as { houses: Record<string, BoxRow[]> }).houses;
  const out: Bed[] = [];
  for (const rows of Object.values(houses)) for (const r of rows) out.push({ kind: "box", x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y: r.y });
  return out;
}
