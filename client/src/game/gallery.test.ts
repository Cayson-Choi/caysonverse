import { describe, it, expect } from "vitest";
import {
  GALLERY_ZONE,
  GALLERY_DOOR_X,
  WALL_HEIGHT,
} from "@caysonverse/shared/worldMap";
import {
  PORTRAITS,
  PORTRAIT_AGES,
  buildPortraits,
  PHOTO_W,
  PHOTO_H,
  PHOTO_CENTER_Y,
  FRAME_MARGIN,
  TITLE_BANNER,
} from "./gallery";

/** Frame half-extent along the wall run (photo half-width + border). */
const FRAME_HALF_ALONG = PHOTO_W / 2 + FRAME_MARGIN;
/** Frame top edge (photo half-height + border above the centre line). */
const FRAME_TOP_Y = PHOTO_CENTER_Y + PHOTO_H / 2 + FRAME_MARGIN;
const FRAME_BOTTOM_Y = PHOTO_CENTER_Y - PHOTO_H / 2 - FRAME_MARGIN;

const Z = GALLERY_ZONE;
const LZ = Z.maxZ - Z.minZ; // west/east wall run length (16)
const LX = Z.maxX - Z.minX; // north wall run length (18)

describe("gallery — chronological portrait data", () => {
  it("exposes exactly the nine milestone ages, in life order", () => {
    expect(PORTRAIT_AGES).toEqual([1, 4, 17, 28, 40, 60, 70, 80, 100]);
    expect(PORTRAITS.map((p) => p.age)).toEqual([...PORTRAIT_AGES]);
  });

  it("labels every portrait 'N살' and points at the committed jpg", () => {
    for (const p of PORTRAITS) {
      expect(p.label).toBe(`${p.age}살`);
      expect(p.url).toBe(`/gallery/age-${p.age}.jpg`);
    }
  });

  it("hangs 3 on the west, 3 on the north, 3 on the east wall — in that order", () => {
    expect(PORTRAITS.map((p) => p.wall)).toEqual([
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

  it("is a pure derivation: rebuilding from the zone reproduces PORTRAITS exactly", () => {
    expect(buildPortraits(GALLERY_ZONE)).toEqual([...PORTRAITS]);
  });
});

describe("gallery — placement geometry (on-wall, inward-facing)", () => {
  it("anchors every portrait exactly on its wall's inner face line", () => {
    for (const p of PORTRAITS) {
      if (p.wall === "west") expect(p.x).toBe(Z.minX);
      if (p.wall === "north") expect(p.z).toBe(Z.minZ);
      if (p.wall === "east") expect(p.x).toBe(Z.maxX);
    }
  });

  it("faces every portrait INTO the room (unit normal, rotY consistent with it)", () => {
    for (const p of PORTRAITS) {
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 10);
      // One metre along the normal must land strictly inside the zone.
      const px = p.x + p.nx;
      const pz = p.z + p.nz;
      expect(px).toBeGreaterThan(Z.minX);
      expect(px).toBeLessThan(Z.maxX);
      expect(pz).toBeGreaterThan(Z.minZ);
      expect(pz).toBeLessThan(Z.maxZ);
      // A +Z-normal plane rotated by rotY has normal (sin rotY, 0, cos rotY).
      expect(Math.sin(p.rotY)).toBeCloseTo(p.nx, 10);
      expect(Math.cos(p.rotY)).toBeCloseTo(p.nz, 10);
    }
  });

  it("keeps every frame fully on its wall, clear of the room corners", () => {
    const corner = 0.3; // clearance to the perpendicular walls
    for (const p of PORTRAITS) {
      if (p.wall === "north") {
        expect(p.x - FRAME_HALF_ALONG).toBeGreaterThanOrEqual(Z.minX + corner);
        expect(p.x + FRAME_HALF_ALONG).toBeLessThanOrEqual(Z.maxX - corner);
      } else {
        expect(p.z - FRAME_HALF_ALONG).toBeGreaterThanOrEqual(Z.minZ + corner);
        expect(p.z + FRAME_HALF_ALONG).toBeLessThanOrEqual(Z.maxZ - corner);
      }
    }
    // Vertically the frame sits between the floor and the wall top.
    expect(FRAME_TOP_Y).toBeLessThanOrEqual(WALL_HEIGHT);
    expect(FRAME_BOTTOM_Y).toBeGreaterThan(0);
  });

  it("spaces each wall's three portraits evenly, centred on the wall run", () => {
    const byWall: Record<string, number[]> = { west: [], north: [], east: [] };
    for (const p of PORTRAITS) byWall[p.wall].push(p.wall === "north" ? p.x : p.z);
    for (const wall of ["west", "north", "east"] as const) {
      const run = wall === "north" ? LX : LZ;
      const start = wall === "north" ? Z.minX : Z.minZ;
      const along = byWall[wall].map((v) => v - start).sort((a, b) => a - b);
      // Thirds pattern: centres at run·(1/6, 3/6, 5/6) — equal gaps, equal margins.
      expect(along[0]).toBeCloseTo(run / 6, 10);
      expect(along[1]).toBeCloseTo(run / 2, 10);
      expect(along[2]).toBeCloseTo((5 * run) / 6, 10);
    }
  });

  it("never lets two frames on one wall touch (gap > 0 between frame edges)", () => {
    const byWall: Record<string, number[]> = { west: [], north: [], east: [] };
    for (const p of PORTRAITS) byWall[p.wall].push(p.wall === "north" ? p.x : p.z);
    for (const centres of Object.values(byWall)) {
      const sorted = [...centres].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(2 * FRAME_HALF_ALONG);
      }
    }
  });

  it("walks chronologically counter-clockwise: door → west → north → east → door", () => {
    // Path coordinate along the viewing route (west wall southward first, then
    // north wall eastward, then east wall back toward the door): must strictly
    // increase with age, i.e. the visitor meets 1살 first and 100살 last.
    const s = PORTRAITS.map((p) => {
      if (p.wall === "west") return Z.maxZ - p.z;
      if (p.wall === "north") return LZ + (p.x - Z.minX);
      return LZ + LX + (p.z - Z.minZ);
    });
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
  });

  it("keeps the entrance wall clear: no frame within 1.5 m of the lounge opening", () => {
    for (const p of PORTRAITS) {
      if (p.wall === "north") continue; // the far wall — 16 m from the door
      expect(p.z + FRAME_HALF_ALONG).toBeLessThanOrEqual(Z.maxZ - 1.5);
    }
  });

  it("puts the middle north portrait dead ahead of the door (문 앞 시야 focal point)", () => {
    const north = PORTRAITS.filter((p) => p.wall === "north");
    expect(north[1].x).toBe(GALLERY_DOOR_X);
  });
});

describe("gallery — title banner and entrance sign anchors", () => {
  it("centres the title banner high on the north wall, facing into the room", () => {
    expect(TITLE_BANNER.z).toBe(Z.minZ); // anchored on the north wall face line
    expect(TITLE_BANNER.x).toBeCloseTo((Z.minX + Z.maxX) / 2, 10);
    expect(TITLE_BANNER.nx).toBe(0);
    expect(TITLE_BANNER.nz).toBe(1);
    // Above every frame, below the wall top — never overlapping the portraits.
    expect(TITLE_BANNER.y - TITLE_BANNER.h / 2).toBeGreaterThan(FRAME_TOP_Y);
    expect(TITLE_BANNER.y + TITLE_BANNER.h / 2).toBeLessThanOrEqual(WALL_HEIGHT);
    // Wide enough to read as a title, but on the wall with corner clearance.
    expect(TITLE_BANNER.w).toBeGreaterThanOrEqual(6);
    expect(TITLE_BANNER.w).toBeLessThanOrEqual(LX - 2);
  });

});
