import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { MOVE_ELAPSED_CEIL_MS, RUN_SPEED, VILLAGE_MAX_CLIENTS } from "../constants";
import { PLAYER_RADIUS, SEAT_REACH, approachesSeat } from "../worldMap";
import {
  LAKE_AREA,
  LAKE_COLLIDER_AREA,
  LAKE_DECKS,
  LAKE_FACE_DIR,
  LAKE_FISHING_SPOTS,
  LAKE_FLOOR_Y,
  LAKE_PARAMS,
  LAKE_PAVILION,
  LAKE_RENTAL_PAD,
  LAKE_SHORE,
  LAKE_TRAIL,
  LAKE_WATER_Y,
  distToPolygonEdge,
  exportLakeLayout,
  inLakeWater,
  insidePolygon,
  lakeColliders,
  lakeGreyboxColliders,
  lakeSeats,
  lakeTerrainColliders,
  lakeWalkable,
  onLakeDeck,
} from "./lakeLayout";
import { VILLAGE_LAYOUT, areaGapBlockers, villageGeometry } from "./villageLayout";

const R = PLAYER_RADIUS;
const inBox = (x: number, z: number, b: AABB) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
const strictlyIn = (x: number, z: number, b: AABB) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;

/** The village's boxes near the lake (the rest cannot matter to a walk that starts at the lake): what the walk grid uses. */
const NEAR = villageGeometry.obstacles.filter((b) => b.maxX > 85);
/** The server's test for a landing point: the body's circle against the boxes with COLLISION_EPS of slack. */
const free = (x: number, z: number, r = R) => !isBlocked(x, z, r, NEAR);

function polygonArea(p: readonly { x: number; z: number }[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

describe("the lake's numbers (design chapter 2)", () => {
  it("the zone, the water level and the owner-approved defaults", () => {
    expect(LAKE_AREA).toEqual({ minX: 95.5, maxX: 186, minZ: -69.5, maxZ: 45.5 });
    expect(LAKE_WATER_Y).toBe(-0.55);
    expect(LAKE_FLOOR_Y).toBe(0);
    expect(LAKE_PARAMS.side).toBe("east");
    expect(LAKE_PARAMS.signText).toBe("케이슨 낚시터");
    expect(LAKE_PARAMS.rentalFree).toBe(true);
    expect(LAKE_PARAMS.spotCount).toBe(VILLAGE_MAX_CLIENTS);
    expect(LAKE_TRAIL[0]).toEqual({ x: 38.5, z: 1 });
    expect(LAKE_TRAIL.at(-1)).toEqual({ x: 106, z: -12 });
  });

  it("the reservoir has 18 outline points and about 5,300 m2 of water", () => {
    expect(LAKE_SHORE).toHaveLength(18);
    expect(polygonArea(LAKE_SHORE)).toBeGreaterThan(5000);
    expect(polygonArea(LAKE_SHORE)).toBeLessThan(5600);
    for (const p of LAKE_SHORE) expect(inBox(p.x, p.z, LAKE_AREA)).toBe(true);
  });

  it("the facilities stand on dry ground or a deck, inside the zone", () => {
    for (const g of lakeGreyboxColliders()) {
      const b = g.box;
      for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]] as const) {
        expect(inBox(x, z, LAKE_AREA), g.id).toBe(true);
        if (!g.id.startsWith("lamp") && !onLakeDeck(x, z)) expect(inLakeWater(x, z), `${g.id} (${x}, ${z}) in the water`).toBe(false);
      }
    }
  });
});

describe("the 30 fishing spots (design 2.3)", () => {
  const spots = LAKE_FISHING_SPOTS;

  it("there are as many as the room has seats, with unique ids", () => {
    expect(spots).toHaveLength(VILLAGE_MAX_CLIENTS);
    expect(new Set(spots.map((s) => s.id)).size).toBe(30);
    expect(spots.slice(0, 16).map((s) => s.id)).toEqual(["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "P13", "P14", "P15", "P16"]);
    expect(spots.slice(16).map((s) => s.id)).toEqual(["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "N1", "N2", "N3", "S1", "S2", "S3"]);
  });

  it("the float lands 6 m straight ahead of the spot, in the water", () => {
    for (const s of spots) {
      const d = LAKE_FACE_DIR[s.face];
      expect(s.float.x).toBeCloseTo(s.anchor.x + d.x * LAKE_PARAMS.castMetres, 5);
      expect(s.float.z).toBeCloseTo(s.anchor.z + d.z * LAKE_PARAMS.castMetres, 5);
      expect(Math.hypot(s.float.x - s.anchor.x, s.float.z - s.anchor.z)).toBeCloseTo(6, 3);
      expect(s.yaw).toBeCloseTo(Math.atan2(d.x, d.z), 9);
      expect(inLakeWater(s.float.x, s.float.z), s.id).toBe(true);
      expect(onLakeDeck(s.float.x, s.float.z), `${s.id}: the float lands on a deck`).toBe(false);
      expect(distToPolygonEdge(s.float.x, s.float.z, LAKE_SHORE), `${s.id}: float near the shore`).toBeGreaterThanOrEqual(LAKE_PARAMS.floatShoreMarginMetres);
    }
  });

  it("every two floats are at least 3 m apart (the +-0.6 m scatter still leaves 1.8 m)", () => {
    let min = Infinity;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        min = Math.min(min, Math.hypot(spots[i]!.float.x - spots[j]!.float.x, spots[i]!.float.z - spots[j]!.float.z));
      }
    }
    expect(min).toBeGreaterThanOrEqual(LAKE_PARAMS.floatSpacingMetres);
  });

  it("every spot is on a deck (its edge) or on dry ground, with a chair that fits", () => {
    for (const s of spots) {
      const onDeck = onLakeDeck(s.anchor.x, s.anchor.z);
      const onLand = lakeWalkable(s.anchor.x, s.anchor.z);
      expect(onDeck || onLand, s.id).toBe(true);
      expect(s.group === "pier" || s.group.startsWith("jwadae") ? onDeck : !onDeck, s.id).toBe(true);
    }
  });

  it("the groups are where the design puts them", () => {
    const count = (g: string) => spots.filter((s) => s.group === g).length;
    expect([count("pier"), count("jwadae_a"), count("jwadae_b"), count("shore_n"), count("shore_s")]).toEqual([16, 4, 4, 3, 3]);
  });
});

describe("colliders: what walks and what does not (design 3)", () => {
  const all = lakeColliders();

  it("a modest number of boxes, deterministic", () => {
    expect(lakeTerrainColliders().length).toBeGreaterThan(40);
    expect(lakeTerrainColliders().length).toBeLessThan(400);
    expect(all.length).toBe(lakeTerrainColliders().length + lakeGreyboxColliders().length);
    expect(JSON.stringify(exportLakeLayout())).toBe(JSON.stringify(exportLakeLayout()));
  });

  it("the village's real map holds the lake's boxes", () => {
    for (const b of all) expect(villageGeometry.obstacles).toContain(b);
  });

  it("the water is solid, everywhere off the decks", () => {
    let waterPoints = 0;
    for (let x = LAKE_AREA.minX; x <= LAKE_AREA.maxX; x += 1) {
      for (let z = LAKE_AREA.minZ; z <= LAKE_AREA.maxZ; z += 1) {
        if (inLakeWater(x, z) && !LAKE_DECKS.some((d) => inBox(x, z, d.box))) {
          waterPoints++;
          expect(isBlocked(x, z, 0.05, NEAR, 0), `water at (${x}, ${z}) is walkable`).toBe(true);
        }
      }
    }
    expect(waterPoints).toBeGreaterThan(4500);
  });

  it("the decks are walkable, down to 0.4 m from their edge (the body fits and never hangs over)", () => {
    for (const d of LAKE_DECKS) {
      const b = d.box;
      for (let x = b.minX + R; x <= b.maxX - R + 1e-9; x += 0.1) {
        for (let z = b.minZ + R; z <= b.maxZ - R + 1e-9; z += 0.1) {
          const hut = lakeGreyboxColliders().some((g) => isBlocked(x, z, R, [g.box], 0));
          if (!hut) expect(free(x, z), `${d.id} (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true);
        }
      }
    }
  });

  it("a body never stands in the water, off a deck", () => {
    for (let x = LAKE_AREA.minX; x <= LAKE_AREA.maxX; x += 0.5) {
      for (let z = LAKE_AREA.minZ; z <= LAKE_AREA.maxZ; z += 0.5) {
        if (free(x, z) && inLakeWater(x, z)) expect(onLakeDeck(x, z), `(${x}, ${z}) is open water`).toBe(true);
      }
    }
  });

  it("a body keeps off the mud bank and inside the walk limit", () => {
    for (let x = LAKE_AREA.minX; x <= LAKE_AREA.maxX; x += 0.5) {
      for (let z = LAKE_AREA.minZ; z <= LAKE_AREA.maxZ; z += 0.5) {
        if (!free(x, z) || onLakeDeck(x, z)) continue;
        expect(distToPolygonEdge(x, z, LAKE_SHORE), `(${x}, ${z}) on the bank`).toBeGreaterThanOrEqual(LAKE_PARAMS.bankMetres - 0.5);
        expect(z, `(${x}, ${z}) beyond the walk limit`).toBeGreaterThanOrEqual(-66 - 0.5);
        expect(z).toBeLessThanOrEqual(43 + 0.5);
      }
    }
  });

  it("the lane from the bus lane to the pier is clear (1 m either side of its middle)", () => {
    for (let i = 0; i < LAKE_TRAIL.length - 1; i++) {
      const a = LAKE_TRAIL[i]!;
      const b = LAKE_TRAIL[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      for (let t = 0; t <= len; t += 0.25) {
        for (const w of [-1, 0, 1]) {
          const x = a.x + ((b.x - a.x) * t) / len + nx * w;
          const z = a.z + ((b.z - a.z) * t) / len + nz * w;
          expect(isBlocked(x, z, R, villageGeometry.obstacles, 0.01), `lane (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
        }
      }
    }
  });

  it("the rental pad is clear, the office's window faces it, and the pier's mouth is open", () => {
    for (let a = 0; a < 360; a += 15) {
      const x = LAKE_RENTAL_PAD.x + Math.cos((a * Math.PI) / 180) * LAKE_RENTAL_PAD.radius * 0.6;
      const z = LAKE_RENTAL_PAD.z + Math.sin((a * Math.PI) / 180) * LAKE_RENTAL_PAD.radius * 0.6;
      expect(isBlocked(x, z, R, villageGeometry.obstacles, 0.01), `pad (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
    }
    expect(isBlocked(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z, R, villageGeometry.obstacles, 0.01)).toBe(false);
    expect(LAKE_RENTAL_PAD.z).toBeGreaterThan(-19.5); // south of the office
    for (let z = -13; z <= -11; z += 0.25) expect(free(106, z)).toBe(true);
  });

  it("the village's gap blockers leave the lake zone open and seal the strips above and below it", () => {
    const gap = areaGapBlockers(VILLAGE_LAYOUT);
    const sealed = (x: number, z: number) => gap.some((b) => strictlyIn(x, z, b));
    expect(sealed(120, -20)).toBe(false);
    expect(sealed(180, 40)).toBe(false);
    expect(sealed(120, -70)).toBe(true); // north of the zone
    expect(sealed(120, 46)).toBe(true); // south of it
    expect(sealed(240, 0)).toBe(true); // east of the area, toward the hall
    expect(sealed(60, -20)).toBe(false); // the village itself
    // the strips are thicker than any legal step
    const north = gap.find((b) => b.minZ <= -90 && b.maxZ === LAKE_AREA.minZ)!;
    expect(north.maxZ - north.minZ).toBeGreaterThan(RUN_SPEED * (MOVE_ELAPSED_CEIL_MS / 1000) * 1.5 + 0.5);
  });

  it("the collider area reaches the village's old edge so no gap opens at x 95..95.5", () => {
    expect(LAKE_COLLIDER_AREA.minX).toBe(95);
    expect(free(95.2, -10)).toBe(true);
    expect(free(95.6, -10)).toBe(true);
    expect(free(95.2, -30)).toBe(true);
  });
});

/** The walkable component of the lake and the village next to it, on a 0.25 m grid (cells whose centre is free). */
function walkGrid() {
  const x0 = 88;
  const x1 = 187;
  const z0 = -71;
  const z1 = 47;
  const step = 0.25;
  const cols = Math.round((x1 - x0) / step) + 1;
  const rows = Math.round((z1 - z0) / step) + 1;
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) open[r * cols + c] = free(x0 + c * step, z0 + r * step) ? 1 : 0;
  return { x0, z0, step, cols, rows, open };
}

describe("walking: what is connected (design 12.1)", () => {
  const g = walkGrid();
  const comp = new Int32Array(g.cols * g.rows);
  const cell = (x: number, z: number) => Math.round((z - g.z0) / g.step) * g.cols + Math.round((x - g.x0) / g.step);

  // flood fill from the rental pad
  const queue: number[] = [];
  const start = cell(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z);
  comp[start] = 1;
  queue.push(start);
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      if (g.open[j] && !comp[j]) {
        comp[j] = 1;
        queue.push(j);
      }
    }
  }
  /** Reached: one of the four grid cells round the point is in the walked piece (the point itself is a free place). */
  const reach = (x: number, z: number) => {
    const c0 = Math.floor((x - g.x0) / g.step);
    const r0 = Math.floor((z - g.z0) / g.step);
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) if (comp[(r0 + dr) * g.cols + c0 + dc] === 1) return true;
    return false;
  };

  it("the lane's end at the lake, the pier's mouth and the pad are one walkable piece", () => {
    expect(reach(95.5, -10)).toBe(true); // where the lane meets the lake zone (the plaza itself: client/src/game/lakeReach.test.ts)
    expect(reach(106, -12)).toBe(true);
    expect(reach(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z)).toBe(true);
  });

  it("every seat's get-up spot and every fishing chair can be walked to", () => {
    for (const s of lakeSeats()) {
      expect(reach(s.standX, s.standZ), `${s.id} stand (${s.standX}, ${s.standZ})`).toBe(true);
      if (s.other) expect(reach(s.other.standX, s.other.standZ), `${s.id} other stand`).toBe(true);
    }
  });

  it("the whole lake side is reachable: the north and south shores, both 좌대, the pavilion, the picnic tables", () => {
    for (const [x, z] of [[120, -62], [142, -62], [125, 40], [150, 40], [143, -31.5], [143, 8], [112, 33.5], [99.5, 8.5], [104.5, -28]] as const) {
      if (free(x, z)) expect(reach(x, z), `(${x}, ${z})`).toBe(true);
    }
  });

  it("a legal step (up to 4.8 m) never lands on a free place that is not connected: no jumping the water or the hills", () => {
    const maxStep = RUN_SPEED * (MOVE_ELAPSED_CEIL_MS / 1000) * 1.5;
    let landed = 0;
    let stranded = 0;
    const bad: string[] = [];
    for (let x = 96; x <= 186; x += 1) {
      for (let z = -69; z <= 45; z += 1) {
        if (!reach(x, z)) continue;
        for (let deg = 0; deg < 360; deg += 10) {
          for (let d = 1; d <= maxStep + 1e-9; d += 0.8) {
            const lx = x + Math.cos((deg * Math.PI) / 180) * d;
            const lz = z + Math.sin((deg * Math.PI) / 180) * d;
            if (lx < 96 || lx > 186 - R || lz < -69.5 + R || lz > 45.5 - R) continue;
            if (!free(lx, lz)) continue;
            landed++;
            if (!reach(lx, lz)) {
              stranded++;
              if (bad.length < 5) bad.push(`(${x}, ${z}) -> (${lx.toFixed(2)}, ${lz.toFixed(2)})`);
            }
          }
        }
      }
    }
    expect(landed).toBeGreaterThan(100000);
    expect(bad).toEqual([]);
    expect(stranded).toBe(0);
  });
});

describe("seats (rule P6: every seat sit-able; a backed one only from its front)", () => {
  const seats = lakeSeats();
  const obstacles = villageGeometry.obstacles;

  it("56 seats: 30 chairs, 6 shore-bench seats, 8 picnic, 8 pavilion, 4 porch", () => {
    expect(seats).toHaveLength(56);
    const kinds = (k: string) => seats.filter((s) => s.kind === k).length;
    expect([kinds("fishing_chair"), kinds("bench"), kinds("picnic"), kinds("pavilion"), kinds("porch")]).toEqual([30, 6, 8, 8, 4]);
    expect(new Set(seats.map((s) => s.id)).size).toBe(56);
    expect(seats.slice(0, 30).map((s) => s.spot)).toEqual(LAKE_FISHING_SPOTS.map((s) => s.id));
  });

  it("every get-up spot (both sides) is clear of every collider of the village and on walkable ground", () => {
    for (const s of seats) {
      expect(isBlocked(s.standX, s.standZ, R + 0.05, obstacles, 0), `${s.id} stand`).toBe(false);
      expect(lakeWalkable(s.standX, s.standZ), `${s.id} stand ground`).toBe(true);
      if (s.other) expect(isBlocked(s.other.standX, s.other.standZ, R + 0.05, obstacles, 0), `${s.id} other stand`).toBe(false);
    }
  });

  it("a seat is within reach of its own get-up spot (stand up, sit again)", () => {
    for (const s of seats) {
      expect(Math.hypot(s.standX - s.x, s.standZ - s.z), `${s.id}`).toBeLessThanOrEqual(SEAT_REACH);
    }
  });

  it("fishing chairs: offered from beside and in front of the backrest, never from behind it", () => {
    for (const s of seats.filter((q) => q.kind === "fishing_chair")) {
      expect(s.approach).toBe("side");
      expect(approachesSeat(s, s.standX, s.standZ), `${s.id}: from its own get-up spot`).toBe(true);
      const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
      expect(approachesSeat(s, s.x + f.x * 1, s.z + f.z * 1), `${s.id}: from the water side`).toBe(true);
      expect(approachesSeat(s, s.x - f.x * 1.3, s.z - f.z * 1.3), `${s.id}: from straight behind`).toBe(false);
      expect(approachesSeat(s, s.x - f.x * 0.9, s.z - f.z * 0.9), `${s.id}: from behind the backrest`).toBe(false);
    }
  });

  it("the seated root of a fishing chair is on the deck or the ground, facing the water 6 m of cast ahead", () => {
    for (const s of seats.filter((q) => q.kind === "fishing_chair")) {
      const spot = LAKE_FISHING_SPOTS.find((q) => q.id === s.spot)!;
      expect(s.yaw).toBeCloseTo(spot.yaw, 9);
      expect(onLakeDeck(s.x, s.z) || !inLakeWater(s.x, s.z), `${s.id} root`).toBe(true);
      expect(Math.hypot(s.x - spot.anchor.x, s.z - spot.anchor.z)).toBeLessThan(0.5);
    }
  });

  it("backed benches (shore benches, porch benches): front only", () => {
    for (const s of seats.filter((q) => q.kind === "bench" || q.kind === "porch")) {
      expect(s.backed).toBe(true);
      expect(s.approach).toBe("front");
      expect(s.frontEdge).toBeDefined();
      const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
      expect(approachesSeat(s, s.x + f.x * 1.2, s.z + f.z * 1.2), `${s.id} from the front`).toBe(true);
      expect(approachesSeat(s, s.x - f.x * 1.0, s.z - f.z * 1.0), `${s.id} from behind`).toBe(false);
      expect(approachesSeat(s, s.standX, s.standZ), `${s.id} from its own get-up spot`).toBe(true);
    }
  });

  it("backless seats (picnic benches, pavilion boards): from either side, facing the way the sitter came", () => {
    const either = seats.filter((q) => q.kind === "picnic" || q.kind === "pavilion");
    expect(either).toHaveLength(16);
    for (const s of either) {
      expect(s.backed).toBe(false);
      expect(s.approach).toBe("either");
      expect(s.frontEdge).toBeUndefined();
      expect(s.other).toBeDefined();
      // the two sides face opposite ways and their get-up spots are on opposite sides of the seat
      expect(Math.abs(Math.abs(s.yaw - s.other!.yaw) - Math.PI)).toBeLessThan(1e-9);
      const ax = s.standX - s.x;
      const az = s.standZ - s.z;
      const bx = s.other!.standX - s.x;
      const bz = s.other!.standZ - s.z;
      if (s.kind === "pavilion") expect(ax * bx + az * bz, `${s.id}: both get-up spots on the same side`).toBeLessThan(0);
      else expect(s.other!.standX).toBe(s.standX); // a picnic bench: the table side is solid, the sitter gets up where they came from
      expect(approachesSeat(s, s.x + 1, s.z + 1)).toBe(true);
      expect(approachesSeat(s, s.x - 1, s.z - 1)).toBe(true);
      expect(s.rootAhead).toBeCloseTo(0.397, 3);
    }
    // two seats a bench, 1.2 m apart: the seated figure is about 1.05 m across
    for (const k of new Set(either.map((s) => s.bench))) {
      const two = either.filter((s) => s.bench === k);
      expect(two).toHaveLength(2);
      expect(Math.hypot(two[0]!.x - two[1]!.x, two[0]!.z - two[1]!.z)).toBeGreaterThanOrEqual(1.16);
    }
  });

  it("no two seats are closer than a seated body", () => {
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        expect(Math.hypot(seats[i]!.x - seats[j]!.x, seats[i]!.z - seats[j]!.z), `${seats[i]!.id} / ${seats[j]!.id}`).toBeGreaterThanOrEqual(1.1);
      }
    }
  });

  it("the pavilion stands on dry ground, 6 x 6 m", () => {
    const c = LAKE_PAVILION.centre;
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) {
      expect(inLakeWater(c.x + dx, c.z + dz)).toBe(false);
      expect(insidePolygon(c.x + dx, c.z + dz, [{ x: LAKE_AREA.minX, z: LAKE_AREA.minZ }, { x: LAKE_AREA.maxX, z: LAKE_AREA.minZ }, { x: LAKE_AREA.maxX, z: LAKE_AREA.maxZ }, { x: LAKE_AREA.minX, z: LAKE_AREA.maxZ }])).toBe(true);
      expect(lakeWalkable(c.x + dx, c.z + dz)).toBe(true);
    }
  });
});

describe("the exporter's data for the art chunks", () => {
  const data = exportLakeLayout();
  it("carries the names the chunks agreed on (col__lake_*, seat__lake_*, spot__*)", () => {
    expect(data.format).toBe("caysonverse-lake-layout");
    expect(data.spots).toHaveLength(30);
    expect(data.spots[0]!.node).toBe("spot__P01");
    expect(data.colliders.every((c) => c.node === `col__lake_${c.id}`)).toBe(true);
    expect(data.seats).toHaveLength(56);
    expect(data.seats[0]!.node).toBe("seat__lake_chair_P01");
    expect(data.terrainColliders.length).toBe(lakeTerrainColliders().length);
    expect(data.waterY).toBe(-0.55);
  });
  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(JSON.parse(JSON.stringify(exportLakeLayout())));
  });
});
