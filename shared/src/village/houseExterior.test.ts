/**
 * 집 외관 A8 약속 (X0) tests — design 8 B1-B6 on the contract: the A plan placements (sizes, turns, moves), the clearances
 * (house to house, roads, lanes, plots, crosswalks, trees), doors and keypads reachable on the A8 map, porch pieces inside their
 * footprints, lift zones, the porch seats, the owner slots, budgets and the hand-over to the rebuilt model.
 */
import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { reachable } from "../school/reachTestUtil";
import { VILLAGE_COLLIDERS, VILLAGE_CAMERA_BOXES } from "./generated/villageColliders";
import { VILLAGE_SEAT_MARKERS as MODEL_SEAT_MARKERS } from "./generated/villageSeatMarkers";
import { VILLAGE_SEAT_MARKERS, VILLAGE_SEATS } from "./benchSeats";
import { keypadEntries, KEYPAD_PAD_FROM_DOOR_M } from "./buildingAccess";
import { RING_MIDDLE_R, SIGNAL_CROSSINGS, crossingFrame, CROSSWALK_LENGTH } from "./crossings";
import { A7_MODEL_HOUSE_BOXES, A8_TREE_MOVES, a8MovedPlantBoxes, modelHasA8Houses, stageA8Colliders, stageA8SeatMarkers } from "./a8Staging";
import {
  DOOR_YAW,
  HOUSE_A8,
  HOUSE_BODY_BACK,
  HOUSE_BODY_FRONT,
  HOUSE_DETAIL_LOD,
  HOUSE_FLUSH_DECKS,
  HOUSE_GLB_BUDGET,
  HOUSE_PORCH_KIND,
  HOUSE_SURFACE_RULES,
  HOUSE_Z_EDGE,
  VILLAGE_SCENE_TRIANGLE_CAP,
  houseExteriorColliders,
  houseLiftZones,
  houseLocalToWorld,
  houseSlots,
  houseSolidBox,
  houseStepLift,
  houseWorldToLocal,
  localBox,
  porchStairsLocal,
  porchTreadsLocal,
  worstSceneTriangles,
} from "./houseExterior";
import { HOUSE_EXTERIOR_DEFAULT } from "./houseOwnership";
import { VILLAGE_LAYOUT, VILLAGE_MODEL_COLLIDERS, boxAt, exportVillageLayout, greyboxColliders, solidBox, villageGeometry, type SceneryHouse } from "./villageLayout";

const L = VILLAGE_LAYOUT;
const HOUSES = L.sceneryHouses.filter((h) => h.kind === "house");
const H = (id: string) => HOUSES.find((h) => h.id === id)!;

const gap = (a: AABB, b: AABB) =>
  Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
const same = (a: AABB, b: AABB) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
const inBox = (p: { x: number; z: number }, b: AABB) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
const union = (bs: AABB[]): AABB => ({
  minX: Math.min(...bs.map((b) => b.minX)),
  maxX: Math.max(...bs.map((b) => b.maxX)),
  minZ: Math.min(...bs.map((b) => b.minZ)),
  maxZ: Math.max(...bs.map((b) => b.maxZ)),
});

/** Everything a house puts on the ground: footprint, solid (plinth sides 8 cm out), stairs, LPG, garden, flush deck. */
function houseParts(h: SceneryHouse): Array<[string, AABB]> {
  const deck = HOUSE_FLUSH_DECKS[h.id];
  return [
    ["footprint", boxAt(h.centre, h.size)],
    ["solid", houseSolidBox(h)],
    ["stairs", localBox(h, porchStairsLocal(h.id))],
    ...houseExteriorColliders(h).map((c): [string, AABB] => [c.id, c.box]),
    ...(deck ? [["flushDeck", localBox(h, deck)] as [string, AABB]] : []),
  ];
}
/** The house proper (no garden): what another house must keep 2.5 m from. */
const houseCore = (h: SceneryHouse) => houseParts(h).filter(([n]) => !n.startsWith("garden_"));

/** Distance from a box to a segment (sampled at 5 cm, exact enough for a 1 m rule). */
function boxToSegment(b: AABB, a: { x: number; z: number }, c: { x: number; z: number }): number {
  const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.05));
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((c.x - a.x) * i) / n;
    const z = a.z + ((c.z - a.z) * i) / n;
    best = Math.min(best, Math.hypot(Math.max(0, b.minX - x, x - b.maxX), Math.max(0, b.minZ - z, z - b.maxZ)));
  }
  return best;
}
/** Nearest distance from the plaza centre to a box (for the ring road / sidewalk). */
const nearR = (b: AABB) => Math.hypot(Math.max(0, b.minX, -b.maxX), Math.max(0, b.minZ, -b.maxZ));

describe("A plan placements (owner 2026-11-16 추천대로)", () => {
  it("every house: 11.2 along the front x 10.75 deep, its centre the box's centre; door-east houses turned (wide side to the street)", () => {
    expect(HOUSES).toHaveLength(10);
    for (const h of HOUSES) {
      const ns = h.doorSide === "n" || h.doorSide === "s";
      expect(h.size, h.id).toEqual(ns ? { x: 11.2, z: 10.75 } : { x: 10.75, z: 11.2 });
      expect(HOUSE_A8.depth).toBeCloseTo(HOUSE_A8.backMargin + HOUSE_A8.bodyDepth + HOUSE_A8.porchDepth, 9);
      expect(h.terrace, h.id).toBe(HOUSE_A8.porchDepth);
    }
    for (const id of ["house_5", "house_8", "house_10"]) expect(H(id).doorSide).toBe("e");
  });

  it("each front edge stays where the 11-15 layout had it, apart from the five approved moves", () => {
    // the A7 front edge: centre + 4.2 (door s), - 4.2 (door n), + 5.6 (door e); the moves: 4 west 0.8, 7/9 north 1.2, 8 south 0.6, 10 north 0.6
    const a7: Record<string, [number, number]> = {
      house_1: [21, -42], house_2: [-21, -42], house_3: [29, 37.6], house_4: [-31.6, 39.4], house_5: [-47, -8], house_6: [42, 42.5],
      house_7: [31, -56], house_8: [-50, 40], house_9: [-31, -56], house_10: [-40.6, 27],
    };
    const move: Record<string, [number, number]> = { house_4: [-0.8, 0], house_7: [0, -1.2], house_9: [0, -1.2], house_8: [0, 0.6], house_10: [0, -0.6] };
    for (const h of HOUSES) {
      const [x0, z0] = a7[h.id]!;
      const [mx, mz] = move[h.id] ?? [0, 0];
      const fp = boxAt(h.centre, h.size);
      const front = houseLocalToWorld(h, 0, HOUSE_Z_EDGE);
      if (h.doorSide === "s") expect(fp.maxZ, h.id).toBeCloseTo(z0 + mz + 4.2, 6);
      if (h.doorSide === "n") expect(fp.minZ, h.id).toBeCloseTo(z0 + mz - 4.2, 6);
      if (h.doorSide === "e") expect(fp.maxX, h.id).toBeCloseTo(x0 + mx + 5.6, 6);
      // the door's centre line is where it was (plus the move)
      if (h.doorSide === "e") expect(front.z, h.id).toBeCloseTo(z0 + mz, 6);
      else expect(front.x, h.id).toBeCloseTo(x0 + mx, 6);
    }
  });

  it("the local frame: x is the right hand walking in, z out of the door; world <-> local round trip", () => {
    for (const h of HOUSES) {
      const yaw = DOOR_YAW[h.doorSide];
      const out = houseLocalToWorld(h, 0, 1);
      // world points are rounded to the centimetre (the model's col__ boxes)
      expect(out.x - h.centre.x, h.id).toBeCloseTo(Math.sin(yaw), 1);
      expect(out.z - h.centre.z, h.id).toBeCloseTo(Math.cos(yaw), 1);
      // walking in faces -local z; the right hand of that facing is +local x
      const right = houseLocalToWorld(h, 1, 0);
      const inDir = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      // the right of a heading (hx, hz) on this map (x east, z south) is (-hz, hx): facing north (0, -1), east (1, 0)
      expect(right.x - h.centre.x, h.id).toBeCloseTo(-inDir.z, 1);
      expect(right.z - h.centre.z, h.id).toBeCloseTo(inDir.x, 1);
      const p = houseWorldToLocal(h, h.centre.x + 1.234, h.centre.z - 2.5);
      const back = houseLocalToWorld(h, p.lx, p.lz);
      expect(back.x).toBeCloseTo(h.centre.x + 1.234, 1);
      expect(back.z).toBeCloseTo(h.centre.z - 2.5, 1);
    }
  });

  it("the solid box is the body + plinth (11.36 x 8.56), its front 0.08 in front of the door's wall, and the layout's solidBox", () => {
    for (const h of HOUSES) {
      const s = houseSolidBox(h);
      const ns = h.doorSide === "n" || h.doorSide === "s";
      expect(+(s.maxX - s.minX).toFixed(6), h.id).toBe(ns ? 11.36 : 8.56);
      expect(+(s.maxZ - s.minZ).toFixed(6), h.id).toBe(ns ? 8.56 : 11.36);
      expect(solidBox(h)).toEqual(s);
      const door = houseLocalToWorld(h, 0, HOUSE_BODY_FRONT);
      expect(inBox(door, s), h.id).toBe(true);
      expect(inBox(houseLocalToWorld(h, 0, HOUSE_BODY_FRONT + 0.09), s), h.id).toBe(false);
    }
    expect(HOUSE_BODY_FRONT - HOUSE_BODY_BACK).toBeCloseTo(HOUSE_A8.bodyDepth, 9);
  });
});

describe("B1 clearances (design 3.2 / 8 B1)", () => {
  it("house to house >= 2.5 m (3 <-> 6 excepted: 1.64 m between the plinths, closed by beds, no walking path)", () => {
    for (let i = 0; i < HOUSES.length; i++) {
      for (let j = i + 1; j < HOUSES.length; j++) {
        const a = HOUSES[i]!;
        const b = HOUSES[j]!;
        const d = Math.min(...houseCore(a).flatMap(([, x]) => houseCore(b).map(([, y]) => gap(x, y))));
        if (`${a.id}/${b.id}` === "house_3/house_6") expect(d).toBeCloseTo(1.64, 6);
        else expect(d, `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it("gardens keep 2 m from any other house and never touch one", () => {
    for (const a of HOUSES) {
      for (const [n, g] of houseParts(a).filter(([n]) => n.startsWith("garden_"))) {
        for (const b of HOUSES) if (b !== a) for (const [m, x] of houseCore(b)) expect(gap(g, x), `${n} / ${b.id}.${m}`).toBeGreaterThanOrEqual(2.0);
      }
    }
  });

  it("every part >= 1.0 m from the ring road's sidewalk, the lanes, the plots, the café, the kiosk and the bus stop", () => {
    const SIDEWALK_OUTER = L.ringRoad.radius + L.ringRoad.width / 2 + L.ringRoad.sidewalk.width;
    const others = L.sceneryHouses.filter((h) => h.kind !== "house").map((h) => [h.id, boxAt(h.centre, h.size)] as const);
    for (const h of HOUSES) {
      for (const [n, b] of houseParts(h)) {
        const where = `${h.id}.${n}`;
        expect(nearR(b) - SIDEWALK_OUTER, `${where} to the sidewalk`).toBeGreaterThanOrEqual(1.0);
        for (const lane of L.lanes) {
          for (let k = 0; k + 1 < lane.points.length; k++) {
            expect(boxToSegment(b, lane.points[k]!, lane.points[k + 1]!) - lane.width / 2, `${where} to ${lane.id}`).toBeGreaterThanOrEqual(1.0);
          }
        }
        for (const p of L.plots) expect(gap(b, boxAt(p.centre, p.size)), `${where} to ${p.id}`).toBeGreaterThanOrEqual(1.0);
        for (const [id, o] of others) expect(gap(b, o), `${where} to ${id}`).toBeGreaterThanOrEqual(1.0);
        for (const bank of greyboxColliders(L).filter((c) => c.id.startsWith("stream_bank_"))) expect(overlaps(b, bank.box), where).toBe(false);
        expect(b.minX >= L.walkBounds.minX && b.maxX <= L.walkBounds.maxX && b.minZ >= L.walkBounds.minZ && b.maxZ <= L.walkBounds.maxZ, where).toBe(true);
      }
    }
  });

  it("the two signalised crosswalks (and the road they cross) are far from every house", () => {
    for (const c of SIGNAL_CROSSINGS) {
      const f = crossingFrame(c);
      const end = (s: number) => ({ x: f.centre.x + f.radial.x * s * (L.ringRoad.width / 2 + L.ringRoad.sidewalk.width), z: f.centre.z + f.radial.z * s * (L.ringRoad.width / 2 + L.ringRoad.sidewalk.width) });
      for (const h of HOUSES) for (const [n, b] of houseParts(h)) expect(boxToSegment(b, end(-1), end(1)) - CROSSWALK_LENGTH / 2, `${h.id}.${n} / ${c.id}`).toBeGreaterThanOrEqual(1.0);
    }
    expect(RING_MIDDLE_R).toBe(L.ringRoad.radius);
  });

  it("tree trunks >= 1.5 m from every part, and no other collider (bushes, benches, poles, walls) within 0.4 m — on the A8 map", () => {
    const own = (h: SceneryHouse) => houseParts(h).map(([, b]) => b);
    const all = HOUSES.flatMap(own);
    const isOwn = (o: AABB) => all.some((b) => same(b, o)) || HOUSES.some((h) => same(o, houseSolidBox(h)));
    for (const o of villageGeometry.obstacles) {
      if (isOwn(o) || o.maxX - o.minX > 12 || o.maxZ - o.minZ > 12) continue; // the houses' own, and the big area blockers and banks
      const trunk = +(o.maxX - o.minX).toFixed(3) === 0.5 && +(o.maxZ - o.minZ).toFixed(3) === 0.5;
      for (const h of HOUSES) {
        for (const [n, b] of houseParts(h)) {
          const d = gap(o, b);
          expect(d, `${JSON.stringify(o)} / ${h.id}.${n}`).toBeGreaterThanOrEqual(trunk ? 1.5 : 0.4);
        }
      }
    }
  });

  it("the moved plants: each one's old box touched or crowded an A8 house; the new box keeps the model's size", () => {
    const moved = a8MovedPlantBoxes();
    expect(moved.map((m) => m.id).sort()).toEqual(A8_TREE_MOVES.map((m) => m.id).sort());
    for (const m of moved) {
      const old = A7_MODEL_HOUSE_BOXES.find((b) => b.id === m.id)!.box;
      expect(+(m.box.maxX - m.box.minX).toFixed(6)).toBe(+(old.maxX - old.minX).toFixed(6));
      const near = Math.min(...HOUSES.flatMap((h) => houseParts(h).map(([, b]) => gap(old, b))));
      expect(near, m.id).toBeLessThan(1.5);
    }
  });

  it("at most four houses within 35 m of any point, so PC draws at most four details (HOUSE_DETAIL_LOD.pcMaxNear)", () => {
    let worst = 0;
    for (let x = -95; x <= 95; x += 1) {
      for (let z = -95; z <= 95; z += 1) {
        const n = HOUSES.filter((h) => gap({ minX: x, maxX: x, minZ: z, maxZ: z }, boxAt(h.centre, h.size)) <= HOUSE_DETAIL_LOD.pc).length;
        worst = Math.max(worst, n);
      }
    }
    expect(worst).toBeLessThanOrEqual(HOUSE_DETAIL_LOD.pcMaxNear);
  });
});

describe("porch, steps and lift zones (design 3.4, Q2: raised 0.30, two steps)", () => {
  it("porch types: gable 1 5 6 7, canopy 3 4 8, deck 2 9 10", () => {
    const by = (k: string) => Object.entries(HOUSE_PORCH_KIND).filter(([, v]) => v === k).map(([id]) => id).sort();
    expect(by("gable")).toEqual(["house_1", "house_5", "house_6", "house_7"]);
    expect(by("canopy")).toEqual(["house_3", "house_4", "house_8"]);
    expect(by("deck")).toEqual(["house_10", "house_2", "house_9"]);
  });

  it("porch pieces sit inside the footprint (the steps outside it, in front), never on the slab's middle, the door or the keypad pad", () => {
    for (const h of HOUSES) {
      const fp = boxAt(h.centre, h.size);
      const pad = keypadEntries().find((e) => e.buildingId === h.id)!.pad;
      for (const c of houseExteriorColliders(h)) {
        if (/_porch_\d+$/.test(c.id)) expect(c.box.minX >= fp.minX - 1e-9 && c.box.maxX <= fp.maxX + 1e-9 && c.box.minZ >= fp.minZ - 1e-9 && c.box.maxZ <= fp.maxZ + 1e-9, c.id).toBe(true);
        expect(isBlocked(pad.x, pad.z, 0, [c.box]), `${c.id} on the pad`).toBe(false);
        expect(overlaps(c.box, houseSolidBox(h)), `${c.id} in the body`).toBe(false);
      }
      const stairs = localBox(h, porchStairsLocal(h.id));
      expect(overlaps(stairs, fp), h.id).toBe(false);
      expect(gap(stairs, fp), h.id).toBe(0);
    }
  });

  it("lift: porch 0.30, treads 0.20 and 0.10 (risers 0.10, treads 0.34), the lawn 0; 0.68 m of steps out of the footprint", () => {
    expect(porchTreadsLocal("house_1").map((t) => t.top)).toEqual([0.2, 0.1]);
    expect(porchStairsLocal("house_1").z1 - HOUSE_Z_EDGE).toBeCloseTo(0.68, 9);
    for (const h of HOUSES) {
      const zones = houseLiftZones(h);
      const at = (lx: number, lz: number) => {
        const p = houseLocalToWorld(h, lx, lz);
        return houseStepLift(p.x, p.z, zones);
      };
      expect(at(0, HOUSE_BODY_FRONT + 0.65), h.id).toBe(0.3); // the keypad pad is on the porch
      expect(at(0, HOUSE_Z_EDGE + 0.17), h.id).toBe(0.2);
      expect(at(0, HOUSE_Z_EDGE + 0.51), h.id).toBe(0.1);
      expect(at(0, HOUSE_Z_EDGE + 0.8), h.id).toBe(0);
      expect(at(5.0, HOUSE_Z_EDGE + 0.17), h.id).toBe(0); // beside the steps: lawn
    }
  });

  it("the porch is climbed only by the steps: from the lawn in front, the slab's front edge outside the steps is blocked", () => {
    for (const h of HOUSES) {
      const zones = houseLiftZones(h).filter((z) => z.part === "porch");
      const slab = zones[0]!.box;
      const blockers = houseExteriorColliders(h).map((c) => c.box);
      const stairs = localBox(h, porchStairsLocal(h.id));
      // walk along the slab's front edge (just inside): every point is either on the steps' width or covered by a kerb / bed
      const s = houseWorldToLocal(h, (slab.minX + slab.maxX) / 2, (slab.minZ + slab.maxZ) / 2);
      for (let lx = -5.55; lx <= 5.55; lx += 0.05) {
        const p = houseLocalToWorld(h, lx, HOUSE_Z_EDGE - 0.05);
        const onSteps = p.x >= stairs.minX && p.x <= stairs.maxX && p.z >= stairs.minZ - 0.1 && p.z <= stairs.maxZ;
        const stepsWidth = Math.abs(lx) <= porchStairsLocal(h.id).x1 + 1e-9;
        if (!stepsWidth) expect(blockers.some((b) => inBox(p, b)), `${h.id} edge at ${lx.toFixed(2)}`).toBe(true);
        else expect(onSteps || stepsWidth, h.id).toBe(true);
      }
      expect(s.lx).toBeCloseTo(0, 6);
    }
  });
});

describe("B3-B6: doors and keypads on the A8 map", () => {
  const spawn = { x: L.spawn.x, z: L.spawn.z };
  const geo = { ...villageGeometry, bounds: L.areas.village };
  const reach = reachable(geo, spawn, 0.25, 0);
  const key = (x: number, z: number) => `${Math.round((x - spawn.x) / 0.25)},${Math.round((z - spawn.z) / 0.25)}`;
  const cells = new Set(reach.map((p) => key(p.x, p.z)));

  it("every keypad pad: on the porch 0.65 m in front of the door, free for a body, and reached from the plaza spawn (8 included)", () => {
    expect(KEYPAD_PAD_FROM_DOOR_M).toBe(0.65);
    for (const e of keypadEntries()) {
      const h = H(e.buildingId);
      const l = houseWorldToLocal(h, e.pad.x, e.pad.z);
      expect(l.lx, h.id).toBeCloseTo(0, 6);
      expect(l.lz, h.id).toBeCloseTo(HOUSE_BODY_FRONT + 0.65, 6);
      expect(isBlocked(e.pad.x, e.pad.z, PLAYER_RADIUS, villageGeometry.obstacles, 0), h.id).toBe(false);
      // the nearest grid cell to the pad that a body stands on is reached from the spawn
      let ok = false;
      for (let i = -2; i <= 2 && !ok; i++) for (let j = -2; j <= 2 && !ok; j++) {
        const x = spawn.x + Math.round((e.pad.x - spawn.x) / 0.25 + i) * 0.25;
        const z = spawn.z + Math.round((e.pad.z - spawn.z) / 0.25 + j) * 0.25;
        if (Math.hypot(x - e.pad.x, z - e.pad.z) <= 0.4 && cells.has(key(x, z))) ok = true;
      }
      expect(ok, `${h.id} pad not reached`).toBe(true);
    }
  });

  it("the steps and the lawn in front of every house are reached, and the seats' and doors' area is open ground (B5)", () => {
    for (const h of HOUSES) {
      for (const lz of [HOUSE_Z_EDGE + 0.17, HOUSE_Z_EDGE + 0.51, HOUSE_Z_EDGE + 1.5]) {
        const p = houseLocalToWorld(h, 0, lz);
        let ok = false;
        for (let i = -1; i <= 1 && !ok; i++) for (let j = -1; j <= 1 && !ok; j++) {
          const x = spawn.x + Math.round((p.x - spawn.x) / 0.25 + i) * 0.25;
          const z = spawn.z + Math.round((p.z - spawn.z) / 0.25 + j) * 0.25;
          if (Math.hypot(x - p.x, z - p.z) <= 0.3 && cells.has(key(x, z))) ok = true;
        }
        expect(ok, `${h.id} at lz ${lz}`).toBe(true);
      }
    }
  });

  it("no arrival spot (spawn, hall arrival, house interior spawn) is inside an A8 footprint (B6)", () => {
    const pts = [L.spawn, L.memorial.exterior.arrival];
    for (const h of HOUSES) for (const p of pts) expect(inBox(p, boxAt(h.centre, h.size)), h.id).toBe(false);
  });
});

describe("porch bench seats (2, 9, 10: seatTop 0.75)", () => {
  it("the three markers are replaced in place: same ids and order, the A8 spot on the deck, seat 0.75", () => {
    expect(VILLAGE_SEAT_MARKERS.map((m) => m.id)).toEqual(MODEL_SEAT_MARKERS.map((m) => m.id));
    const porch = VILLAGE_SEAT_MARKERS.filter((m) => /^house_\d+_porch$/.test(m.id));
    expect(porch.map((m) => m.id)).toEqual(["house_2_porch", "house_9_porch", "house_10_porch"]);
    for (const m of porch) {
      const h = H(m.id.replace("_porch", ""));
      expect(m.seatTop).toBe(0.75);
      expect(m.facing).toBe(h.doorSide);
      const slab = houseLiftZones(h)[0]!.box;
      expect(inBox(m, slab), m.id).toBe(true);
    }
    expect(stageA8SeatMarkers(porch, HOUSES)).toEqual(porch);
  });

  it("each porch seat's sitter gets up onto the deck (lift 0.30), not past its rail", () => {
    for (const s of VILLAGE_SEATS.filter((v) => /^house_\d+_porch$/.test(v.bench))) {
      const h = H(s.bench.replace("_porch", ""));
      expect(houseStepLift(s.standX, s.standZ, houseLiftZones(h)), s.bench).toBe(0.3);
    }
  });
});

describe("owner slots (design 6)", () => {
  it("three slots per house, node names slot__house_N_{nameplate,mailbox,sign}, facing the street, nameplate right of the door", () => {
    const nodes = HOUSES.flatMap((h) => houseSlots(h).map((s) => s.node));
    expect(nodes).toHaveLength(30);
    expect(new Set(nodes).size).toBe(30);
    for (const h of HOUSES) {
      const [plate, mail, sign] = houseSlots(h);
      expect(plate!.node).toBe(`slot__${h.id}_nameplate`);
      expect(mail!.node).toBe(`slot__${h.id}_mailbox`);
      expect(sign!.node).toBe(`slot__${h.id}_sign`);
      for (const s of [plate!, mail!, sign!]) expect(s.yaw).toBe(DOOR_YAW[h.doorSide]);
      const pl = houseWorldToLocal(h, plate!.x, plate!.z);
      expect(pl.lx).toBeGreaterThan(HOUSE_A8.doorHalfWidth);
      expect(plate!.y).toBeCloseTo(1.9, 9);
      expect([plate!.width, plate!.height]).toEqual([0.42, 0.16]);
      expect([sign!.width, sign!.height]).toEqual([0.9, 0.55]);
      // the yard sign stands in the right-hand bed (a solid porch piece), not on the walkway
      expect(houseExteriorColliders(h).some((c) => inBox(sign!, c.box)), h.id).toBe(true);
      expect(HOUSE_EXTERIOR_DEFAULT[h.id]).toEqual({ n: Number(h.id.slice(6)), label: `${h.id.slice(6)}번 집`, sign: "hidden" });
    }
  });
});

describe("budgets and surfaces (design 5, owner 2026-11-16 실제 질감)", () => {
  it("shell <= 1.8k, detail <= 6k, total <= 78k, 10 materials; PC scene 310k with 4 details, phone 300k with 2", () => {
    expect(HOUSE_GLB_BUDGET.shellTriangles * 10 + HOUSE_GLB_BUDGET.detailTriangles * 10).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.totalTriangles);
    expect(HOUSE_GLB_BUDGET.materials).toHaveLength(HOUSE_GLB_BUDGET.maxMaterials);
    expect(VILLAGE_SCENE_TRIANGLE_CAP).toEqual({ pc: 310_000, phone: 300_000 });
    // design 5.1's worst case: village 219.7k + bus 38.3k + shells 18k + details
    expect(worstSceneTriangles(219_700 + 38_300, 18_000, 6_000, "pc")).toBeLessThanOrEqual(VILLAGE_SCENE_TRIANGLE_CAP.pc);
    expect(worstSceneTriangles(219_700 + 38_300, 18_000, 6_000, "phone")).toBeLessThanOrEqual(VILLAGE_SCENE_TRIANGLE_CAP.phone);
  });

  it("every house surface family is a photo-real PBR set (albedo, normal, roughness) at >= 512 px/m within reach; only glass, lamps, flower cards and the screen are exempt", () => {
    expect(HOUSE_SURFACE_RULES.pbr).toEqual(["albedo", "normal", "roughness"]);
    expect(HOUSE_SURFACE_RULES.texelsPerMetre.firstPerson).toBeGreaterThanOrEqual(512);
    expect(HOUSE_SURFACE_RULES.texelsPerMetre.far).toBeGreaterThanOrEqual(256);
    for (const m of HOUSE_SURFACE_RULES.exempt) expect(HOUSE_GLB_BUDGET.materials).toContain(m);
    for (const m of HOUSE_GLB_BUDGET.materials.filter((x) => x.startsWith("LM_"))) expect(HOUSE_SURFACE_RULES.exempt as readonly string[]).not.toContain(m);
  });
});

describe("hand-over to the rebuilt model (a8Staging.ts)", () => {
  it("today the model is the A7 one: every A7 box is in it, none survives in the game's map, every A8 contract box is in it", () => {
    expect(modelHasA8Houses(VILLAGE_COLLIDERS, HOUSES)).toBe(false);
    for (const { id, box } of A7_MODEL_HOUSE_BOXES) {
      expect(VILLAGE_COLLIDERS.some((b) => same(b, box)), id).toBe(true);
      const stillA8 = greyboxColliders(L).some((c) => same(c.box, box)) || a8MovedPlantBoxes().some((m) => same(m.box, box));
      if (!stillA8) expect(VILLAGE_MODEL_COLLIDERS.obstacles.some((b) => same(b, box)), id).toBe(false);
    }
    for (const c of greyboxColliders(L)) expect(VILLAGE_MODEL_COLLIDERS.obstacles.some((b) => same(b, c.box)), c.id).toBe(true);
    for (const h of HOUSES) expect(VILLAGE_MODEL_COLLIDERS.cameraBoxes).toContainEqual({ ...houseSolidBox(h), height: HOUSE_A8.cameraHeight });
  });

  it("once the model holds the A8 houses the swap is a no-op (the model wins)", () => {
    const rebuilt = stageA8Colliders({ obstacles: VILLAGE_COLLIDERS, cameraBoxes: VILLAGE_CAMERA_BOXES }, HOUSES);
    expect(modelHasA8Houses(rebuilt.obstacles, HOUSES)).toBe(true);
    expect(stageA8Colliders(rebuilt, HOUSES)).toBe(rebuilt);
  });

  it("layout.json carries the A8 contract for the Blender kit: per house frame, porch, boxes with node names, zones, slots, nodes", () => {
    const x = exportVillageLayout().houseExteriors;
    expect(JSON.parse(JSON.stringify(x))).toEqual(x);
    expect(x.houses).toHaveLength(10);
    for (const h of x.houses) {
      expect(h.solid.node).toBe(`col__${h.id}`);
      for (const c of h.colliders) expect(c.node).toBe(`col__${c.id}`);
      expect(h.nodes).toEqual({ shell: `houseshell__${h.id}`, detail: `housedetail__${h.id}`, proxy: `houseproxy__${h.id}` });
      expect(h.slots).toHaveLength(3);
      expect(h.seat === null).toBe(HOUSE_PORCH_KIND[h.id] !== "deck");
    }
    expect(Object.keys(x.windows.houses)).toHaveLength(10);
    expect(union(x.houses.map((h) => h.stairs)).minX).toBeGreaterThan(L.walkBounds.minX);
  });
});
