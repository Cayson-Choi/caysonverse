import { VILLAGE_LAYOUT, type AreaId, type Disc, type VillageLayout } from "@caysonverse/shared/village/villageLayout";
import type { InteractTarget } from "../game/interact";

/**
 * What the village offers at a spot (케이슨 마을, Task 4) — pure: the scene hands it the local area and pose at
 * the context button's ~5 Hz pass and gets back the targets for the button and the E key. Today there is one
 * door, the memorial hall's, with two sides: "추모관 들어가기" outside, "밖으로 나가기" inside. Pressing it sends
 * `VillageMsg.UseDoor`; the server decides (villageDoor.ts) and teleports.
 *
 * The server accepts a door within the pad's radius plus 0.9 m of its centre. This offers it a little less
 * (`DOOR_OFFER_REACH_M`): our pose runs a few centimetres ahead of the one the server knows, so a button shown at
 * the very edge could be pressed just outside what the server accepts and be dropped without a word. Both
 * arrival points (the way out lands 2.2 m from the outside pad's centre, the way in 1.6 m from the inside one)
 * are still inside, so the button comes back after a door — a second press is possible once the server's
 * one-per-second cap has passed, which is fine.
 */

export const DOOR_LABEL: Readonly<Record<AreaId, string>> = { village: "추모관 들어가기", hall: "밖으로 나가기" };
/** The word for the 60 px round touch button. */
export const DOOR_SHORT: Readonly<Record<AreaId, string>> = { village: "들어가기", hall: "나가기" };
/** The target id of the memorial hall's door (both sides). */
export const MEMORIAL_DOOR_ID = "memorial_door";

/** How far past the pad's radius the button is offered (m). The server's own reach is 0.9 (villageDoor.ts DOOR_REACH_M). */
export const DOOR_OFFER_REACH_M = 0.7;

const NONE: readonly InteractTarget[] = Object.freeze([]);

/** The door pad a player in `area` uses: the building's front door outside, the way out inside. */
export function doorPadFor(area: AreaId, layout: VillageLayout = VILLAGE_LAYOUT): Disc {
  return area === "village" ? layout.memorial.exterior.doorPad : layout.memorial.interior.doorPad;
}

export function villageTargets(
  area: AreaId,
  x: number,
  z: number,
  layout: VillageLayout = VILLAGE_LAYOUT,
): readonly InteractTarget[] {
  const pad = doorPadFor(area, layout);
  const dist = Math.hypot(x - pad.centre.x, z - pad.centre.z);
  if (!(dist <= pad.radius + DOOR_OFFER_REACH_M)) return NONE; // also false for NaN
  return [{ kind: "door", id: MEMORIAL_DOOR_ID, dist, icon: "🚪", label: DOOR_LABEL[area], short: DOOR_SHORT[area] }];
}
