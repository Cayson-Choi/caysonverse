import { describe, it, expect } from "vitest";
import type { AABB, CameraBox } from "@caysonverse/shared/collision";
import { wallsAround } from "@caysonverse/shared/school/geometry";
import { COUNSEL_GEOMETRY } from "@caysonverse/shared/school/counselMap";
import { HUB_GEOMETRY_OPEN } from "@caysonverse/shared/school/hubMap";
import { MAZE_WALLS } from "@caysonverse/shared/maze";
import { PLAYER_RADIUS, WALLS, WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import {
  ARM_FREE,
  CAMERA_BOXES,
  SPRING,
  armHeightScaleAt,
  INDOOR_ARM,
  armLookLiftAt,
  indoorArmShape,
  cameraPad,
  segmentHitFraction,
  springArmDistance,
  stepArmLimit,
  stepSpringDistance,
} from "./cameraCollision";
import { LEGACY_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, VILLAGE_CAMERA_PAD, getActiveMap, setActiveMap } from "./activeMap";

// A long wall across the +Z side of the origin: 0.3 m thick, face at z = 4.
const WALL: AABB = { minX: -5, maxX: 5, minZ: 4, maxZ: 4.3 };

describe("cameraCollision — constants (verbatim from the brief)", () => {
  it("keeps the agreed spring tuning", () => {
    expect(SPRING).toEqual({ minDist: 0.6, pad: 0.2, returnRate: 6 });
  });

  it("CAMERA_BOXES is every room wall plus every maze wall, in that order", () => {
    expect(CAMERA_BOXES.length).toBe(WALLS.length + MAZE_WALLS.length);
    expect(CAMERA_BOXES.slice(0, WALLS.length)).toEqual(WALLS);
    expect(CAMERA_BOXES.slice(WALLS.length)).toEqual(MAZE_WALLS);
    expect(MAZE_WALLS.length).toBeGreaterThan(0);
  });
});

describe("segmentHitFraction", () => {
  it("returns 1 when clear", () => {
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, -10, [WALL])).toBe(1);
  });

  it("hits a wall between head and camera at the right fraction", () => {
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [WALL])).toBeCloseTo(0.4, 6);
  });

  it("passes over a wall when the segment is above WALL_HEIGHT", () => {
    expect(segmentHitFraction(0, 5, 0, 0, 5, 10, [WALL])).toBe(1);
  });

  it("is blocked by the wall for a rising segment only until it clears the top", () => {
    // Steep climb: at the wall face (t = 0.4) the segment is at y = 1.4 + 7.6·0.4 = 4.44 > WALL_HEIGHT,
    // so it has already left the wall's height band → passes over.
    expect(segmentHitFraction(0, 1.4, 0, 0, 9, 10, [WALL])).toBe(1);
    // A gentler climb is still under the top at the face (y = 2.84) → blocked there.
    expect(segmentHitFraction(0, 1.4, 0, 0, 5, 10, [WALL])).toBeCloseTo(0.4, 6);
  });

  it("clips on the height axis too: a segment starting above the wall and diving into it is a hit", () => {
    // y falls from 6 to −2 over the 10 m run: at the wall face (t = 0.4) y = 2.8 ≤ 4 → hit,
    // but it only drops under WALL_HEIGHT at t = 0.25, so the entry is the face (0.4), not 0.25.
    expect(segmentHitFraction(0, 6, 0, 0, -2, 10, [WALL])).toBeCloseTo(0.4, 6);
  });

  it("honours a custom box height", () => {
    // Same wall but only 1 m tall: a segment at 1.4 m flies over it.
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [WALL], 1)).toBe(1);
    expect(segmentHitFraction(0, 0.5, 0, 0, 0.5, 10, [WALL], 1)).toBeCloseTo(0.4, 6);
  });

  it("ignores a box that contains the start point", () => {
    // The head is inside the wall (hugging it): that wall must not fold the camera to zero.
    expect(segmentHitFraction(0, 1.4, 4.1, 0, 1.4, 10, [WALL])).toBe(1);
    expect(segmentHitFraction(0, 1.4, 4.1, 0, 1.4, -10, [WALL])).toBe(1);
    // ...but a second wall further along the segment still blocks it.
    const far: AABB = { minX: -5, maxX: 5, minZ: 8, maxZ: 8.5 };
    expect(segmentHitFraction(0, 1.4, 4.1, 0, 1.4, 10, [WALL, far])).toBeCloseTo((8 - 4.1) / 5.9, 6);
  });

  it("a start point above the box is not contained (height counts)", () => {
    // x,z are inside the wall's footprint but the head is above it → the wall can block a downward ray.
    expect(segmentHitFraction(0, 5, 4.1, 0, 1, 4.1, [WALL])).toBeCloseTo((5 - 4) / 4, 6);
  });

  it("returns the nearest hit, whatever the box order", () => {
    const near: AABB = { minX: -5, maxX: 5, minZ: 2, maxZ: 2.3 };
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [WALL, near])).toBeCloseTo(0.2, 6);
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [near, WALL])).toBeCloseTo(0.2, 6);
  });

  it("is not blocked by a wall that lies beyond the end of the segment, or only touched at the end", () => {
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 3, [WALL])).toBe(1); // stops 1 m short
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 4, [WALL])).toBe(1); // ends exactly on the face
  });

  it("is not blocked by a wall behind the head (ray direction matters)", () => {
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, -10, [WALL])).toBe(1);
    expect(segmentHitFraction(0, 1.4, 9, 0, 1.4, 20, [WALL])).toBe(1);
  });

  it("works for a segment pointing the other way (−Z wall) and a diagonal one", () => {
    const north: AABB = { minX: -5, maxX: 5, minZ: -4.3, maxZ: -4 };
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, -10, [north])).toBeCloseTo(0.4, 6);
    // 45° in XZ toward the +Z wall: reaches z = 4 at x = 4 (inside the wall's X span).
    expect(segmentHitFraction(0, 1.4, 0, 8, 1.4, 8, [WALL])).toBeCloseTo(0.5, 6);
    // ...but a diagonal that leaves the wall's X span before z = 4 misses it.
    expect(segmentHitFraction(0, 1.4, 0, 20, 1.4, 8, [WALL])).toBe(1);
  });

  it("rejects a box beside the segment (broad phase) and a segment parallel to a slab", () => {
    const side: AABB = { minX: 3, maxX: 4, minZ: 0, maxZ: 10 };
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [side])).toBe(1);
    // dx = 0 and the x slab does not contain the segment's x → no hit even though z overlaps.
    expect(segmentHitFraction(2.9, 1.4, 0, 2.9, 1.4, 10, [side])).toBe(1);
    expect(segmentHitFraction(3.5, 1.4, -2, 3.5, 1.4, 10, [side])).toBeCloseTo(2 / 12, 6);
  });

  it("a zero-length segment is never a hit", () => {
    expect(segmentHitFraction(0, 1.4, 5, 0, 1.4, 5, [WALL])).toBe(1);
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 0, [WALL])).toBe(1);
  });

  it("with no boxes there is nothing to hit", () => {
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [])).toBe(1);
  });

  it("uses the real room walls by default: from the lounge to the south wall", () => {
    // WALLS' south wall face is at z = WORLD_BOUNDS.maxZ = 18; x = −15 is clear of everything else.
    expect(segmentHitFraction(-15, 1.4, 0, -15, 1.4, 30)).toBeCloseTo(18 / 30, 6);
    // ...and a camera 10 m up in the air sails over the 4 m wall.
    expect(segmentHitFraction(-15, WALL_HEIGHT + 6, 0, -15, WALL_HEIGHT + 6, 30)).toBe(1);
  });

  it("uses the maze walls by default too", () => {
    // Cast straight across a real maze wall that is thin in Z: it (or something nearer) must be hit.
    const w = MAZE_WALLS.find((m) => m.maxZ - m.minZ < 1 && m.maxX - m.minX > 1);
    expect(w).toBeDefined();
    const box = w as AABB;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const depth = box.maxZ - box.minZ;
    const t = segmentHitFraction(cx, 1.4, cz - 5, cx, 1.4, cz + 5);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(0.5 - depth / 20 + 1e-9);
  });
});

describe("segmentHitFraction — tall props (a box that states its own height)", () => {
  // A 2.2 m locker bank: z -3..-2.36 along the corridor's north wall (the real hub box, x 15..19).
  const LOCKERS: CameraBox = { minX: 15, maxX: 19, minZ: -3, maxZ: -2.36, height: 2.2 };

  it("a box's own height replaces the default: a segment above the locker top passes over, below it is a hit", () => {
    // From the player at (17, 1.7, 0) to a camera north of the lockers at z = -6: the segment is at y = 1.7 + (h - 1.7)·t.
    // The locker face (z = -2.36) is at t = 2.36 / 6; a camera at y = 6 is at ~3.4 there (over the 2.2 top), one at y = 1.7 is inside the band.
    expect(segmentHitFraction(17, 1.7, 0, 17, 6, -6, [LOCKERS])).toBe(1);
    expect(segmentHitFraction(17, 1.7, 0, 17, 1.7, -6, [LOCKERS])).toBeCloseTo(2.36 / 6, 6);
    // The same footprint as a wall (no height) is 4 m tall, so the high segment would have been stopped.
    const asWall: AABB = { minX: 15, maxX: 19, minZ: -3, maxZ: -2.36 };
    expect(segmentHitFraction(17, 1.7, 0, 17, 6, -6, [asWall])).toBeLessThan(1);
  });

  it("a wall and a tall prop in one list each use their own height", () => {
    const wall: AABB = { minX: -5, maxX: 5, minZ: 4, maxZ: 4.3 }; // 4 m (the default)
    const low: CameraBox = { minX: -5, maxX: 5, minZ: -4.3, maxZ: -4, height: 2 };
    // At y = 3 the 2 m box is looked over, the 4 m wall is not.
    expect(segmentHitFraction(0, 3, 0, 0, 3, -10, [wall, low])).toBe(1);
    expect(segmentHitFraction(0, 3, 0, 0, 3, 10, [wall, low])).toBeCloseTo(0.4, 6);
  });

  it("a start point inside a tall box's footprint but above its top is not contained", () => {
    expect(segmentHitFraction(17, 2.5, -2.6, 17, 2.5, 5, [LOCKERS])).toBe(1);
  });

  it("the spring arm stops 0.2 m in front of a locker bank when the camera would end inside it (hub corridor)", () => {
    // The Task 23 case: camera on the north side, low (a recentre while looking south): the head at (17, 1.9, 1) and the
    // wanted camera spot 5 m behind it, north, at the same height — the corridor's north wall alone left it inside the lockers.
    const lockers = HUB_GEOMETRY_OPEN.cameraBoxes;
    const arm = springArmDistance(17, 1.9, 1, 17, 1.9, -4, 5, lockers);
    expect(arm).toBeCloseTo(1 + 2.36 - SPRING.pad, 6); // stops at z = -2.36 + 0.2 = -2.16: 3.16 m out
    // Over the lockers (camera well above 2.2 m at the face) nothing stops it.
    expect(springArmDistance(17, 1.9, 1, 17, 7.5, -4, 5, lockers)).toBe(5);
  });

  it("the counselling room's bookcase and cabinet stop the camera; the desk and the low table do not", () => {
    const boxes = COUNSEL_GEOMETRY.cameraBoxes;
    // Looking west past the east bookcase (x 3.98..4.5, 2.1 m): head at (2.5, 1.9, -2.5), camera east of it at the same height.
    const east = segmentHitFraction(2.5, 1.9, -2.5, 5.2, 1.9, -2.5, boxes, WALL_HEIGHT, SPRING.pad);
    expect(east).toBeLessThan(1);
    // The desk (x -4.38..-3.54, 1.24 m) is looked over by a camera at 1.9 m.
    expect(segmentHitFraction(-2.5, 1.9, -1.1, -5.2, 1.9, -1.1, boxes, WALL_HEIGHT, SPRING.pad)).toBe(1);
    // The low table (0.66 m) the same.
    expect(segmentHitFraction(-2, 1.9, 0.9, 2, 1.9, 0.9, boxes, WALL_HEIGHT, SPRING.pad)).toBe(1);
  });
});

describe("segmentHitFraction — margin (boxes inflated in XZ for the cast)", () => {
  it("a margin pulls the hit earlier by exactly that much for a perpendicular segment", () => {
    // Wall face at z = 4: with a 0.2 margin the segment enters the inflated box at z = 3.8.
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [WALL], WALL_HEIGHT, 0.2)).toBeCloseTo(0.38, 6);
    expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [WALL], WALL_HEIGHT, 0)).toBeCloseTo(0.4, 6);
  });

  it("the margin grows the box sideways too: a segment that grazes just past the end of a wall is caught", () => {
    // Wall spans x −5..5; this segment runs at x = 5.1 — outside the raw box, inside the inflated one.
    expect(segmentHitFraction(5.1, 1.4, 0, 5.1, 1.4, 10, [WALL])).toBe(1);
    expect(segmentHitFraction(5.1, 1.4, 0, 5.1, 1.4, 10, [WALL], WALL_HEIGHT, 0.2)).toBeCloseTo(0.38, 6);
  });

  it("does not inflate height: a segment above the wall top still passes over", () => {
    expect(segmentHitFraction(0, WALL_HEIGHT + 0.1, 0, 0, WALL_HEIGHT + 0.1, 10, [WALL], WALL_HEIGHT, 0.2)).toBe(1);
  });

  it("a start inside the inflated box but outside the raw one tests the raw box (no fold to zero)", () => {
    // Head 0.1 m in front of the wall face: inside the 0.2 margin. The camera still has room up to the face.
    expect(segmentHitFraction(0, 1.4, 3.9, 0, 1.4, 10, [WALL], WALL_HEIGHT, 0.2)).toBeCloseTo(0.1 / 6.1, 6);
    // ...and a start inside the raw box is skipped, margin or not.
    expect(segmentHitFraction(0, 1.4, 4.1, 0, 1.4, 10, [WALL], WALL_HEIGHT, 0.2)).toBe(1);
  });

  it("the head can never start inside an inflated wall: PLAYER_RADIUS keeps it at least the pad away", () => {
    expect(PLAYER_RADIUS).toBeGreaterThanOrEqual(SPRING.pad);
    // Touching a wall face (centre PLAYER_RADIUS away) is outside the inflated box.
    const z = WALL.minZ - PLAYER_RADIUS;
    expect(z).toBeLessThan(WALL.minZ - SPRING.pad);
    // Touching a corner (circle tangent to the corner) is outside it on at least one axis.
    const off = PLAYER_RADIUS / Math.SQRT2;
    expect(off).toBeGreaterThan(SPRING.pad);
  });
});

describe("springArmDistance", () => {
  it("returns the desired distance untouched when nothing is in the way", () => {
    expect(springArmDistance(0, 1.4, 0, 0, 1.4, -10, 10, [WALL])).toBe(10);
    expect(springArmDistance(0, 1.4, 0, 0, 1.4, 10, 10, [])).toBe(10);
  });

  it("pulls in front of the wall by SPRING.pad, floored at SPRING.minDist", () => {
    expect(springArmDistance(0, 1.4, 0, 0, 1.4, 10, 10, [WALL])).toBeCloseTo(3.8, 6);
    expect(springArmDistance(0, 1.4, 0, 0, 1.4, 10, 10, [{ ...WALL, minZ: 0.05, maxZ: 0.3 }])).toBe(
      SPRING.minDist,
    );
  });

  it("keeps the pad PERPENDICULAR to the wall at a shallow angle (not along the ray)", () => {
    // Head 0.4 m from the wall face (as close as the player body can get), camera swung out nearly
    // parallel to the wall: 10 m along X, 1 m toward it (about 5.7 degrees). The old "t × desired − pad"
    // stopped 0.2 m along the ray = only ~0.02 m from the wall plane, inside the near plane.
    const ax = -4;
    const az = 3.6;
    const bx = 6;
    const bz = 4.6;
    const desired = Math.hypot(bx - ax, bz - az);
    const arm = springArmDistance(ax, 1.4, az, bx, 1.4, bz, desired, [WALL]);
    const camZ = az + ((bz - az) / desired) * arm;
    expect(arm).toBeLessThan(desired);
    expect(WALL.minZ - camZ).toBeGreaterThanOrEqual(SPRING.pad - 1e-6);
    expect(WALL.minZ - camZ).toBeLessThan(SPRING.pad + 1e-6);
  });

  it("scales with the desired distance (t × desired)", () => {
    // Same segment, but `desired` is the arm length the caller measured: a 5 m arm hits at 0.4 → 2 − 0.2.
    expect(springArmDistance(0, 1.4, 0, 0, 1.4, 5, 5, [{ ...WALL, minZ: 2, maxZ: 2.3 }])).toBeCloseTo(
      1.8,
      6,
    );
  });
});

describe("stepSpringDistance", () => {
  it("snaps in and eases out at SPRING.returnRate", () => {
    expect(stepSpringDistance(6, 2, 0.016)).toBe(2);
    expect(stepSpringDistance(2, 6, 0.1)).toBeCloseTo(2.6, 6);
  });

  it("never eases past the target, holds when already there, and a zero step holds", () => {
    expect(stepSpringDistance(2, 2.1, 1)).toBe(2.1);
    expect(stepSpringDistance(3, 3, 0.5)).toBe(3);
    expect(stepSpringDistance(2, 6, 0)).toBe(2);
  });

  it("takes (target − current) / returnRate seconds to come all the way back out", () => {
    let cur = 1;
    let frames = 0;
    while (cur < 7 && frames < 1000) {
      cur = stepSpringDistance(cur, 7, 1 / 60);
      frames++;
    }
    expect(cur).toBe(7);
    // 6 m at 6 m/s = 1 s = 60 frames (± the float edge).
    expect(frames).toBeGreaterThanOrEqual(59);
    expect(frames).toBeLessThanOrEqual(61);
  });
});

describe("stepArmLimit — the eased limit behind the spring arm", () => {
  it("a blocked arm snaps in at once", () => {
    // desired 6, wall allows 2.5: the limit drops from 'free' straight to 2.5.
    expect(stepArmLimit(ARM_FREE, 2.5, 6, 0.016)).toBe(2.5);
    expect(stepArmLimit(5, 2.5, 6, 0.016)).toBe(2.5);
  });

  it("once the wall is gone the limit eases out at SPRING.returnRate", () => {
    // reach === desired means clear.
    expect(stepArmLimit(2, 6, 6, 0.1)).toBeCloseTo(2.6, 6);
    let limit = 2;
    for (let i = 0; i < 30; i++) limit = stepArmLimit(limit, 6, 6, 1 / 60);
    expect(limit).toBeCloseTo(2 + 6 * 0.5, 6);
  });

  it("in the clear it never limits the arm: a zoom-out is not slowed by the spring", () => {
    let limit = ARM_FREE;
    for (let i = 0; i < 10; i++) limit = stepArmLimit(limit, 6, 6, 1 / 60);
    expect(limit).toBe(ARM_FREE);
    // The wheel pushes the desired distance 6 → 18 in one frame: the arm is min(desired, limit) = 18.
    limit = stepArmLimit(limit, 18, 18, 1 / 60);
    expect(Math.min(18, limit)).toBe(18);
  });

  it("stays clear of the free value even after a long walk in the open", () => {
    let limit = 2;
    for (let i = 0; i < 6000; i++) limit = stepArmLimit(limit, 8, 8, 1 / 60);
    expect(limit).toBe(ARM_FREE);
  });

  it("is larger than any arm the camera can ask for (maxDistance × the portrait pull-back)", () => {
    expect(ARM_FREE).toBeGreaterThan(18 * 1.6);
  });
});

describe("outdoor arm shaping (the angle is kept: the arm shrinks along the camera's own line)", () => {
  it("a shortened arm scales the height offset with it, and nothing is lifted", () => {
    expect(armHeightScaleAt(0.5, false)).toBe(0.5);
    expect(armHeightScaleAt(0.25, false)).toBe(0.25);
    expect(armLookLiftAt(0.5, false)).toBe(0);
  });

  it("an unshortened arm (k = 1) changes nothing", () => {
    expect(armHeightScaleAt(1, false)).toBe(1);
    expect(armLookLiftAt(1, false)).toBe(0);
  });
});

describe("ceiling slabs (a box with `minY`: it spans minY..height, not floor..height)", () => {
  // A synthetic 9 x 12 m room: its four walls and a ceiling slab over the whole room, 3.3..3.5 m up (the shape the
  // memorial hall's ceiling boxes take in Task 9).
  const room: AABB = { minX: -4.5, maxX: 4.5, minZ: -6, maxZ: 6 };
  const CEILING: CameraBox = { minX: -5, maxX: 5, minZ: -6.5, maxZ: 6.5, minY: 3.3, height: 3.5 };
  const walls: CameraBox[] = wallsAround(room);
  const boxes: CameraBox[] = [...walls, CEILING];
  const HEAD = 1.4;

  it("a segment from a head under the slab rising into it is a hit at the slab's underside (the head is not 'inside' it)", () => {
    // Straight up from y = 1.4 to 6: the underside (y = 3.3) is at t = 1.9 / 4.6.
    expect(segmentHitFraction(0, HEAD, 0, 0, 6, 0, boxes)).toBeCloseTo(1.9 / 4.6, 9);
  });

  it("a segment that stays under the slab is clear, and one that stays above it passes over", () => {
    expect(segmentHitFraction(0, HEAD, 0, 0, 3.2, 3, [CEILING])).toBe(1);
    expect(segmentHitFraction(0, 4, 0, 0, 6, 3, [CEILING])).toBe(1);
  });

  it("a segment beside the slab (outside its footprint) climbs past it", () => {
    expect(segmentHitFraction(8, HEAD, 0, 8, 6, 0, [CEILING])).toBe(1);
  });

  it("a slab without `minY` still starts at the floor (no change for every other box)", () => {
    const wall: CameraBox = { minX: -5, maxX: 5, minZ: -6.5, maxZ: 6.5, height: 3.5 };
    // From outside the footprint at the same height the old way: a wall from the floor is hit at its face.
    expect(segmentHitFraction(0, HEAD, 8, 0, HEAD, 0, [wall])).toBeCloseTo(1.5 / 8, 9);
  });

  it("the spring arm stops under the slab with the pad below it: 3.3 - 0.2 = 3.1 m, the hall's camera ceiling", () => {
    const desired = 4.6; // straight up to y = 6
    const arm = springArmDistance(0, HEAD, 0, 0, 6, 0, desired, boxes);
    expect(HEAD + arm).toBeCloseTo(3.1, 9);
    expect(HEAD + arm).toBeLessThan(CEILING.minY!);
  });

  it("whatever the pitch and zoom, the arm's end stays under the slab and inside the walls", () => {
    let swept = 0;
    for (let pitch = 0; pitch <= 1.2 + 1e-9; pitch += 0.1) {
      for (let zoom = 2.5; zoom <= 18; zoom += 0.5) {
        for (const yaw of [0, 1, 2, 3.1, -1.7]) {
          const horiz = zoom * Math.cos(pitch);
          const offY = zoom * Math.sin(pitch);
          const cx = horiz * Math.sin(yaw);
          const cz = horiz * Math.cos(yaw);
          const reach = Math.hypot(horiz, offY);
          const arm = springArmDistance(0, HEAD, 0, cx, HEAD + offY, cz, reach, boxes);
          const k = arm / reach;
          expect(HEAD + offY * k).toBeLessThanOrEqual(CEILING.minY! - SPRING.pad + 1e-9);
          expect(Math.abs(cx * k)).toBeLessThanOrEqual(room.maxX + 1e-9);
          expect(Math.abs(cz * k)).toBeLessThanOrEqual(room.maxZ + 1e-9);
          swept++;
        }
      }
    }
    expect(swept).toBeGreaterThan(500);
  });

  it("a head AT or above the slab's underside is not trapped by it (an already-contained start is skipped)", () => {
    expect(segmentHitFraction(0, 3.4, 0, 0, 3.4, 3, [CEILING])).toBe(1);
  });
});

describe("the map's own pad (케이슨 마을: 0.3 m, wider than its 0.2 m near plane; T7 review m5)", () => {
  // A concave corner: WALL's face at z = 4 and a side wall whose face is at x = 2.
  const SIDE: AABB = { minX: 2, maxX: 2.3, minZ: -5, maxZ: 4.3 };
  const VILLAGE_NEAR = 0.2;

  it("cameraPad() is the active map's pad, SPRING.pad where the map names none", () => {
    const before = getActiveMap();
    try {
      setActiveMap(LEGACY_ACTIVE_MAP);
      expect(cameraPad()).toBe(SPRING.pad);
      setActiveMap(VILLAGE_ACTIVE_MAP);
      expect(cameraPad()).toBe(VILLAGE_CAMERA_PAD);
    } finally {
      setActiveMap(before);
    }
  });

  it("a camera pushed into a concave corner stays at least the pad from both walls, clear of the near plane", () => {
    const head = { x: 1, y: 1.4, z: 3 };
    for (const [cx, cz] of [
      [3, 5],
      [4, 4.5],
      [2.6, 6],
      [1.9, 5.5],
    ] as const) {
      const cam = { x: cx, y: 2, z: cz };
      const desired = Math.hypot(cam.x - head.x, cam.y - head.y, cam.z - head.z);
      const d = springArmDistance(head.x, head.y, head.z, cam.x, cam.y, cam.z, desired, [WALL, SIDE], VILLAGE_CAMERA_PAD);
      const k = d / desired;
      const x = head.x + (cam.x - head.x) * k;
      const z = head.z + (cam.z - head.z) * k;
      const toSide = SIDE.minX - x;
      const toWall = WALL.minZ - z;
      expect(Math.min(toSide, toWall), `camera toward ${cx}, ${cz}`).toBeGreaterThanOrEqual(VILLAGE_CAMERA_PAD - 1e-6);
      expect(Math.min(toSide, toWall)).toBeGreaterThan(VILLAGE_NEAR);
    }
  });
});

describe("indoor arm shaping (케이슨 마을 Task 9: the 9 x 12 m hall must not fill the screen with the own head)", () => {
  it("indoors a shortened arm keeps its height and the look rises by (1 − k) × lookLift", () => {
    expect(INDOOR_ARM).toEqual({ lookLift: 1.3, refReach: 3.6 });
    expect(armHeightScaleAt(0.2, true)).toBe(1);
    expect(armLookLiftAt(0.2, true)).toBeCloseTo(0.8 * INDOOR_ARM.lookLift, 9);
  });

  it("against a wall a long zoom is shaped like the old 3.6 m reference: same height and look lift as a 3.6 m arm", () => {
    // Review 2026-11-10: the zoom is no longer capped indoors, so the shaping must not depend on the uncapped length.
    const pitch = 0.35;
    const capped = indoorArmShape(2.1, 3.6, 3.6 * Math.sin(pitch), pitch);
    for (const reach of [6, 10, 18, 28.8]) {
      const offY = Math.min(reach * Math.sin(pitch), 1.85); // the ceiling clamp may flatten the wanted spot
      const s = indoorArmShape(2.1, reach, offY, pitch);
      expect(s.lookLift, `reach ${reach}`).toBeCloseTo(capped.lookLift, 9);
      expect(s.offY, `reach ${reach}`).toBeCloseTo(Math.min(offY, capped.offY), 9);
    }
    // Continuous as the arm clears: at the full reach the whole wanted height and no lift.
    const full = indoorArmShape(9.999999, 10, 1.85, pitch);
    expect(full.offY).toBeCloseTo(1.85, 5);
    expect(full.lookLift).toBe(0);
  });

  it("a full arm changes nothing indoors either: the shaping lasts only while a wall is in the way", () => {
    expect(armHeightScaleAt(1, true)).toBe(1);
    expect(armLookLiftAt(1, true)).toBe(0);
  });

  it("at the 0.6 m floor of a 3.6 m arm the camera stays up: the head no longer fills the view from head height", () => {
    const k = SPRING.minDist / 3.6;
    const wanted = 3.6 * Math.sin(0.35); // the height offset of the default pitch
    expect(wanted * armHeightScaleAt(k, true)).toBeCloseTo(wanted, 9); // indoors: about 1.2 m over the head
    expect(wanted * armHeightScaleAt(k, false)).toBeLessThan(0.25); // outdoors: about head height
  });
});
