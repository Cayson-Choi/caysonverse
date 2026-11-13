/**
 * Visibility filter for remote avatars: 케이슨 마을 shows only the avatars of the area (village or memorial hall)
 * the local player is in (remoteSync / areaFilter).
 */

/**
 * What a change of "should this avatar be on screen" means for one that is (`shown`) or is not on screen:
 * "add" when a hidden player should now show, "remove" when a shown one should not, null when nothing changes
 * (also for a listener's immediate first call). The one rule behind every filter (the area).
 */
export function visibilityChange(shown: boolean, wanted: boolean): "add" | "remove" | null {
  if (wanted && !shown) return "add";
  if (!wanted && shown) return "remove";
  return null;
}
