import { describe, it, expect } from "vitest";
import {
  GALLERY_ZONE,
  GALLERY_DOOR_X,
  WALL_HEIGHT,
} from "@caysonverse/shared/worldMap";
import {
  ARTWORKS,
  ARTWORKS_DATA,
  buildArtworks,
  artworkWidth,
  GALLERY_TITLE,
  PHOTO_H,
  PHOTO_MAX_W,
  PHOTO_CENTER_Y,
  FRAME_MARGIN,
  TITLE_BANNER,
} from "./gallery";

/** Frame half-extent along the wall run for one work (half-width + border). */
const frameHalf = (w: number) => w / 2 + FRAME_MARGIN;
/** Frame top edge (canvas half-height + border above the centre line). */
const FRAME_TOP_Y = PHOTO_CENTER_Y + PHOTO_H / 2 + FRAME_MARGIN;
const FRAME_BOTTOM_Y = PHOTO_CENTER_Y - PHOTO_H / 2 - FRAME_MARGIN;

const Z = GALLERY_ZONE;
const LZ = Z.maxZ - Z.minZ; // west/east wall run length (16)
const LX = Z.maxX - Z.minX; // north wall run length (18)

describe("AI 갤러리 — artwork data (design 34)", () => {
  it("exposes exactly the nine curated works, in visit order", () => {
    expect(ARTWORKS_DATA).toHaveLength(9);
    expect(ARTWORKS.map((a) => a.title)).toEqual(ARTWORKS_DATA.map((d) => d.title));
    // Every committed art file appears exactly once.
    const files = ARTWORKS.map((a) => a.url).sort();
    expect(files).toEqual(
      Array.from({ length: 9 }, (_, i) => `/gallery/art-${i + 1}.jpg`).sort(),
    );
  });

  it("gives every work a Korean curator title and an aspect-true width", () => {
    for (const a of ARTWORKS) {
      expect(a.title.length).toBeGreaterThanOrEqual(4);
      expect(a.aspect).toBeGreaterThan(0.5);
      expect(a.aspect).toBeLessThanOrEqual(2.0);
      expect(a.w).toBeCloseTo(artworkWidth(a.aspect), 10);
      expect(a.w).toBeLessThanOrEqual(PHOTO_MAX_W);
      expect(a.w).toBeGreaterThan(0.9);
    }
  });

  it("hangs 3 on the west, 3 on the north, 3 on the east wall — in that order", () => {
    expect(ARTWORKS.map((a) => a.wall)).toEqual([
      "west",
      "west",
      "west",
      "north",
      "north",
      "north",
      "east",
      "east",
      "east",
    ]);
  });

  it("is a pure derivation: rebuilding from the zone reproduces ARTWORKS exactly", () => {
    expect(buildArtworks(GALLERY_ZONE)).toEqual([...ARTWORKS]);
  });
});

describe("AI 갤러리 — placement geometry (on-wall, inward-facing)", () => {
  it("anchors every work exactly on its wall's inner face line", () => {
    for (const a of ARTWORKS) {
      if (a.wall === "west") expect(a.x).toBe(Z.minX);
      if (a.wall === "north") expect(a.z).toBe(Z.minZ);
      if (a.wall === "east") expect(a.x).toBe(Z.maxX);
    }
  });

  it("faces every work INTO the room (unit normal, rotY consistent with it)", () => {
    for (const a of ARTWORKS) {
      expect(Math.hypot(a.nx, a.nz)).toBeCloseTo(1, 10);
      const px = a.x + a.nx;
      const pz = a.z + a.nz;
      expect(px).toBeGreaterThan(Z.minX);
      expect(px).toBeLessThan(Z.maxX);
      expect(pz).toBeGreaterThan(Z.minZ);
      expect(pz).toBeLessThan(Z.maxZ);
      expect(Math.sin(a.rotY)).toBeCloseTo(a.nx, 10);
      expect(Math.cos(a.rotY)).toBeCloseTo(a.nz, 10);
    }
  });

  it("keeps every frame fully on its wall, clear of the room corners", () => {
    const corner = 0.3; // clearance to the perpendicular walls
    for (const a of ARTWORKS) {
      const half = frameHalf(a.w);
      if (a.wall === "north") {
        expect(a.x - half).toBeGreaterThanOrEqual(Z.minX + corner);
        expect(a.x + half).toBeLessThanOrEqual(Z.maxX - corner);
      } else {
        expect(a.z - half).toBeGreaterThanOrEqual(Z.minZ + corner);
        expect(a.z + half).toBeLessThanOrEqual(Z.maxZ - corner);
      }
    }
    expect(FRAME_TOP_Y).toBeLessThanOrEqual(WALL_HEIGHT);
    expect(FRAME_BOTTOM_Y).toBeGreaterThan(0);
  });

  it("spaces each wall's three works evenly, centred on the wall run", () => {
    const byWall: Record<string, number[]> = { west: [], north: [], east: [] };
    for (const a of ARTWORKS) byWall[a.wall].push(a.wall === "north" ? a.x : a.z);
    for (const wall of ["west", "north", "east"] as const) {
      const run = wall === "north" ? LX : LZ;
      const start = wall === "north" ? Z.minX : Z.minZ;
      const along = byWall[wall].map((v) => v - start).sort((a, b) => a - b);
      expect(along[0]).toBeCloseTo(run / 6, 10);
      expect(along[1]).toBeCloseTo(run / 2, 10);
      expect(along[2]).toBeCloseTo((5 * run) / 6, 10);
    }
  });

  it("never lets two frames on one wall touch — even with aspect-true widths", () => {
    const byWall: Record<string, { at: number; half: number }[]> = {
      west: [],
      north: [],
      east: [],
    };
    for (const a of ARTWORKS)
      byWall[a.wall].push({ at: a.wall === "north" ? a.x : a.z, half: frameHalf(a.w) });
    for (const items of Object.values(byWall)) {
      const sorted = [...items].sort((p, q) => p.at - q.at);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].at - sorted[i - 1].at - sorted[i].half - sorted[i - 1].half;
        expect(gap).toBeGreaterThan(0.3);
      }
    }
  });

  it("keeps the entrance wall clear: no frame within 1.5 m of the lounge opening", () => {
    for (const a of ARTWORKS) {
      if (a.wall === "north") continue; // the far wall — 16 m from the door
      expect(a.z + frameHalf(a.w)).toBeLessThanOrEqual(Z.maxZ - 1.5);
    }
  });

  it("puts the middle north work dead ahead of the door (문 앞 시야 focal point)", () => {
    const north = ARTWORKS.filter((a) => a.wall === "north");
    expect(north[1].x).toBe(GALLERY_DOOR_X);
    // The focal slot carries the widest piece of the exhibition (금빛 산수).
    expect(north[1].title).toContain("금빛 산수");
  });
});

describe("AI 갤러리 — title banner", () => {
  it("names the room AI 갤러리 (발주자 요청 — design 34)", () => {
    expect(GALLERY_TITLE).toBe("AI 갤러리");
  });

  it("centres the title banner high on the north wall, facing into the room", () => {
    expect(TITLE_BANNER.z).toBe(Z.minZ);
    expect(TITLE_BANNER.x).toBeCloseTo((Z.minX + Z.maxX) / 2, 10);
    expect(TITLE_BANNER.nx).toBe(0);
    expect(TITLE_BANNER.nz).toBe(1);
    expect(TITLE_BANNER.y - TITLE_BANNER.h / 2).toBeGreaterThan(FRAME_TOP_Y);
    expect(TITLE_BANNER.y + TITLE_BANNER.h / 2).toBeLessThanOrEqual(WALL_HEIGHT);
    expect(TITLE_BANNER.w).toBeGreaterThanOrEqual(6);
    expect(TITLE_BANNER.w).toBeLessThanOrEqual(LX - 2);
  });
});
