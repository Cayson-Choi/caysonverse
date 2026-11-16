/**
 * Every seat of the village room: the village's own (`VILLAGE_SEATS`, indexes unchanged) followed by the fishing lake's 56 seats
 * (`lakeSeats()`: the 30 fishing chairs in spot order, benches, picnic benches, pavilion boards, porch benches). `Player.seatIndex`
 * counts in this list wherever it is used: the client's active map (activeMap.ts) already does; the server's sit validation must use
 * the same list (chunk E states it here because lakeLayout.ts imports benchSeats.ts, so VILLAGE_SEATS itself cannot hold the lake).
 */
import { VILLAGE_SEATS, type VillageSeat } from "./benchSeats";
import { lakeSeats } from "./lakeLayout";

/** The index of the first lake seat: fishing chair `n` (spot order, 0..29) is `LAKE_SEAT_BASE + n`. */
export const LAKE_SEAT_BASE = VILLAGE_SEATS.length;

export const VILLAGE_AND_LAKE_SEATS: readonly VillageSeat[] = Object.freeze([
  ...VILLAGE_SEATS,
  ...lakeSeats().map((s): VillageSeat => Object.freeze({ ...s, area: "village", bench: s.bench })),
]);
