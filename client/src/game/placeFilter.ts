/**
 * Who the hall shows (AI 학교 탈출, Task 15). A class member inside a team classroom
 * (`Player.place === PLACE_ESCAPE`) stays in the class state — the teacher's lists still
 * have them — but is not in the hall: remoteSync takes their avatar out while they are
 * inside and puts it back, at their current position, when they come out.
 *
 * In the legacy world and in a classroom every player's place is PLACE_HUB (the schema
 * default), so the filter changes nothing there.
 */

import { PLACE_HUB } from "@caysonverse/shared/escape/constants";

/** True when a player at `place` is in the hall (and so has an avatar there). */
export function showsInHub(place: number): boolean {
  return place === PLACE_HUB;
}

/**
 * What a change of "should this avatar be on screen" means for one that is (`shown`) or is not on screen:
 * "add" when a hidden player should now show, "remove" when a shown one should not, null when nothing changes
 * (also for a listener's immediate first call). The one rule behind every filter (place, and in 케이슨 마을 the area).
 */
export function visibilityChange(shown: boolean, wanted: boolean): "add" | "remove" | null {
  if (wanted && !shown) return "add";
  if (!wanted && shown) return "remove";
  return null;
}

/**
 * What a `place` change means for an avatar that is (`shown`) or is not on screen: "add" when
 * a hidden player is back in the hall, "remove" when a shown one went into a classroom, null
 * when nothing changes (also for the listener's immediate first call).
 */
export function placeTransition(shown: boolean, place: number): "add" | "remove" | null {
  return visibilityChange(shown, showsInHub(place));
}
