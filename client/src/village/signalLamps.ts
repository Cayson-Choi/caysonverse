import { pedestrianSignalAt, signalAt, type PedestrianSignalColor, type SignalColor } from "@caysonverse/shared/village/transit";

/** What every crosswalk signal shows at an instant (the pure part of TransitRoadSignals). */
export interface LampState {
  vehicle: SignalColor;
  ped: PedestrianSignalColor;
  /** The pedestrian's walking figure shows: steady while walking, blinking (1 Hz) while flashing. */
  walkLit: boolean;
  /** The pedestrian's red standing figure shows. */
  stopLit: boolean;
  /** The count-down display: the whole seconds left of the walk and flashing phases (green) or until the walk (red). */
  countdown: { seconds: number; color: "green" | "red" };
}

/** Blink half-period of the flashing walking figure (ms). */
export const BLINK_MS = 500;

export function lampsAt(nowMs: number, override?: Partial<Pick<LampState, "vehicle" | "ped">> | null): LampState {
  const veh = override?.vehicle ?? signalAt(nowMs).color;
  const p = pedestrianSignalAt(nowMs);
  const ped = override?.ped ?? p.color;
  const blinkOn = Math.floor(nowMs / BLINK_MS) % 2 === 0;
  const walking = ped === "walk" || ped === "flashing";
  // seconds to show: the walk phase's and the flashing phase's remaining time together (the figure turns red at 0)
  const untilStop = p.color === "walk" ? p.remainingMs + 4_000 : p.color === "flashing" ? p.remainingMs : 0;
  return {
    vehicle: veh,
    ped,
    walkLit: ped === "walk" || (ped === "flashing" && blinkOn),
    stopLit: ped === "stop",
    countdown: walking
      ? { seconds: Math.max(0, Math.ceil(untilStop / 1000)), color: "green" }
      : { seconds: Math.max(0, Math.ceil(p.remainingMs / 1000)), color: "red" },
  };
}

/** A key that changes exactly when the picture must be redrawn. */
export function lampKey(s: LampState): string {
  return `${s.vehicle}|${s.ped}|${s.walkLit ? 1 : 0}|${s.countdown.color}${s.countdown.seconds}`;
}
