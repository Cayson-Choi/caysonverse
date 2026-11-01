/**
 * The school hub: a 28 x 24 m central hall (중앙 홀) with an east corridor (동쪽 복도) of
 * doors that lead to the escape rooms. Single source of truth for the hub's layout —
 * zones, spawn, team area, gates, door pads and the collision geometry — read by the
 * server (movement checks, pad/team rules) and the client (collision, camera, HUD, scene).
 *
 * Browser-safe and data-driven: plain numbers plus the shared collision types. North is -z.
 *
 * Layout: the hall is x -14..14, z -12..12. A 6 m doorway (z -3..3) in its east wall opens
 * into the corridor (x 14..48, z -3..3). The room doors sit in the corridor's long walls:
 * counsel (north, x 22), library (south, x 22), broadcast (north, x 38), career (south, x 38).
 * The progress board hangs on the hall's north wall; the team area is in the hall's west half.
 *
 * The east gate is shut until the teacher starts the class; the west opening (the next
 * stage's corridor) is sealed for good in this phase.
 */

import type { AABB } from "../collision";
import type { RoomId } from "../escape/constants";
import { HUB_PROP_COLLIDERS } from "./generated/hubColliders";
import { makeGeometry, wallsAround } from "./geometry";
import type { Bounds, MapGeometry } from "./geometry";

/** The central hall. */
export const HALL: AABB = { minX: -14, maxX: 14, minZ: -12, maxZ: 12 };
/** The corridor that runs east from the hall; the room doors line its north and south walls. */
export const EAST_CORRIDOR: AABB = { minX: 14, maxX: 48, minZ: -3, maxZ: 3 };
/** Bounding box of hall + corridor: the area the server lets a player move in. */
export const HUB_BOUNDS: Bounds = { minX: -14, maxX: 48, minZ: -12, maxZ: 12 };

/** Where players appear (plus a random offset of up to `HUB_SPAWN_JITTER` m). */
export const HUB_SPAWN = { x: 0, z: 6 } as const;
export const HUB_SPAWN_JITTER = 2;

/**
 * The team-building area (a rug) in the hall's west half. No obstacle may overlap it (a test
 * pins that): the rug itself has no collider, and the sign stand goes just OUTSIDE the zone.
 */
export const TEAM_ZONE: AABB = { minX: -12, maxX: -5, minZ: 1, maxZ: 9 };

/** Shut until the teacher starts the class: blocks the hall's east opening. */
export const EAST_GATE: AABB = { minX: 13.75, maxX: 14.25, minZ: -3, maxZ: 3 };
/** Blocks the hall's west opening (the next stage's corridor) in this phase, always. */
export const WEST_SEAL: AABB = { minX: -14.25, maxX: -13.75, minZ: -3, maxZ: 3 };
/** The school-model progress board on the hall's north wall. */
export const PROGRESS_BOARD: AABB = { minX: -4, maxX: 4, minZ: -12, maxZ: -11 };

/**
 * One room door on the corridor wall. The team stands on `pad` (a floor mat inside the
 * corridor in front of the door) to enter; `returnPoint` (the pad's centre) is where the
 * team reappears in the hub after leaving the room.
 */
export interface HubDoor {
  room: RoomId;
  side: "n" | "s";
  /** Door centre along the corridor (x). */
  x: number;
  pad: AABB;
  returnPoint: { x: number; z: number };
}

/** Pad half-width along the corridor (m). */
const PAD_HALF_WIDTH = 1.5;
/** A pad's z range, measured from the corridor centre line: from its near edge to its far edge.
 *  The far edge is inset PLAYER_RADIUS (0.4) from the corridor wall at |z| = 3. */
const PAD_NEAR_Z = 0.8;
const PAD_FAR_Z = 2.6;

function makeDoor(room: RoomId, side: "n" | "s", x: number): HubDoor {
  const sign = side === "n" ? -1 : 1;
  const pad: AABB = {
    minX: x - PAD_HALF_WIDTH,
    maxX: x + PAD_HALF_WIDTH,
    minZ: Math.min(sign * PAD_NEAR_Z, sign * PAD_FAR_Z),
    maxZ: Math.max(sign * PAD_NEAR_Z, sign * PAD_FAR_Z),
  };
  return { room, side, x, pad, returnPoint: { x, z: (pad.minZ + pad.maxZ) / 2 } };
}

/** counsel (north, x 22), library (south, x 22), broadcast (north, x 38), career (south, x 38). */
export const HUB_DOORS: readonly HubDoor[] = [
  makeDoor("counsel", "n", 22),
  makeDoor("library", "s", 22),
  makeDoor("broadcast", "n", 38),
  makeDoor("career", "s", 38),
];

/**
 * The hall's and the corridor's walls. The hall's east wall and the corridor's west wall both
 * leave the 6 m doorway z -3..3; the corridor's north and south walls overlap the hall's east
 * wall near the doorway on purpose (overlap is what keeps the shell watertight).
 */
export const HUB_WALLS: readonly AABB[] = [
  ...wallsAround(HALL, [
    { side: "e", from: -3, to: 3 },
    { side: "w", from: -3, to: 3 },
  ]),
  ...wallsAround(EAST_CORRIDOR, [{ side: "w", from: -3, to: 3 }]),
];

/** Walls, the west seal, the progress board and the generated prop boxes; the east gate is open. */
export const HUB_GEOMETRY_OPEN: MapGeometry = makeGeometry(
  "hub-open",
  HUB_BOUNDS,
  [...HUB_WALLS, WEST_SEAL],
  [PROGRESS_BOARD, ...HUB_PROP_COLLIDERS],
);

/** The open geometry plus the shut east gate (before the teacher starts the class). */
export const HUB_GEOMETRY_GATED: MapGeometry = makeGeometry(
  "hub-gated",
  HUB_BOUNDS,
  [...HUB_WALLS, WEST_SEAL, EAST_GATE],
  [PROGRESS_BOARD, ...HUB_PROP_COLLIDERS],
);

/** The hub geometry for the gate's state. Returns one of two prebuilt objects (no allocation). */
export function hubGeometry(gateOpen: boolean): MapGeometry {
  return gateOpen ? HUB_GEOMETRY_OPEN : HUB_GEOMETRY_GATED;
}

function within(box: AABB, x: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

/** The room whose door pad contains the point, or null (pads are disjoint). */
export function doorAtPad(x: number, z: number): RoomId | null {
  for (const d of HUB_DOORS) {
    if (within(d.pad, x, z)) return d.room;
  }
  return null;
}

/** True when the point is inside the team area widened by `margin` m on every side. */
export function inTeamZone(x: number, z: number, margin = 0.5): boolean {
  return (
    x >= TEAM_ZONE.minX - margin &&
    x <= TEAM_ZONE.maxX + margin &&
    z >= TEAM_ZONE.minZ - margin &&
    z <= TEAM_ZONE.maxZ + margin
  );
}

/** HUD place name for a hub position: "중앙 홀", "동쪽 복도", or "" outside both. */
export function hubZoneLabel(x: number, z: number): string {
  if (within(HALL, x, z)) return "중앙 홀";
  if (within(EAST_CORRIDOR, x, z)) return "동쪽 복도";
  return "";
}
