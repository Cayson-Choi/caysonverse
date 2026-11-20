/**
 * Whether this page and the server run the SAME ride timetable. The server sends a fingerprint of its timetable with its clock
 * (shared/land/rides.ts `rideScheduleKey`); when it differs from ours (the page and the server were deployed at different times,
 * e.g. a train on a 136 s cycle against a server still on 130 s) the train we draw and the seats the server hands out are on different
 * clocks, so riders would be seated before the train stands in the station and put off before the ride ends. The HUD then refuses
 * to board and says so. An older server that sends no fingerprint counts as a mismatch only once it has sent its clock without one.
 */
import { rideScheduleKey } from "@caysonverse/shared/land/rides";

export const rideSchedule: { skew: boolean; known: boolean } = { skew: false, known: false };

/** The server's ride fingerprint from a ServerTime message (undefined: an older server that predates it). */
export function noteServerRideSchedule(serverKey: unknown): void {
  rideSchedule.known = true;
  rideSchedule.skew = serverKey !== rideScheduleKey();
}
