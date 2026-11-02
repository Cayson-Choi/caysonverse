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
 * What a `place` change means for an avatar that is (`shown`) or is not on screen: "add" when
 * a hidden player is back in the hall, "remove" when a shown one went into a classroom, null
 * when nothing changes (also for the listener's immediate first call).
 */
export function placeTransition(shown: boolean, place: number): "add" | "remove" | null {
  const inHall = showsInHub(place);
  if (inHall && !shown) return "add";
  if (!inHall && shown) return "remove";
  return null;
}
