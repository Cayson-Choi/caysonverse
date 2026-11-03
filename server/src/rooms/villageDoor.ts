import type { AreaId, VillageLayout } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";

/**
 * Pure door rules of 케이슨 마을 (clock-free, room-free, so they stay unit-testable): where a player may use
 * a door and where the door puts them. The room owns the timing (the 1-per-second cap) and the writes.
 *
 * The memorial hall has ONE door with two sides. From the village it is the front door of the building
 * (`memorial.exterior.doorPad`); from inside it is the way out (`memorial.interior.doorPad`). The two areas
 * share one coordinate space, hundreds of metres apart, and nobody can walk between them — a validated door
 * use is the only way across, and it is a teleport.
 */

/** How far past a door pad's edge a player may still use the door (m): a pad radius + this. */
export const DOOR_REACH_M = 0.9;

/** Per-client door-use cap: at most `count` accepted uses per `windowMs`. */
export const DOOR_RATE = { count: 1, windowMs: 1000 } as const;

/** Where the outside arrival is put, beyond the pad's edge (m): pad centre + radius + this, south of the door. */
export const OUTSIDE_ARRIVAL_GAP_M = 0.6;

/** Yaw that faces south (+z), away from the memorial building's south door: atan2(0, 1) = 0. */
const FACING_SOUTH = Math.atan2(0, 1);

/** The new place of a player who used a door. Yaw follows the game's `atan2(dirX, dirZ)` convention. */
export interface DoorArrival {
  area: AreaId;
  x: number;
  z: number;
  yaw: number;
}

/**
 * Village → hall: the inside spawn, facing into the room (the layout's `interior.spawn`).
 * Hall → village: just outside the memorial's door pad (south of it, its centre + radius + 0.6 m, so
 * (0, -33.4) in the current layout), facing south (+z), away from the building.
 */
export function arrivalAfter(from: AreaId, layout: VillageLayout = VILLAGE_LAYOUT): DoorArrival {
  if (from === "village") {
    const { spawn } = layout.memorial.interior;
    return { area: "hall", x: spawn.x, z: spawn.z, yaw: spawn.yaw };
  }
  const pad = layout.memorial.exterior.doorPad;
  return {
    area: "village",
    x: pad.centre.x,
    z: pad.centre.z + pad.radius + OUTSIDE_ARRIVAL_GAP_M,
    yaw: FACING_SOUTH,
  };
}

/** The door pad a player in `area` uses: the building's front door outside, the way out inside. */
function padFor(area: AreaId, layout: VillageLayout) {
  return area === "village" ? layout.memorial.exterior.doorPad : layout.memorial.interior.doorPad;
}

/**
 * What using the door does for a player standing at (x, z) in `area`: the arrival, or `null` when the
 * request must be dropped — an unknown area, a non-finite position, or farther from the door pad's centre
 * than the pad radius + `DOOR_REACH_M`.
 */
export function useDoor(
  area: string,
  x: number,
  z: number,
  layout: VillageLayout = VILLAGE_LAYOUT,
): DoorArrival | null {
  if (area !== "village" && area !== "hall") return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const pad = padFor(area, layout);
  if (Math.hypot(x - pad.centre.x, z - pad.centre.z) > pad.radius + DOOR_REACH_M) return null;
  return arrivalAfter(area, layout);
}
