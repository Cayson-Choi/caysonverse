/**
 * Where the 별똥별 급행's track-local origin (the station's middle, on the track's centre line) sits in the village, in metres.
 * PHASE 1 (temporary): the test entry replaces the village with a bare sandbox (a lawn, a sky and the coaster), with the platform beside the
 * spawn point; phase 2 puts the whole park (its own area / room, DESIGN.md section 3) around it and this becomes the park-local site.
 */
export const COASTER_SITE = { x: -6, z: 4 } as const;

/** The temporary test entry (DESIGN.md §9): `?land=coaster` in the address shows the coaster, its boarding button and the ride panel. */
export function coasterEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("land") === "coaster";
  } catch {
    return false;
  }
}
