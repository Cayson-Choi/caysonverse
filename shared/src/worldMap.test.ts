import { describe, it, expect } from "vitest";
import {
  OBSTACLES,
  WALLS,
  FURNITURE,
  FURNITURE_MODELS,
  SPAWN_POINT,
  SPAWN_JITTER,
  PLAYER_RADIUS,
  WORLD_BOUNDS,
  ZONES,
  GALLERY_ZONE,
  GALLERY_DOOR_X,
  GALLERY_DOOR_HALF_WIDTH,
  SEATS,
  SEAT_REACH,
  SEAT_YAW,
  furnitureObstacle,
  nearestFreeSeat,
} from "./worldMap";
import { MAZE_WALLS, MAZE_ZONE, MAZE_GOAL, MAZE_PORTAL, MAZE_RETURN } from "./maze";
import { isBlocked, resolveCollision, COLLISION_EPS } from "./collision";

function inside(box: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

describe("worldMap — structure", () => {
  it("has well-formed obstacles (min < max on both axes)", () => {
    for (const o of OBSTACLES) {
      expect(o.maxX).toBeGreaterThan(o.minX);
      expect(o.maxZ).toBeGreaterThan(o.minZ);
    }
  });

  it("derives OBSTACLES = solid furniture + walls + screen + maze walls (no others)", () => {
    const solidFurniture = FURNITURE.filter((p) => FURNITURE_MODELS[p.model].solid).length;
    expect(OBSTACLES.length).toBe(solidFurniture + WALLS.length + 1 + MAZE_WALLS.length);
  });

  it("excludes non-solid decor (rug, lamp) from obstacles", () => {
    // No obstacle is ever derived from a non-solid model …
    for (const p of FURNITURE) {
      if (FURNITURE_MODELS[p.model].solid) continue;
      const foot = furnitureObstacle(p);
      expect(OBSTACLES).not.toContainEqual(foot);
    }
    // … and a point under the rug but clear of the (solid) coffee table on it is walkable.
    expect(isBlocked(-23.5, 0.8, PLAYER_RADIUS, OBSTACLES)).toBe(false);
  });
});

describe("worldMap — spawn", () => {
  it("spawns inside the lounge and world bounds", () => {
    expect(inside(ZONES.lounge, SPAWN_POINT.x, SPAWN_POINT.z)).toBe(true);
    expect(inside(WORLD_BOUNDS, SPAWN_POINT.x, SPAWN_POINT.z)).toBe(true);
  });

  it("keeps the whole spawn jitter disk (+player radius) clear of obstacles", () => {
    // A circle covering the jitter disk plus the player's body must hit nothing.
    const clearance = SPAWN_JITTER + PLAYER_RADIUS;
    expect(isBlocked(SPAWN_POINT.x, SPAWN_POINT.z, clearance, OBSTACLES, 0)).toBe(false);
  });
});

describe("worldMap — door gap is walkable", () => {
  it("lets a player pass through the divider at z = 0", () => {
    for (let x = -2; x <= 2; x += 0.25) {
      expect(isBlocked(x, 0, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("keeps the divider solid away from the door (e.g. z = -8)", () => {
    expect(isBlocked(0, -8, PLAYER_RADIUS, OBSTACLES)).toBe(true);
  });

  it("has a clear straight corridor from the lounge through the door into the hall (z = 0)", () => {
    for (let x = -15; x <= 20; x += 0.5) {
      expect(isBlocked(x, 0, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });
});

describe("worldMap — maze zone integration (v2-3 west extension)", () => {
  it("extends WORLD_BOUNDS west to the maze zone, lounge/hall unchanged", () => {
    expect(WORLD_BOUNDS.minX).toBe(MAZE_ZONE.minX); // derived, not a bumped literal
    expect(WORLD_BOUNDS.maxX).toBe(30);
    expect(ZONES.lounge).toEqual({ minX: -30, maxX: 0, minZ: -18, maxZ: 18 });
    expect(ZONES.lectureHall).toEqual({ minX: 0, maxX: 30, minZ: -18, maxZ: 18 });
    // The maze is a full 36×36 room west of the lounge.
    expect(ZONES.maze.maxX - ZONES.maze.minX).toBe(36);
    expect(ZONES.maze.maxZ - ZONES.maze.minZ).toBe(36);
    expect(ZONES.maze.maxX).toBe(-30); // its east wall == the lounge's west edge
  });

  it("joins the merged maze walls into OBSTACLES (single derivation)", () => {
    for (const w of MAZE_WALLS) expect(OBSTACLES).toContainEqual(w);
  });

  it("connects lounge⇄maze through the door at z≈0 (walk west through the opening)", () => {
    // From the lounge (x=-29) west through the door into the maze entrance cell
    // (centre ≈ x=-31.2) the path is clear — the maze's east wall opens at z≈0.
    for (let x = -29; x >= -31.2; x -= 0.3) {
      expect(isBlocked(x, 0, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("keeps the lounge⇄maze wall solid away from the door (e.g. z = 8)", () => {
    // A body pressed against the maze's east wall off the opening is blocked —
    // the only way in is the z≈0 door.
    expect(isBlocked(-30, 8, PLAYER_RADIUS, OBSTACLES)).toBe(true);
  });

  it("keeps the whole spawn jitter disk clear after the west extension", () => {
    const clearance = SPAWN_JITTER + PLAYER_RADIUS;
    expect(isBlocked(SPAWN_POINT.x, SPAWN_POINT.z, clearance, OBSTACLES, 0)).toBe(false);
  });

  it("puts goal + portal inside the maze zone, on clear chamber floor", () => {
    for (const box of [MAZE_GOAL, MAZE_PORTAL]) {
      expect(box.minX).toBeGreaterThanOrEqual(MAZE_ZONE.minX);
      expect(box.maxX).toBeLessThanOrEqual(MAZE_ZONE.maxX);
      expect(box.minZ).toBeGreaterThanOrEqual(MAZE_ZONE.minZ);
      expect(box.maxZ).toBeLessThanOrEqual(MAZE_ZONE.maxZ);
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      expect(isBlocked(cx, cz, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("teleports returns to a clear lounge spot near the door (not the spawn)", () => {
    expect(isBlocked(MAZE_RETURN.x, MAZE_RETURN.z, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    // In the lounge, east of the maze wall, and NOT the spawn point.
    expect(MAZE_RETURN.x).toBeGreaterThan(-30);
    expect(MAZE_RETURN.x).toBeLessThan(0);
    expect(Math.hypot(MAZE_RETURN.x - SPAWN_POINT.x, MAZE_RETURN.z - SPAWN_POINT.z)).toBeGreaterThan(2);
  });

  it("blocks a body pushed into a maze wall (server drop / client slide truth)", () => {
    // Straight west from the entrance cell centre (-31.2, 0) is a wall (x≈-32.4);
    // a body there overlaps it — the move validator would drop the tunnel attempt.
    expect(isBlocked(-32.4, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true);
  });
});

describe("worldMap — walls keep the player in", () => {
  it("blocks a body pressed against each outer bound", () => {
    expect(isBlocked(WORLD_BOUNDS.maxX, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true); // east
    expect(isBlocked(WORLD_BOUNDS.minX, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true); // west
    expect(isBlocked(0, WORLD_BOUNDS.maxZ, PLAYER_RADIUS, OBSTACLES)).toBe(true); // south (z=+18)
    // The world's minZ line is the GALLERY's far wall (v2-11) — solid on the
    // door axis; off the gallery's x-range that line borders unreachable void
    // (sealed at z=-18 instead — see the wall-seal invariant suite).
    expect(isBlocked(GALLERY_DOOR_X, WORLD_BOUNDS.minZ, PLAYER_RADIUS, OBSTACLES)).toBe(true); // north
  });
});

describe("worldMap — seats (derived from the classroom placement)", () => {
  it("derives exactly 20 student seats (the instructor set was removed — design 27)", () => {
    expect(SEATS.length).toBe(20);
  });

  it("places every seat inside the lecture-hall zone", () => {
    for (const s of SEATS) {
      expect(inside(ZONES.lectureHall, s.x, s.z)).toBe(true);
    }
  });

  it("faces every chair MODEL toward the screen (+X): rotY = +PI/2 (backrest west)", () => {
    // The chair GLB rests facing +Z, so rotY = +PI/2 turns the seat toward +X (the
    // screen) with the backrest to the west — matching the seated player's SEAT_YAW.
    // Empirically confirmed by the task-v2-04 screenshots; a regression that flips a
    // chair back to -PI/2 (seat facing AWAY from the screen) fails here.
    const chairs = FURNITURE.filter((p) => p.model === "chairDesk");
    expect(chairs.length).toBe(SEATS.length); // one chair per seat (20 students)
    for (const c of chairs) expect(c.rotY).toBeCloseTo(Math.PI / 2, 10);
  });

  it("faces every seat toward the screen (+X): player-yaw = +PI/2", () => {
    // Player-yaw convention is atan2(dirX, dirZ) with the model facing +Z at yaw 0
    // (see client MODEL_FACING_OFFSET/worldDirection). Facing +X ⇒ atan2(1,0) = +PI/2.
    // The chair model's rotY is also +PI/2 (model rests facing +Z — see SEAT_YAW
    // doc; separate convention, asserted by its own regression test).
    for (const s of SEATS) {
      expect(s.yaw).toBeCloseTo(Math.PI / 2, 10);
    }
    expect(SEAT_YAW).toBeCloseTo(Math.PI / 2, 10);
  });

  it("keeps every dismount point clear of all obstacles (chair, desk, walls)", () => {
    for (const s of SEATS) {
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("keeps every dismount point inside the world bounds (inset by the body radius)", () => {
    for (const s of SEATS) {
      expect(s.standX).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + PLAYER_RADIUS);
      expect(s.standX).toBeLessThanOrEqual(WORLD_BOUNDS.maxX - PLAYER_RADIUS);
      expect(s.standZ).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ + PLAYER_RADIUS);
      expect(s.standZ).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
    }
  });

  it("keeps each seat↔dismount distance sane (0.5..2 m) and within reach", () => {
    for (const s of SEATS) {
      const d = Math.hypot(s.x - s.standX, s.z - s.standZ);
      expect(d).toBeGreaterThanOrEqual(0.5);
      expect(d).toBeLessThanOrEqual(2);
      // A player standing at the dismount point can always sit back down.
      expect(d).toBeLessThanOrEqual(SEAT_REACH);
    }
  });

  it("dismounts every student to the WEST (each desk is to the east — the aisle side)", () => {
    // All 20 seats are students; each desk sits east of its chair, so 'away from
    // the desk' must resolve west (-X) for every seat.
    for (const s of SEATS) expect(s.standX).toBeLessThan(s.x);
  });

  it("puts each seat on the same chairDesk footprint the furniture renders", () => {
    // Every seat centre must coincide with a real chairDesk placement (single truth).
    const chairs = FURNITURE.filter((p) => p.model === "chairDesk");
    for (const s of SEATS) {
      const match = chairs.find((c) => Math.abs(c.x - s.x) < 1e-9 && Math.abs(c.z - s.z) < 1e-9);
      expect(match).toBeDefined();
    }
  });
});

describe("worldMap — nearestFreeSeat (client proximity, pure)", () => {
  const none = () => false;

  it("returns null when no seat is within reach", () => {
    expect(nearestFreeSeat(SPAWN_POINT.x, SPAWN_POINT.z, none)).toBeNull();
  });

  it("returns the seat whose dismount point you are standing on", () => {
    const target = 5;
    const s = SEATS[target];
    expect(nearestFreeSeat(s.standX, s.standZ, none)).toBe(target);
  });

  it("skips an occupied seat and offers the next nearest free one", () => {
    const target = 5;
    const s = SEATS[target];
    // Standing on seat 5's dismount but seat 5 is taken → no OTHER seat is in reach.
    expect(nearestFreeSeat(s.standX, s.standZ, (i) => i === target)).toBeNull();
  });

  it("never offers a seat beyond SEAT_REACH", () => {
    const s = SEATS[0];
    // A point exactly SEAT_REACH + a hair past the seat centre is out of reach.
    expect(nearestFreeSeat(s.x - (SEAT_REACH + 0.01), s.z, none)).toBeNull();
  });
});

describe("worldMap — gallery zone integration (v2-11 north extension, design 25)", () => {
  it("extends WORLD_BOUNDS north to the gallery zone; every other edge unchanged", () => {
    expect(WORLD_BOUNDS.minZ).toBe(GALLERY_ZONE.minZ); // derived, not a bumped literal
    expect(WORLD_BOUNDS.minX).toBe(MAZE_ZONE.minX);
    expect(WORLD_BOUNDS.maxX).toBe(30);
    expect(WORLD_BOUNDS.maxZ).toBe(18);
  });

  it("shapes the gallery as an 18×16 m annex on the lounge's north wall", () => {
    expect(GALLERY_ZONE).toEqual({ minX: -24, maxX: -6, minZ: -34, maxZ: -18 });
    expect(ZONES.gallery).toEqual(GALLERY_ZONE);
    // The annex sits entirely on the lounge's footprint edge (never past it).
    expect(GALLERY_ZONE.minX).toBeGreaterThanOrEqual(ZONES.lounge.minX);
    expect(GALLERY_ZONE.maxX).toBeLessThanOrEqual(ZONES.lounge.maxX);
    expect(GALLERY_ZONE.maxZ).toBe(ZONES.lounge.minZ);
    // Existing zones are byte-identical to their pre-extension values.
    expect(ZONES.lounge).toEqual({ minX: -30, maxX: 0, minZ: -18, maxZ: 18 });
    expect(ZONES.lectureHall).toEqual({ minX: 0, maxX: 30, minZ: -18, maxZ: 18 });
    expect(ZONES.maze).toEqual(MAZE_ZONE);
  });

  it("opens the gallery door inside the gallery's own south wall (never the void)", () => {
    const doorMin = GALLERY_DOOR_X - GALLERY_DOOR_HALF_WIDTH;
    const doorMax = GALLERY_DOOR_X + GALLERY_DOOR_HALF_WIDTH;
    expect(doorMax - doorMin).toBeCloseTo(2.5, 10); // design 25: ~2.5 m opening
    expect(doorMin).toBeGreaterThan(GALLERY_ZONE.minX);
    expect(doorMax).toBeLessThan(GALLERY_ZONE.maxX);
  });

  it("connects spawn → gallery centre along a clear walked route (door included)", () => {
    // Legs mirror the E2E walk: west of the spawn column, north to the
    // wall, over to the door axis, straight through the 2.5 m opening, then deep
    // into the room. Every sampled body position must be walkable.
    const legs: Array<[number, number, number, number]> = [
      [-15, 0, -18, 0], // spawn → west of the sofa column
      [-18, 0, -18, -16.5], // north along the clear corridor
      [-18, -16.5, -15, -16.5], // over to the door axis
      [-15, -16.5, -15, -20], // THROUGH the door (crosses z = -18)
      [-15, -20, -15, -26], // to the gallery centre
    ];
    for (const [x0, z0, x1, z1] of legs) {
      const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25);
      for (let s = 0; s <= steps; s++) {
        const x = x0 + ((x1 - x0) * s) / steps;
        const z = z0 + ((z1 - z0) * s) / steps;
        expect(isBlocked(x, z, PLAYER_RADIUS, OBSTACLES), `blocked at (${x}, ${z})`).toBe(false);
      }
    }
  });

  it("keeps the lounge north wall solid away from the door", () => {
    expect(isBlocked(-20, -18, PLAYER_RADIUS, OBSTACLES)).toBe(true); // west of the door
    expect(isBlocked(-10, -18, PLAYER_RADIUS, OBSTACLES)).toBe(true); // east of the door
    expect(isBlocked(-27, -18, PLAYER_RADIUS, OBSTACLES)).toBe(true); // lounge segment west of the gallery
    expect(isBlocked(-3, -18, PLAYER_RADIUS, OBSTACLES)).toBe(true); // lounge segment east of the gallery
    expect(isBlocked(15, -18, PLAYER_RADIUS, OBSTACLES)).toBe(true); // lecture hall north wall
  });

  it("keeps the gallery interior obstacle-free (portraits are wall décor, not obstacles)", () => {
    // A generous inner margin (walls + body radius) — the whole exhibition floor
    // is walkable, so visitors can stand anywhere in front of any portrait.
    for (let x = GALLERY_ZONE.minX + 1; x <= GALLERY_ZONE.maxX - 1; x += 0.5) {
      for (let z = GALLERY_ZONE.minZ + 1; z <= GALLERY_ZONE.maxZ - 1.5; z += 0.5) {
        expect(isBlocked(x, z, PLAYER_RADIUS, OBSTACLES), `blocked at (${x}, ${z})`).toBe(false);
      }
    }
  });
});

describe("worldMap — wall-seal invariant (north extension opens NO gap into the void)", () => {
  /**
   * Exact free (walkable-centre) intervals for a body of radius r sliding along a
   * fixed-Z line: the complement of the union of every obstacle's blocked
   * x-interval, computed in CLOSED FORM from the same circle-vs-AABB math
   * `isBlocked` uses (dz = distance to the box's z-band; blocked where
   * dx² + dz² < eff²) — so, unlike a sampled scan, a sliver thinner than any
   * sampling step cannot hide between probes.
   */
  function freeIntervalsAlongZ(
    zLine: number,
    x0: number,
    x1: number,
    r: number,
  ): Array<[number, number]> {
    const eff = r - COLLISION_EPS; // isBlocked's slack-adjusted effective radius
    const blocked: Array<[number, number]> = [];
    for (const b of OBSTACLES) {
      const dz = zLine < b.minZ ? b.minZ - zLine : zLine > b.maxZ ? zLine - b.maxZ : 0;
      if (dz >= eff) continue;
      const halfW = Math.sqrt(eff * eff - dz * dz);
      blocked.push([b.minX - halfW, b.maxX + halfW]);
    }
    blocked.sort((a, b) => a[0] - b[0]);
    const free: Array<[number, number]> = [];
    let cursor = x0;
    for (const [s, e] of blocked) {
      if (e <= cursor) continue;
      if (s > cursor) free.push([cursor, Math.min(s, x1)]);
      cursor = Math.max(cursor, e);
      if (cursor >= x1) break;
    }
    if (cursor < x1) free.push([cursor, x1]);
    return free.filter(([s, e]) => e - s > 1e-9);
  }

  /** Same closed-form seal scan for a fixed-X line (gallery west/east walls). */
  function freeIntervalsAlongX(
    xLine: number,
    z0: number,
    z1: number,
    r: number,
  ): Array<[number, number]> {
    const eff = r - COLLISION_EPS;
    const blocked: Array<[number, number]> = [];
    for (const b of OBSTACLES) {
      const dx = xLine < b.minX ? b.minX - xLine : xLine > b.maxX ? xLine - b.maxX : 0;
      if (dx >= eff) continue;
      const halfW = Math.sqrt(eff * eff - dx * dx);
      blocked.push([b.minZ - halfW, b.maxZ + halfW]);
    }
    blocked.sort((a, b) => a[0] - b[0]);
    const free: Array<[number, number]> = [];
    let cursor = z0;
    for (const [s, e] of blocked) {
      if (e <= cursor) continue;
      if (s > cursor) free.push([cursor, Math.min(s, z1)]);
      cursor = Math.max(cursor, e);
      if (cursor >= z1) break;
    }
    if (cursor < z1) free.push([cursor, z1]);
    return free.filter(([s, e]) => e - s > 1e-9);
  }

  it("seals the ENTIRE z = -18 interface except exactly one opening: the gallery door", () => {
    // Any path from the old map into the extension strip must cross z = -18.
    // The exact free set of that whole 96 m line must be ONE interval, and it must
    // lie inside the gallery door span (which itself opens into the gallery box).
    const free = freeIntervalsAlongZ(
      ZONES.lounge.minZ,
      WORLD_BOUNDS.minX,
      WORLD_BOUNDS.maxX,
      PLAYER_RADIUS,
    );
    expect(free.length).toBe(1);
    const [s, e] = free[0];
    expect(s).toBeGreaterThanOrEqual(GALLERY_DOOR_X - GALLERY_DOOR_HALF_WIDTH);
    expect(e).toBeLessThanOrEqual(GALLERY_DOOR_X + GALLERY_DOOR_HALF_WIDTH);
    // …and a real body actually fits through it (a sliver would be a broken door).
    expect(e - s).toBeGreaterThan(2 * PLAYER_RADIUS);
  });

  it("seals the gallery's west, east and north walls completely (no opening at all)", () => {
    const west = freeIntervalsAlongX(
      GALLERY_ZONE.minX,
      GALLERY_ZONE.minZ,
      GALLERY_ZONE.maxZ,
      PLAYER_RADIUS,
    );
    expect(west).toEqual([]);
    const east = freeIntervalsAlongX(
      GALLERY_ZONE.maxX,
      GALLERY_ZONE.minZ,
      GALLERY_ZONE.maxZ,
      PLAYER_RADIUS,
    );
    expect(east).toEqual([]);
    const north = freeIntervalsAlongZ(
      GALLERY_ZONE.minZ,
      GALLERY_ZONE.minX,
      GALLERY_ZONE.maxX,
      PLAYER_RADIUS,
    );
    expect(north).toEqual([]);
  });

  it("flood-fills from spawn into every zone but never escapes the zone union", () => {
    // Grid BFS over the whole bounds (+2 m margin past every edge so an escape
    // would be caught, not clipped): a cell is enterable iff a body there is not
    // blocked. The reachable set must (a) touch all four zones — the doors work —
    // and (b) contain no cell outside maze∪lounge∪hall∪gallery: the void exposed
    // by the north extension is unreachable, wall-sealed everywhere but the door.
    const step = 0.4;
    const margin = 2;
    const minX = WORLD_BOUNDS.minX - margin;
    const maxX = WORLD_BOUNDS.maxX + margin;
    const minZ = WORLD_BOUNDS.minZ - margin;
    const maxZ = WORLD_BOUNDS.maxZ + margin;
    const cols = Math.floor((maxX - minX) / step) + 1;
    const rows = Math.floor((maxZ - minZ) / step) + 1;
    const xOf = (i: number) => minX + i * step;
    const zOf = (j: number) => minZ + j * step;
    const si = Math.round((SPAWN_POINT.x - minX) / step);
    const sj = Math.round((SPAWN_POINT.z - minZ) / step);
    expect(isBlocked(xOf(si), zOf(sj), PLAYER_RADIUS, OBSTACLES)).toBe(false); // seed sanity

    const seen = new Uint8Array(cols * rows);
    const queue: number[] = [si + sj * cols];
    seen[queue[0]] = 1;
    const reached: Array<{ x: number; z: number }> = [];
    while (queue.length) {
      const idx = queue.pop()!;
      const i = idx % cols;
      const j = (idx - i) / cols;
      reached.push({ x: xOf(i), z: zOf(j) });
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nidx = ni + nj * cols;
        if (seen[nidx]) continue;
        seen[nidx] = 1;
        if (!isBlocked(xOf(ni), zOf(nj), PLAYER_RADIUS, OBSTACLES)) queue.push(nidx);
      }
    }

    expect(reached.length).toBeGreaterThan(5000); // sanity: the world really was walked
    const zones = Object.values(ZONES);
    const eps = 1e-9;
    const escapes = reached.filter(
      (p) =>
        !zones.some(
          (zn) =>
            p.x >= zn.minX - eps && p.x <= zn.maxX + eps && p.z >= zn.minZ - eps && p.z <= zn.maxZ + eps,
        ),
    );
    expect(escapes).toEqual([]); // NOT ONE reachable point outside the zone union
    for (const [name, zn] of Object.entries(ZONES)) {
      expect(reached.some((p) => inside(zn, p.x, p.z)), `zone ${name} is reachable`).toBe(true);
    }
  });
});

describe("worldMap — sofa collision (deterministic simulation)", () => {
  it("stops a player walking south into the central set's north sofa OUTSIDE its footprint", () => {
    // The central conversation set's north seat (design 32) — directly south of
    // the spawn, so holding 's' from spawn walks straight into its back.
    const sofa = FURNITURE.find((p) => p.model === "loungeSofa" && p.x === -15 && p.z === 3.5)!;
    const footprint = furnitureObstacle(sofa);

    // Simulate the E2E: hold 's' (moves +Z) from spawn for ~3 s at 4 m/s, 50 ms steps.
    let pos: { x: number; z: number } = { x: SPAWN_POINT.x, z: SPAWN_POINT.z };
    for (let i = 0; i < 60; i++) {
      pos = resolveCollision(pos.x, pos.z, 0, 4 * 0.05, PLAYER_RADIUS, OBSTACLES);
    }

    // Walked a real distance toward the sofa …
    expect(pos.z).toBeGreaterThan(1.5);
    // … but stopped NORTH of (outside) the footprint — never passed through.
    expect(pos.z).toBeLessThan(footprint.minZ);
    expect(inside(footprint, pos.x, pos.z)).toBe(false);
    // and it is resting ~one radius off the sofa face (proves collision stopped it).
    expect(pos.z).toBeCloseTo(footprint.minZ - PLAYER_RADIUS, 6);
  });
});
