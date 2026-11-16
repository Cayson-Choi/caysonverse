import { type AreaId, type VillageLayout } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { keypadEntryOf } from "@caysonverse/shared/village/buildingAccess";
import {
  ENTRY_SPAWN,
  EXIT_PAD,
  HOUSE_PLACES,
  STAIR_PLANS,
  HOUSE_STAIR_TYPE,
  padUsableFrom,
  parseHouseFloorArea,
  worldToLocal,
  type HousePad,
} from "@caysonverse/shared/village/houseAreas";

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
// 1.3 (round 5, 2026-11-15; was 0.9): the hall's spawn moved 1 m in from its door so the camera behind a new arrival has room
// (the player sees their own avatar), and a new arrival can still turn straight back out from where they stand.
export const DOOR_REACH_M = 1.3;

/**
 * Inside a building the way out is used only from in front of the door: at most this far (m) to either side of the door's
 * centre line (round 6 review, 2026-11-15: with the 1.3 m reach the lounge entrance, 1.2 m to the side and 2.37 m from the
 * pad, offered "밖으로 나가기" — an E press on the way to the sofas left the hall). The arrival spot (on the line) stays inside.
 */
export const DOOR_INSIDE_HALF_WIDTH_M = 0.8;

/** Per-client door-use cap: at most `count` accepted uses per `windowMs`. */
export const DOOR_RATE = { count: 1, windowMs: 1000 } as const;

/** The new place of a player who used a door. Yaw follows the game's `atan2(dirX, dirZ)` convention. */
export interface DoorArrival {
  area: AreaId;
  x: number;
  z: number;
  yaw: number;
}

/**
 * Village → hall: the inside spawn, facing into the room (the layout's `interior.spawn`).
 * Hall → village: the layout's `memorial.exterior.arrival` — south of the door pad, outside the building,
 * facing south (+z), away from it. Both places belong to the layout, not to this file.
 *
 * These are the NOMINAL spots. The room puts the player there only when it is free; with someone already standing
 * there it uses the nearest free spot beside it (shared/src/village/arrivalSpot.ts `spreadArrival`), so two visitors
 * through the door in the same second never appear inside each other.
 */
export function arrivalAfter(from: AreaId, layout: VillageLayout = VILLAGE_LAYOUT): DoorArrival {
  if (from === "village") {
    const { spawn } = layout.memorial.interior;
    return { area: "hall", x: spawn.x, z: spawn.z, yaw: spawn.yaw };
  }
  const { arrival } = layout.memorial.exterior;
  return { area: "village", x: arrival.x, z: arrival.z, yaw: arrival.yaw };
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
  // a house floor's way out and its stair have their own rules below (`useHouseExit`, `useStair`)
  if (area !== "village" && area !== "hall") return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const pad = area === "village" ? layout.memorial.exterior.doorPad : layout.memorial.interior.doorPad;
  const d = Math.hypot(x - pad.centre.x, z - pad.centre.z);
  if (d > pad.radius + DOOR_REACH_M) return null;
  // past the pad's edge inside a building: only straight in front of the door, on the room's side of it (the door is in the
  // south wall, the room to the north: −z) — round 7 review: the rule looked at the sideways offset alone
  if (area !== "village" && d > pad.radius && (Math.abs(x - pad.centre.x) > DOOR_INSIDE_HALF_WIDTH_M || z > pad.centre.z)) return null;
  return arrivalAfter(area, layout);
}

/** How far from the arrival spot inside a house (m) the way out is also accepted: the rescue of a house whose model would not load. */
export const HOUSE_ENTRY_RESCUE_M = 1.2;

/**
 * Where the way out of a house puts a player: on the porch in front of that house's door, facing away from it (the keypad entry's
 * `exit`, buildingAccess.ts), in the village. Null for a position that is not within reach of floor 1's exit pad
 * (`padUsableFrom`, houseAreas.ts: the same shape as the memorial door's inside rule), on any other area, or a non-finite position.
 */
export function useHouseExit(area: string, x: number, z: number): DoorArrival | null {
  const hit = parseHouseFloorArea(area);
  if (!hit || hit.floor !== 1) return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const local = worldToLocal(hit.n, 1, x, z);
  // from the arrival spot itself too (it is 2.2 m from the pad, out of its reach): a player whose house model would not load is sent back
  // out from where they arrived (the client gives up after 8 s, HouseEntryCover.tsx); nobody gains a way out they could not walk to
  const rescue = Math.hypot(local.x - ENTRY_SPAWN.x, local.z - ENTRY_SPAWN.z) <= HOUSE_ENTRY_RESCUE_M;
  if (!rescue && !padUsableFrom(EXIT_PAD as HousePad, local.x, local.z)) return null;
  const entry = keypadEntryOf(hit.buildingId);
  if (!entry) return null;
  return { area: "village", x: entry.exit.x, z: entry.exit.z, yaw: entry.exit.yaw };
}

/**
 * What using the stair does for a player standing at (x, z) on a house floor: floor 1's up pad → floor 2's arrival (the top of the stair,
 * looking into the room), floor 2's down pad → floor 1's arrival at the foot. `padUsableFrom` decides from the authoritative position
 * (the payload is never read). Null: not within reach of the pad, another area, or a non-finite position.
 */
export function useStair(area: string, x: number, z: number): DoorArrival | null {
  const hit = parseHouseFloorArea(area);
  if (!hit) return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const local = worldToLocal(hit.n, hit.floor, x, z);
  const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[hit.n]];
  const places = HOUSE_PLACES[hit.n];
  if (hit.floor === 1) {
    if (!padUsableFrom(plan.upPad, local.x, local.z)) return null;
    const to = places.spawnUp;
    return { area: to.area, x: to.x, z: to.z, yaw: to.yaw };
  }
  if (!padUsableFrom(plan.downPad, local.x, local.z)) return null;
  const to = places.spawnDown;
  return { area: to.area, x: to.x, z: to.z, yaw: to.yaw };
}
