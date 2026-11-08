/**
 * When the village needs its night light map (final fix, review I2 b and the Task 10 byte ruling): only when night is
 * near. The map is ~250 KB on the wire and ~22 MB decoded on the GPU; by day nobody sees it.
 *
 * "Near" = the night blend (`phaseAt`, sunClock.ts) is above 0 now or will be within `NIGHT_MAP_LEAD_MS`. The blend
 * starts while the sun is still +8° up (about 45 min before sunset) and ends when it is back at +8° after sunrise, so
 * the window runs from roughly 75 min before sunset to 45 min after sunrise: it contains "30 minutes before sunset until
 * sunrise" and also the dawn ramp, where the night map still shows.
 *
 * DEV override: `setNightMapOverride(true | false)` (and the clock's `?time=` pin, which moves `nowMs`); null = the
 * clock decides.
 */
import { useEffect, useState } from "react";
import { phaseAt, sunAt } from "@caysonverse/shared/village/sunClock";
import { villageClock } from "./villageClock";

/** How far ahead the map is fetched before the night blend starts. */
export const NIGHT_MAP_LEAD_MS = 30 * 60 * 1000;
/** How often the hook re-reads the clock. */
export const NIGHT_MAP_CHECK_MS = 15 * 1000;

let override: boolean | null = null;
const listeners = new Set<() => void>();

/** Force the night map on or off (DEV probes, e2e), or give the decision back to the clock (null). */
export function setNightMapOverride(v: boolean | null): void {
  override = v;
  for (const l of [...listeners]) l();
}

const nightAt = (utcMs: number): number => phaseAt(sunAt(utcMs).elevationDeg).night;

/** Whether the night light map should be loaded at `utcMs` (ignores the override). */
export function nightMapWantedAt(utcMs: number): boolean {
  return nightAt(utcMs) > 0 || nightAt(utcMs + NIGHT_MAP_LEAD_MS) > 0;
}

/** The decision now: the override, else the village clock. */
export function nightMapWanted(nowMs: number = villageClock.nowMs()): boolean {
  return override ?? nightMapWantedAt(nowMs);
}

/** React: true while the night light map should be loaded (re-read every `NIGHT_MAP_CHECK_MS` and on an override). */
export function useNightMapWanted(): boolean {
  const [wanted, setWanted] = useState(() => nightMapWanted());
  useEffect(() => {
    const check = () => setWanted(nightMapWanted());
    check();
    listeners.add(check);
    const id = setInterval(check, NIGHT_MAP_CHECK_MS);
    return () => {
      listeners.delete(check);
      clearInterval(id);
    };
  }, []);
  return wanted;
}
