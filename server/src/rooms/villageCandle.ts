import { CANDLE_REACH_M } from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT, cubbyAnchors, type CubbyAnchor, type VillageLayout } from "@caysonverse/shared/village/villageLayout";

/**
 * Pure candle rule of the memorial hall (케이슨 마을 Task 9; clock-free and room-free like villageDoor.ts): may a player
 * standing at (x, z) in `area` light the candle of `cubby`? The room owns the 1-per-5-seconds cap and the broadcast.
 *
 * The distance is measured on the ground plane, from the player to the cubby's anchor (its opening centre): the seven
 * rows of a column share one spot on the floor, and a visitor stands in front of the column, not at the height of the
 * cubby. Nothing is stored: a candle is a broadcast, and each client lets it burn out by itself.
 */

/** Every cubby's anchor by id, built once. */
const ANCHORS: ReadonlyMap<string, CubbyAnchor> = new Map(cubbyAnchors(VILLAGE_LAYOUT).map((a) => [a.id, a]));

/** The anchors of another layout (tests), else the shared one. */
function anchorsOf(layout: VillageLayout): ReadonlyMap<string, CubbyAnchor> {
  return layout === VILLAGE_LAYOUT ? ANCHORS : new Map(cubbyAnchors(layout).map((a) => [a.id, a]));
}

/**
 * The cubby's anchor when the candle may be lit, else `null`: the player is not in the hall, the position is not finite,
 * `cubby` is not a string naming one of the hall's cubbies, or the player is farther than `CANDLE_REACH_M` from it.
 */
export function candleCubby(
  area: string,
  x: number,
  z: number,
  cubby: unknown,
  layout: VillageLayout = VILLAGE_LAYOUT,
): CubbyAnchor | null {
  if (area !== "hall") return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (typeof cubby !== "string") return null;
  const anchor = anchorsOf(layout).get(cubby);
  if (!anchor) return null;
  if (Math.hypot(x - anchor.x, z - anchor.z) > CANDLE_REACH_M) return null;
  return anchor;
}
