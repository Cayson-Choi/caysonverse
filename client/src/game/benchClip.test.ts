import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, Vector3 } from "three";
import { SIT_POSE } from "@caysonverse/shared/sitPose";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import type { BuiltAvatar } from "./characterAvatar";
import { benchClipPlanes, clipAvatar } from "./benchClip";

/** Whether three would clip point p with `clipIntersection` planes: only when it is behind (negative side of) ALL of them. */
const clipped = (planes: NonNullable<ReturnType<typeof benchClipPlanes>>, p: Vector3) => planes.every((pl) => pl.distanceToPoint(p) < 0);

describe("benchClipPlanes — what of a sitter is hidden: inside the bench only", () => {
  const s = VILLAGE_SEATS[0]!;
  const planes = benchClipPlanes(s)!;
  const f = new Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
  /** A point `ahead` m along the sitter's facing from the seat point, `y` m up. */
  const at = (ahead: number, y: number) => new Vector3(s.x + f.x * ahead, y, s.z + f.z * ahead);

  it("hides the skirt's back panel hanging under the butt, below the seat surface", () => {
    expect(clipped(planes, at(-0.45, s.seatY! - 0.2))).toBe(true); // under the butt (z -0.45 in the pose)
    expect(clipped(planes, at(-0.3, 0.05))).toBe(true); // down by the ground, under the seat
  });

  it("keeps everything above the seat (the butt rests ON it) and everything in front of its edge (legs, a skirt's front drape)", () => {
    expect(clipped(planes, at(-SIT_POSE.hipsBehindRoot, s.seatY! + 0.005))).toBe(false); // the butt, just above the surface
    expect(clipped(planes, at(-SIT_POSE.calvesBehindRoot, 0.3))).toBe(false); // the hanging calves
    expect(clipped(planes, at(0, 0.27))).toBe(false); // the dangling feet
    expect(clipped(planes, at(-0.6, 1.2))).toBe(false); // the back, high above the seat
  });

  it("is null for a seat without a bench (nothing is clipped)", () => {
    expect(benchClipPlanes({ x: 0, z: 0, yaw: 0, standX: 0.9, standZ: 0 })).toBeNull();
    expect(benchClipPlanes(undefined)).toBeNull();
  });
});

describe("clipAvatar — on and off, recompiling only on a change", () => {
  it("sets the planes on every material with clipIntersection, and takes them off again", () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    const avatar = { materials: [a, b] } as unknown as BuiltAvatar;
    const planes = benchClipPlanes(VILLAGE_SEATS[3]!)!;
    const v0 = a.version;
    clipAvatar(avatar, planes);
    expect(a.clippingPlanes).toBe(planes);
    expect(b.clipIntersection).toBe(true);
    expect(a.clipShadows).toBe(true); // the hidden cloth casts no shadow either
    expect(a.version).toBe(v0 + 1);
    clipAvatar(avatar, planes); // the same: nothing to do
    expect(a.version).toBe(v0 + 1);
    clipAvatar(avatar, null);
    expect(a.clippingPlanes).toBeNull();
    expect(b.clipIntersection).toBe(false);
    expect(b.clipShadows).toBe(false);
  });
});
