/**
 * Single source of truth for the world map: bounds, zones, spawn, furniture
 * placements, the derived collision OBSTACLES, and the lecture-hall screen.
 *
 * Browser-safe and data-driven: it imports ONLY the `AABB` type (no THREE, no
 * @colyseus/schema, no clocks), so the client scene renders from it, the client
 * collision resolver and the server drop-check both collide against the SAME
 * `OBSTACLES`, and there is exactly one place a map literal ever lives.
 *
 * Layout (60 m × 36 m, split by a walled divider at x = 0 with a central door):
 *
 *        z=-18 ┌───────────────── divider ──────────────────┐ z=-18
 *              │  LOUNGE (warm)      │ ▓  LECTURE HALL (cool) │
 *              │    sofas / table    │ ▓   desks → ▐screen▌   │
 *   x=-30 ─────┤        · spawn ·    ◘ (door)   lectern       ├───── x=30
 *              │    plants           │ ▓   bookcases (N wall) │
 *        z=+18 └─────────────────────┴───────────────────────┘ z=+18
 *                west half (x<0)        east half (x>0)
 */

import type { AABB } from "./collision";

export type { AABB };

/** Player collision radius (m) — the circle both sides resolve against. */
export const PLAYER_RADIUS = 0.4;

/** Playable area bounds (final). Walls sit on these lines; the divider is at x=0. */
export const WORLD_BOUNDS = { minX: -30, maxX: 30, minZ: -18, maxZ: 18 } as const;

/** Named zones (AABBs) for ground styling and future zone features. */
export const ZONES: Readonly<Record<"lounge" | "lectureHall", AABB>> = {
  lounge: { minX: -30, maxX: 0, minZ: -18, maxZ: 18 },
  lectureHall: { minX: 0, maxX: 30, minZ: -18, maxZ: 18 },
};

/** Spawn origin — centre of the lounge, kept clear of furniture + jitter. */
export const SPAWN_POINT = { x: -15, z: 0 } as const;

/** Random spawn radius (m) so simultaneous joiners don't stack. */
export const SPAWN_JITTER = 2;

// ─────────────────────────────── Walls ────────────────────────────────

const WALL_THICKNESS = 0.5;
/** Half-width (m) of the door opening in the divider, centred on z = 0. */
const DOOR_HALF_WIDTH = 2;
const B = WORLD_BOUNDS;
const T = WALL_THICKNESS;

/**
 * Wall AABBs = collision truth AND render geometry (the scene draws a box per
 * wall). Outer walls sit just OUTSIDE each bound (inner face exactly on the
 * bound) so the whole playable rectangle stays usable; the divider at x = 0 is
 * two segments leaving a `2·DOOR_HALF_WIDTH` gap toward the lounge.
 */
export const WALLS: readonly AABB[] = [
  { minX: B.minX - T, maxX: B.maxX + T, minZ: B.maxZ, maxZ: B.maxZ + T }, // north
  { minX: B.minX - T, maxX: B.maxX + T, minZ: B.minZ - T, maxZ: B.minZ }, // south
  { minX: B.minX - T, maxX: B.minX, minZ: B.minZ, maxZ: B.maxZ }, // west
  { minX: B.maxX, maxX: B.maxX + T, minZ: B.minZ, maxZ: B.maxZ }, // east
  { minX: -T / 2, maxX: T / 2, minZ: B.minZ, maxZ: -DOOR_HALF_WIDTH }, // divider, south of door
  { minX: -T / 2, maxX: T / 2, minZ: DOOR_HALF_WIDTH, maxZ: B.maxZ }, // divider, north of door
];

/** Height (m) of every wall box in the scene. */
export const WALL_HEIGHT = 4;

// ─────────────────────────── Lecture-hall screen ───────────────────────────

/**
 * The big screen on the east wall (a dark box with a slightly emissive face;
 * v2 screen-share placeholder). `depth` runs along X, `width` along Z, `height`
 * along Y; `y` is the box centre height. It also contributes one obstacle.
 */
export const SCREEN = {
  x: 29.6,
  z: 0,
  y: 2.2,
  width: 9,
  height: 3.2,
  depth: 0.3,
} as const;

function screenObstacle(): AABB {
  return {
    minX: SCREEN.x - SCREEN.depth / 2,
    maxX: SCREEN.x + SCREEN.depth / 2,
    minZ: SCREEN.z - SCREEN.width / 2,
    maxZ: SCREEN.z + SCREEN.width / 2,
  };
}

// ──────────────────────────────── Furniture ────────────────────────────────

/** Uniform up-scale applied to every Kenney model (kit models are ~0.5× life). */
export const FURNITURE_SCALE = 2.2;

/** Public path prefix for the curated furniture GLBs. */
export const FURNITURE_URL_BASE = "/models/furniture/";

/** Per-model geometry, measured from the source GLB (unscaled, metres). */
export interface FurnitureModel {
  /** Unscaled bounding-box size on X and Z. */
  sizeX: number;
  sizeZ: number;
  /** Unscaled bounding-box centre offset (re-centred so a placement point ===
   *  its footprint centre, regardless of the model's own origin). */
  cx: number;
  cz: number;
  /** Whether the model contributes a collision obstacle (flat/thin decor = false). */
  solid: boolean;
}

/**
 * The curated Kenney Furniture Kit models (CC0). The record KEY is the model id
 * used in `FURNITURE`, and its GLB is `${FURNITURE_URL_BASE}${key}.glb`. Sizes
 * come from parsing each GLB's node hierarchy (see models/furniture/LICENSE.md).
 */
export const FURNITURE_MODELS = {
  loungeSofa: { sizeX: 0.98, sizeZ: 0.41, cx: 0.49, cz: -0.205, solid: true },
  loungeSofaLong: { sizeX: 0.98, sizeZ: 0.82, cx: 0.49, cz: 0.0, solid: true },
  tableCoffee: { sizeX: 0.661, sizeZ: 0.4, cx: -0.13, cz: -0.1, solid: true },
  rugRectangle: { sizeX: 1.57, sizeZ: 0.92, cx: 0.785, cz: -0.46, solid: false },
  pottedPlant: { sizeX: 0.212, sizeZ: 0.241, cx: 0.0, cz: 0.0, solid: true },
  lampSquareFloor: { sizeX: 0.12, sizeZ: 0.12, cx: 0.06, cz: -0.06, solid: false },
  desk: { sizeX: 0.734, sizeZ: 0.392, cx: 0.357, cz: -0.184, solid: true },
  chairDesk: { sizeX: 0.335, sizeZ: 0.314, cx: 0.167, cz: -0.157, solid: true },
  bookcaseClosedWide: { sizeX: 0.8, sizeZ: 0.25, cx: 0.4, cz: -0.125, solid: true },
} as const satisfies Record<string, FurnitureModel>;

export type FurnitureModelId = keyof typeof FURNITURE_MODELS;

/** One furniture placement: model id, ground position, and yaw. */
export interface Furniture {
  model: FurnitureModelId;
  x: number;
  z: number;
  /** Yaw (rad) about Y. Any angle is supported; footprints stay exact. */
  rotY: number;
}

const HALF_PI = Math.PI / 2;

// Build the classroom's student desk+chair grid: rows recede from the screen,
// columns straddle a central aisle aligned with the door (z = 0).
function classroomSeating(): Furniture[] {
  const rowsX = [9, 14, 19];
  const colsZ = [-9, -3, 3, 9];
  const out: Furniture[] = [];
  for (const x of rowsX) {
    for (const z of colsZ) {
      out.push({ model: "desk", x, z, rotY: -HALF_PI }); // desk faces the screen (+X)
      out.push({ model: "chairDesk", x: x - 1.3, z, rotY: -HALF_PI }); // student behind it
    }
  }
  return out;
}

/**
 * All furniture placements. Lounge (west) is authored explicitly; the lecture
 * hall (east) mixes an authored instructor area + bookcases with the generated
 * student grid. Rotations are 90° multiples but any angle would stay exact.
 */
export const FURNITURE: readonly Furniture[] = [
  // ── Lounge (x < 0) ──
  { model: "loungeSofa", x: -15, z: -7, rotY: 0 }, // faces spawn; the E2E collision target
  { model: "rugRectangle", x: -22, z: 0, rotY: 0 }, // decorative floor rug (non-solid)
  { model: "loungeSofaLong", x: -26, z: 0, rotY: HALF_PI }, // against the west wall
  { model: "tableCoffee", x: -22, z: 0, rotY: 0 },
  { model: "loungeSofa", x: -22, z: -5, rotY: 0 }, // north of the coffee table
  { model: "loungeSofa", x: -22, z: 5, rotY: Math.PI }, // south of the coffee table
  { model: "lampSquareFloor", x: -28, z: 10, rotY: 0 }, // corner lamp (non-solid)
  { model: "pottedPlant", x: -28, z: -14, rotY: 0 }, // SW corner greenery
  { model: "pottedPlant", x: -3, z: 6, rotY: 0 }, // frames the door (lounge side, north)
  { model: "pottedPlant", x: -3, z: -6, rotY: 0 }, // frames the door (lounge side, south)

  // ── Lecture hall (x > 0) ──
  { model: "desk", x: 25, z: 0, rotY: -HALF_PI }, // instructor desk, faces the class
  { model: "chairDesk", x: 26.2, z: 0, rotY: -HALF_PI }, // instructor chair
  { model: "bookcaseClosedWide", x: 8, z: 17, rotY: Math.PI }, // against the north wall
  { model: "bookcaseClosedWide", x: 20, z: 17, rotY: Math.PI },
  ...classroomSeating(),
];

// ──────────────────────────── Derived obstacles ────────────────────────────

function halfExtents(m: FurnitureModel, rotY: number): { ex: number; ez: number } {
  const hx = (m.sizeX / 2) * FURNITURE_SCALE;
  const hz = (m.sizeZ / 2) * FURNITURE_SCALE;
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  // Exact AABB of the rotated footprint rectangle (valid for ANY yaw).
  return { ex: c * hx + s * hz, ez: s * hx + c * hz };
}

/** The scaled, rotated, floor-plane footprint AABB of one furniture placement. */
export function furnitureObstacle(p: Furniture): AABB {
  const m = FURNITURE_MODELS[p.model];
  const { ex, ez } = halfExtents(m, p.rotY);
  return { minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez };
}

/**
 * Every collision obstacle, derived at module load: solid furniture footprints
 * + walls + the screen. Both the client slide resolver and the server drop
 * check import THIS array — no obstacle literal is ever duplicated.
 */
export const OBSTACLES: readonly AABB[] = [
  ...FURNITURE.filter((p) => FURNITURE_MODELS[p.model].solid).map(furnitureObstacle),
  ...WALLS,
  screenObstacle(),
];
