// The pier cue's arithmetic (LakePierCue.tsx) — pure, tested: which free chair, and which way the arrow points on screen.
import { dirToIntent } from "../game/clickMove";
import { FISHING_CHAIRS } from "./lakeNearby";

/** The nearest fishing chair nobody fishes at, as where to stand to sit on it (its get-up spot), or null. */
export function nearestFreeChairStand(x: number, z: number, occupied: ReadonlySet<number>): { x: number; z: number; spot: number } | null {
  let best: { x: number; z: number; spot: number } | null = null;
  let bestD = Infinity;
  FISHING_CHAIRS.forEach((c, i) => {
    if (occupied.has(i)) return;
    const d = Math.hypot(c.standX - x, c.standZ - z);
    if (d < bestD) {
      bestD = d;
      best = { x: c.standX, z: c.standZ, spot: i };
    }
  });
  return best;
}

/**
 * The arrow's turn on screen (rad, 0 = straight up the screen, clockwise positive) toward (tx, tz) from (x, z) for a view
 * looking along `viewYaw` (the camera's yaw: what W walks toward).
 */
export function screenBearing(x: number, z: number, tx: number, tz: number, viewYaw: number): number {
  const dx = tx - x;
  const dz = tz - z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const i = dirToIntent({ x: dx / len, z: dz / len }, viewYaw);
  return Math.atan2(i.right, i.forward);
}

