import { TRANSIT, busTripAt } from "@caysonverse/shared/village/transit";
import { busBoardingDistance } from "@caysonverse/shared/village/villageLayout";
import { BUS_OFFER_REACH_M, busCountdownWords } from "./villageTargets";

/** How far outside the boarding area (m) the stop's timetable line shows: the board button's reach and a little more. */
export const BUS_HINT_REACH_M = BUS_OFFER_REACH_M + 1.2;

export interface BusStopHint {
  tone: "board" | "wait";
  text: string;
}

/**
 * The bus stop's line for a first-time player (review 2026-11-15: "the way to ride must never be hidden"): standing at
 * the stop, the pill says when the next bus leaves and how soon boarding opens (TRANSIT.boardingMs, 3 min before each
 * departure; owner 2026-11-15); while it is open it says to board now, by the bus (the board button, villageTargets.ts
 * villageBusTarget, always gives the shelter's bench the E key, so riders can wait seated and step to the bus to board).
 * On the bench this pill is how the timetable stays in sight. Null away from the stop and while riding.
 */
export function busStopHintAt(x: number, z: number, nowMs: number, boarded: boolean): BusStopHint | null {
  if (boarded) return null;
  if (!(busBoardingDistance(x, z) <= BUS_HINT_REACH_M)) return null;
  const trip = busTripAt(nowMs);
  if (trip.status === "boarding") {
    return { tone: "board", text: `지금 탈 수 있어요 · ${busCountdownWords(trip.startMs - nowMs).long} 뒤 출발 (버스 앞에서 E / 🚌)` };
  }
  const opensIn = busCountdownWords(trip.nextStartMs - TRANSIT.boardingMs - nowMs).long;
  return { tone: "wait", text: `다음 버스 ${busCountdownWords(trip.nextStartMs - nowMs).long} 뒤 출발 · ${opensIn} 뒤부터 탈 수 있어요` };
}
