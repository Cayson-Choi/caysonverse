import { describe, it, expect } from "vitest";
import { WALLS, ZONES, type AABB } from "@caysonverse/shared/worldMap";
import { MAZE_WALLS, MAZE_ZONE, MAZE_WALL_T } from "@caysonverse/shared/maze";
import {
  ZONE_WALL_COLORS,
  faceColors,
  isMazeLobbyBoundary,
  renderSegments,
  zoneAt,
} from "./wallColors";

const area = (b: AABB) => (b.maxX - b.minX) * (b.maxZ - b.minZ);
const overlap = (a: AABB, b: AABB) =>
  Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) *
  Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));

describe("zoneAt", () => {
  it("resolves each zone's centre to that zone", () => {
    for (const key of Object.keys(ZONES) as (keyof typeof ZONES)[]) {
      const z = ZONES[key];
      expect(zoneAt((z.minX + z.maxX) / 2, (z.minZ + z.maxZ) / 2)).toBe(key);
    }
  });

  it("returns null in the void beside the gallery annex", () => {
    // West of the gallery box and north of the maze/lounge band.
    expect(zoneAt(-40, -25)).toBe(null);
  });
});

describe("renderSegments (render-only split; collision walls stay whole)", () => {
  it("preserves each wall's exact area with non-overlapping segments inside it", () => {
    for (const wall of WALLS) {
      const segs = renderSegments(wall);
      const total = segs.reduce((s, b) => s + area(b), 0);
      expect(total).toBeCloseTo(area(wall), 9);
      for (const s of segs) expect(overlap(s, wall)).toBeCloseTo(area(s), 9);
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++) expect(overlap(segs[i], segs[j])).toBe(0);
    }
  });

  it("splits the full-width south wall at the maze and divider seams (3 rooms)", () => {
    const south = WALLS[0]; // z = +18 run across the whole map
    const segs = renderSegments(south);
    expect(segs).toHaveLength(3);
    const cuts = segs.map((s) => s.maxX).sort((a, b) => a - b);
    expect(cuts[0]).toBe(ZONES.lounge.minX);
    expect(cuts[1]).toBe(ZONES.lounge.maxX);
  });
});

describe("faceColors (a face is painted for the room that sees it)", () => {
  const dividerNorth = WALLS.find((w) => w.maxX < 1 && w.minX > -1 && w.maxZ <= 0)!;

  it("paints the divider hall-blue toward the hall and ivory toward the lounge", () => {
    const [px, nx] = faceColors(renderSegments(dividerNorth)[0]);
    expect(px).toBe(ZONE_WALL_COLORS.lectureHall); // +x face → lecture hall
    expect(nx).toBe(ZONE_WALL_COLORS.lounge); // -x face → lounge
  });

  it("paints the lounge/gallery north wall differently per side", () => {
    // North-wall piece in front of the gallery: gallery sand on -z, lounge ivory on +z.
    const northWest = WALLS[1];
    const seg = renderSegments(northWest).find((s) => s.maxX > ZONES.gallery.minX)!;
    const colors = faceColors(seg);
    expect(colors[4]).toBe(ZONE_WALL_COLORS.lounge); // +z face → lounge side
    expect(colors[5]).toBe(ZONE_WALL_COLORS.gallery); // -z face → gallery side
  });

  it("mirrors the room colour onto void-facing outer faces (never a stray hue)", () => {
    const outerWest = WALLS.find((w) => w.maxX <= MAZE_ZONE.minX)!;
    const [px, nx] = faceColors(renderSegments(outerWest)[0]);
    expect(px).toBe(ZONE_WALL_COLORS.maze); // inner face → maze
    expect(nx).toBe(px); // void face borrows the room colour
  });
});

describe("isMazeLobbyBoundary (미로 로비쪽 경계 — design 30 후속)", () => {
  const boundary = MAZE_WALLS.filter(isMazeLobbyBoundary);

  it("selects only walls sitting ON the maze's east line (x = -30)", () => {
    expect(boundary.length).toBeGreaterThanOrEqual(2); // door gap ⇒ at least two runs
    for (const w of boundary) {
      expect(w.minX).toBeGreaterThanOrEqual(MAZE_ZONE.maxX - MAZE_WALL_T);
      expect(w.maxX).toBeLessThanOrEqual(MAZE_ZONE.maxX + MAZE_WALL_T);
    }
  });

  it("keeps every interior wall (one cell further west or more) unselected", () => {
    for (const w of MAZE_WALLS.filter((x) => !isMazeLobbyBoundary(x))) {
      expect(w.minX).toBeLessThan(MAZE_ZONE.maxX - MAZE_WALL_T);
    }
  });

  it("gives the lobby-facing run a colour DIFFERENT from the maze interior", () => {
    expect(ZONE_WALL_COLORS.lounge).not.toBe(ZONE_WALL_COLORS.maze);
  });
});
