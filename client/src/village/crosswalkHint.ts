import { SIGNAL_CROSSINGS, crossingFrame } from "@caysonverse/shared/village/crossings";
import { pedestrianSignalAt, signalAt } from "@caysonverse/shared/village/transit";

/** How near (m) to a crosswalk's centre the hint shows. */
export const CROSSWALK_HINT_REACH_M = 9;

export interface CrosswalkHint {
  tone: "go" | "wait" | "hurry";
  /** One short line a first-time player understands at a glance. */
  text: string;
  /** Seconds left in this phase (whole, rounded up). */
  seconds: number;
}

/**
 * The hint for a player at (x, z), or null away from the crosswalks: what the pedestrian signal says in words, and the
 * seconds to the next change, so a first-time player (on a phone, where the signal head is small) does not have to read
 * the lights. Follows the same cycle as the lamps (transit.ts pedestrianSignalAt) and the cars (a green car light is never
 * shown with "건너가요").
 */
export function crosswalkHintAt(x: number, z: number, nowMs: number): CrosswalkHint | null {
  let near = false;
  for (const c of SIGNAL_CROSSINGS) {
    const f = crossingFrame(c);
    if (Math.hypot(x - f.centre.x, z - f.centre.z) <= CROSSWALK_HINT_REACH_M) near = true;
  }
  if (!near) return null;
  const p = pedestrianSignalAt(nowMs);
  const seconds = Math.max(1, Math.ceil(p.remainingMs / 1000));
  if (p.color === "walk") return { tone: "go", text: "초록불이에요, 건너가요", seconds: Math.ceil((p.remainingMs + 4_000) / 1000) };
  if (p.color === "flashing") return { tone: "hurry", text: "곧 빨간불이에요, 건너는 중이면 서둘러요", seconds };
  const car = signalAt(nowMs).color;
  return { tone: "wait", text: car === "green" ? "빨간불이에요, 차가 지나가요 · 기다려요" : "빨간불이에요, 잠깐 기다려요", seconds };
}
