/**
 * 케이슨랜드's rides as one table (the server's boarding rules and the client's targets read it): id (`Player.rideId`), seats, the boarding pad,
 * and the schedule as a function of the wall clock. The ride itself (where its seats are at a moment) is each ride's own module
 * (coaster.ts, carousel.ts, wheel.ts).
 */
import { COASTER_SEATS, coasterAt } from "./coaster";
import { CAROUSEL_SEATS, carouselAt } from "./carousel";
import { DROP_SEATS, dropAt, dropCanLeave } from "./dropTower";
import { WHEEL_RIDE_CYCLES, WHEEL_SEATS, boardingSeatsOfWheel, wheelAt, wheelSeatAtPlatform } from "./wheel";
import { MOON_BOAT_SEATS, moonBoatAt } from "./moonBoat";
import { CAROUSEL_PAD, COASTER_BOARD_REACH_M, COASTER_PAD, DROP_PAD, MOON_BOAT_PAD, WHEEL_PAD } from "../village/parkArea";

/** How far (m) past a ride's boarding pad the "board" prompt is offered: the press walks to the pad and boards (client/src/land/rideBoard.ts). */
export const RIDE_PROMPT_RANGE_M = 45;

export const RIDE = { coaster: 1, carousel: 2, wheel: 3, moonboat: 4, droptower: 5 } as const;
export type RideKey = keyof typeof RIDE;
export type RideStatusName = "unloading" | "boarding" | "gate" | "riding";

export interface RideStatus {
  status: RideStatusName;
  cycle: number;
  /** ms since the cycle began */
  phase: number;
  departsInMs: number;
}

export interface RideDef {
  id: number;
  key: RideKey;
  /** the Korean name, for the HUD */
  name: string;
  seats: number;
  pad: { x: number; z: number; radius: number };
  /** how far past the pad's edge a rider may stand to board (m) */
  reach: number;
  statusAt(nowMs: number): RideStatus;
  /** how many cycles a ride lasts (default 1: put off when the next cycle begins) */
  rideCycles?: number;
  /** the seats a boarding rider may take now (default: any free seat) */
  boardingSeats?(nowMs: number): readonly number[];
  /** whether a rider on `seat` may get off now (default: always) */
  canLeave?(seat: number, nowMs: number): boolean;
}

export const RIDES: readonly RideDef[] = Object.freeze([
  { id: RIDE.coaster, key: "coaster", name: "별똥별 급행", seats: COASTER_SEATS, pad: COASTER_PAD, reach: COASTER_BOARD_REACH_M, statusAt: (t: number): RideStatus => coasterAt(t) },
  { id: RIDE.carousel, key: "carousel", name: "달빛 회전목마", seats: CAROUSEL_SEATS, pad: CAROUSEL_PAD, reach: 6, statusAt: (t: number): RideStatus => carouselAt(t) },
  { id: RIDE.wheel, key: "wheel", name: "하늘 등불 바퀴", seats: WHEEL_SEATS, pad: WHEEL_PAD, reach: 6, statusAt: (t: number): RideStatus => wheelAt(t), rideCycles: WHEEL_RIDE_CYCLES, boardingSeats: boardingSeatsOfWheel, canLeave: wheelSeatAtPlatform },
  { id: RIDE.moonboat, key: "moonboat", name: "달배", seats: MOON_BOAT_SEATS, pad: MOON_BOAT_PAD, reach: 6, statusAt: (t: number): RideStatus => moonBoatAt(t) },
  { id: RIDE.droptower, key: "droptower", name: "구름 낙하탑", seats: DROP_SEATS, pad: DROP_PAD, reach: 6, statusAt: (t: number): RideStatus => dropAt(t), canLeave: dropCanLeave },
]);

export function rideByKey(key: unknown): RideDef | null {
  return RIDES.find((r) => r.key === key) ?? null;
}
export function rideById(id: number): RideDef | null {
  return RIDES.find((r) => r.id === id) ?? null;
}

/**
 * ms until the ride next takes riders (0 while it is boarding now): for the "다음 탑승까지 N초" countdown and a reserved seat's wait. Scans the
 * schedule in 500 ms steps (at most `maxMs`, default 6 min); null when it does not open within that.
 */
export function msUntilBoarding(ride: RideDef, nowMs: number, maxMs = 360_000): number | null {
  for (let dt = 0; dt <= maxMs; dt += 500) if (ride.statusAt(nowMs + dt).status === "boarding") return dt;
  return null;
}

/**
 * A short fingerprint of every ride's timetable (cycle length, the unload / boarding / gate / riding windows, the wheel's steps): the server sends it
 * with its clock, and a client whose own timetable differs (the server and the page were deployed at different times: a train on a 136 s cycle
 * against a server on a 130 s one) refuses to board instead of being seated or put off at the wrong moment (owner 2026-11-20: "열차가 도착하기도
 * 전에 타버린다", "타 끝나기도 전에 내려버린다"). Samples every ride's status every 1.7 s over 10 minutes from a fixed instant.
 */
let scheduleKey: string | null = null;
export function rideScheduleKey(): string {
  if (scheduleKey !== null) return scheduleKey;
  let h = 2166136261;
  const t0 = 1_900_000_000_000;
  for (const r of RIDES) {
    for (let dt = 0; dt < 600_000; dt += 1700) {
      const st = r.statusAt(t0 + dt);
      const code = `${r.id}${st.status}${st.cycle - r.statusAt(t0).cycle}${Math.round(st.phase / 100)}`;
      for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619) >>> 0;
    }
  }
  scheduleKey = h.toString(16);
  return scheduleKey;
}
