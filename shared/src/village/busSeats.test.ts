import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { busDismountSpot } from "./busSeats";
import { TRANSIT, type TransitPoint, type TransitPose } from "./transit";
import { busBoardingDistance, villageGeometry } from "./villageLayout";

/** A point in the bus's own frame at `pose`: m ahead of its centre and m to its right (doors). */
function local(pose: TransitPose, p: TransitPoint): { ahead: number; right: number } {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  const dx = p.x - pose.x;
  const dz = p.z - pose.z;
  return { ahead: dx * fx + dz * fz, right: dx * -fz + dz * fx };
}

describe("getting off the village bus", () => {
  it("riders are put down outside the middle door on the pavement, clear of every collider, by the stop, apart", () => {
    const spots = [0, 1, 2, 3, 4, 5].map((s) => busDismountSpot(s));
    for (const p of spots) {
      expect(isBlocked(p.x, p.z, PLAYER_RADIUS, villageGeometry.obstacles), `${p.x}, ${p.z}`).toBe(false);
      // on the pavement past the kerb (R 37), facing away from the bus
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(37 + PLAYER_RADIUS);
      expect(busBoardingDistance(p.x, p.z)).toBe(0);
      const l = local(TRANSIT.parked, p);
      expect(l.right).toBeGreaterThan(1.25 + PLAYER_RADIUS);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
      }
    }
  });

  it("any integer picks a spot (the server spreads riders by where they stood)", () => {
    for (const s of [-7, 0, 12, 99]) {
      const p = busDismountSpot(s);
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    }
  });
});
