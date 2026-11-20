/**
 * The flower and grass cards the village.glb bakes lie where the OLD flat lanes ran; the lanes were redrawn (ground/groundPaths.ts),
 * so some cards ended up on the cobbles (owner 2026-11-21: "꽃들도 그렇고"). A card on the paving is moved to the grass beside it,
 * at the nearest spot 45 cm off the edge (the planting scatters 24 cm round a card's centre), so the bed stays where the garden
 * was meant to be: along the path's edge. Raised beds (the plaza's planters, window boxes) and cards above the ground are left.
 */
import { bedAt, type Bed } from "./flowerPlacement";
import { offPaving, pavedClearance } from "./pavedGround";
import type { Card } from "./vegCards";

/** Cards standing on the ground (not a window box's, a roof's or a raised bed's). */
export const GROUND_FLOOR_MAX = 0.35;
/** A card whose centre is nearer than this to the paving is moved. */
export const CARD_TRIGGER_M = 0.4;
/** The clearance a moved card's centre gets. */
export const CARD_MARGIN_M = 0.45;

/** The cards with each one that lay on the paving moved off it (new objects; the others are the same objects). */
export function cardsOffPaving(cards: readonly Card[], beds: readonly Bed[]): { cards: Card[]; moved: number[] } {
  const moved: number[] = [];
  const out = cards.map((c, i) => {
    if (c.floor > GROUND_FLOOR_MAX) return c;
    const cx = (c.ax + c.bx) / 2;
    const cz = (c.az + c.bz) / 2;
    if (bedAt(beds, cx, cz, c.floor)) return c;
    if (pavedClearance(cx, cz) >= CARD_TRIGGER_M) return c;
    const to = offPaving(cx, cz, CARD_MARGIN_M);
    const dx = to.x - cx;
    const dz = to.z - cz;
    moved.push(i);
    return { ...c, x: c.x + dx, z: c.z + dz, ax: c.ax + dx, az: c.az + dz, bx: c.bx + dx, bz: c.bz + dz };
  });
  return { cards: out, moved };
}
