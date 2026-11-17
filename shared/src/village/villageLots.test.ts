import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { BUS_STOP_PAD, VILLAGE_LAYOUT, boxAt, solidBox, villageGeometry } from "./villageLayout";
import { LAKE_TRAIL, LAKE_TRAIL_WIDTH } from "./lakeLayout";
import {
  LOT_GLB_BUDGET,
  LOT_REPLACED_MODEL_BOXES,
  LOT_ROOF_SLABS,
  LOT_SURFACE_RULES,
  LOT_SEAT_ORDER,
  LOT_SIGN_WORDS,
  LOT_TRIANGLES,
  VILLAGE_LOTS,
  allLotColliders,
  allLotSeatMarkers,
  lotBox,
  lotGeometryColliders,
  lotRoomColliders,
  lotColliders,
  lotDoorPoints,
  lotFootprint,
  lotLocalToWorld,
  lotSeatMarkers,
  lotSlots,
  lotWorldToLocal,
  lotYaw,
  replacedByLot,
  lotsForLayoutJson,
  maxBaseSceneTriangles,
  worstSceneTrianglesWithLots,
  type VillageLot,
} from "./villageLots";

const overlaps = (a: AABB, b: AABB, gap = 0) => a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
const inside = (a: AABB, b: AABB, eps = 1e-6) => a.minX >= b.minX - eps && a.maxX <= b.maxX + eps && a.minZ >= b.minZ - eps && a.maxZ <= b.maxZ + eps;
const boxDistToPoint = (b: AABB, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
/** The smallest distance from a box to the origin's circle-road centre: the nearest point of the box to (0, 0). */
const minRadius = (b: AABB) => boxDistToPoint(b, 0, 0);

/** Distance from a point to a segment. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
/** Smallest distance between a box and a polyline (sampled along the polyline every 10 cm). */
function boxToPolyline(b: AABB, pts: readonly { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, c = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.1));
    for (let k = 0; k <= n; k++) best = Math.min(best, boxDistToPoint(b, a.x + ((c.x - a.x) * k) / n, a.z + ((c.z - a.z) * k) / n));
  }
  return best;
}

/** The houses' A8 footprints (docs/designs/house-exteriors/contract.md ch.2 on feat/exterior 5bda2ec): the lots must clear these too. */
const A8_HOUSES: readonly [string, number, number, number, number][] = [
  ["house_1", 21, -43.175, 11.2, 10.75], ["house_2", -21, -43.175, 11.2, 10.75], ["house_3", 29, 38.775, 11.2, 10.75],
  ["house_4", -32.4, 40.575, 11.2, 10.75], ["house_5", -46.775, -8, 10.75, 11.2], ["house_6", 42, 43.675, 11.2, 10.75],
  ["house_7", 31, -58.375, 11.2, 10.75], ["house_8", -49.775, 40.6, 10.75, 11.2], ["house_9", -31, -58.375, 11.2, 10.75],
  ["house_10", -40.375, 26.4, 10.75, 11.2],
];
/** The A8 tree moves (same contract): the lots must keep 1.5 m clear of these trunks. */
const A8_TREES: readonly [string, number, number][] = [
  ["tree_15", 34, 49], ["tree_16", 21.5, 46.5], ["tree_17", -39.8, 48.5], ["tree_19", -50.05, 0.4], ["tree_26", 23, -66], ["tree_27", -38.5, -66], ["bush_15", -45.4, 18.6],
];
/** Today's village obstacles, minus what vrb2 removes from the plots (the library's scaffold, col__construction). */
// (the lots' own boxes and rooms, wired since L5v2, are not what a lot must keep clear of)
const ownKey = (b: AABB) => `${b.minX},${b.maxX},${b.minZ},${b.maxZ}`;
const lotOwn = new Set([...lotGeometryColliders().obstacles, ...lotRoomColliders().obstacles].map(ownKey));
const villageObstacles: AABB[] = villageGeometry.obstacles.filter((b) => !isConstruction(b) && !lotOwn.has(ownKey(b)));
function isConstruction(b: AABB): boolean {
  // col__construction (generated villageColliders.ts): x -72.4..-66.3, z 2.6..21.4
  return b.minX === -72.4 && b.maxX === -66.3 && b.minZ === 2.6 && b.maxZ === 21.4;
}

describe("the lots: frame, ids, words", () => {
  it("six lots, one per empty plot plus the 케이슨랜드 gate; the memorial's plot stays as it is", () => {
    expect(VILLAGE_LOTS.map((l) => l.id)).toEqual(["lot_school", "lot_chapel", "lot_library", "lot_temple", "lot_church", "lot_gate"]);
    // (vrb2, release 4: the plots lost their signs — the empty plots are every plot but the memorial's)
    const empty = VILLAGE_LAYOUT.plots.filter((p) => p.id !== "plot_n").map((p) => p.id).sort();
    expect(VILLAGE_LOTS.map((l) => l.plot).filter((p) => p !== null).sort()).toEqual(empty);
    expect(VILLAGE_LOTS.filter((l) => l.plot === null).map((l) => l.id)).toEqual(["lot_gate"]);
  });

  it("v2: each plot gets the building its original name board promised (owner 2026-11-17: \"원래대로 다 지어\")", () => {
    const kindOf: Record<string, string> = { 학교: "school", 성당: "chapel", 도서관: "library", 절: "temple", 교회: "church" };
    for (const l of VILLAGE_LOTS) {
      if (!l.plot) continue;
      const p = VILLAGE_LAYOUT.plots.find((q) => q.id === l.plot)!;
      expect(l.kind, `${l.id} on ${p.id} (${p.label})`).toBe(kindOf[p.label]);
    }
  });

  it("the gate entry is exactly the one built on feat/lot-mart-gate 75ab7df (its GLB, colliders and seats stay valid)", () => {
    const g = VILLAGE_LOTS.find((l) => l.id === "lot_gate")!;
    expect({ centre: g.centre, front: g.front, depth: g.depth, doorSide: g.doorSide, height: g.height, body: g.body }).toEqual({
      centre: { x: -24, z: 89 }, front: 20, depth: 12, doorSide: "n", height: 16.5, body: { x0: -10, x1: 10, z0: -6, z1: -3.6 },
    });
    expect(g.colliders.map((c) => c.suffix)).toEqual([
      "tower_l", "tower_r", "leaves", "booth_l", "booth_r", "fence_l", "fence_r", "fence_ml", "fence_mr",
      "wing_l", "wing_r", "dome_l", "dome_r", "barrier", "fountain", "planter_l", "planter_r", "lamp_1", "lamp_2", "lamp_3", "lamp_4",
    ]);
    expect(g.seats.map((x) => x.id)).toEqual(["lot_gate_bench_1", "lot_gate_bench_2"]);
    expect(LOT_TRIANGLES.lot_gate).toEqual({ shell: 4_000, detail: 25_000 });
  });

  it("the old construction site goes with the wiring, model or not (owner: the crane and the scaffold go)", () => {
    const c = LOT_REPLACED_MODEL_BOXES.find((r) => r.id === "construction")!;
    expect(c.lot).toBe("lot_library");
    expect(replacedByLot({ minX: -72.4, maxX: -66.3, minZ: 2.6, maxZ: 21.4 })).toBe(true);
    // ...and the library's own footprint does not reach the old scaffold's box (nothing of it is left standing inside the lot)
    const lib = VILLAGE_LOTS.find((l) => l.id === "lot_library")!;
    expect(overlaps(lotFootprint(lib), c.box)).toBe(false);
  });

  it("brand-new PBR families per lot, and roof slabs are inside the footprint above head height", () => {
    for (const l of VILLAGE_LOTS) {
      expect(LOT_SURFACE_RULES.families[l.id].length, l.id).toBeGreaterThan(3);
      for (const r of LOT_ROOF_SLABS[l.id]) {
        expect(inside(lotBox(l, r.rect), lotFootprint(l)), `${l.id} slab`).toBe(true);
        expect(r.minY, l.id).toBeGreaterThanOrEqual(2.6);
        expect(r.height).toBeGreaterThan(r.minY);
      }
    }
  });

  it("local <-> world round trip, and the door side is the local +z side", () => {
    for (const l of VILLAGE_LOTS) {
      for (const [lx, lz] of [[1.5, 2.25], [-3, 4], [0, -2]] as const) {
        const w = lotLocalToWorld(l, lx, lz);
        const back = lotWorldToLocal(l, w.x, w.z);
        expect(back.lx).toBeCloseTo(lx, 2);
        expect(back.lz).toBeCloseTo(lz, 2);
      }
      const front = lotLocalToWorld(l, 0, l.depth / 2);
      const fp = lotFootprint(l);
      const onSide = { n: Math.abs(front.z - fp.minZ), s: Math.abs(front.z - fp.maxZ), e: Math.abs(front.x - fp.maxX), w: Math.abs(front.x - fp.minX) }[l.doorSide];
      expect(onSide, l.id).toBeLessThan(1e-6);
      expect(lotYaw(l, "out")).toBeCloseTo({ s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[l.doorSide], 6);
    }
  });

  it("collider and seat ids are unique; the seat order is fixed (append only)", () => {
    const ids = allLotColliders().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LOT_SEAT_ORDER).toEqual(allLotSeatMarkers().map((s) => s.id));
    expect(new Set(LOT_SEAT_ORDER).size).toBe(LOT_SEAT_ORDER.length);
    expect(LOT_SEAT_ORDER).toEqual([
      "lot_school_bench_1",
      "lot_school_bench_2",
      "lot_chapel_bench_1",
      "lot_chapel_bench_2",
      "lot_library_bench_1",
      "lot_library_bench_2",
      "lot_temple_bench_1",
      "lot_temple_bench_2",
      "lot_church_bench_1",
      "lot_church_bench_2",
      "lot_gate_bench_1",
      "lot_gate_bench_2",
    ]);
    for (const id of [...ids, ...LOT_SEAT_ORDER]) expect(id).toMatch(/^lot_[a-z0-9_]+$/);
  });

  it("signs use generic words only (no denomination, diocese, order, real temple name, scripture or brand)", () => {
    for (const l of VILLAGE_LOTS) {
      expect(LOT_SIGN_WORDS, l.id).toContain(l.sign);
      for (const u of l.units) expect(LOT_SIGN_WORDS, u.id).toContain(u.sign);
      for (const d of l.doors) if (d.closedNote) expect(LOT_SIGN_WORDS, d.id).toContain(d.closedNote);
    }
    for (const w of LOT_SIGN_WORDS) expect(w, w).not.toMatch(/천주교|가톨릭|교구|장로|감리|침례|성결|순복음|조계|태고|천태|사$|卍|아멘|할렐루야|나무아미타불|성경|불경/);
  });

  it("the religious buildings' doors say a quiet note, not 준비 중", () => {
    for (const id of ["lot_chapel", "lot_temple", "lot_church"]) {
      const l = VILLAGE_LOTS.find((x) => x.id === id)!;
      for (const d of l.doors) expect(d.closedNote, d.id).toBe("조용히 둘러보세요");
    }
  });

  it("slots: unique nodes, price-tag holders numbered from 1, interior slots inside their unit's room", () => {
    const nodes = VILLAGE_LOTS.flatMap((l) => lotSlots(l).flatMap((s) => [s.node, ...s.tags]));
    expect(new Set(nodes).size).toBe(nodes.length);
    for (const l of VILLAGE_LOTS) {
      for (const s of l.slots) {
        if (s.where === "exterior") {
          const p = lotLocalToWorld(l, s.lx, s.lz);
          expect(boxDistToPoint(lotFootprint(l), p.x, p.z), `${l.id} ${s.name}`).toBeLessThan(1e-6);
          continue;
        }
        const unit = l.units.find((u) => `interior:${u.id}` === s.where);
        expect(unit, `${l.id} ${s.name}`).toBeDefined();
        expect(s.lx).toBeGreaterThanOrEqual(0);
        expect(s.lx).toBeLessThanOrEqual(unit!.interior.size.x);
        expect(s.lz).toBeGreaterThanOrEqual(0);
        expect(s.lz).toBeLessThanOrEqual(unit!.interior.size.z);
      }
    }
    // the economy hooks the design promises exist
    const kinds = new Set(VILLAGE_LOTS.flatMap((l) => l.slots.map((s) => s.kind)));
    for (const k of ["playground", "bell", "clock", "reading_nook", "book_return", "lantern", "pond", "garden", "nameplate", "notice_board"] as const) expect(kinds.has(k), k).toBe(true);
    // owner 2026-11-17 "낚시해서 뭔가 돈으로 바꾸고 이런건 다 취소다. 그런거 없다": no economy hook in the five new lots (the gate's
    // ticket windows stay as 75ab7df built them, shut and decorative — see contract 5)
    for (const l of VILLAGE_LOTS.filter((x) => x.id !== "lot_gate")) for (const sl of l.slots) {
      expect(["sell_counter", "price_board", "scale", "shop_rack", "checkout", "fitting_room", "atm", "parcel_counter", "house_desk", "ticket_booth", "turnstile"], l.id + " " + sl.name).not.toContain(sl.kind);
      expect(sl.tags, l.id + " " + sl.name).toBe(0);
    }
    expect(LOT_SIGN_WORDS.filter((w) => /원|입장권|이용권|가격|시세|사요|팔아요/.test(w))).toEqual([]);
  });

  it("interiors: reserved origins far from the village and the hall (x >= 400), rooms never overlap", () => {
    const rooms = VILLAGE_LOTS.flatMap((l) => l.units.map((u) => ({ id: u.id, box: boxAt(u.interior.origin, u.interior.size), area: u.interior.area })));
    for (const r of rooms) {
      expect(r.box.minX, r.id).toBeGreaterThanOrEqual(395);
      expect(r.area).toBe(`lot:${r.id}`);
    }
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) expect(overlaps(rooms[i]!.box, rooms[j]!.box, 4), `${rooms[i]!.id} / ${rooms[j]!.id}`).toBe(false);
  });

  it("layout.json form carries everything the build reads", () => {
    const j = lotsForLayoutJson() as { id: string; colliders: unknown[]; seats: unknown[]; doors: unknown[] }[];
    expect(j).toHaveLength(6);
    for (const l of j) {
      expect(l.colliders.length).toBeGreaterThan(0);
      expect(l.doors.length).toBeGreaterThan(0);
    }
  });
});

describe("the lots on the map: no overlap with roads, lanes, houses, trees, water", () => {
  const foot = new Map(VILLAGE_LOTS.map((l) => [l.id, lotFootprint(l)]));

  it("each lot stays inside its plot (the gate inside the walk bounds) and the village's walk bounds", () => {
    const wb = VILLAGE_LAYOUT.walkBounds;
    for (const l of VILLAGE_LOTS) {
      const f = foot.get(l.id)!;
      expect(inside(f, { minX: wb.minX, maxX: wb.maxX, minZ: wb.minZ, maxZ: wb.maxZ }), l.id).toBe(true);
      if (l.plot) {
        const p = VILLAGE_LAYOUT.plots.find((q) => q.id === l.plot)!;
        expect(inside(f, boxAt(p.centre, p.size)), l.id).toBe(true);
      }
    }
  });

  it("lots don't overlap each other (3 m apart at least)", () => {
    const ls = [...foot.entries()];
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) expect(overlaps(ls[i]![1], ls[j]![1], 3), `${ls[i]![0]} / ${ls[j]![0]}`).toBe(false);
  });

  it("clear of the ring road and its sidewalk (r 39), the bus stop pad, the lake trail and the plaza", () => {
    const pad: AABB = {
      minX: Math.min(...BUS_STOP_PAD.map((p) => p.x)), maxX: Math.max(...BUS_STOP_PAD.map((p) => p.x)),
      minZ: Math.min(...BUS_STOP_PAD.map((p) => p.z)), maxZ: Math.max(...BUS_STOP_PAD.map((p) => p.z)),
    };
    const ring = VILLAGE_LAYOUT.ringRoad;
    for (const [id, f] of foot) {
      expect(minRadius(f), id).toBeGreaterThan(ring.radius + ring.width / 2 + ring.sidewalk.width + 1);
      expect(overlaps(f, pad, 1), id).toBe(false);
      expect(boxToPolyline(f, LAKE_TRAIL), id).toBeGreaterThan(LAKE_TRAIL_WIDTH / 2 + 0.5);
    }
  });

  it("lanes only touch a lot at its approach (the lane's last point), never cross a building body", () => {
    for (const l of VILLAGE_LOTS) {
      const f = foot.get(l.id)!;
      const body = lotBox(l, l.body);
      for (const lane of VILLAGE_LAYOUT.lanes) {
        // the lane's corridor (half width) must not reach the body; only the lot's own lane may end on the footprint's front edge
        expect(boxToPolyline(body, lane.points), `${l.id} body / ${lane.id}`).toBeGreaterThan(lane.width / 2 + 1);
        const own = l.plot && lane.id === `lane_${l.plot}`;
        if (!own) expect(boxToPolyline(f, lane.points), `${l.id} / ${lane.id}`).toBeGreaterThan(lane.width / 2);
      }
      if (l.plot) {
        const lane = VILLAGE_LAYOUT.lanes.find((q) => q.id === `lane_${l.plot}`)!;
        const end = lane.points[lane.points.length - 1]!;
        expect(Math.hypot(end.x - l.approach.x, end.z - l.approach.z), `${l.id} approach`).toBeLessThan(5);
        expect(boxDistToPoint(f, l.approach.x, l.approach.z), `${l.id} approach on its edge`).toBeLessThan(1e-6);
      }
    }
  });

  it("clear of every house (today's and the A8 footprints), the café, the kiosk and their terraces", () => {
    for (const [id, f] of foot) {
      for (const h of VILLAGE_LAYOUT.sceneryHouses) {
        expect(overlaps(f, boxAt(h.centre, h.size), 1.5), `${id} / ${h.id}`).toBe(false);
        expect(overlaps(f, solidBox(h), 1.5), `${id} / ${h.id} solid`).toBe(false);
      }
      for (const [hid, x, z, sx, sz] of A8_HOUSES) expect(overlaps(f, boxAt({ x, z }, { x: sx, z: sz }), 1.5), `${id} / A8 ${hid}`).toBe(false);
    }
  });

  it("clear of every model collider (trees, bushes, benches, creek banks, the pavilion) and the A8 tree moves", () => {
    for (const l of VILLAGE_LOTS) {
      const f = foot.get(l.id)!;
      const hits = villageObstacles.filter((b) => overlaps(f, b, 0.3) && !isConstruction(b));
      expect(hits, l.id).toEqual([]);
      for (const [tid, x, z] of A8_TREES) expect(boxDistToPoint(f, x, z), `${l.id} / ${tid}`).toBeGreaterThan(1.5);
    }
  });

  it("doors: every v2 swing door opens INWARD as a pair of leaves, and the swept quarter-circles stay inside the body and clear of every other collider", () => {
    for (const l of VILLAGE_LOTS) {
      if (l.id === "lot_gate") continue; // the gate's leaves are 75ab7df's (closed until B11)
      for (const d of l.doors) {
        expect(d.wall, d.id).toBe("front");
        // two leaves of width/2 hinged at the jambs, swinging into the building: the swept box is width x width/2 behind the wall
        const sweep = { x0: d.at - d.width / 2, x1: d.at + d.width / 2, z0: l.body.z1 - d.width / 2, z1: l.body.z1 };
        expect(sweep.x0 >= l.body.x0 && sweep.x1 <= l.body.x1 && sweep.z0 >= l.body.z0, d.id).toBe(true);
        const sw = lotBox(l, sweep);
        for (const c of lotColliders(l).slice(1)) expect(overlaps(sw, c.box), `${d.id} / ${c.id}`).toBe(false);
        expect(d.height, d.id).toBeGreaterThanOrEqual(3.2); // chibi scale (head 2.16 m)
      }
    }
  });

  it("every collider of a lot lies inside its footprint; the body is inside, the doors are on the body's walls", () => {
    for (const l of VILLAGE_LOTS) {
      const f = foot.get(l.id)!;
      for (const c of lotColliders(l)) expect(inside(c.box, f), `${c.id}`).toBe(true);
      for (const d of l.doors) {
        const span = d.wall === "front" ? [l.body.x0, l.body.x1] : [l.body.z0, l.body.z1];
        expect(d.at - d.width / 2, d.id).toBeGreaterThanOrEqual(span[0]! - 1e-6);
        expect(d.at + d.width / 2, d.id).toBeLessThanOrEqual(span[1]! + 1e-6);
      }
      for (const u of l.units) {
        const d = l.doors.find((q) => q.id === u.door)!;
        expect(d, u.id).toBeDefined();
        expect(d.at - d.width / 2, u.id).toBeGreaterThanOrEqual(u.x0);
        expect(d.at + d.width / 2, u.id).toBeLessThanOrEqual(u.x1);
      }
    }
  });
});

// ─────────────────────────────── walking: doors, seats and counters are reachable ───────────────────────────────

/** The map with the lots built: today's obstacles (minus what vrb2 clears) plus every lot collider. */
const obstacles: AABB[] = [...villageObstacles.filter((b) => !isConstruction(b)), ...allLotColliders().map((c) => c.box)];
const BUCKET = 4;
const buckets = new Map<string, AABB[]>();
for (const b of obstacles) {
  for (let bx = Math.floor((b.minX - 1) / BUCKET); bx <= Math.floor((b.maxX + 1) / BUCKET); bx++)
    for (let bz = Math.floor((b.minZ - 1) / BUCKET); bz <= Math.floor((b.maxZ + 1) / BUCKET); bz++) {
      const k = `${bx},${bz}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(b);
    }
}
const wb = VILLAGE_LAYOUT.walkBounds;
const free = (x: number, z: number, r = PLAYER_RADIUS): boolean => {
  if (x < wb.minX + r || x > wb.maxX - r || z < wb.minZ + r || z > wb.maxZ - r) return false;
  return !isBlocked(x, z, r, buckets.get(`${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`) ?? []);
};

describe("walking with the lots built (0.25 m grid flood fill from the spawn)", () => {
  const step = 0.25;
  const cols = Math.round((wb.maxX - wb.minX) / step) + 1;
  const rows = Math.round((wb.maxZ - wb.minZ) / step) + 1;
  const reached = new Uint8Array(cols * rows);
  const idx = (c: number, r: number) => r * cols + c;
  const cellOf = (x: number, z: number) => [Math.round((x - wb.minX) / step), Math.round((z - wb.minZ) / step)] as const;
  const open = (c: number, r: number) => free(wb.minX + c * step, wb.minZ + r * step);
  {
    const sp = VILLAGE_LAYOUT.spawn;
    const [c0, r0] = cellOf(sp.x, sp.z);
    const queue: number[] = [idx(c0, r0)];
    reached[idx(c0, r0)] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi]!;
      const c = i % cols;
      const r = (i - c) / cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = idx(nc, nr);
        if (!reached[j] && open(nc, nr)) {
          reached[j] = 1;
          queue.push(j);
        }
      }
    }
  }
  /** A free point is reached when a grid cell next to it is. */
  const reach = (x: number, z: number) => {
    if (!free(x, z)) return false;
    const c0 = Math.floor((x - wb.minX) / step);
    const r0 = Math.floor((z - wb.minZ) / step);
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) if (reached[idx(c0 + dc, r0 + dr)]) return true;
    return false;
  };

  it("every door pad and arrival is free and walkable from the plaza", () => {
    for (const l of VILLAGE_LOTS) {
      for (const p of lotDoorPoints(l)) {
        expect(reach(p.pad.x, p.pad.z), `${p.door} pad (${p.pad.x}, ${p.pad.z})`).toBe(true);
        expect(reach(p.arrival.x, p.arrival.z), `${p.door} arrival`).toBe(true);
      }
      expect(reach(l.approach.x + (l.doorSide === "e" ? 0.6 : l.doorSide === "w" ? -0.6 : 0), l.approach.z + (l.doorSide === "s" ? 0.6 : l.doorSide === "n" ? -0.6 : 0)), `${l.id} approach`).toBe(true);
    }
  });

  it("the schoolyard: through the front gate to the swings, the slide, the seesaw and the sandbox; the picket fence holds", () => {
    const l = VILLAGE_LOTS.find((x) => x.id === "lot_school")!;
    for (const [lx, lz, what] of [[0, 9.5, "gate"], [-5.4, 3.2, "beside the swings"], [-6.4, 7.8, "the slide's foot"], [8.1, 4, "the seesaw"], [8, 7, "the sandbox"], [-9.6, -5, "behind the school, north"], [9.6, -5, "behind the school, south"]] as const) {
      const p = lotLocalToWorld(l, lx, lz);
      expect(reach(p.x, p.z), `school ${what} (${p.x}, ${p.z})`).toBe(true);
    }
    for (const lx of [-8, 6]) {
      const p = lotLocalToWorld(l, lx, 9.94);
      expect(free(p.x, p.z), `front fence at ${lx}`).toBe(false);
    }
  });

  it("the chapel's two gardens, the library's reading garden and the church's porch are reached", () => {
    const at = (id: string, lx: number, lz: number) => lotLocalToWorld(VILLAGE_LOTS.find((x) => x.id === id)!, lx, lz);
    for (const [id, lx, lz, what] of [
      ["lot_chapel", 8.2, 1, "fountain garden"], ["lot_chapel", -8.2, 0, "rose arbour"], ["lot_chapel", -8.2, -7, "behind the apse, north"], ["lot_chapel", 8.2, -7, "behind the apse, south"],
      ["lot_library", 7, -0.4, "reading garden"], ["lot_library", -3, 5.2, "front door"], ["lot_library", -9.5, 6.2, "book return"],
      ["lot_church", 0, 3.9, "porch, under its roof"], ["lot_church", -7, -2, "west side yard"], ["lot_church", 7, -2, "east side yard"],
    ] as const) {
      const p = at(id, lx, lz);
      expect(reach(p.x, p.z), `${id} ${what} (${p.x}, ${p.z})`).toBe(true);
    }
  });

  it("the temple: in through the 일주문 only, round the 석등 to the 대웅전, to the pond, the 석탑 and the 범종각", () => {
    const l = VILLAGE_LOTS.find((x) => x.id === "lot_temple")!;
    for (const [lx, lz, what] of [[0, 12.2, "between the 일주문 pillars"], [-2, 1.7, "past the lantern, left"], [2, 1.7, "past the lantern, right"], [0, -1.5, "before the hall"], [3.2, 6, "by the pond"], [-5, 4.4, "by the pagoda"], [-9.7, -6.2, "before the bell pavilion"], [-9, -12, "behind the hall"]] as const) {
      const p = lotLocalToWorld(l, lx, lz);
      expect(reach(p.x, p.z), `temple ${what} (${p.x}, ${p.z})`).toBe(true);
    }
    // the 돌담 closes the garden: its line is blocked everywhere but the gate
    for (const lx of [-10, -5, 5, 10]) {
      const p = lotLocalToWorld(l, lx, 12.7);
      expect(free(p.x, p.z), `front wall at ${lx}`).toBe(false);
    }
    for (const lz of [-10, 0, 10]) {
      const a = lotLocalToWorld(l, -11.8, lz), b = lotLocalToWorld(l, 11.8, lz);
      expect(free(a.x, a.z) || free(b.x, b.z), `side walls at ${lz}`).toBe(false);
    }
  });

  it("every seat can be walked to: a standing spot 0.7 m ahead of the seat's front edge is reached", () => {
    for (const s of allLotSeatMarkers()) {
      // a chair at a table ("side") is stepped into from beside it: 0.75 m to its right or left
      const d = s.approach === "side" ? 0.75 : s.frontEdge + 0.7;
      const ang = s.approach === "side" ? s.yaw + Math.PI / 2 : s.yaw;
      const x = s.x + Math.sin(ang) * d;
      const z = s.z + Math.cos(ang) * d;
      if (s.approach === "side" && !reach(x, z)) {
        const x2 = s.x - Math.sin(ang) * d, z2 = s.z - Math.cos(ang) * d;
        expect(reach(x2, z2), `${s.id} (${x2.toFixed(2)}, ${z2.toFixed(2)})`).toBe(true);
        continue;
      }
      expect(reach(x, z), `${s.id} (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true);
    }
  });

  it("the 케이슨랜드 gate plaza is reached over the footbridge; the closed gate stops you", () => {
    const g = VILLAGE_LOTS.find((l) => l.id === "lot_gate")!;
    const plaza = lotLocalToWorld(g, 0, 3);
    expect(reach(plaza.x, plaza.z)).toBe(true);
    // the closed leaves fill the opening between the towers, and the gate line is the walk bounds' edge: no way through or round
    for (const lx of [-2.5, 0, 2.5]) {
      const leaf = lotLocalToWorld(g, lx, -5.8);
      expect(free(leaf.x, leaf.z), `leaf ${lx}`).toBe(false);
    }
    const wbz = VILLAGE_LAYOUT.walkBounds.maxZ;
    expect(lotFootprint(g).maxZ).toBe(wbz);
  });

  it("the lots don't cut off any place that was reachable: every house door side and the bridge stay connected", () => {
    for (const h of VILLAGE_LAYOUT.sceneryHouses) {
      const f = boxAt(h.centre, h.size);
      const p = { n: { x: h.centre.x, z: f.minZ - 1.2 }, s: { x: h.centre.x, z: f.maxZ + 1.2 }, e: { x: f.maxX + 1.2, z: h.centre.z }, w: { x: f.minX - 1.2, z: h.centre.z } }[h.doorSide];
      if (free(p.x, p.z)) expect(reach(p.x, p.z), h.id).toBe(true);
    }
    expect(reach(-24, 75)).toBe(true);
    expect(reach(0, -49.4)).toBe(true); // the memorial's arrival
  });
});

describe("budgets", () => {
  it("per-lot triangles add up to the GLB totals", () => {
    const shells = Object.values(LOT_TRIANGLES).reduce((a, t) => a + t.shell, 0);
    const details = Object.values(LOT_TRIANGLES).reduce((a, t) => a + t.detail, 0);
    expect(shells).toBe(LOT_GLB_BUDGET.shellTrianglesTotal);
    expect(details).toBeLessThanOrEqual(LOT_GLB_BUDGET.detailTrianglesTotal);
    expect(Object.keys(LOT_TRIANGLES).sort()).toEqual(VILLAGE_LOTS.map((l) => l.id).sort());
  });

  it("the scene cap leaves room for vrb2's base scene (main fa2645a village.glb 250,595 minus the 27.5k far backdrop vrb2 removes)", () => {
    expect(maxBaseSceneTriangles("pc")).toBe(310_000 - 18_000 - 18_400 - 40_000);
    expect(maxBaseSceneTriangles("phone")).toBe(300_000 - 18_000 - 18_400 - 14_000);
    expect(worstSceneTrianglesWithLots(250_595 - 27_547, "pc")).toBeLessThanOrEqual(310_000);
    expect(worstSceneTrianglesWithLots(250_595 - 27_547, "phone")).toBeLessThanOrEqual(300_000);
    // one detailed lot never takes more than the pool on PC; on the phone its structure level fits the pool
    for (const t of Object.values(LOT_TRIANGLES)) {
      expect(t.detail).toBeLessThanOrEqual(40_000);
      expect(t.detail * LOT_GLB_BUDGET.structureShare).toBeLessThanOrEqual(14_000);
    }
  });

  it("seat facing yaw and compass side agree", () => {
    const dir = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] } as const;
    for (const l of VILLAGE_LOTS as readonly VillageLot[]) for (const s of lotSeatMarkers(l)) {
      expect(Math.sin(s.yaw)).toBeCloseTo(dir[s.facing][0], 6);
      expect(Math.cos(s.yaw)).toBeCloseTo(dir[s.facing][1], 6);
    }
  });
});
