import { TRANSIT, boardingOpensWords, busTripAt, type BusTrip } from "@caysonverse/shared/village/transit";
import { busBoardingDistance } from "@caysonverse/shared/village/villageLayout";
import { BUS_CAPACITY } from "@caysonverse/shared/village/busCabin";
import { BUS_OFFER_REACH_M, busCountdownWords } from "./villageTargets";

/** Bus v3: the stop's line names the places left once this few remain (a full bus says so instead of "board now"). */
export const BUS_HINT_SPACE_FROM = 10;

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
export function busStopHintAt(
  x: number,
  z: number,
  nowMs: number,
  boarded: boolean,
  tripAt: (ms: number) => BusTrip = busTripAt,
  touch = false,
  aboard = 0,
): BusStopHint | null {
  if (boarded) return null;
  if (!(busBoardingDistance(x, z) <= BUS_HINT_REACH_M)) return null;
  const trip = tripAt(nowMs);
  // a phone has no E key: the round 🚌 button is how it boards (review 2026-11-15); bus v3 QA: every line says how
  const how = touch ? "버스 앞에서 🚌 버튼" : "버스 앞에서 E";
  if (trip.status === "boarding") {
    const left = BUS_CAPACITY - aboard;
    // bus v3 (owner 2026-11-16): only as many as the bus holds; a full one says so (the server refuses the next rider)
    if (left <= 0) return { tone: "wait", text: `버스가 가득 찼어요 · 다음 버스를 기다려 주세요` };
    const space = left <= BUS_HINT_SPACE_FROM ? ` · 남은 자리 ${left}` : "";
    return { tone: "board", text: `지금 탈 수 있어요 · ${busCountdownWords(trip.startMs - nowMs).long} 뒤 출발${space} (${how})` };
  }
  if (trip.status === "inTransit") {
    // "약 N분": just after the departure the exact whole-minute countdown rounded UP to a full cycle ("10분 뒤" 40 s after it left)
    const left = Math.max(0, trip.nextStartMs - nowMs);
    const words = left > TRANSIT.boardingMs ? `약 ${Math.max(1, Math.round(left / 60000))}분` : busCountdownWords(left).long;
    // bus v3 QA: said positively (when the next one leaves), not that this one has gone
    return { tone: "wait", text: `다음 버스는 ${words} 뒤 출발해요 · 출발 ${boardingOpensWords()} 전부터 탈 수 있어요 (${how})` };
  }
  // one countdown only (review 2026-11-15: a second, rounded one for the boarding window disagreed with the first)
  return { tone: "wait", text: `다음 버스는 ${busCountdownWords(trip.nextStartMs - nowMs).long} 뒤 출발해요 · 출발 ${boardingOpensWords()} 전부터 탈 수 있어요 (${how})` };
}

/**
 * The pill's change gate: true when `hint` differs from the one shown last (publish it). It starts from "nothing decided
 * yet", so the first sample is always published — also a null one (review 2026-11-15: the pill kept "지금 탈 수 있어요" all
 * ride: after boarding its effect restarted with `last = ""`, the null's key "" equalled it and the line never cleared).
 */
export function createHintGate(): (hint: BusStopHint | null) => boolean {
  let last: string | null = null;
  return (hint) => {
    const key = hint ? `${hint.tone}|${hint.text}` : "";
    if (key === last) return false;
    last = key;
    return true;
  };
}
