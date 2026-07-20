/**
 * "AI 갤러리" — artwork placement data (design 25, re-curated by design 34: the
 * former 최무호 일대기 portraits were replaced with nine AI-painted works from
 * the owner's collection, titled by the curator). A PURE, client-only module
 * (no THREE, no React, no server contract — the server never knows artworks
 * exist; only the gallery WALLS are shared collision truth). Every anchor
 * derives from the shared GALLERY_ZONE, mirroring mazeLandmarks' single-source
 * discipline: the renderer (GalleryRoom.tsx) consumes these anchors verbatim,
 * and gallery.test.ts pins the on-wall / spacing / order invariants without
 * touching a scene graph.
 *
 * Curation (design 34): enter through the south door and walk the west wall
 * (기하학의 마을 → 별바다로 가는 문 → 원색의 왈츠), the far north wall (달빛
 * 아래 학과 모란 → 금빛 산수 dead ahead of the door as the focal wide piece →
 * 달빛 바다와 설산), then the east wall back to the door (꽃 피는 해안의 아침
 * → 별밤의 바이올린 → 안개 계곡의 정자).
 */

import type { AABB } from "@caysonverse/shared/collision";
import { GALLERY_ZONE } from "@caysonverse/shared/worldMap";

/** The exhibition room's display name (banner + lounge poster + persona). */
export const GALLERY_TITLE = "AI 갤러리";

/**
 * The nine AI-painted works, in VISIT order (west 3 → north 3 → east 3). The
 * curator titles were written after viewing each committed image; `aspect` is
 * the committed jpg's true width/height, so no canvas is ever stretched.
 */
export const ARTWORKS_DATA: readonly { file: string; title: string; aspect: number }[] = [
  { file: "art-1.jpg", title: "기하학의 마을", aspect: 1.0 },
  { file: "art-3.jpg", title: "별바다로 가는 문", aspect: 0.75 },
  { file: "art-2.jpg", title: "원색의 왈츠", aspect: 2.0 },
  { file: "art-4.jpg", title: "달빛 아래 학과 모란", aspect: 1.0 },
  { file: "art-5.jpg", title: "금빛 산수 — 소나무와 학", aspect: 1.778 },
  { file: "art-6.jpg", title: "달빛 바다와 설산", aspect: 1.499 },
  { file: "art-7.jpg", title: "꽃 피는 해안의 아침", aspect: 1.668 },
  { file: "art-8.jpg", title: "별밤의 바이올린", aspect: 0.8 },
  { file: "art-9.jpg", title: "안개 계곡의 정자", aspect: 0.667 },
];

/**
 * Canvas plane height (m) — one shared museum eye-line for every work; each
 * width follows its own aspect (clamped so a very wide piece can never touch
 * its neighbours given the thirds spacing below).
 */
export const PHOTO_H = 2.0;
export const PHOTO_MAX_W = 4.2;

/** Width (m) of one artwork plane: aspect-true at the shared height, capped. */
export function artworkWidth(aspect: number): number {
  return Math.min(PHOTO_H * aspect, PHOTO_MAX_W);
}

/** Photo centre height (m) — museum-style eye level for the chibi avatars. */
export const PHOTO_CENTER_Y = 1.8;

/** Frame border width beyond the canvas on every side (m). */
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
 * Title plaque quad (m) under each work — canvas-textured caption card. Wider
 * than the old age plaques (titles are sentences, not "N살"); the painter
 * shrinks the type to fit, so any title length stays inside the card.
 */
export const PLAQUE_W = 1.15;
export const PLAQUE_H = 0.28;
export const PLAQUE_CENTER_Y = 0.55;
export const PLAQUE_WALL_GAP = 0.03;

/** Banner/sign quads hug their wall by this gap (m) — same z-fight discipline. */
export const PANEL_WALL_GAP = 0.02;

/** The three exhibition walls, in viewing order. */
export type GalleryWall = "west" | "north" | "east";

/** One hung artwork: identity + its wall-face anchor and inward normal. */
export interface Artwork {
  /** Curator title (plaque text). */
  title: string;
  /** Public image URL (client/public/gallery). */
  url: string;
  /** Committed image aspect (width/height). */
  aspect: number;
  /** Plane width (m) at the shared PHOTO_H — aspect-true, capped. */
  w: number;
  /** Which exhibition wall it hangs on. */
  wall: GalleryWall;
  /** Canvas-centre anchor ON the wall's inner face line (y = PHOTO_CENTER_Y). */
  x: number;
  z: number;
  /** Outward (into-the-room) unit normal — offsets and facing derive from it. */
  nx: number;
  nz: number;
  /** Y-rotation aligning a +Z-normal plane with (nx, nz). */
  rotY: number;
}

/** A wall-mounted text panel (title banner) anchor. */
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
 * Derive the nine artwork anchors from the gallery zone. Pure and total: the
 * same zone always yields byte-identical placement (asserted by the tests), so
 * a future room resize re-hangs the whole exhibition with zero literal edits.
 */
export function buildArtworks(zone: AABB): Artwork[] {
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
    const { file, title, aspect } = ARTWORKS_DATA[i];
    return { title, url: `/gallery/${file}`, aspect, w: artworkWidth(aspect), ...slot };
  });
}

/**
 * The exhibition, derived ONCE at module load from the shared zone. Consumed by
 * GalleryRoom.tsx; identical on every client (pure data, no network).
 */
export const ARTWORKS: readonly Artwork[] = buildArtworks(GALLERY_ZONE);

/**
 * "AI 갤러리" title banner: high on the north wall, centred, facing the room —
 * visible the moment a visitor steps through the door. Its bottom edge
 * (y - h/2 = 3.0) clears the frame tops (2.92) so title and artworks never
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
