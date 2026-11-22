import { zoneLetter } from "@caysonverse/shared/village/villageLayout";

/**
 * "A구역 4단 12번" from a cubby id `M1-A-r3-c11` (rows counted from the bottom, both 1-based); "" for anything else. The zone is the
 * letter the hall's signs show (zoneLetter: A, B, C, D in walking order), not the id's bank letter.
 */
export function slotLabel(slotId: string | null | undefined): string {
  const m = /^M\d+-([A-Z])-r(\d+)-c(\d+)$/.exec(slotId ?? "");
  if (!m) return "";
  return `${zoneLetter(m[1]!)}구역 ${Number(m[2]) + 1}단 ${Number(m[3]) + 1}번`;
}
