/**
 * B1 waterfall, W5: walking at the falls' rest area (fallsWalk.ts): the pocket joins the walk area, the pool cannot be
 * entered, the flat rocks and stone seats are walked to and sat on from either side, the camera keeps out of the rock,
 * and a click on the water goes to the nearest shore. Every check runs on `villageGeometry`, the one collision truth.
 */
import { describe, expect, it, vi } from "vitest";
import { isBlocked, circleIntersectsAABB } from "../collision";
import { reachable } from "../school/reachTestUtil";
import { makeGeometry } from "../school/geometry";
import { PLAYER_RADIUS, SEAT_REACH, approachesSeat, nearestFreeSeat } from "../worldMap";
import { VILLAGE_LAYOUT, villageGeometry } from "./villageLayout";
import { VILLAGE_SEATS, STAND_CLEARANCE, isLotSeat } from "./benchSeats";
import {
  cameraWallBoxes,
  fallsShoreSpot,
  fallsWalkSurfaceOk,
  inFallsRestArea,
  onSlab,
  pocketBlockers,
  poolBlockers,
  poolRadius,
  seatStoneBlockers,
  slabRadius,
  villagePickArea,
  villageWalkArea,
} from "./fallsWalk";

// the flood fills and sweeps are heavy: a slow machine must not fail them on time alone
vi.setConfig({ testTimeout: 120000 });

const L = VILLAGE_LAYOUT;
const W = L.backdrop.waterfall;
const G = villageGeometry;
const R = PLAYER_RADIUS;
const blocked = (x: number, z: number, r = R) => isBlocked(x, z, r, G.obstacles, 0);
const inPocket = (x: number, z: number) => x >= W.pocket.minX && x <= W.pocket.maxX && z >= W.pocket.minZ && z <= W.pocket.maxZ;
/** A 0.1 m flood fill over the rest area and the village edge beside it only (the whole village at 0.1 m is 8 M cells). */
const nearFill = (step = 0.1) =>
  reachable(makeGeometry("village", { minX: W.pocket.minX, maxX: -85, minZ: -95, maxZ: -60 }, [], G.obstacles), { x: -90, z: -78 }, step, 0);
const wallX = (z: number) => {
  const w = W.cameraWall;
  if (z <= w[0].z) return w[0].x;
  for (let i = 1; i < w.length; i++) {
    if (z <= w[i].z) return w[i - 1].x + ((w[i].x - w[i - 1].x) * (z - w[i - 1].z)) / (w[i].z - w[i - 1].z);
  }
  return w[w.length - 1].x;
};

describe("the walk area takes in the rest area", () => {
  it("the geometry's bounds reach the pocket's west edge; the village's own area is unchanged", () => {
    expect(villageWalkArea(L)).toEqual({ minX: W.pocket.minX, maxX: L.areas.village.maxX, minZ: L.areas.village.minZ, maxZ: L.areas.village.maxZ });
    expect(G.bounds.minX).toBe(W.pocket.minX);
    expect(L.areas.village.minX).toBe(-95);
    expect(L.walkBounds.minX).toBe(-95);
    expect(villagePickArea(L).minX).toBeLessThan(W.pool.centre.x - W.pool.radiusX); // the whole pool can be clicked
    expect(villagePickArea(L).maxX).toBe(villageWalkArea(L).maxX);
  });

  it("the column north and south of the pocket is solid, far thicker than one legal step (4.8 m)", () => {
    const [north, south] = pocketBlockers(L);
    expect(north).toEqual({ minX: W.pocket.minX, maxX: W.pocket.maxX, minZ: L.areas.village.minZ, maxZ: W.pocket.minZ });
    expect(south).toEqual({ minX: W.pocket.minX, maxX: W.pocket.maxX, minZ: W.pocket.maxZ, maxZ: L.areas.village.maxZ });
    expect(north.maxZ - north.minZ).toBeGreaterThanOrEqual(4.8);
    for (const b of pocketBlockers(L)) expect(G.obstacles).toContainEqual(b);
  });

  it("the village is joined to the rest area: a flood fill from the spawn reaches the pocket, through the entry", () => {
    const fill = reachable(G, L.spawn, 0.25, 0);
    const inPocketCells = fill.filter((p) => inPocket(p.x, p.z) && p.x < L.walkBounds.minX);
    expect(inPocketCells.length).toBeGreaterThan(150);
    // the front stone, the north end and the south end of the pocket (a body stands there)
    for (const t of [W.slabs[0].centre, { x: -100, z: -89.4 }, { x: -100, z: -68.6 }, { x: -105.5, z: -89.4 }, { x: -105.5, z: -68.6 }]) {
      expect(fill.some((p) => Math.hypot(p.x - t.x, p.z - t.z) <= 0.4), `${t.x},${t.z}`).toBe(true);
    }
    // nothing the fill reaches lies outside the pocket west of the village
    for (const p of fill) if (p.x < L.walkBounds.minX) expect(inPocket(p.x, p.z), `${p.x},${p.z}`).toBe(true);
  });

  it("the village's west column outside the pocket (north and south of it) is solid ground, whatever the point", () => {
    for (let x = W.pocket.minX; x <= W.pocket.maxX; x += 0.25) {
      for (let z = L.areas.village.minZ; z <= L.areas.village.maxZ; z += 0.5) {
        if (z >= W.pocket.minZ && z <= W.pocket.maxZ) continue;
        expect(blocked(x, z, 0.01), `${x},${z}`).toBe(true);
      }
    }
  });
});

describe("the pool cannot be entered, the shore stones can be walked", () => {
  it("every point of the waterline (grown by the keep-out) that is not on a flat rock is solid to a body of 0.4 m (its centre keeps W0's 0.6 m off the water)", () => {
    let n = 0;
    for (let x = W.pocket.minX; x <= W.pocket.maxX; x += 0.05) {
      for (let z = W.pocket.minZ; z <= W.pocket.maxZ; z += 0.05) {
        if (poolRadius(L, x, z, W.pool.keepOut - 0.05) >= 1 || onSlab(L, x, z)) continue;
        n++;
        expect(blocked(x, z), `${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("a free centre is always a point W0's rule allows (walk_surface_ok): in the pocket, off the pool's keep-out unless on a flat rock", () => {
    let free = 0;
    for (let x = W.pocket.minX + R; x <= W.pocket.maxX; x += 0.05) {
      for (let z = W.pocket.minZ + R; z <= W.pocket.maxZ - R; z += 0.05) {
        if (blocked(x, z)) continue;
        free++;
        expect(fallsWalkSurfaceOk(L, x, z), `${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
      }
    }
    expect(free).toBeGreaterThan(5000);
  });

  it("the shore is not wasted: any rest-area point 0.95 m off the pool, 0.4 m off the pocket's edges and off the stones is free", () => {
    for (let x = W.pocket.minX + R + 0.05; x <= L.walkBounds.minX; x += 0.1) {
      for (let z = W.pocket.minZ + R + 0.05; z <= W.pocket.maxZ - R - 0.05; z += 0.1) {
        if (poolRadius(L, x, z, W.pool.keepOut + 0.35) < 1) continue; // within 0.95 m of the waterline (the boxes stand 0.3 m off it, the body 0.4 more, the staircase swells by up to 0.18)
        if (seatStoneBlockers(L).some((b) => circleIntersectsAABB(x, z, R + 0.01, b))) continue;
        expect(blocked(x, z), `${x.toFixed(2)},${z.toFixed(2)}`).toBe(false);
      }
    }
  });

  it("the four flat rocks are standing ground, reached from the shore; the front one reaches out over the water at x ~ -104.5", () => {
    for (const s of W.slabs) {
      // the middle of every rock: a body stands there
      expect(blocked(s.centre.x, s.centre.z), s.id).toBe(false);
      expect(fallsWalkSurfaceOk(L, s.centre.x, s.centre.z), s.id).toBe(true);
    }
    // the front rock: a body walks onto it from the east, to within 0.4 m of its lip (x -104.5)
    const front = W.slabs[0];
    const fill = nearFill();
    const west = Math.min(...fill.filter((p) => Math.abs(p.z - front.centre.z) < 0.35 && p.x < -101).map((p) => p.x));
    expect(west).toBeLessThan(-103.8);
    expect(west).toBeGreaterThan(-104.45);
    // that spot is over the water's edge: inside the waterline ellipse, on the rock
    expect(poolRadius(L, west - 0.3, front.centre.z)).toBeLessThan(1.001);
    expect(slabRadius(front, west, front.centre.z)).toBeLessThan(1);
  });

  it("the pool box set is small and exact: staircase boxes in the pocket, none overlapping a flat rock's heart", () => {
    const boxes = poolBlockers(L);
    expect(boxes.length).toBeGreaterThan(20);
    expect(boxes.length).toBeLessThan(200);
    for (const b of boxes) {
      expect(b.minX).toBeLessThan(b.maxX);
      expect(b.minZ).toBeGreaterThanOrEqual(W.pocket.minZ);
      expect(b.maxZ).toBeLessThanOrEqual(W.pocket.maxZ);
      expect(G.obstacles).toContainEqual(b);
    }
    for (const s of W.slabs) {
      const c = { x: s.centre.x, z: s.centre.z };
      expect(boxes.some((b) => c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ), s.id).toBe(false);
    }
  });

  it("a step of up to 4.8 m from a standing spot cannot land in the water or past the pocket: all such targets are blocked or out of bounds", () => {
    const b = G.bounds;
    let landed = 0;
    for (let x = W.pocket.minX + R; x <= W.pocket.maxX; x += 0.5) {
      for (let z = W.pocket.minZ + R; z <= W.pocket.maxZ - R; z += 0.5) {
        if (blocked(x, z)) continue;
        for (let a = 0; a < 16; a++) {
          const tx = x + 4.8 * Math.cos((a * Math.PI) / 8);
          const tz = z + 4.8 * Math.sin((a * Math.PI) / 8);
          if (tx < W.pocket.maxX + 0.01 && tx > W.pocket.minX - 20 && tz > b.minZ - 20 && tz < b.maxZ + 20 && tx < L.walkBounds.minX) {
            // a landing west of the village's edge: legal only inside the pocket on free ground
            const clamped = tx < b.minX + R || tz < b.minZ + R || tz > b.maxZ - R;
            if (!clamped && !blocked(tx, tz)) {
              landed++;
              expect(inPocket(tx, tz), `${tx},${tz}`).toBe(true);
              expect(fallsWalkSurfaceOk(L, tx, tz), `${tx},${tz}`).toBe(true);
            }
          }
        }
      }
    }
    expect(landed).toBeGreaterThan(100);
  });
});

describe("the two stone seats (backless: sat on from either side)", () => {
  const stones = W.seats;
  const seatsOf = (id: string) => VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => s.bench === id);

  it("four seats a stone, after every seat release 1 had (no earlier index moved; only the zelkova deck of release 3 follows), in the village area", () => {
    const falls = VILLAGE_SEATS.findIndex((s) => s.bench.startsWith("falls_seat_"));
    expect(VILLAGE_SEATS.slice(falls, falls + 8).map((s) => s.bench)).toEqual([...Array(4).fill("falls_seat_n"), ...Array(4).fill("falls_seat_s")]);
    expect(VILLAGE_SEATS.slice(falls + 8).every((s) => isLotSeat(s) || s.area === "park" || s.id.startsWith("zelkova_deck:") || /^h\d+_/.test(s.bench))).toBe(true);
    for (const st of stones) {
      const mine = seatsOf(st.id);
      expect(mine).toHaveLength(4);
      expect(mine.filter(({ s }) => s.yaw < 0)).toHaveLength(2); // west-facing
      expect(mine.filter(({ s }) => s.yaw > 0)).toHaveLength(2); // east-facing
      for (const { s } of mine) {
        expect(s.area).toBe("village");
        expect(s.seatY).toBe(st.seatTop);
        expect(inPocket(s.x, s.z)).toBe(true);
      }
    }
  });

  it("each side's seat sits on its own half of the stone, in front of its edge, two places apart by the usual 1.2 m", () => {
    for (const st of stones) {
      for (const { s } of seatsOf(st.id)) {
        const east = s.yaw > 0;
        expect(Math.abs(s.x - st.centre.x)).toBeCloseTo(st.size.x / 2 + s.frontEdge!, 6);
        expect(Math.sign(s.x - st.centre.x)).toBe(east ? 1 : -1);
        expect(Math.abs(s.z - st.centre.z)).toBeCloseTo(0.6, 6);
      }
      // the two sitters of one side
      for (const yawSign of [-1, 1]) {
        const side = seatsOf(st.id).filter(({ s }) => Math.sign(s.yaw) === yawSign).map(({ s }) => s);
        expect(Math.abs(side[0].z - side[1].z)).toBeCloseTo(1.2, 6);
      }
    }
  });

  it("a sitter on either side is offered the seats of their own side, never the other side's (from behind, there is no way in)", () => {
    for (const st of stones) {
      const mine = seatsOf(st.id);
      for (const side of [-1, 1]) {
        const x = st.centre.x + side * (st.size.x / 2 + 0.9);
        const z = st.centre.z;
        const offered = mine.filter(({ s }) => approachesSeat(s, x, z) && Math.hypot(x - s.x, z - s.z) <= SEAT_REACH);
        expect(offered.length, `${st.id} side ${side}`).toBeGreaterThan(0);
        for (const { s } of offered) expect(Math.sign(s.x - st.centre.x)).toBe(side);
        const pick = nearestFreeSeat(x, z, () => false, SEAT_REACH, VILLAGE_SEATS);
        expect(pick).not.toBeNull();
        expect(VILLAGE_SEATS[pick!].bench).toBe(st.id);
        expect(Math.sign(VILLAGE_SEATS[pick!].x - st.centre.x)).toBe(side);
      }
    }
  });

  it("a sitter's root and the spot they get up to are free ground (the stone itself is the only solid), the stand spot a short step ahead", () => {
    for (const st of stones) {
      for (const { s } of seatsOf(st.id)) {
        expect(isBlocked(s.standX, s.standZ, R + STAND_CLEARANCE, G.obstacles, 0), st.id).toBe(false);
        expect(fallsWalkSurfaceOk(L, s.standX, s.standZ)).toBe(true);
        expect(Math.hypot(s.standX - s.x, s.standZ - s.z)).toBeLessThanOrEqual(0.85);
        expect(approachesSeat(s, s.standX, s.standZ)).toBe(true);
      }
    }
  });

  it("the stone is solid, room to walk round it on both sides and the ends", () => {
    for (const b of seatStoneBlockers(L)) expect(G.obstacles).toContainEqual(b);
    const fill = nearFill();
    for (const st of stones) {
      // both long sides, along the whole stone (its south end reaches the pocket's edge: by W0's numbers no way round that end)
      for (const dz of [-st.size.z / 2, -0.5, 0, 0.5, st.size.z / 2 - 0.1]) {
        for (const dx of [-st.size.x / 2 - 0.6, st.size.x / 2 + 0.6]) {
          const p = { x: st.centre.x + dx, z: st.centre.z + dz };
          expect(fill.some((q) => Math.hypot(q.x - p.x, q.z - p.z) <= 0.1), `${st.id} ${p.x},${p.z}`).toBe(true);
        }
      }
      // round the north/south ends: a 0.8 m wide gap at least between a stone's end and the pocket's edge or the pool
      const north = { x: st.centre.x, z: st.centre.z - st.size.z / 2 - 0.5 };
      const south = { x: st.centre.x, z: st.centre.z + st.size.z / 2 + 0.5 };
      for (const p of [north, south]) {
        if (p.z - R > W.pocket.minZ && p.z + R < W.pocket.maxZ) expect(fill.some((q) => Math.hypot(q.x - p.x, q.z - p.z) <= 0.1), `${st.id} end ${p.z}`).toBe(true);
      }
    }
  });
});

describe("the camera keeps out of the rock", () => {
  const boxes = cameraWallBoxes(L);

  it("every leg of the polyline has a box from the site's west edge to its eastmost end, as tall as the cliff", () => {
    expect(boxes).toHaveLength(W.cameraWall.length - 1);
    for (const b of boxes) {
      expect(b.minX).toBe(W.site.minX);
      expect(b.height).toBeGreaterThanOrEqual(W.height + 5);
      expect(b.minY).toBeLessThan(0); // reaches under the floor: a low arm cannot dive under it
      expect(G.cameraBoxes).toContainEqual(b);
    }
    expect(boxes[0].minZ).toBe(W.site.minZ);
    expect(boxes[boxes.length - 1].maxZ).toBe(W.site.maxZ);
  });

  it("everything west of the polyline, z -104..-58, is inside a box; the boxes never reach the pocket (3 m clear of its west edge)", () => {
    for (let z = W.site.minZ + 0.05; z < W.site.maxZ; z += 0.25) {
      const wx = wallX(Math.max(z, W.cameraWall[0].z));
      for (const x of [W.site.minX + 0.1, wx - 2, wx - 0.05]) {
        expect(boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ), `${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
      }
    }
    for (const b of boxes) expect(b.maxX).toBeLessThan(W.pocket.minX - 3);
    // the camera can still look down on the plunge: the impact point is east of the box at its own z
    const hit = boxes.filter((b) => W.impact.z >= b.minZ && W.impact.z <= b.maxZ);
    for (const b of hit) expect(b.maxX).toBeLessThan(W.impact.x);
  });

  it("a player's body never reaches a camera box: the boxes lie wholly outside the walk area", () => {
    for (const b of boxes) expect(b.maxX).toBeLessThan(villageWalkArea(L).minX);
  });
});

describe("a click on the pool's water walks to the nearest shore", () => {
  it("every click in the pool (its whole waterline, off the rocks) gives a free, reachable spot in the rest area", () => {
    const fill = nearFill();
    const key = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
    const ok = new Set(fill.map((p) => key(p.x, p.z)));
    let n = 0;
    for (let x = W.pool.centre.x - W.pool.radiusX; x <= W.pool.centre.x + W.pool.radiusX + 0.6; x += 0.5) {
      for (let z = W.pool.centre.z - W.pool.radiusZ; z <= W.pool.centre.z + W.pool.radiusZ; z += 0.5) {
        if (poolRadius(L, x, z, 0.6) >= 1 || onSlab(L, x, z)) continue;
        const s = fallsShoreSpot(L, x, z);
        expect(s, `${x},${z}`).not.toBeNull();
        n++;
        expect(blocked(s!.x, s!.z), `${x},${z} -> ${s!.x},${s!.z}`).toBe(false);
        expect(inPocket(s!.x, s!.z)).toBe(true);
        expect(ok.has(key(s!.x, s!.z)), `reachable ${s!.x},${s!.z}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it("the spot is the nearest one: a click near the east tip goes to the shore beside it, not across the pool", () => {
    const fill = nearFill();
    for (const [cx, cz] of [[-104.6, -80.6], [-107, -74], [-105.5, -86], [-110, -88], [-109, -69]]) {
      const s = fallsShoreSpot(L, cx, cz)!;
      const best = Math.min(...fill.filter((p) => p.x >= W.pocket.minX + R && p.x <= L.walkBounds.minX && p.z >= W.pocket.minZ + R && p.z <= W.pocket.maxZ - R).map((p) => Math.hypot(p.x - cx, p.z - cz)));
      expect(Math.hypot(s.x - cx, s.z - cz), `${cx},${cz}`).toBeLessThanOrEqual(best + 0.25);
    }
    const far = fallsShoreSpot(L, -118, -78)!; // the far side: the nearest bank the rest area has
    expect(inPocket(far.x, far.z)).toBe(true);
    expect(Math.hypot(far.x + 118, far.z + 78)).toBeLessThan(16);
  });

  it("clicks on the dry land, on a flat rock, in the village are not water clicks", () => {
    expect(fallsShoreSpot(L, -100, -78)).toBeNull();
    expect(fallsShoreSpot(L, W.slabs[0].centre.x, W.slabs[0].centre.z)).toBeNull();
    expect(fallsShoreSpot(L, 0, 0)).toBeNull();
    expect(fallsShoreSpot(L, -95, -78)).toBeNull();
  });
});

describe("naming the place", () => {
  it("the HUD's area name: the rest area west of the village's edge", () => {
    expect(inFallsRestArea(L, -100, -78)).toBe(true);
    expect(inFallsRestArea(L, -105.5, -88)).toBe(true);
    expect(inFallsRestArea(L, -94, -78)).toBe(false);
    expect(inFallsRestArea(L, -100, -60)).toBe(false);
    expect(inFallsRestArea(L, 0, 0)).toBe(false);
  });
});
