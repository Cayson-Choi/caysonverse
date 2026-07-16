import { describe, it, expect } from "vitest";
import { MAZE_WALLS, MAZE_SEED, MAZE_WALL_T, pointInAABB } from "@caysonverse/shared/maze";
import {
  LANDMARK_EMOJIS,
  PLAQUE_SIZE,
  PLAQUE_EYE_Y,
  PLAQUE_FACE_GAP,
  buildMazeLandmarks,
  plaqueQuads,
  MAZE_LANDMARKS,
} from "./mazeLandmarks";

const HT = MAZE_WALL_T / 2;

describe("mazeLandmarks — emoji set", () => {
  it("has ~24 visually distinct emojis, all unique", () => {
    expect(LANDMARK_EMOJIS.length).toBe(24);
    expect(new Set(LANDMARK_EMOJIS).size).toBe(LANDMARK_EMOJIS.length);
  });
});

describe("mazeLandmarks — deterministic placement", () => {
  it("is deterministic: the same walls + seed rebuild an identical placement", () => {
    expect(buildMazeLandmarks(MAZE_WALLS, MAZE_SEED)).toEqual(
      buildMazeLandmarks(MAZE_WALLS, MAZE_SEED),
    );
    expect(buildMazeLandmarks(MAZE_WALLS, MAZE_SEED)).toEqual([...MAZE_LANDMARKS]);
  });

  it("gives a DIFFERENT placement for a different seed (the sub-PRNG drives it)", () => {
    expect(buildMazeLandmarks(MAZE_WALLS, MAZE_SEED + 1)).not.toEqual([...MAZE_LANDMARKS]);
  });

  it("places a healthy number of landmarks (dense enough to remember the path)", () => {
    expect(MAZE_LANDMARKS.length).toBeGreaterThanOrEqual(40);
  });
});

describe("mazeLandmarks — anchors sit on real wall runs", () => {
  it("every anchor centre lies inside its source wall AABB", () => {
    for (const lm of MAZE_LANDMARKS) {
      const wall = MAZE_WALLS[lm.wall];
      expect(wall).toBeDefined();
      expect(pointInAABB(lm.x, lm.z, wall)).toBe(true);
    }
  });

  it("anchor run axis matches the wall's long dimension", () => {
    for (const lm of MAZE_LANDMARKS) {
      const w = MAZE_WALLS[lm.wall];
      const horizontal = w.maxX - w.minX >= w.maxZ - w.minZ;
      expect(lm.axis).toBe(horizontal ? "x" : "z");
    }
  });
});

describe("mazeLandmarks — spacing along a run is 4–6 m", () => {
  it("consecutive anchors on the same wall are 4–6 m apart", () => {
    const byWall = new Map<number, number[]>();
    for (const lm of MAZE_LANDMARKS) {
      const coord = lm.axis === "x" ? lm.x : lm.z;
      const arr = byWall.get(lm.wall) ?? [];
      arr.push(coord);
      byWall.set(lm.wall, arr);
    }
    for (const coords of byWall.values()) {
      coords.sort((a, b) => a - b);
      for (let i = 1; i < coords.length; i++) {
        const gap = coords[i] - coords[i - 1];
        expect(gap).toBeGreaterThanOrEqual(4 - 1e-6);
        expect(gap).toBeLessThanOrEqual(6 + 1e-6);
      }
    }
  });
});

describe("mazeLandmarks — adjacent anchors never share an emoji", () => {
  it("no two consecutive landmarks (placement order) share an emoji index", () => {
    for (let i = 1; i < MAZE_LANDMARKS.length; i++) {
      expect(MAZE_LANDMARKS[i].emojiIndex).not.toBe(MAZE_LANDMARKS[i - 1].emojiIndex);
    }
  });

  it("consecutive anchors on the same wall differ in emoji", () => {
    let prevWall = -1;
    let prevEmoji = -1;
    for (const lm of MAZE_LANDMARKS) {
      if (lm.wall === prevWall) expect(lm.emojiIndex).not.toBe(prevEmoji);
      prevWall = lm.wall;
      prevEmoji = lm.emojiIndex;
    }
  });
});

describe("mazeLandmarks — plaque quads stay flush on the wall face", () => {
  it("each anchor yields two quads (one per wall face)", () => {
    const quads = plaqueQuads(MAZE_LANDMARKS);
    expect(quads.length).toBe(MAZE_LANDMARKS.length * 2);
  });

  it("every plaque face is within 0.05 m of a wall face (no corridor intrusion)", () => {
    for (const lm of MAZE_LANDMARKS) {
      const wall = MAZE_WALLS[lm.wall];
      const quads = plaqueQuads([lm]);
      for (const q of quads) {
        if (lm.axis === "x") {
          // Horizontal wall: faces at minZ / maxZ; quad offset along Z.
          const dMin = Math.abs(q.z - wall.minZ);
          const dMax = Math.abs(q.z - wall.maxZ);
          expect(Math.min(dMin, dMax)).toBeLessThanOrEqual(0.05 + 1e-9);
          // Depth-wise the quad never protrudes past the face by more than the gap.
          expect(Math.min(dMin, dMax)).toBeCloseTo(PLAQUE_FACE_GAP, 6);
          expect(q.x).toBeCloseTo(lm.x, 6); // centred along the run
        } else {
          const dMin = Math.abs(q.x - wall.minX);
          const dMax = Math.abs(q.x - wall.maxX);
          expect(Math.min(dMin, dMax)).toBeLessThanOrEqual(0.05 + 1e-9);
          expect(Math.min(dMin, dMax)).toBeCloseTo(PLAQUE_FACE_GAP, 6);
          expect(q.z).toBeCloseTo(lm.z, 6);
        }
        expect(q.y).toBe(PLAQUE_EYE_Y);
      }
    }
  });

  it("the plaque half-width never overhangs the wall run end (fits flush)", () => {
    for (const lm of MAZE_LANDMARKS) {
      const wall = MAZE_WALLS[lm.wall];
      const half = PLAQUE_SIZE / 2;
      if (lm.axis === "x") {
        expect(lm.x - half).toBeGreaterThanOrEqual(wall.minX + HT - 1e-9);
        expect(lm.x + half).toBeLessThanOrEqual(wall.maxX - HT + 1e-9);
      } else {
        expect(lm.z - half).toBeGreaterThanOrEqual(wall.minZ + HT - 1e-9);
        expect(lm.z + half).toBeLessThanOrEqual(wall.maxZ - HT + 1e-9);
      }
    }
  });
});
