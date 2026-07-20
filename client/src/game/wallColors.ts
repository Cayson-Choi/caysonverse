/**
 * Per-room wall colours (design 30 후속): every room's walls read in that room's
 * own colour, so a wall face takes the colour of the ZONE you see it from. Pure
 * data/geometry helpers — the WorldMap render consumes them; collision (WALLS /
 * OBSTACLES) is untouched, this is render-only.
 *
 * Mechanics: a shared wall sits BETWEEN two rooms (the lounge/hall divider, the
 * lounge/gallery north wall), so its two side faces get different materials via
 * boxGeometry's 6 face groups. Walls that RUN THROUGH several rooms along their
 * length (the full-width south wall crosses maze→lounge→hall) are split into
 * per-room render segments first, so each segment borders one zone per face.
 */

import { ZONES, type AABB } from "@caysonverse/shared/worldMap";
import { MAZE_ZONE, MAZE_WALL_T } from "@caysonverse/shared/maze";

export type ZoneKey = keyof typeof ZONES;

/** Bright architectural wall paint per room (design 30 palette family). */
export const ZONE_WALL_COLORS: Record<ZoneKey, string> = {
  lounge: "#ece6da", // warm ivory plaster
  lectureHall: "#d8e2ec", // pale study blue
  gallery: "#ead9bd", // warm exhibition sand
  maze: "#d8d4e4", // lavender-grey stone (matches the maze's interior walls)
};

/** Faces that look into no zone (world exterior) — invisible; ivory is fine. */
export const FALLBACK_WALL_COLOR = ZONE_WALL_COLORS.lounge;

const ZONE_KEYS = Object.keys(ZONES) as ZoneKey[];

/** The zone containing (x, z), or null (void / outside the playable map). */
export function zoneAt(x: number, z: number): ZoneKey | null {
  for (const key of ZONE_KEYS) {
    const zn = ZONES[key];
    if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return key;
  }
  return null;
}

/**
 * Room-boundary lines that walls RUN THROUGH lengthwise: the maze/lounge seam
 * (x = -30), the lounge/hall divider line (x = 0) and the lounge/gallery seam
 * (z = -18). A wall is split at any of these that fall strictly inside it, so
 * every render segment touches exactly one room per side.
 */
const SPLIT_X = [ZONES.lounge.minX, ZONES.lounge.maxX];
const SPLIT_Z = [ZONES.lounge.minZ];

function splitAxis(boxes: AABB[], axis: "x" | "z", lines: number[]): AABB[] {
  const [lo, hi] = axis === "x" ? (["minX", "maxX"] as const) : (["minZ", "maxZ"] as const);
  let out = boxes;
  for (const line of lines) {
    out = out.flatMap((b) =>
      line > b[lo] && line < b[hi]
        ? [
            { ...b, [hi]: line },
            { ...b, [lo]: line },
          ]
        : [b],
    );
  }
  return out;
}

/** Render-only segmentation of one collision wall (collision stays whole). */
export function renderSegments(wall: AABB): AABB[] {
  return splitAxis(splitAxis([wall], "x", SPLIT_X), "z", SPLIT_Z);
}

/**
 * Probe distance (m) outside a face when asking "which room sees this face?".
 * Larger than any wall thickness (rooms 0.5, maze 0.3) so the sample lands in
 * open room space, small enough to stay inside a 2 m-wide maze corridor.
 */
const PROBE = 0.75;

/**
 * Face colours for one render segment, in boxGeometry group order
 * [+x, -x, +y(top), -y(bottom), +z, -z]. Each side face is painted for the zone
 * just outside it; a face looking into the void borrows the opposite face's
 * room (it is only ever seen from there via overview edges). The top face —
 * what the overview actually shows — prefers the non-lounge adjacent room, so
 * the overview reads as a colour-coded floor plan.
 */
export function faceColors(seg: AABB): [string, string, string, string, string, string] {
  const cx = (seg.minX + seg.maxX) / 2;
  const cz = (seg.minZ + seg.maxZ) / 2;
  const sides = {
    px: zoneAt(seg.maxX + PROBE, cz),
    nx: zoneAt(seg.minX - PROBE, cz),
    pz: zoneAt(cx, seg.maxZ + PROBE),
    nz: zoneAt(cx, seg.minZ - PROBE),
  };
  const found = [sides.px, sides.nx, sides.pz, sides.nz].filter(
    (zone): zone is ZoneKey => zone !== null,
  );
  const anyRoom = found.find((zone) => zone !== "lounge") ?? found[0];
  const paint = (own: ZoneKey | null, opposite: ZoneKey | null): string =>
    ZONE_WALL_COLORS[own ?? opposite ?? anyRoom] ?? FALLBACK_WALL_COLOR;
  const top = ZONE_WALL_COLORS[anyRoom] ?? FALLBACK_WALL_COLOR;
  return [
    paint(sides.px, sides.nx),
    paint(sides.nx, sides.px),
    top,
    top,
    paint(sides.pz, sides.nz),
    paint(sides.nz, sides.pz),
  ];
}

/**
 * True for maze walls on the maze's EAST perimeter line (x = -30) — the run the
 * LOBBY sees (its single gap is the lounge's west door). These are painted in
 * the lounge's ivory so, per the owner's request, the wall you see from the
 * lobby is NOT the colour of the maze interior. Only vertical runs sit ON the
 * line; interior lines are a full cell (2.4 m) further west.
 */
export function isMazeLobbyBoundary(wall: AABB): boolean {
  return wall.minX >= MAZE_ZONE.maxX - MAZE_WALL_T;
}
