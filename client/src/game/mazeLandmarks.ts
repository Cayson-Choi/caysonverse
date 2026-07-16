/**
 * Deterministic emoji-landmark placement for the maze — a PURE, client-only
 * module (no THREE, no React, no server contract). It derives plaque anchors and
 * their emojis SOLELY from the shared maze wall AABBs plus the maze seed, so every
 * client computes byte-identical placement with zero network sync (mirrors the
 * single-source discipline of shared/maze.ts, but stays client-side because it is
 * purely visual — the server never knows plaques exist).
 *
 * Placement: a fixed sub-PRNG (mulberry32, seeded off the maze seed) marches along
 * each wall run dropping anchors every 4–6 m; runs too short for a stride get one
 * centred anchor. Each anchor is assigned an emoji that differs from the previous
 * anchor's, so neighbours stay tellable apart. The renderer (MazeWalls.tsx) turns
 * every anchor into TWO plaque quads — one flush on each wall face — via
 * `plaqueQuads`, grouped per-emoji into merged geometry to stay inside the draw
 * budget. Determinism, spacing, on-wall, adjacency and flush invariants are pinned
 * by mazeLandmarks.test.ts.
 */

import type { AABB } from "@caysonverse/shared/collision";
import { MAZE_WALLS, MAZE_SEED, MAZE_WALL_T } from "@caysonverse/shared/maze";
import { ZONES } from "@caysonverse/shared/worldMap";

/**
 * ~24 one-glyph landmarks (animals · fruit · symbols), each visually distinct at a
 * glance so a player can recall "the fox corridor" vs "the key corridor". Written
 * as \u{…} code points (mojibake-proof, matching maze.ts's escapeMessage style).
 */
export const LANDMARK_EMOJIS: readonly string[] = [
  "\u{1F436}", // 🐶 dog
  "\u{1F431}", // 🐱 cat
  "\u{1F98A}", // 🦊 fox
  "\u{1F43C}", // 🐼 panda
  "\u{1F438}", // 🐸 frog
  "\u{1F989}", // 🦉 owl
  "\u{1F422}", // 🐢 turtle
  "\u{1F419}", // 🐙 octopus
  "\u{1F34E}", // 🍎 apple
  "\u{1F34C}", // 🍌 banana
  "\u{1F347}", // 🍇 grapes
  "\u{1F353}", // 🍓 strawberry
  "\u{1F351}", // 🍑 peach
  "\u{1F955}", // 🥕 carrot
  "\u{2B50}", //  ⭐ star
  "\u{1F319}", // 🌙 moon
  "\u{1F338}", // 🌸 blossom
  "\u{1F340}", // 🍀 clover
  "\u{1F511}", // 🔑 key
  "\u{1F388}", // 🎈 balloon
  "\u{26A1}", //  ⚡ bolt
  "\u{1F3B5}", // 🎵 note
  "\u{1F9ED}", // 🧭 compass
  "\u{1F48E}", // 💎 gem
] as const;

/** Plaque side length (m). Small enough to sit flush on the 2.1 m corridor walls. */
export const PLAQUE_SIZE = 0.65;

/** Plaque centre height (m) — roughly avatar eye level. */
export const PLAQUE_EYE_Y = 1.5;

/** Outward offset from the wall face (m) — lifts the quad off the wall to kill z-fighting. */
export const PLAQUE_FACE_GAP = 0.02;

/** Half the wall thickness — the run overhang trim AND the base face offset. */
const HT = MAZE_WALL_T / 2;

/** Keep the plaque's half-width clear of the run ends (fits flush, no corner overhang). */
const MARGIN = 0.45;

/** Stride bounds (m) between consecutive anchors on one run. */
const SPACING_MIN = 4;
const SPACING_MAX = 6;

/** Shortest run (m, core) that still earns a landmark. */
const MIN_RUN = 1.0;

/** One placed landmark: an anchor centred on a wall run, plus its emoji. */
export interface Landmark {
  /** Index into the source walls array. */
  wall: number;
  /** Run axis: "x" = horizontal wall (faces ±Z), "z" = vertical wall (faces ±X). */
  axis: "x" | "z";
  /** Anchor centre X on the wall centreline (world space). */
  x: number;
  /** Anchor centre Z on the wall centreline (world space). */
  z: number;
  /** Half the wall thickness — the base offset to each face. */
  half: number;
  /** Index into LANDMARK_EMOJIS. */
  emojiIndex: number;
  /** The emoji glyph (LANDMARK_EMOJIS[emojiIndex]). */
  emoji: string;
}

/** One plaque quad ready to render: a face position + the Y-rotation facing outward. */
export interface PlaqueQuad {
  x: number;
  y: number;
  z: number;
  /** Rotation about Y so the plane's +Z normal points out of the wall face. */
  rotationY: number;
  emojiIndex: number;
}

/** mulberry32 — the same tiny PRNG the maze uses (identical seed ⇒ identical stream). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Anchor coordinates (along the run) for one wall — draws stride rnds in order. */
function runOffsets(runStart: number, runEnd: number, rnd: () => number): number[] {
  const core = runEnd - runStart;
  if (core < MIN_RUN) return [];
  const usableStart = runStart + MARGIN;
  const usableEnd = runEnd - MARGIN;
  // Too short for a full stride → one centred anchor (still a memorable marker).
  if (usableEnd - usableStart < SPACING_MIN) return [(runStart + runEnd) / 2];
  const out: number[] = [];
  let p = usableStart;
  while (p <= usableEnd + 1e-9) {
    out.push(p);
    p += SPACING_MIN + rnd() * (SPACING_MAX - SPACING_MIN);
  }
  return out;
}

/**
 * Build the landmark placement for `walls` under `seed`. Deterministic: same
 * inputs ⇒ byte-identical output. The sub-seed is derived from the maze seed so a
 * different maze relays a different plaque layout, but for a fixed maze every
 * client agrees. Walls are visited in array order (a fixed, shared ordering).
 */
export function buildMazeLandmarks(walls: readonly AABB[], seed: number): Landmark[] {
  // A fixed derivation off the maze seed — its own stream, independent of the maze
  // carve, but still 100% reproducible from the seed alone.
  const rnd = mulberry32((Math.imul(seed + 1, 0x9e3779b1) ^ 0x5f356495) >>> 0);
  const out: Landmark[] = [];
  let lastEmoji = -1;

  for (let wi = 0; wi < walls.length; wi++) {
    const w = walls[wi];
    const horizontal = w.maxX - w.minX >= w.maxZ - w.minZ;
    const axis: "x" | "z" = horizontal ? "x" : "z";
    const perp = horizontal ? (w.minZ + w.maxZ) / 2 : (w.minX + w.maxX) / 2;
    const axisMin = horizontal ? w.minX : w.minZ;
    const axisMax = horizontal ? w.maxX : w.maxZ;
    // Trim the half-thickness corner overhang so anchors sit on the real wall.
    const offsets = runOffsets(axisMin + HT, axisMax - HT, rnd);

    for (const along of offsets) {
      let e = Math.floor(rnd() * LANDMARK_EMOJIS.length);
      if (e === lastEmoji) e = (e + 1) % LANDMARK_EMOJIS.length; // never repeat a neighbour
      lastEmoji = e;
      out.push({
        wall: wi,
        axis,
        x: horizontal ? along : perp,
        z: horizontal ? perp : along,
        half: HT,
        emojiIndex: e,
        emoji: LANDMARK_EMOJIS[e],
      });
    }
  }
  return out;
}

/**
 * True when a plaque face point lies inside the maze zone. Plaques are
 * INTERIOR-ONLY (design 26 follow-up): an anchor on a boundary wall would put
 * its outward face in the lounge (visible from the lobby — owner rejected) or
 * in the void outside the world, so those faces are simply not generated.
 */
function insideMaze(x: number, z: number): boolean {
  const m = ZONES.maze;
  return x >= m.minX && x <= m.maxX && z >= m.minZ && z <= m.maxZ;
}

/**
 * Expand anchors into render-ready plaque quads: one flush on each of the wall's
 * two faces — but ONLY faces inside the maze (see insideMaze; interior walls keep
 * both, boundary walls keep just the corridor side). Each quad is rotated so its
 * front points out into the flanking corridor (the back is occluded by the
 * 4 m-tall wall, so a corridor only ever sees the correct-reading side). The face
 * gap keeps every quad within PLAQUE_FACE_GAP of the wall — never intruding into
 * the corridor.
 */
export function plaqueQuads(landmarks: readonly Landmark[]): PlaqueQuad[] {
  const out: PlaqueQuad[] = [];
  const off = HT + PLAQUE_FACE_GAP;
  const push = (q: PlaqueQuad) => {
    if (insideMaze(q.x, q.z)) out.push(q);
  };
  for (const lm of landmarks) {
    if (lm.axis === "x") {
      // Horizontal wall → faces at ±Z. Plane +Z normal: rotY 0 faces +Z, PI faces -Z.
      push({ x: lm.x, y: PLAQUE_EYE_Y, z: lm.z + off, rotationY: 0, emojiIndex: lm.emojiIndex });
      push({ x: lm.x, y: PLAQUE_EYE_Y, z: lm.z - off, rotationY: Math.PI, emojiIndex: lm.emojiIndex });
    } else {
      // Vertical wall → faces at ±X. rotY +PI/2 faces +X, -PI/2 faces -X.
      push({ x: lm.x + off, y: PLAQUE_EYE_Y, z: lm.z, rotationY: Math.PI / 2, emojiIndex: lm.emojiIndex });
      push({ x: lm.x - off, y: PLAQUE_EYE_Y, z: lm.z, rotationY: -Math.PI / 2, emojiIndex: lm.emojiIndex });
    }
  }
  return out;
}

/**
 * The maze's landmark placement, derived ONCE at module load from the shared wall
 * AABBs + seed. Consumed by MazeWalls.tsx; identical on every client.
 */
export const MAZE_LANDMARKS: readonly Landmark[] = buildMazeLandmarks(MAZE_WALLS, MAZE_SEED);
