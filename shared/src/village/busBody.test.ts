import { describe, expect, it } from "vitest";
import { BUS_BODY, busClearance, busLocal, pushOutOfBus } from "./busBody";
import { routePoseAtDistance, routeLength } from "./transit";

const R = 0.4;

/** Where (x, z) is `ahead` / `right` (door side) of the pose. */
function at(pose: { x: number; z: number; yaw: number }, ahead: number, right: number) {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  return { x: pose.x + fx * ahead - fz * right, z: pose.z + fz * ahead + fx * right };
}

describe("the moving bus's body pushes avatars out (checker r2: walked into the driving bus)", () => {
  it("clearance is the exact distance from the 9 x 2.5 m rectangle at any heading", () => {
    for (let yaw = -3; yaw <= 3; yaw += 0.37) {
      const pose = { x: 12, z: -7, yaw };
      const side = at(pose, 1, BUS_BODY.halfWidth + 1);
      expect(busClearance(pose, side.x, side.z, R)).toBeCloseTo(1 - R, 9);
      const inside = at(pose, 0, 0);
      expect(busClearance(pose, inside.x, inside.z, R)).toBeCloseTo(-BUS_BODY.halfWidth - R, 9);
      const corner = at(pose, BUS_BODY.halfLength + 0.3, BUS_BODY.halfWidth + 0.4);
      expect(busClearance(pose, corner.x, corner.z, R)).toBeCloseTo(0.5 - R, 9);
      const l = busLocal(pose, side.x, side.z);
      expect(l.ahead).toBeCloseTo(1, 9);
      expect(l.right).toBeCloseTo(BUS_BODY.halfWidth + 1, 9);
    }
  });

  it("someone clear of it is left alone", () => {
    const pose = { x: 0, z: 0, yaw: 0.7 };
    const p = at(pose, 2, BUS_BODY.halfWidth + R + 0.04);
    expect(pushOutOfBus(pose, p.x, p.z, R)).toBeNull();
  });

  it("anyone overlapping it — even right at its middle — ends clear of it, on the nearer flank", () => {
    for (let yaw = -3; yaw <= 3; yaw += 0.41) {
      const pose = { x: -5, z: 30, yaw };
      for (let a = -4.4; a <= 4.4; a += 0.4) {
        for (let r = -1.6; r <= 1.6; r += 0.2) {
          const p = at(pose, a, r);
          const out = pushOutOfBus(pose, p.x, p.z, R);
          if (busClearance(pose, p.x, p.z, R) >= 0.03) continue;
          expect(out).not.toBeNull();
          expect(busClearance(pose, out!.x, out!.z, R)).toBeGreaterThanOrEqual(0);
          const l = busLocal(pose, out!.x, out!.z);
          // within the body's length the push is sideways, to the side the avatar was on (never across the bus)
          if (Math.abs(a) < BUS_BODY.halfLength - 1 && Math.abs(r) > 0.05) expect(Math.sign(l.right)).toBe(Math.sign(r));
        }
      }
    }
  });

  it("a walk into the flank slides along it: repeated steps toward the middle never get in", () => {
    const pose = { x: 0, z: 0, yaw: 0 };
    let p = at(pose, 1, 3);
    for (let i = 0; i < 100; i++) {
      // step toward the bus's middle (and a bit forward)
      const target = at(pose, 0, 0);
      const d = Math.hypot(target.x - p.x, target.z - p.z) || 1;
      p = { x: p.x + ((target.x - p.x) / d) * 0.1, z: p.z + ((target.z - p.z) / d) * 0.1 };
      p = pushOutOfBus(pose, p.x, p.z, R) ?? p;
      expect(busClearance(pose, p.x, p.z, R)).toBeGreaterThanOrEqual(0);
    }
  });

  it("the body driving past someone at the kerb shoves them out, a little each frame, never leaving them inside", () => {
    const len = routeLength();
    let p = at(routePoseAtDistance(50), 0, BUS_BODY.halfWidth + 0.2); // standing where the flank will pass over them
    let biggest = 0;
    for (let d = 40; d < 60; d += 4.5 / 60) {
      const pose = routePoseAtDistance(d % len);
      const out = pushOutOfBus(pose, p.x, p.z, R);
      if (out) {
        biggest = Math.max(biggest, Math.hypot(out.x - p.x, out.z - p.z));
        p = out;
      }
      expect(busClearance(pose, p.x, p.z, R)).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(biggest).toBeGreaterThan(0); // it did reach them
    // a shove, not a teleport: at most the flank's reach past a body the nose came over by one frame (the driver stops for
    // anyone that far in its path, busDrive.ts, so on the road this is a graze)
    expect(biggest).toBeLessThan(0.7);
  });

  it("never pushes onto a static collider when another side is free, and never ahead of the bus unless it must", () => {
    const pose = { x: 0, z: 0, yaw: 0 }; // heading +z; right (doors) is -x
    const p = at(pose, 3.9, 0.9); // near the front, door side
    const free = pushOutOfBus(pose, p.x, p.z, R)!;
    expect(busLocal(pose, free.x, free.z).right).toBeGreaterThan(BUS_BODY.halfWidth); // the door-side flank, not the nose
    const blockedDoorSide = (x: number, z: number) => busLocal(pose, x, z).right > 0;
    const other = pushOutOfBus(pose, p.x, p.z, R, blockedDoorSide)!;
    expect(busLocal(pose, other.x, other.z).right).toBeLessThan(-BUS_BODY.halfWidth);
    const onlyFront = (x: number, z: number) => busLocal(pose, x, z).ahead < BUS_BODY.halfLength;
    const front = pushOutOfBus(pose, p.x, p.z, R, onlyFront)!;
    expect(busLocal(pose, front.x, front.z).ahead).toBeGreaterThan(BUS_BODY.halfLength);
    const nowhere = pushOutOfBus(pose, p.x, p.z, R, () => true)!;
    expect(busClearance(pose, nowhere.x, nowhere.z, R)).toBeGreaterThanOrEqual(0);
  });
});
