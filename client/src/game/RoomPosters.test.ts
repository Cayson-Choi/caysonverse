import { describe, it, expect } from "vitest";
import {
  DOOR_HALF_WIDTH,
  GALLERY_DOOR_X,
  GALLERY_DOOR_HALF_WIDTH,
  WALL_HEIGHT,
  WALLS,
  ZONES,
} from "@caysonverse/shared/worldMap";
import { MAZE_WALL_T, MAZE_WALLS, MAZE_ZONE } from "@caysonverse/shared/maze";
import { MAZE_LANDMARKS, PLAQUE_SIZE } from "./mazeLandmarks";
import {
  POSTER_DOOR_CLEARANCE,
  POSTER_EYE_Y,
  POSTER_H,
  POSTER_W,
  ROOM_POSTERS,
} from "./RoomPosters";

const LOUNGE = ZONES.lounge;

/** Lounge-side face lines the three posters must sit on (derived, not guessed). */
const MAZE_FACE_X = MAZE_ZONE.maxX + MAZE_WALL_T / 2; // maze east wall, lounge face
const DIVIDER = WALLS.find((w) => Math.abs(w.minX + w.maxX) < 1e-9)!; // centred on x=0
const DIVIDER_FACE_X = DIVIDER.minX; // divider west face (lounge side)
const NORTH_FACE_Z = LOUNGE.minZ; // lounge north wall, south (lounge) face

/** Poster interval [min,max] along its wall's run axis (z for ±X walls, x for ±Z). */
function runSpan(p: (typeof ROOM_POSTERS)[number]): [number, number] {
  const c = p.nx !== 0 ? p.z : p.x;
  return [c - POSTER_W / 2, c + POSTER_W / 2];
}

describe("room posters — identity (design 26)", () => {
  it("names the three enterable rooms, in maze → lecture → gallery order", () => {
    expect(ROOM_POSTERS.map((p) => p.room)).toEqual(["maze", "lectureHall", "gallery"]);
    expect(ROOM_POSTERS.map((p) => p.title)).toEqual(["미로방", "강의실", "AI 갤러리"]);
  });

  it("pairs each room with its symbol emoji (미로 🌀 · 강의실 📚 · 갤러리 🖼)", () => {
    expect(ROOM_POSTERS.map((p) => p.emoji)).toEqual([
      "\u{1F300}",
      "\u{1F4DA}",
      "\u{1F5BC}\u{FE0F}",
    ]);
  });
});

describe("room posters — on the lounge-side wall face", () => {
  it("anchors each poster exactly on its wall's lounge-side face line", () => {
    const [maze, lecture, gallery] = ROOM_POSTERS;
    expect(maze.x).toBeCloseTo(MAZE_FACE_X, 10);
    expect(lecture.x).toBeCloseTo(DIVIDER_FACE_X, 10);
    expect(gallery.z).toBeCloseTo(NORTH_FACE_Z, 10);
  });

  it("backs every poster with a REAL wall run covering its full span", () => {
    const [maze, lecture, gallery] = ROOM_POSTERS;
    const [mzMin, mzMax] = runSpan(maze);
    expect(
      MAZE_WALLS.some(
        (w) => Math.abs(w.maxX - MAZE_FACE_X) < 1e-9 && mzMin >= w.minZ && mzMax <= w.maxZ,
      ),
    ).toBe(true);
    const [lcMin, lcMax] = runSpan(lecture);
    expect(
      WALLS.some(
        (w) => Math.abs(w.minX + w.maxX) < 1e-9 && lcMin >= w.minZ && lcMax <= w.maxZ,
      ),
    ).toBe(true);
    const [glMin, glMax] = runSpan(gallery);
    expect(
      WALLS.some(
        (w) => Math.abs(w.maxZ - NORTH_FACE_Z) < 1e-9 && glMin >= w.minX && glMax <= w.maxX,
      ),
    ).toBe(true);
  });

  it("faces every poster INTO the lounge (unit normal, rotY consistent with it)", () => {
    for (const p of ROOM_POSTERS) {
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 10);
      // One metre along the normal must land strictly inside the lounge.
      const px = p.x + p.nx;
      const pz = p.z + p.nz;
      expect(px).toBeGreaterThan(LOUNGE.minX);
      expect(px).toBeLessThan(LOUNGE.maxX);
      expect(pz).toBeGreaterThan(LOUNGE.minZ);
      expect(pz).toBeLessThan(LOUNGE.maxZ);
      // A +Z-normal plane rotated by rotY has normal (sin rotY, 0, cos rotY).
      expect(Math.sin(p.rotY)).toBeCloseTo(p.nx, 10);
      expect(Math.cos(p.rotY)).toBeCloseTo(p.nz, 10);
    }
  });
});

describe("room posters — clear of the door openings", () => {
  it("records each flanked door span truthfully (pinned literals)", () => {
    const [maze, lecture, gallery] = ROOM_POSTERS;
    // Maze east entrance: grid row 7 opening minus the wall-run half-thickness
    // overhang (maze.ts merge) ⇒ the solid wall ends at z = ∓1.05.
    expect(maze.doorMin).toBeCloseTo(-1.05, 10);
    expect(maze.doorMax).toBeCloseTo(1.05, 10);
    expect(lecture.doorMin).toBeCloseTo(-DOOR_HALF_WIDTH, 10);
    expect(lecture.doorMax).toBeCloseTo(DOOR_HALF_WIDTH, 10);
    expect(gallery.doorMin).toBeCloseTo(GALLERY_DOOR_X - GALLERY_DOOR_HALF_WIDTH, 10);
    expect(gallery.doorMax).toBeCloseTo(GALLERY_DOOR_X + GALLERY_DOOR_HALF_WIDTH, 10);
  });

  it("never overlaps its door — at least the clearance margin between edges", () => {
    expect(POSTER_DOOR_CLEARANCE).toBeGreaterThanOrEqual(0.5);
    for (const p of ROOM_POSTERS) {
      const [min, max] = runSpan(p);
      // Signed gap between the poster interval and the door interval.
      const gap = Math.max(p.doorMin - max, min - p.doorMax);
      expect(gap).toBeGreaterThanOrEqual(POSTER_DOOR_CLEARANCE - 1e-9);
    }
  });

  it("dodges the maze landmark plaques sharing its wall face (no card collision)", () => {
    // mazeLandmarks puts a flush plaque quad on EACH face of every maze wall —
    // including the lounge-side face of the east boundary the poster hangs on.
    const [maze] = ROOM_POSTERS;
    const [min, max] = runSpan(maze);
    const facePlaques = MAZE_LANDMARKS.filter(
      (lm) => lm.axis === "z" && Math.abs(lm.x - MAZE_ZONE.maxX) < 1e-9,
    );
    expect(facePlaques.length).toBeGreaterThan(0); // the hazard is real
    for (const lm of facePlaques) {
      const gap = Math.max(lm.z - PLAQUE_SIZE / 2 - max, min - (lm.z + PLAQUE_SIZE / 2));
      expect(gap).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe("room posters — eye-level card geometry", () => {
  it("centres the card at avatar eye level, fully on the 4 m wall", () => {
    expect(POSTER_EYE_Y).toBeCloseTo(1.6, 10);
    expect(POSTER_EYE_Y + POSTER_H / 2).toBeLessThanOrEqual(WALL_HEIGHT);
    expect(POSTER_EYE_Y - POSTER_H / 2).toBeGreaterThan(0.9); // above floor clutter
  });

  it("keeps the card poster-sized: readable across the lounge, never a billboard", () => {
    expect(POSTER_W).toBeGreaterThanOrEqual(1.0);
    expect(POSTER_W).toBeLessThanOrEqual(1.8);
    expect(POSTER_H).toBeGreaterThanOrEqual(0.7);
    expect(POSTER_H).toBeLessThanOrEqual(1.2);
    expect(POSTER_W).toBeGreaterThan(POSTER_H); // landscape card (name reads big)
  });
});
