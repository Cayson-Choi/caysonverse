/**
 * The village café's ground-floor front room, furnished at runtime (CafeInterior.tsx). The room itself (floor, walls, the
 * back bar, the counter with its machine and cake case, two bistro tables, three pendants, the menu board) is baked into
 * village.glb (art/village/tools/parts_cafe.py `cafe_interior`); this file places what the bake lacks. The café is never
 * walked into (its door is closed for good, `col__cafe`), so all of this is seen through the glass, and none of it takes a
 * collider, a seat or a click.
 *
 * Reference (research 2026-11-18, small Alsatian cafés and pâtisseries, Colmar and Riquewihr): an oak counter with a glass
 * pastry case, an espresso machine and kougelhopf on cake stands; open shelves of jars, cups and bread; a chalkboard menu;
 * round bistro tables with bentwood chairs; a banquette in Kelsch check along a window wall; brass and opal pendants over each
 * table; potted herbs and palms; exposed oak ceiling beams; a tiled entrance mat.
 *
 * Local frame = the café's own (parts_cafe.py `Frame`): x to the right seen from the front, z toward the door side (west),
 * y up. World = (50.6 - z, y, -15.1 + x); the café is `house("cafe", pt(50.6, -15.1), "wood", "w", "cafe")`.
 */
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";

const cafe = VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === "cafe")!;
export const CAFE_CENTRE = { x: cafe.centre.x, z: cafe.centre.z } as const;

/** The modelled room (local metres): the inner wall faces, the kitchen partition at the back and the ceiling. */
export const ROOM = { x0: -6.8, x1: 6.8, zBack: -4.1, zFront: 3.7, ceil: 4.3 } as const;

/** Local (x, z) to world (x, z). */
export function toWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: CAFE_CENTRE.x - lz, z: CAFE_CENTRE.z + lx };
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** What the bake already put on the floor (local rectangles, a little generous): new things keep clear of them. */
export const BAKED_FOOTPRINTS: readonly (Rect & { name: string })[] = [
  { name: "counter", x0: -5.24, x1: -0.16, z0: -2.42, z1: -1.7 },
  { name: "back bar", x0: -5.63, x1: 0.83, z0: -4.1, z1: -3.46 },
  { name: "table a", x0: 2.58, x1: 3.22, z0: -0.02, z1: 0.62 },
  { name: "table b", x0: 4.98, x1: 5.62, z0: -0.02, z1: 0.62 },
  { name: "chairs a", x0: 2.69, x1: 3.11, z0: -0.63, z1: 1.23 },
  { name: "chairs b", x0: 5.09, x1: 5.51, z0: -0.63, z1: 1.23 },
  { name: "fig by the door", x0: 1.55, x1: 2.05, z0: 2.9, z1: 3.4 },
  { name: "fig by the counter", x0: -6.55, x1: -6.05, z0: -1.45, z1: -0.95 },
  { name: "kitchen door", x0: 4.05, x1: 5.15, z0: -4.1, z1: -3.9 },
];

/** A round bistro table (top radius, m). */
export const TABLE_RADIUS = 0.33;
/** How far a chair's centre stands from its table's centre (m): the bake's own (cafe_interior uses 0.72). */
export const CHAIR_DIST = 0.72;

export interface TableSpot {
  x: number;
  z: number;
  /** Which sides have a chair: the chair's centre is at this angle (rad, from +x toward +z) and CHAIR_DIST. */
  chairs: readonly number[];
  /** The pendant over it: "dome" (brass) or "globe" (opal glass). */
  lamp: "dome" | "globe";
}

const PI = Math.PI;
/** The new tables (the bake's two at x 2.9 and 5.3, z 0.3, take pendants too: EXTRA_PENDANTS). */
export const TABLES: readonly TableSpot[] = [
  { x: -5.75, z: 0.85, chairs: [0], lamp: "globe" }, // the banquette's two tables: one chair each, the wall side is the bench
  { x: -5.75, z: 2.2, chairs: [0], lamp: "globe" },
  { x: -3.4, z: 2.2, chairs: [-PI / 2, PI / 2], lamp: "dome" },
  { x: -1.7, z: 1.3, chairs: [-PI / 2, PI / 2], lamp: "globe" },
  { x: 4.1, z: 2.6, chairs: [-PI / 2, PI / 2], lamp: "dome" },
];

/** Pendants over the bake's own two tables (their tops are 0.78 m up; the shade's lower rim 1.25 m over them). */
export const EXTRA_PENDANTS: readonly { x: number; z: number; lamp: "dome" | "globe" }[] = [
  { x: 2.9, z: 0.3, lamp: "dome" },
  { x: 5.3, z: 0.3, lamp: "globe" },
];

/** The shade's lowest point over the floor (m). */
export const PENDANT_Y = 2.05;

/** The baked pendants (parts_cafe.py: three brass domes over the counter at z -2.074, their bulb 2.2 m up): lights for the new surfaces. */
export const BAKED_PENDANTS: readonly { x: number; z: number }[] = [-4.3, -2.7, -1.1].map((x) => ({ x, z: -2.07 }));

/** The banquette along the left wall (Kelsch-check seat and back, an oak base). Depth 0.55 m from the wall. */
export const BANQUETTE: Rect & { depth: number } = { x0: -6.8, x1: -6.25, z0: 0.25, z1: 2.95, depth: 0.55 };

/** The open shelf unit right of the kitchen door. */
export const SHELF_UNIT: Rect & { height: number } = { x0: 5.45, x1: 6.7, z0: -4.1, z1: -3.8, height: 2.3 };

/** Exposed oak ceiling beams (across the room along x, local z of each). */
export const BEAMS_Z: readonly number[] = [-3.2, -1.0, 1.2, 3.4];

/** The entrance's tile mat. */
export const TILE_MAT: Rect = { x0: -1.25, x1: 1.25, z0: 2.45, z1: 3.7 };

/** The chalkboard on the right wall and the framed prints on the left. */
export const CHALKBOARD = { wall: 6.8, z0: -1.4, z1: -0.1, y0: 1.15, y1: 2.5 } as const;

export function tableChairs(t: TableSpot): { x: number; z: number; yaw: number }[] {
  return t.chairs.map((a) => {
    const x = t.x + Math.cos(a) * CHAIR_DIST;
    const z = t.z + Math.sin(a) * CHAIR_DIST;
    // the chair faces the table: yaw about +y so the chair's +z (its front) points at the table
    return { x, z, yaw: Math.atan2(t.x - x, t.z - z) };
  });
}

/** Every pendant (the new ones), local (x, z) and its kind. */
export function allNewPendants(): { x: number; z: number; lamp: "dome" | "globe" }[] {
  return [...TABLES.map((t) => ({ x: t.x, z: t.z, lamp: t.lamp })), ...EXTRA_PENDANTS];
}

/** The lamp positions the shading reads (local x, y, z): the baked pendants (bulb at 2.2) and the new ones (bulb near the rim). */
export function lampPositions(): { x: number; y: number; z: number }[] {
  return [...BAKED_PENDANTS.map((p) => ({ x: p.x, y: 2.2, z: p.z })), ...allNewPendants().map((p) => ({ x: p.x, y: PENDANT_Y + 0.12, z: p.z }))];
}
