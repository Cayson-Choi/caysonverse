import { lotRoomOf } from "./villageLots";
import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { PLAYER_RADIUS, SEAT_APPROACH_SLACK, SEAT_REACH, approachesSeat, nearestFreeSeat, seatTaken } from "../worldMap";
import { BACKED_ROOT_AHEAD, SIT_POSE, SIT_ROOT_AHEAD, liftForSeatY } from "../sitPose";
import { reachable, hasNear } from "../school/reachTestUtil";
import { VILLAGE_COLLIDERS } from "./generated/villageColliders";
import { MEMORIAL_COLLIDERS } from "./generated/memorialColliders";
import { MEMORIAL_SEAT_MARKERS } from "./generated/memorialSeats";
import { VILLAGE_LAYOUT, busShelterBenchCollider, busShelterColliders, isHouseArea, villageGeometry } from "./villageLayout";
import { houseFloorBounds, parseHouseFloorArea } from "./houseAreas";
import {
  CHAIR_BACK_BEHIND,
  LAKE_SEAT_BASE,
  LATE_HOUSE_SEATS,
  SHELTER_BENCH,
  STAND_CLEARANCE,
  VILLAGE_BENCHES,
  VILLAGE_SEATS,
  benchSeatOffsets,
  fishingSeatIndex,
  isLotSeat,
  fishingSpotOfSeat,
  type VillageBench,
  type VillageSeat,
} from "./benchSeats";
import { LAKE_FISHING_SPOTS, lakeSeats } from "./lakeLayout";
import { VILLAGE_SEAT_MARKERS } from "./generated/villageSeatMarkers";
import { villageWalkArea } from "./fallsWalk";

const MARKED = new Set(VILLAGE_SEAT_MARKERS.map((m) => m.id));
/** The seats the art marks (café chairs, porch benches): appended after the benches', the hall's, the houses' and the shelter's. */
/** The waterfall rest area's stone seats close the list, after the lake's (B1 W5, release 2; fallsWalk.test.ts holds their own tests). */
const FALLS_SEATS = VILLAGE_SEATS.filter((s) => s.bench.startsWith("falls_seat_"));
const markedSeats = () => VILLAGE_SEATS.filter((s) => MARKED.has(s.bench));

/** The seated figure's width across the arms (sitPose.ts: the torso with the upper arms, -0.52..0.54 m) and the hands' (-0.53..0.58). */
const SEATED_HANDS_WIDTH = 0.532 + 0.575;

const L = VILLAGE_LAYOUT;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The axis-aligned box of an `sx` x `sz` rectangle centred on (cx, cz) and turned by `yaw` (parts_props.py aabb_of). */
function turnedBox(cx: number, cz: number, yaw: number, sx: number, sz: number): AABB {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = (sx * c + sz * s) / 2;
  const hz = (sx * s + sz * c) / 2;
  return { minX: r2(cx - hx), maxX: r2(cx + hx), minZ: r2(cz - hz), maxZ: r2(cz + hz) };
}
const sameBox = (a: AABB, b: AABB, tol = 0.011) =>
  Math.abs(a.minX - b.minX) <= tol && Math.abs(a.maxX - b.maxX) <= tol && Math.abs(a.minZ - b.minZ) <= tol && Math.abs(a.maxZ - b.maxZ) <= tol;
const contains = (outer: AABB, inner: AABB) =>
  outer.minX <= inner.minX + 1e-9 && outer.maxX >= inner.maxX - 1e-9 && outer.minZ <= inner.minZ + 1e-9 && outer.maxZ >= inner.maxZ - 1e-9;

/** A seat point expressed in its bench's frame: `along` the bench (local x) and `ahead` of its centre along the facing. */
function inBenchFrame(b: VillageBench, x: number, z: number): { along: number; ahead: number } {
  const dx = x - b.centre.x;
  const dz = z - b.centre.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { along: dx * c - dz * s, ahead: dx * s + dz * c };
}
const benchOf = (id: string) => VILLAGE_BENCHES.find((b) => b.id === id)!;
const seatsOf = (furniture: string): VillageSeat[] => VILLAGE_SEATS.filter((s) => s.bench === furniture);
const indexOf = (id: string): number => VILLAGE_SEATS.findIndex((s) => s.id === id);
const hallSeats = VILLAGE_SEATS.filter((s) => s.area === "hall" && !s.retired);
const fwd = (s: { yaw: number }) => ({ x: Math.sin(s.yaw), z: Math.cos(s.yaw) });

describe("village benches (the models sitting needs)", () => {
  it("lists the eight plaza benches, the forecourt bench and the bus shelter's, in that order (the hall's seats come from its model's markers)", () => {
    expect(VILLAGE_BENCHES.map((b) => b.id)).toEqual([...L.plaza.benches.map((_, i) => `plaza_${i + 1}`), "memorial_forecourt", "shelter"]);
    expect(VILLAGE_BENCHES.filter((b) => b.area === "hall")).toEqual([]);
  });

  it("each plaza bench is the layout's, and the model's collider is its 1.9 x 0.66 footprint turned to face the fountain", () => {
    L.plaza.benches.forEach((p, i) => {
      const b = VILLAGE_BENCHES[i]!;
      expect(b.centre).toEqual({ x: p.x, z: p.z });
      expect(b.yaw).toBe(p.yaw);
      expect(b.kind).toBe("backed");
      // the art builds col__bench_<n> as exactly this box (parts_props.py benches): the model really is where we sit
      const box = turnedBox(p.x, p.z, p.yaw, 1.9, 0.66);
      expect(VILLAGE_COLLIDERS.some((c) => sameBox(c, box)), b.id).toBe(true);
      expect(b.length).toBeLessThanOrEqual(1.9);
      expect(b.frontEdge).toBeLessThanOrEqual(0.33);
    });
  });

  it("the forecourt's stone block is backless and sits inside its collider", () => {
    const fore = benchOf("memorial_forecourt");
    expect(fore.kind).toBe("backless");
    expect(VILLAGE_COLLIDERS.some((c) => contains(c, turnedBox(fore.centre.x, fore.centre.z, fore.yaw, fore.length, fore.frontEdge * 2)))).toBe(true);
  });

  it("seat surfaces are ordinary bench height, a few cm above the sit pose's butt (the avatar is lifted, never sunk)", () => {
    for (const b of VILLAGE_BENCHES) {
      expect(b.seatTop).toBeGreaterThanOrEqual(0.43);
      expect(b.seatTop).toBeLessThanOrEqual(0.52); // the shelter's slats stand on a 4.5 cm pad
      const lift = liftForSeatY(b.seatTop);
      expect(lift).toBeGreaterThan(0);
      expect(lift).toBeLessThan(0.13);
    }
    expect(liftForSeatY(undefined)).toBe(0); // the legacy chairs: drawn as authored
  });
});

describe("village seats (where a sitter goes)", () => {
  it("one global list: plaza places (backed, one facing), the forecourt's (backless, two facings in one group), the hall's, the houses'", () => {
    // 8 plaza benches x 2 places, the forecourt 2 places x 2 facings, the hall's markers (20..50: 25 seats and, since release 3.1, 6 retired chairs keeping their indices), the houses' (집 실내 G: from 51,
    // every finished floor's), the bus shelter's two, then the art's marked seats
    expect(VILLAGE_SEATS.slice(16, 20).every((s) => s.bench === "memorial_forecourt")).toBe(true);
    expect(VILLAGE_SEATS.slice(20, 51).every((s) => s.area === "hall")).toBe(true);
    // the six chairs taken out in release 3.1 keep their indices as retired seats, out of every map's reach
    expect(VILLAGE_SEATS.slice(20, 51).filter((s) => s.retired).map((s) => s.id)).toEqual(["consult_0", "consult_1", "letter_n0", "letter_n1", "letter_s0", "letter_s1"]);
    for (const s of VILLAGE_SEATS.filter((v) => v.retired)) expect(nearestFreeSeat(s.x, s.z, () => false, SEAT_REACH, VILLAGE_SEATS.filter((v) => !v.retired))).toBeNull();
    const housesEnd = VILLAGE_SEATS.findIndex((s, i) => i >= 51 && !isHouseArea(s.area));
    expect(housesEnd).toBeGreaterThan(51 + 100); // the ten houses' 110-odd seats
    expect(VILLAGE_SEATS.slice(51, housesEnd).every((s) => isHouseArea(s.area))).toBe(true);
    expect(VILLAGE_SEATS.slice(housesEnd, housesEnd + 2).map((s) => s.bench)).toEqual(["shelter", "shelter"]);
    const plaza = VILLAGE_SEATS.slice(0, 16);
    plaza.forEach((s, i) => {
      const b = VILLAGE_BENCHES[Math.floor(i / 2)]!;
      expect(s.bench).toBe(b.id);
      expect(s.area).toBe("village");
      expect(s.kind).toBe("backed");
      expect(s.yaw).toBe(b.yaw);
      expect(s.seatY).toBe(b.seatTop);
      expect(s.frontEdge).toBe(SIT_ROOT_AHEAD);
    });
    const fore = seatsOf("memorial_forecourt");
    expect(fore).toHaveLength(4);
    expect(new Set(fore.map((s) => s.group)).size).toBe(2);
    expect(VILLAGE_SEATS.map((s) => s.id).length).toBe(new Set(VILLAGE_SEATS.map((s) => s.id)).size); // ids unique
    expect(benchSeatOffsets(1.86)).toEqual([-0.58, 0.58]); // the plaza benches
    expect(benchSeatOffsets(2.2)).toEqual([-0.6, 0.6]); // the hall's
  });

  it("the sit pose lands ON a bench: hips on its front half, the butt between its edges, the hanging calves clear of the front edge", () => {
    for (const s of VILLAGE_SEATS.filter((v) => VILLAGE_BENCHES.some((b) => b.id === v.bench))) {
      const b = benchOf(s.bench);
      // the other facing of a two-sided bench is the same bench turned half a turn
      const flipped = Math.abs(Math.atan2(Math.sin(s.yaw - b.yaw), Math.cos(s.yaw - b.yaw))) > 1;
      const bb: VillageBench = flipped ? { ...b, yaw: s.yaw } : b;
      const root = inBenchFrame(bb, s.x, s.z);
      const hips = root.ahead - SIT_POSE.hipsBehindRoot;
      const calves = root.ahead - SIT_POSE.calvesBehindRoot;
      expect(hips).toBeLessThan(b.frontEdge - 0.1);
      expect(hips - 0.17).toBeGreaterThan(-b.frontEdge);
      expect(hips).toBeGreaterThan(0);
      expect(calves).toBeGreaterThan(b.frontEdge);
      expect(Math.abs(root.along) + 0.31).toBeLessThanOrEqual(b.length / 2);
    }
  });

  it("plaza sitters face the fountain with the backrest behind them; the forecourt can face the plaza or the building", () => {
    for (const s of VILLAGE_SEATS.filter((v) => v.bench.startsWith("plaza_"))) {
      const toFountain = Math.atan2(-s.x, -s.z);
      expect(Math.abs(Math.atan2(Math.sin(s.yaw - toFountain), Math.cos(s.yaw - toFountain)))).toBeLessThan(0.15);
    }
    const south = seatsOf("memorial_forecourt").filter((s) => Math.abs(s.yaw) < 1e-6);
    const north = seatsOf("memorial_forecourt").filter((s) => Math.abs(Math.abs(s.yaw) - Math.PI) < 1e-6);
    expect(south).toHaveLength(2);
    expect(north).toHaveLength(2);
    for (const s of south) expect(s.z).toBeGreaterThan(L.memorial.exterior.centre.z + L.memorial.exterior.size.z / 2); // on the plaza side
  });

  it("every seat point is in its own area and clear of the other seats of its area (one group is one place)", () => {
    for (let i = 0; i < VILLAGE_SEATS.length; i++) {
      const a = VILLAGE_SEATS[i]!;
      if (a.retired) continue; // (a retired seat lies far outside every map on purpose)
      const house = parseHouseFloorArea(a.area);
      const room = lotRoomOf(a.area);
      const bounds = a.area === "village" ? villageWalkArea(L) : house ? houseFloorBounds(house.n, house.floor) : room ? room.bounds : L.areas.hall;
      expect(a.x, a.id).toBeGreaterThan(bounds.minX);
      expect(a.x, a.id).toBeLessThan(bounds.maxX);
      expect(a.z, a.id).toBeGreaterThan(bounds.minZ);
      expect(a.z, a.id).toBeLessThan(bounds.maxZ);
      for (let j = i + 1; j < VILLAGE_SEATS.length; j++) {
        const b = VILLAGE_SEATS[j]!;
        if (a.area !== b.area || (a.group !== undefined && a.group === b.group)) continue;
        // people on the two sides of the letter table face each other across it (their arms rest on the table)
        if (a.bench.startsWith("letter_") && b.bench.startsWith("letter_") && Math.abs(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw))) - Math.PI) < 1e-3) continue;
        // (the houses' places are as close as their furniture is — sofa seats 0.72 m apart, dining chairs facing each other across a table —
        // and the contract's own rules govern them: seat width ≥ 0.38 m, `seatMarkerProblems`, houseSeats.test.ts)
        if (isHouseArea(a.area)) continue;
        // a 대웅전's 방석 rows (lots v2, contract 11: 1.0 m apart, all facing the 수미단) sit one behind another, cross-legged: the
        // hands' width is across the row, not along it
        if (a.kind === "floor" && b.kind === "floor" && isLotSeat(a) && Math.abs(a.yaw - b.yaw) < 1e-3 && Math.abs((b.x - a.x) * Math.cos(a.yaw) - (b.z - a.z) * Math.sin(a.yaw)) < 0.05) continue;
        // two sitters facing each other across a café table: their feet meet under it, their bodies (the hips, 0.397 m
        // behind each root) are what must keep apart
        const fa = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
        const fb = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
        const facing = fa.x * fb.x + fa.z * fb.z < -0.9 && (b.x - a.x) * fa.x + (b.z - a.z) * fa.z > 0;
        const d = facing
          ? Math.hypot(a.x - fa.x * SIT_POSE.hipsBehindRoot - (b.x - fb.x * SIT_POSE.hipsBehindRoot), a.z - fa.z * SIT_POSE.hipsBehindRoot - (b.z - fb.z * SIT_POSE.hipsBehindRoot))
          : Math.hypot(a.x - b.x, a.z - b.z);
        expect(d, `${a.id} vs ${b.id}`).toBeGreaterThan(SEATED_HANDS_WIDTH);
      }
    }
  });
});

describe("the memorial hall's seats (generated from the model's seat__ markers)", () => {
  it("every sofa, armchair and bench of the hall is a seat: 15 places, 25 seats (no desk or letter chairs since 2026-11-17)", () => {
    expect(MEMORIAL_SEAT_MARKERS).toHaveLength(15);
    const by = (furn: string) => MEMORIAL_SEAT_MARKERS.filter((m) => m.furn === furn).length;
    expect({ sofa: by("sofa"), armchair: by("armchair"), chair: by("chair"), bench: by("bench") }).toEqual({ sofa: 3, armchair: 2, chair: 0, bench: 10 });
    expect(hallSeats).toHaveLength(25);
    for (const m of MEMORIAL_SEAT_MARKERS) expect(seatsOf(m.id).length, m.id).toBe(m.kind === "backless" && m.both ? 2 : 1);
  });

  it("backless seats (benches) can be sat from either side; backed seats (sofas, armchairs, chairs) lean back, from the front only", () => {
    for (const m of MEMORIAL_SEAT_MARKERS) {
      const seats = seatsOf(m.id);
      if (m.kind === "backless") {
        expect(seats.map((s) => s.kind)).toEqual(["backless", "backless"]);
        expect(new Set(seats.map((s) => s.group)).size).toBe(1);
        const [a, b] = seats as [VillageSeat, VillageSeat];
        expect(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw)))).toBeCloseTo(Math.PI, 5); // opposite facings
        expect(a.lean).toBe(0);
      } else {
        expect(seats).toHaveLength(1);
        expect(seats[0]!.kind).toBe("backed");
        expect(seats[0]!.lean).toBeGreaterThan(0.05);
        expect(m.back).toBeGreaterThan(0);
        // the root is in front of the backrest's face by BACKED_ROOT_AHEAD, so the torso's back touches the backrest
        const f = fwd(seats[0]!);
        const behind = (seats[0]!.x - m.x) * f.x + (seats[0]!.z - m.z) * f.z; // root ahead of the marker
        expect(behind + m.back).toBeCloseTo(BACKED_ROOT_AHEAD, 2);
      }
    }
  });

  it("a backed seat is offered from its front, never from behind its backrest; a bench from the side the visitor is on", () => {
    const free = () => false;
    const sofa = VILLAGE_SEATS[indexOf("sofa_a1")]!;
    const f = fwd(sofa);
    expect(approachesSeat(sofa, sofa.standX, sofa.standZ)).toBe(true);
    expect(approachesSeat(sofa, sofa.x - f.x * 1.2, sofa.z - f.z * 1.2)).toBe(false); // behind it
    // the bench w1: its north side picks the facing-north seat, its south side the facing-south one
    const front = VILLAGE_SEATS[indexOf("bench_w1_s0:front")]!;
    const back = VILLAGE_SEATS[indexOf("bench_w1_s0:back")]!;
    const north = nearestFreeSeat(front.x, front.z - 0.2, free, SEAT_REACH, VILLAGE_SEATS);
    const south = nearestFreeSeat(back.x, back.z + 0.2, free, SEAT_REACH, VILLAGE_SEATS);
    expect(VILLAGE_SEATS[north!]!.id).toBe("bench_w1_s0:front");
    expect(VILLAGE_SEATS[south!]!.id).toBe("bench_w1_s0:back");
  });

  it("the server forgives a hair behind the front edge (the client's pose runs ahead), never the far side of a backrest", () => {
    const sofa = VILLAGE_SEATS[indexOf("sofa_a1")]!;
    const f = fwd(sofa);
    const edge = sofa.frontEdge ?? 0;
    const justBehind = { x: sofa.x - f.x * (edge + 0.08), z: sofa.z - f.z * (edge + 0.08) };
    expect(approachesSeat(sofa, justBehind.x, justBehind.z)).toBe(false);
    expect(approachesSeat(sofa, justBehind.x, justBehind.z, SEAT_APPROACH_SLACK)).toBe(true);
    expect(approachesSeat(sofa, sofa.x - f.x * 1.2, sofa.z - f.z * 1.2, SEAT_APPROACH_SLACK)).toBe(false);
  });

  it("a backless bench outdoors: the two facings of one place sit at the same spot, back to back, and are one group", () => {
    const seats = VILLAGE_SEATS.filter((s) => s.bench === "memorial_forecourt");
    expect(seats).toHaveLength(4);
    const byGroup = new Map<string, VillageSeat[]>();
    for (const s of seats) byGroup.set(s.group!, [...(byGroup.get(s.group!) ?? []), s]);
    expect(byGroup.size).toBe(2);
    for (const [g, pair] of byGroup) {
      expect(pair, g).toHaveLength(2);
      const [a, b] = pair as [VillageSeat, VillageSeat];
      const ax = a.x - Math.sin(a.yaw) * (a.frontEdge ?? 0); // back from the root to the bench's middle line
      const bx = b.x - Math.sin(b.yaw) * (b.frontEdge ?? 0);
      // the same spot along the bench (the bench runs along x at the forecourt)
      expect(Math.abs(ax - bx), g).toBeLessThan(1e-3);
      expect(Math.abs(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw))) - Math.PI), g).toBeLessThan(1e-3);
    }
    // the two places along the bench are a full place apart
    const fronts = seats.filter((s) => s.id.endsWith(":front"));
    expect(Math.abs(fronts[0]!.x - fronts[1]!.x)).toBeGreaterThan(SEATED_HANDS_WIDTH);
  });

  it("one place is one seat: taking one facing of a bench seat blocks the other", () => {
    const a = indexOf("bench_w1_s0:front");
    const b = indexOf("bench_w1_s0:back");
    const other = indexOf("bench_w1_s1:front");
    expect(seatTaken(VILLAGE_SEATS, b, (i) => i === a)).toBe(true);
    expect(seatTaken(VILLAGE_SEATS, a, (i) => i === b)).toBe(true);
    expect(seatTaken(VILLAGE_SEATS, other, (i) => i === a)).toBe(false); // the neighbouring place stays free
    const s = VILLAGE_SEATS[a]!;
    const p = { x: s.standX, z: s.standZ };
    expect(nearestFreeSeat(p.x, p.z, (i) => i === a, SEAT_REACH, VILLAGE_SEATS)).not.toBe(b);
  });

  it("every seat sits ON its furniture: the marker is inside a collider of the model, the root clear of nothing but its own furniture", () => {
    for (const m of MEMORIAL_SEAT_MARKERS) {
      const box = MEMORIAL_COLLIDERS.find((c) => m.x > c.minX && m.x < c.maxX && m.z > c.minZ && m.z < c.maxZ);
      expect(box, m.id).toBeDefined();
      expect(m.y).toBeGreaterThan(0.38);
      expect(m.y).toBeLessThan(0.5);
    }
  });

  it("the hall has no sitting spot that the houses' furniture could answer: house seats are in house areas", () => {
    expect(hallSeats.every((s) => s.area === "hall")).toBe(true);
    const houses = VILLAGE_SEATS.filter((s) => isHouseArea(s.area));
    expect(houses.length).toBeGreaterThan(0);
    // the same coordinates as the hall's seats, a different area: the index, not the position, tells them apart
    expect(new Set(VILLAGE_SEATS.map((s) => s.id)).size).toBe(VILLAGE_SEATS.length);
  });
});

describe("nobody is trapped in the hall: every seat can be left and the whole floor reached", () => {
  const sp = L.memorial.interior.spawn;
  const reach = reachable({ ...villageGeometry, bounds: L.areas.hall }, { x: sp.x, z: sp.z }, 0.1, 0);

  it("from every hall seat's dismount spot a body walks to the arrival spot (the spot is on the arrival's connected floor)", () => {
    for (const s of hallSeats) expect(hasNear(reach, { x: s.standX, z: s.standZ }, 0.1), s.id).toBe(true);
  });

  it("the places a visitor goes are on that floor: the door pad, bank C's front, the open floor where the desk and the letter table stood, the lounge", () => {
    const places: Array<[string, number, number]> = [
      ["the door", 300, 5.2], ["bank C's front", 299.87, -4.5], ["where the desk stood", 303.0, 4.1], ["where the kiosk stood", 303.4, 3.4],
      ["the flowers", 302.8, 4.8], ["the mailbox", 297.2, -3.4], ["the lounge", 294.6, 3.0], ["east cubbies", 306.0, 0.0], ["bank A", 295.0, -4.9],
    ];
    for (const [name, x, z] of places) expect(hasNear(reach, { x, z }, 0.15), name).toBe(true);
  });
});

describe("village seats (where a sitter gets up to)", () => {
  it("every dismount spot is clear of every collider of its map (a standing body plus margin) and inside its area", () => {
    for (const s of VILLAGE_SEATS.filter((v) => !v.retired)) {
      const house = parseHouseFloorArea(s.area);
      const room = lotRoomOf(s.area);
      const bounds = s.area === "village" ? villageWalkArea(L) : house ? houseFloorBounds(house.n, house.floor) : room ? room.bounds : L.areas.hall;
      const obstacles = villageGeometry.obstacles;
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS + STAND_CLEARANCE, obstacles, 0), s.id).toBe(false);
      expect(s.standX - PLAYER_RADIUS, s.id).toBeGreaterThan(bounds.minX);
      expect(s.standX + PLAYER_RADIUS, s.id).toBeLessThan(bounds.maxX);
      expect(s.standZ - PLAYER_RADIUS, s.id).toBeGreaterThan(bounds.minZ);
      expect(s.standZ + PLAYER_RADIUS, s.id).toBeLessThan(bounds.maxZ);
    }
  });

  it("gets up a short step from the seat, within reach (so the seat is offered again from there)", () => {
    for (const s of VILLAGE_SEATS.filter((v) => !isHouseArea(v.area))) {
      expect(approachesSeat(s, s.standX, s.standZ), s.id).toBe(true);
      const d = Math.hypot(s.standX - s.x, s.standZ - s.z);
      // a fishing chair's front is the water: its sitter gets up beside it and a step back (lakeLayout.ts chairSeat)
      expect(d, s.id).toBeLessThanOrEqual(s.lake === "fishing_chair" ? 1.35 : 1.3);
      expect(d, s.id).toBeLessThan(SEAT_REACH);
    }
    // a bench or a sofa: straight ahead, so the seat is offered again from where the sitter stands
    for (const s of VILLAGE_SEATS.filter((v) => !isHouseArea(v.area) && (v.kind === "backless" || v.bench.startsWith("plaza_") || v.bench.startsWith("sofa")))) {
      const ahead = (s.standX - s.x) * Math.sin(s.yaw) + (s.standZ - s.z) * Math.cos(s.yaw);
      expect(ahead, s.id).toBeGreaterThan(0);
    }
  });

  it("two sitters of one bench get up to different spots, clear of each other and of the other seat", () => {
    // the backed benches' pairs (plaza 1..8, the bus shelter): two places, one facing each
    for (const bench of VILLAGE_BENCHES.filter((b) => b.kind === "backed")) {
      const [a, b] = seatsOf(bench.id) as [VillageSeat, VillageSeat];
      expect(Math.hypot(a.standX - b.standX, a.standZ - b.standZ)).toBeGreaterThan(2 * PLAYER_RADIUS);
      expect(Math.hypot(a.standX - b.x, a.standZ - b.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
      expect(Math.hypot(b.standX - a.x, b.standZ - a.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
    }
  });
});

describe("the art's marked seats: café terrace chairs and porch benches (review 2026-11-15)", () => {
  it("every seat__ marker of village.glb is a seat, after the benches' and the houses' (their indices stay)", () => {
    expect(VILLAGE_SEAT_MARKERS.filter((m) => m.id.startsWith("cafe_terrace_"))).toHaveLength(12);
    expect(VILLAGE_SEAT_MARKERS.filter((m) => /^house_\d+_porch$/.test(m.id)).map((m) => m.id)).toEqual(["house_2_porch", "house_9_porch", "house_10_porch"]);
    const marked = markedSeats();
    expect(marked).toHaveLength(15);
    expect(VILLAGE_SEATS.slice(LAKE_SEAT_BASE - 15, LAKE_SEAT_BASE)).toEqual(marked); // the lake's seats come after them
    expect(VILLAGE_SEATS.slice(0, VILLAGE_BENCHES.length * 2).every((s) => !MARKED.has(s.bench))).toBe(true);
  });

  it("a café chair: the sitter's root just past the seat's front edge, getting up beside the chair; offered beside it, never from behind the backrest", () => {
    const chairs = VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => s.bench.startsWith("cafe_terrace_"));
    expect(chairs).toHaveLength(12);
    for (const { s, i } of chairs) {
      const m = VILLAGE_SEAT_MARKERS.find((k) => k.id === s.bench)!;
      const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
      const ahead = (s.x - m.x) * f.x + (s.z - m.z) * f.z;
      expect(ahead).toBeCloseTo(m.frontEdge + SIT_ROOT_AHEAD, 3);
      expect(s.seatY).toBe(m.seatTop);
      // the art's spot, or further out on the line from the chair where the terrace's clearance needs it
      expect(Math.hypot(s.standX - m.standX!, s.standZ - m.standZ!)).toBeLessThanOrEqual(0.5);
      // the get-up spot is beside the chair (not ahead: the table is there), within reach and a short step
      const standAhead = (s.standX - m.x) * f.x + (s.standZ - m.z) * f.z;
      expect(standAhead).toBeGreaterThanOrEqual(-CHAIR_BACK_BEHIND);
      expect(standAhead).toBeLessThanOrEqual(m.frontEdge);
      expect(Math.hypot(s.standX - s.x, s.standZ - s.z)).toBeLessThan(1.2); // a step aside, well within SEAT_REACH
      expect(approachesSeat(s, s.standX, s.standZ)).toBe(true);
      expect(nearestFreeSeat(s.standX, s.standZ, () => false, SEAT_REACH, VILLAGE_SEATS)).toBe(i);
      // behind the backrest: not offered, right behind it nor a little to the side (still behind the chair's width)
      for (const side of [0, 0.3]) {
        const l = { x: Math.cos(s.yaw), z: -Math.sin(s.yaw) };
        const back = { x: m.x - f.x * (CHAIR_BACK_BEHIND + 0.15) + l.x * side, z: m.z - f.z * (CHAIR_BACK_BEHIND + 0.15) + l.z * side };
        expect(approachesSeat(s, back.x, back.z)).toBe(false);
      }
      // beside the chair, level with its back or a tap-walk's stop past it: offered
      const l = { x: Math.cos(s.yaw), z: -Math.sin(s.yaw) };
      for (const behind of [CHAIR_BACK_BEHIND, CHAIR_BACK_BEHIND + 0.3]) {
        for (const sgn of [-1, 1]) expect(approachesSeat(s, m.x - f.x * behind + l.x * sgn * 0.6, m.z - f.z * behind + l.z * sgn * 0.6)).toBe(true);
      }
    }
  });

  it("a porch bench: one seat in front of its board, getting up toward the lane, clear of the porch's posts and rails", () => {
    const porch = markedSeats().filter((s) => s.bench.endsWith("_porch"));
    expect(porch).toHaveLength(3);
    for (const s of porch) {
      const m = VILLAGE_SEAT_MARKERS.find((k) => k.id === s.bench)!;
      const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
      expect((s.x - m.x) * f.x + (s.z - m.z) * f.z).toBeCloseTo(m.frontEdge + SIT_ROOT_AHEAD, 3);
      expect(s.approachEdge).toBeUndefined();
      expect(approachesSeat(s, m.x - f.x * 0.5, m.z - f.z * 0.5)).toBe(false); // behind the backrest
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS + STAND_CLEARANCE, villageGeometry.obstacles, 0)).toBe(false);
    }
  });
});

describe("benches are sat on from the front (approachesSeat / nearestFreeSeat)", () => {
  const s = VILLAGE_SEATS[0]!;
  const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };

  it("offers the seat in front of the bench, not behind its backrest, even within reach", () => {
    expect(approachesSeat(s, s.x + f.x, s.z + f.z)).toBe(true);
    expect(approachesSeat(s, s.x - f.x * 1.2, s.z - f.z * 1.2)).toBe(false); // behind the bench, 1.2 m from the seat
    const free = () => false;
    expect(nearestFreeSeat(s.x - f.x * 1.2, s.z - f.z * 1.2, free, SEAT_REACH, VILLAGE_SEATS)).toBeNull();
    expect(nearestFreeSeat(s.standX, s.standZ, free, SEAT_REACH, VILLAGE_SEATS)).toBe(0);
  });

  it("offers the nearest free seat of a bench: the neighbour when the near one is taken", () => {
    const n = VILLAGE_SEATS[1]!;
    // 0.4 m in front of the bench's middle, a hair nearer seat 0
    const x = s.x * 0.52 + n.x * 0.48 + f.x * 0.4;
    const z = s.z * 0.52 + n.z * 0.48 + f.z * 0.4;
    expect(nearestFreeSeat(x, z, () => false, SEAT_REACH, VILLAGE_SEATS)).toBe(0);
    expect(nearestFreeSeat(x, z, (i) => i === 0, SEAT_REACH, VILLAGE_SEATS)).toBe(1);
  });

  it("a seat without a front edge keeps an any-side reach", () => {
    const chair = { x: 0, z: 0, yaw: Math.PI / 2, standX: -0.9, standZ: 0 };
    expect(approachesSeat(chair, chair.x - 1, chair.z)).toBe(true);
    expect(approachesSeat(chair, chair.x + 1, chair.z)).toBe(true);
    expect(nearestFreeSeat(chair.standX, chair.standZ, () => false, SEAT_REACH, [chair])).toBe(0);
  });
});

describe("the bus stop shelter's bench", () => {
  const seats = VILLAGE_SEATS.filter((v) => v.bench === "shelter");
  const shelter = L.busStop.shelter;
  const rearGlass = busShelterColliders(L)[0]!; // the back wall behind the bench
  const index = (i: number) => VILLAGE_SEATS.indexOf(seats[i]!);

  it("has a seat for each 1.15 m of its 2.3 m length, in the end cells between the arm dividers, at slat height", () => {
    expect(SHELTER_BENCH.length).toBe(2.3);
    expect(seats).toHaveLength(2);
    expect(seats.map((s) => s.area)).toEqual(["village", "village"]);
    expect(seats[0]!.seatY).toBeCloseTo(0.5125, 4);
    const along = seats.map((s) => inBenchFrame(SHELTER_BENCH, s.x, s.z).along);
    // the dividers (build_busstop.py) stand 0.38 m either side of the middle; each seat has 0.77 m between a divider and the end
    expect(Math.abs(along[0]!)).toBeGreaterThan(0.38 + 0.31 - 0.05);
    expect(Math.abs(along[1]!)).toBeGreaterThan(0.38 + 0.31 - 0.05);
    expect(Math.abs(along[0]!) + 0.31).toBeLessThanOrEqual(SHELTER_BENCH.length / 2);
    expect(Math.abs(along[0]! - along[1]!)).toBeGreaterThan(SEATED_HANDS_WIDTH);
  });

  it("lies inside the shelter, against its glass back wall", () => {
    const b = SHELTER_BENCH;
    expect(b.centre.x).toBeGreaterThan(shelter.centre.x);
    expect(b.centre.x).toBeLessThan(rearGlass.minX);
    expect(Math.abs(b.centre.z - shelter.centre.z)).toBeLessThan(1e-9);
    const solid = busShelterBenchCollider(L);
    expect(solid.maxX).toBeLessThan(rearGlass.minX);
    expect(solid.minZ).toBeGreaterThan(shelter.centre.z - shelter.size.z / 2);
    expect(solid.maxZ).toBeLessThan(shelter.centre.z + shelter.size.z / 2);
    expect(VILLAGE_BENCHES.indexOf(b)).toBe(VILLAGE_BENCHES.length - 1);
    // the village seats list the shelter's after the hall's and the houses', before the art's marked seats
    expect(VILLAGE_SEATS.findIndex((s) => s.bench === "shelter")).toBe(LAKE_SEAT_BASE - markedSeats().length - 2); // the lake's seats come after
  });

  it("is sat on from the FRONT only, facing the road: the glass wall is its back rest (any side behind it is refused)", () => {
    for (const s of seats) {
      expect(s.yaw).toBeCloseTo(-Math.PI / 2, 5); // facing west, to the road (wrapYaw keeps 6 decimals)
      const fwd = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
      expect(fwd.x).toBeLessThan(-0.99);
      // from the road side (in front of the seat): offered
      expect(approachesSeat(s, s.x + fwd.x * 0.8, s.z + fwd.z * 0.8)).toBe(true);
      expect(approachesSeat(s, s.standX, s.standZ)).toBe(true);
      // from behind the glass (east of the bench), even within reach: not offered
      expect(approachesSeat(s, s.x - fwd.x * 1.2, s.z - fwd.z * 1.2)).toBe(false);
      expect(approachesSeat(s, rearGlass.maxX + 0.5, s.z)).toBe(false);
      expect(nearestFreeSeat(rearGlass.maxX + 0.5, s.z, () => false, SEAT_REACH, VILLAGE_SEATS)).toBeNull();
    }
    // standing at the open side offers the nearer seat, and the other when it is taken
    const x = seats[0]!.x - 0.5;
    const z = (seats[0]!.z + seats[1]!.z) / 2 + 0.05; // in front of the bench, a hair nearer the second seat
    expect(nearestFreeSeat(x, z, () => false, SEAT_REACH, VILLAGE_SEATS)).toBe(index(1));
    expect(nearestFreeSeat(x, z, (i) => i === index(1), SEAT_REACH, VILLAGE_SEATS)).toBe(index(0));
  });

  it("puts the sitter inside the shelter, clear of the glass and the bench, and gets up to the road side, clear of every collider", () => {
    for (const s of seats) {
      expect(s.x).toBeGreaterThan(shelter.centre.x - shelter.size.x / 2);
      expect(s.x).toBeLessThan(rearGlass.minX);
      expect(s.standX).toBeLessThan(s.x); // west of the seat: the road side
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS + STAND_CLEARANCE, villageGeometry.obstacles, 0)).toBe(false);
    }
  });
});

describe("the fishing lake's seats in the global index (A10, design 5.4 and 12.2)", () => {
  const lake = lakeSeats();
  const lakeIdx = VILLAGE_SEATS.map((s, i) => (s.lake ? i : -1)).filter((i) => i >= 0);

  it("come after every village seat, so every older seat index stays (Player.seatIndex is int16); only the waterfall's stones, then the zelkova deck follow", () => {
    expect(FALLS_SEATS).toHaveLength(8);
    const deck = VILLAGE_SEATS.filter((s) => s.id.startsWith("zelkova_deck:"));
    expect(deck).toHaveLength(6);
    // release 3 appended the deck, then the house seats the art brought back (LATE_HOUSE_SEATS): no live index moved; lots v2 (L5v2)
    // appends the lot buildings' seats after those (isLotSeat)
    const lotFirst = VILLAGE_SEATS.findIndex((s) => isLotSeat(s));
    const end = lotFirst >= 0 ? lotFirst : VILLAGE_SEATS.length;
    const late = VILLAGE_SEATS.slice(end - LATE_HOUSE_SEATS.length, end);
    expect(late.map((s) => s.bench)).toEqual([...LATE_HOUSE_SEATS]);
    expect(VILLAGE_SEATS.slice(end).every((s) => isLotSeat(s))).toBe(true);
    const tail = end - late.length;
    expect(LAKE_SEAT_BASE).toBe(tail - lakeIdx.length - FALLS_SEATS.length - deck.length);
    expect(VILLAGE_SEATS.slice(tail - deck.length, tail)).toEqual(deck);
    expect(VILLAGE_SEATS.slice(tail - deck.length - FALLS_SEATS.length, tail - deck.length)).toEqual(FALLS_SEATS); // release 2's stones keep their indices
    expect(lakeIdx[0]).toBe(LAKE_SEAT_BASE);
    expect(lakeIdx.every((i, k) => i === LAKE_SEAT_BASE + k)).toBe(true);
    expect(lake).toHaveLength(56);
    // a backless board is two seats (one per facing) of one group; a picnic bench one (its other side is the table)
    const boards = lake.filter((s) => s.approach === "either" && s.kind !== "picnic").length;
    expect(lakeIdx).toHaveLength(56 + boards);
    expect(VILLAGE_SEATS.length).toBeLessThan(32768);
    for (const i of lakeIdx) expect(VILLAGE_SEATS[i]!.area).toBe("village");
  });

  it("the 30 fishing chairs are the first lake seats, in LAKE_FISHING_SPOTS order", () => {
    expect(LAKE_FISHING_SPOTS).toHaveLength(30);
    LAKE_FISHING_SPOTS.forEach((spot, i) => {
      const idx = fishingSeatIndex(i);
      expect(idx).toBe(LAKE_SEAT_BASE + i);
      expect(VILLAGE_SEATS[idx]).toMatchObject({ lake: "fishing_chair", kind: "backed", spot: spot.id, yaw: spot.yaw });
      expect(VILLAGE_SEATS[idx]!.beside).toBeDefined();
      expect(fishingSpotOfSeat(idx)).toBe(i);
    });
    expect(fishingSpotOfSeat(0)).toBe(-1);
    expect(fishingSpotOfSeat(LAKE_SEAT_BASE + 30)).toBe(-1); // the first bench
    expect(fishingSpotOfSeat(-1)).toBe(-1);
    expect(fishingSpotOfSeat(999)).toBe(-1);
  });

  it("a backed seat (fishing chair, bench, porch) is offered from its front / side only; a backless board from either side, each facing from its own side", () => {
    for (const i of lakeIdx) {
      const s = VILLAGE_SEATS[i]!;
      const ahead = (d: number) => ({ x: s.x + Math.sin(s.yaw) * d, z: s.z + Math.cos(s.yaw) * d });
      expect(approachesSeat(s, ahead(1).x, ahead(1).z), `${s.id} front`).toBe(true);
      if (s.kind === "backed") expect(approachesSeat(s, ahead(-1.2).x, ahead(-1.2).z), `${s.id} behind the backrest`).toBe(false);
    }
    const groups = new Map<string, VillageSeat[]>();
    for (const i of lakeIdx) {
      const s = VILLAGE_SEATS[i]!;
      if (s.kind !== "backless" || s.group === undefined) continue;
      groups.set(s.group!, [...(groups.get(s.group!) ?? []), s]);
    }
    expect(groups.size).toBe(lake.filter((s) => s.approach === "either" && s.kind !== "picnic").length);
    for (const [g, pair] of groups) {
      expect(pair, g).toHaveLength(2);
      const [a, b] = pair as [VillageSeat, VillageSeat];
      // opposite facings, the roots either side of the board's middle
      expect(Math.abs(Math.cos(a.yaw - b.yaw) + 1), g).toBeLessThan(1e-6);
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      expect(Math.hypot(a.x - mid.x, a.z - mid.z), g).toBeCloseTo(SIT_POSE.hipsBehindRoot, 2);
    }
  });

  it("every lake seat's get-up spot is clear of every collider", () => {
    for (const i of lakeIdx) {
      const s = VILLAGE_SEATS[i]!;
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS, villageGeometry.obstacles, 0), `${s.id} ${s.standX},${s.standZ}`).toBe(false);
    }
  });
});

describe("the plaza zelkova deck (평상, UX 2026-11-16)", () => {
  const deck = VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => s.id.startsWith("zelkova_deck:"));
  const c = VILLAGE_LAYOUT.plaza.zelkova.centre;
  const box = { minX: c.x - 2.5, maxX: c.x + 2.5, minZ: c.z - 2.5, maxZ: c.z + 2.5 };

  it("six places, the very last seats (after the lake's and release 2's waterfall stones), so no older index moves", () => {
    expect(deck).toHaveLength(6);
    // (only release 3's restored house seats, LATE_HOUSE_SEATS, follow them)
    // (lots v2's seats come after those, L5v2)
    const end = VILLAGE_SEATS.findIndex((s) => isLotSeat(s));
    expect(deck.map(({ i }) => i)).toEqual([0, 1, 2, 3, 4, 5].map((k) => (end >= 0 ? end : VILLAGE_SEATS.length) - LATE_HOUSE_SEATS.length - 6 + k));
    expect(deck[0]!.i).toBeGreaterThan(LAKE_SEAT_BASE);
  });

  it("each sits on the rim facing out, at the deck's height, a backless seat of the open village", () => {
    for (const { s } of deck) {
      expect(s).toMatchObject({ area: "village", kind: "backless", seatY: 0.46, lean: 0 });
      expect(s.group).toBeUndefined(); // one facing: nobody stands on the deck to sit facing the trunk
      const out = Math.hypot(s.x - c.x, s.z - c.z);
      expect(out).toBeGreaterThan(2.3);
      expect(out).toBeLessThan(2.6);
      // facing away from the trunk
      expect(Math.sin(s.yaw) * (s.x - c.x) + Math.cos(s.yaw) * (s.z - c.z)).toBeGreaterThan(2.2);
    }
  });

  it("gets up onto clear ground outside the deck's collider, in front of the seat, and sitters keep apart", () => {
    for (const { s } of deck) {
      const inside = s.standX > box.minX - 0.3 && s.standX < box.maxX + 0.3 && s.standZ > box.minZ - 0.3 && s.standZ < box.maxZ + 0.3;
      expect(inside, s.id).toBe(false);
      expect(approachesSeat(s, s.standX, s.standZ)).toBe(true);
      expect(Math.hypot(s.standX - s.x, s.standZ - s.z)).toBeLessThan(SEAT_REACH);
    }
    for (let a = 0; a < deck.length; a++)
      for (let b = a + 1; b < deck.length; b++)
        expect(Math.hypot(deck[a]!.s.x - deck[b]!.s.x, deck[a]!.s.z - deck[b]!.s.z)).toBeGreaterThan(1.2);
  });
});
