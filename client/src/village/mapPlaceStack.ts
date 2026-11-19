/**
 * The stacking of the map's place chips (MapPlaces.tsx). drei's <Html zIndexRange={[near, far]}> sets each label's z-index from its
 * depth between the two numbers; every chip sits at nearly the same depth over a top-down map, so equal ranges tie and the later
 * one in the page wins. The picked place's card ("여기로 가기") therefore used to sit UNDER a neighbouring chip drawn later (QA
 * 2026-11-20, phone: a tap on the button landed on the chip over it and re-picked the neighbour, the walk never started).
 *
 * The picked place takes a range strictly above every other chip (14..19 against <= 13) and still below the HUD (z-index 20+).
 */
export const MAP_CHIP_Z: readonly [number, number] = [13, 0];
export const MAP_PICKED_Z: readonly [number, number] = [19, 14];
/** The zIndexRange of a place's label: the picked one above all the others. */
export const mapPlaceZRange = (picked: boolean): [number, number] => (picked ? [MAP_PICKED_Z[0], MAP_PICKED_Z[1]] : [MAP_CHIP_Z[0], MAP_CHIP_Z[1]]);

/**
 * drei's <Html> writes a label's z-index only when its projected position (or the zoom) changes, so a still map keeps the number it
 * computed under the OLD range when `picked` flips. The picked place's Html is therefore keyed by this: the flip remounts it and the
 * new range is computed at once.
 */
export const mapPlaceKey = (picked: boolean): string => (picked ? "picked" : "idle");
