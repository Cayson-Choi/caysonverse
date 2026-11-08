import { VILLAGE_LAYOUT, cubbyAnchors, type CubbyAnchor } from "./villageLayout";

/**
 * Which of the memorial hall's cubbies hold a sample memorial (케이슨 마을 Task 9), shared by the client (which draws
 * and describes them, client/src/village/sampleCubbies.ts) and the server (which lights a candle only on a filled cubby:
 * final fix, the T9 review's "candle on an empty cubby" item).
 *
 * Seed-stable: the `SAMPLE_FILL` share of the cubbies (rounded) with the lowest hash of `fill:<id>`, ties by id.
 */

/** How many of the hall's cubbies hold a sample (brief: 60 %). */
export const SAMPLE_FILL = 0.6;

/** FNV-1a hash of a string (32-bit): the seed of a cubby's choices. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The ids of the filled cubbies among `anchors`. */
export function sampleFilledIds(anchors: readonly CubbyAnchor[], fill: number = SAMPLE_FILL): ReadonlySet<string> {
  const want = Math.round(anchors.length * fill);
  return new Set(
    [...anchors]
      .sort((a, b) => hashId(`fill:${a.id}`) - hashId(`fill:${b.id}`) || (a.id < b.id ? -1 : 1))
      .slice(0, want)
      .map((a) => a.id),
  );
}

/** The filled cubbies of the shared layout. */
export const SAMPLE_FILLED_IDS: ReadonlySet<string> = sampleFilledIds(cubbyAnchors(VILLAGE_LAYOUT));
