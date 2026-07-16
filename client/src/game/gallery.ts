/**
 * "최무호 일대기" gallery — portrait placement data (design 25). A PURE,
 * client-only module (no THREE, no React, no server contract — the server never
 * knows portraits exist; only the gallery WALLS are shared collision truth).
 * Every anchor derives from the shared GALLERY_ZONE, mirroring mazeLandmarks'
 * single-source discipline: the renderer (GalleryRoom.tsx) consumes these
 * anchors verbatim, and gallery.test.ts pins the on-wall / spacing / life-order
 * invariants without touching a scene graph.
 *
 * Curation (design 25): nine life-milestone portraits hang in CHRONOLOGICAL
 * counter-clockwise order — enter through the south door, read the west wall
 * top-to-bottom of life's first act (1·4·17), the far north wall (28·40·60,
 * with 40살 dead ahead of the door as the focal point), and the east wall walks
 * you back to the door through 70·80·100.
 */

import type { AABB } from "@caysonverse/shared/collision";
import { GALLERY_ZONE } from "@caysonverse/shared/worldMap";

/** The nine milestone ages, in life order — one committed jpg each. */
export const PORTRAIT_AGES: readonly number[] = [1, 4, 17, 28, 40, 60, 70, 80, 100];

/** Photo plane size (m). 1.6 × 2.0 keeps the committed 819×1024 jpg's 4:5 ratio. */
export const PHOTO_W = 1.6;
export const PHOTO_H = 2.0;

/** Photo centre height (m) — museum-style eye level for the chibi avatars. */
export const PHOTO_CENTER_Y = 1.8;

/** Frame border width beyond the photo on every side (m). */
export const FRAME_MARGIN = 0.12;

/** Frame depth off the wall (m) — a real moulding, not a decal. */
export const FRAME_DEPTH = 0.06;

/**
 * Wall-face gaps (m), plaque-precedent z-fight discipline (mazeLandmarks 0.02):
 * the frame ring starts 0.03 off the wall (spanning 0.03–0.09), and the photo
 * plane floats at 0.05 — INSIDE the ring's opening, recessed from its front
 * face like a canvas in a real moulding, never coplanar with wall or frame.
 */
export const FRAME_WALL_GAP = 0.03;
export const PHOTO_WALL_GAP = 0.05;

/**
 * Age plaque quad (m) under each photo — canvas-textured "N살" card. Sized up
 * slightly from the design sketch (~0.5×0.22) after the E2E screenshots showed
 * the label unreadable at tour distance (~9 m); its top edge meets the frame's
 * bottom rail (0.685 ≈ 0.68) like a museum caption.
 */
export const PLAQUE_W = 0.62;
export const PLAQUE_H = 0.27;
export const PLAQUE_CENTER_Y = 0.55;
export const PLAQUE_WALL_GAP = 0.03;

/** Banner/sign quads hug their wall by this gap (m) — same z-fight discipline. */
export const PANEL_WALL_GAP = 0.02;

/** The three exhibition walls, in viewing order. */
export type GalleryWall = "west" | "north" | "east";

/** One hung portrait: identity + its wall-face anchor and inward normal. */
export interface Portrait {
  /** Milestone age (PORTRAIT_AGES entry). */
  age: number;
  /** Korean plaque text ("1살" … "100살"). */
  label: string;
  /** Public photo URL (client/public/gallery). */
  url: string;
  /** Which exhibition wall it hangs on. */
  wall: GalleryWall;
  /** Photo-centre anchor ON the wall's inner face line (y = PHOTO_CENTER_Y). */
  x: number;
  z: number;
  /** Outward (into-the-room) unit normal — offsets and facing derive from it. */
  nx: number;
  nz: number;
  /** Y-rotation aligning a +Z-normal plane with (nx, nz). */
  rotY: number;
}

/** A wall-mounted text panel (title banner / entrance sign) anchor. */
export interface WallPanel {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Outward unit normal of the face it hangs on. */
  nx: number;
  nz: number;
  /** Y-rotation aligning a +Z-normal plane with (nx, nz). */
  rotY: number;
}

/** Centres for three even slots on a run of `length`: length·(1/6, 3/6, 5/6). */
function thirds(start: number, length: number): [number, number, number] {
  return [start + length / 6, start + length / 2, start + (5 * length) / 6];
}

/**
 * Derive the nine portrait anchors from the gallery zone. Pure and total: the
 * same zone always yields byte-identical placement (asserted by the tests), so
 * a future room resize re-hangs the whole exhibition with zero literal edits.
 */
export function buildPortraits(zone: AABB): Portrait[] {
  const runZ = zone.maxZ - zone.minZ;
  const runX = zone.maxX - zone.minX;

  // West wall: door side → far corner (z decreasing); normal +X; plane +Z→+X.
  const west = thirds(zone.minZ, runZ)
    .reverse()
    .map((z) => ({ wall: "west" as const, x: zone.minX, z, nx: 1, nz: 0, rotY: Math.PI / 2 }));
  // North wall: west → east (x increasing); normal +Z (into the room); rotY 0.
  const north = thirds(zone.minX, runX).map((x) => ({
    wall: "north" as const,
    x,
    z: zone.minZ,
    nx: 0,
    nz: 1,
    rotY: 0,
  }));
  // East wall: far corner → door side (z increasing); normal -X; plane +Z→-X.
  const east = thirds(zone.minZ, runZ).map((z) => ({
    wall: "east" as const,
    x: zone.maxX,
    z,
    nx: -1,
    nz: 0,
    rotY: -Math.PI / 2,
  }));

  return [...west, ...north, ...east].map((slot, i) => {
    const age = PORTRAIT_AGES[i];
    return { age, label: `${age}살`, url: `/gallery/age-${age}.jpg`, ...slot };
  });
}

/**
 * The exhibition, derived ONCE at module load from the shared zone. Consumed by
 * GalleryRoom.tsx; identical on every client (pure data, no network).
 */
export const PORTRAITS: readonly Portrait[] = buildPortraits(GALLERY_ZONE);

/**
 * "최무호 일대기" title banner: high on the north wall, centred, facing the
 * room — visible the moment a visitor steps through the door. Its bottom edge
 * (y - h/2 = 3.0) clears the frame tops (2.92) so title and portraits never
 * overlap even on the shared north wall.
 */
export const TITLE_BANNER: WallPanel = {
  x: (GALLERY_ZONE.minX + GALLERY_ZONE.maxX) / 2,
  y: 3.45,
  z: GALLERY_ZONE.minZ,
  w: 9,
  h: 0.9,
  nx: 0,
  nz: 1,
  rotY: 0,
};

