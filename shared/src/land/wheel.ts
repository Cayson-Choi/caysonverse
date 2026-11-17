/**
 * 케이슨랜드 하늘 등불 바퀴 (Sky Lantern Wheel): placeholder until the wheel is built (phase 2c). Seats: 0 so nobody can board yet.
 */
export const WHEEL_SEATS = 0;
export interface WheelState {
  cycle: number;
  phase: number;
  status: "unloading" | "boarding" | "gate" | "riding";
  departsInMs: number;
}
export function wheelAt(nowMs: number): WheelState {
  const cycle = Math.floor(nowMs / 300_000);
  return { cycle, phase: nowMs - cycle * 300_000, status: "unloading", departsInMs: 0 };
}
