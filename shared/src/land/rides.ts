/**
 * 케이슨랜드's rides as one table (the server's boarding rules and the client's targets read it): id (`Player.rideId`), seats, the boarding pad,
 * and the schedule as a function of the wall clock. The ride itself (where its seats are at a moment) is each ride's own module
 * (coaster.ts, carousel.ts, wheel.ts).
 */
import { COASTER_SEATS, coasterAt } from "./coaster";
import { CAROUSEL_SEATS, carouselAt } from "./carousel";
import { WHEEL_SEATS, wheelAt } from "./wheel";
import { CAROUSEL_PAD, COASTER_BOARD_REACH_M, COASTER_QUEUE_PAD, WHEEL_PAD } from "../village/parkArea";

export const RIDE = { coaster: 1, carousel: 2, wheel: 3 } as const;
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
}

export const RIDES: readonly RideDef[] = Object.freeze([
  { id: RIDE.coaster, key: "coaster", name: "별똥별 급행", seats: COASTER_SEATS, pad: COASTER_QUEUE_PAD, reach: COASTER_BOARD_REACH_M, statusAt: (t: number): RideStatus => coasterAt(t) },
  { id: RIDE.carousel, key: "carousel", name: "달빛 회전목마", seats: CAROUSEL_SEATS, pad: CAROUSEL_PAD, reach: 6, statusAt: (t: number): RideStatus => carouselAt(t) },
  { id: RIDE.wheel, key: "wheel", name: "하늘 등불 바퀴", seats: WHEEL_SEATS, pad: WHEEL_PAD, reach: 6, statusAt: (t: number): RideStatus => wheelAt(t) },
]);

export function rideByKey(key: unknown): RideDef | null {
  return RIDES.find((r) => r.key === key) ?? null;
}
export function rideById(id: number): RideDef | null {
  return RIDES.find((r) => r.id === id) ?? null;
}
