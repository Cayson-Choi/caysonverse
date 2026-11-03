import { VILLAGE_LAYOUT, boxAt, type PlotId, type Side, type VillageLayout, type VillagePlot } from "@caysonverse/shared/village/villageLayout";

/**
 * The signs on the village's building plots (케이슨 마을, Task 4) — pure, from the layout. An empty plot has a
 * sign post (`signPost`: where it stands inside the plot and the way it faces, toward the plaza) and a sign
 * ("곧 지어져요") next to the name of what is planned there ("도서관"), shown as "곧 지어져요 · 도서관". The plot where
 * a building is going up (`underConstruction`: the library) says "공사 중" instead. The memorial hall's plot is
 * built already and has neither marker nor sign (`sign` and `signPost` are null).
 */

/** What a plot's sign says while its building is going up (the layout's `sign` is "곧 지어져요" for every empty plot). */
export const SIGN_UNDER_CONSTRUCTION = "공사 중";

/** Yaw of a plane that faces `side` (0 faces +z / south, PI faces north, PI/2 faces east): `atan2(dirX, dirZ)`. */
export function sideYaw(side: Side): number {
  switch (side) {
    case "s":
      return 0;
    case "n":
      return Math.PI;
    case "e":
      return Math.PI / 2;
    case "w":
      return -Math.PI / 2;
  }
}

type SignWords = Pick<VillagePlot, "sign" | "label" | "underConstruction">;

/** The two lines of a plot's sign (status, then the planned building), or null for a plot with no sign. */
export function plotSignLines(plot: SignWords): [string, string] | null {
  if (plot.sign === null) return null;
  return [plot.underConstruction ? SIGN_UNDER_CONSTRUCTION : plot.sign, plot.label];
}

/** The sign as one line, "곧 지어져요 · 도서관" (or null). */
export function plotSignText(plot: SignWords): string | null {
  const lines = plotSignLines(plot);
  return lines === null ? null : lines.join(" · ");
}

/** One plot marker: the glow outline's rectangle, and the sign with where it stands. */
export interface PlotMarkerSpec {
  id: PlotId;
  /** The plot's rectangle. */
  rect: ReturnType<typeof boxAt>;
  lines: [string, string];
  text: string;
  underConstruction: boolean;
  /** Where the sign post stands. */
  post: { x: number; z: number };
  /** Yaw the sign faces. */
  yaw: number;
}

/** Every plot that has a marker and a sign, from the layout (the built memorial plot is left out). */
export function plotMarkerSpecs(layout: VillageLayout = VILLAGE_LAYOUT): PlotMarkerSpec[] {
  const out: PlotMarkerSpec[] = [];
  for (const plot of layout.plots) {
    const lines = plotSignLines(plot);
    if (lines === null || plot.signPost === null) continue;
    out.push({
      id: plot.id,
      rect: boxAt(plot.centre, plot.size),
      lines,
      text: lines.join(" · "),
      underConstruction: plot.underConstruction,
      post: { x: plot.signPost.x, z: plot.signPost.z },
      yaw: sideYaw(plot.signPost.facing),
    });
  }
  return out;
}
