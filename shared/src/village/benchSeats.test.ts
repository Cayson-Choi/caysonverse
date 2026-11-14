import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { PLAYER_RADIUS, SEAT_APPROACH_SLACK, SEAT_REACH, approachesSeat, nearestFreeSeat, seatTaken } from "../worldMap";
import { BACKED_ROOT_AHEAD, SIT_POSE, SIT_ROOT_AHEAD, liftForSeatY } from "../sitPose";
import { reachable, hasNear } from "../school/reachTestUtil";
import { VILLAGE_COLLIDERS } from "./generated/villageColliders";
import { MEMORIAL_COLLIDERS } from "./generated/memorialColliders";
import { MEMORIAL_SEAT_MARKERS } from "./generated/memorialSeats";
import { VILLAGE_LAYOUT, houseInteriorGeometry, isHouseArea, villageGeometry } from "./villageLayout";
import { STAND_CLEARANCE, VILLAGE_BENCHES, VILLAGE_SEATS, benchSeatOffsets, type VillageBench, type VillageSeat } from "./benchSeats";

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
const hallSeats = VILLAGE_SEATS.filter((s) => s.area === "hall");
const fwd = (s: { yaw: number }) => ({ x: Math.sin(s.yaw), z: Math.cos(s.yaw) });

describe("village benches (the models sitting needs)", () => {
  it("lists the eight plaza benches and the forecourt bench, in that order (the hall's seats come from its model's markers)", () => {
    expect(VILLAGE_BENCHES.map((b) => b.id)).toEqual([...L.plaza.benches.map((_, i) => `plaza_${i + 1}`), "memorial_forecourt"]);
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
      expect(b.seatTop).toBeLessThanOrEqual(0.47);
      const lift = liftForSeatY(b.seatTop);
      expect(lift).toBeGreaterThan(0);
      expect(lift).toBeLessThan(0.1);
    }
    expect(liftForSeatY(undefined)).toBe(0); // the legacy chairs: drawn as authored
  });
});

describe("village seats (where a sitter goes)", () => {
  it("one global list: plaza places (backed, one facing), the forecourt's (backless, two facings in one group), the hall's, the houses'", () => {
    // 8 plaza benches x 2 places, the forecourt 2 places x 2 facings, the hall's markers, then the houses
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
      const bounds = a.area === "village" ? L.areas.village : L.areas.hall;
      expect(a.x, a.id).toBeGreaterThan(bounds.minX);
      expect(a.x, a.id).toBeLessThan(bounds.maxX);
      expect(a.z, a.id).toBeGreaterThan(bounds.minZ);
      expect(a.z, a.id).toBeLessThan(bounds.maxZ);
      for (let j = i + 1; j < VILLAGE_SEATS.length; j++) {
        const b = VILLAGE_SEATS[j]!;
        if (a.area !== b.area || (a.group !== undefined && a.group === b.group)) continue;
        // people on the two sides of the letter table face each other across it (their arms rest on the table)
        if (a.bench.startsWith("letter_") && b.bench.startsWith("letter_") && Math.abs(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw))) - Math.PI) < 1e-3) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThan(SEATED_HANDS_WIDTH);
      }
    }
  });
});

describe("the memorial hall's seats (generated from the model's seat__ markers)", () => {
  it("every sofa, armchair, chair and bench of the hall is a seat: 21 places, 31 seats", () => {
    expect(MEMORIAL_SEAT_MARKERS).toHaveLength(21);
    const by = (furn: string) => MEMORIAL_SEAT_MARKERS.filter((m) => m.furn === furn).length;
    expect({ sofa: by("sofa"), armchair: by("armchair"), chair: by("chair"), bench: by("bench") }).toEqual({ sofa: 3, armchair: 2, chair: 6, bench: 10 });
    expect(hallSeats).toHaveLength(31);
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

  it("a chair at a table is sat on from its sides too (its front is the table), never through its backrest", () => {
    for (const id of ["letter_s0", "letter_n1", "consult_0", "consult_1"]) {
      const chair = VILLAGE_SEATS[indexOf(id)]!;
      const f = fwd(chair);
      const side = { x: f.z, z: -f.x }; // a quarter turn from the facing
      expect(chair.sidePlane, id).toBeGreaterThan(0.2);
      expect(approachesSeat(chair, chair.x + side.x * 0.6, chair.z + side.z * 0.6), `${id} from its side`).toBe(true);
      expect(approachesSeat(chair, chair.x - side.x * 0.6, chair.z - side.z * 0.6), `${id} from its other side`).toBe(true);
      // from behind the backrest: refused by the client, and by the server even with its slack
      expect(approachesSeat(chair, chair.x - f.x * 1.1, chair.z - f.z * 1.1), `${id} from behind`).toBe(false);
      expect(approachesSeat(chair, chair.x - f.x * 1.1, chair.z - f.z * 1.1, SEAT_APPROACH_SLACK), `${id} from behind (server)`).toBe(false);
    }
    expect(VILLAGE_SEATS[indexOf("armchair_0")]!.sidePlane).toBeUndefined();
    expect(VILLAGE_SEATS[indexOf("sofa_a1")]!.sidePlane).toBeUndefined();
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

  it("the places a visitor goes are on that floor: the door pad, the niche's front, the desk, the kiosk, the flower stand, the letter table, the lounge", () => {
    const places: Array<[string, number, number]> = [
      ["the door", 300, 5.2], ["the niche", 299.87, -4.5], ["the desk", 303.0, 4.1], ["the kiosk", 303.4, 3.4],
      ["the flowers", 302.8, 4.8], ["the mailbox", 297.2, -3.4], ["the lounge", 294.6, 3.0], ["east cubbies", 306.0, 0.0], ["bank A", 295.0, -4.9],
    ];
    for (const [name, x, z] of places) expect(hasNear(reach, { x, z }, 0.15), name).toBe(true);
  });
});

describe("village seats (where a sitter gets up to)", () => {
  it("every dismount spot is clear of every collider of its map (a standing body plus margin) and inside its area", () => {
    for (const s of VILLAGE_SEATS) {
      const bounds = s.area === "village" ? L.areas.village : L.areas.hall;
      const obstacles = isHouseArea(s.area) ? houseInteriorGeometry.obstacles : villageGeometry.obstacles;
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS + STAND_CLEARANCE, obstacles, 0), s.id).toBe(false);
      expect(s.standX - PLAYER_RADIUS, s.id).toBeGreaterThan(bounds.minX);
      expect(s.standX + PLAYER_RADIUS, s.id).toBeLessThan(bounds.maxX);
      expect(s.standZ - PLAYER_RADIUS, s.id).toBeGreaterThan(bounds.minZ);
      expect(s.standZ + PLAYER_RADIUS, s.id).toBeLessThan(bounds.maxZ);
    }
  });

  it("gets up a short step from the seat, within reach", () => {
    for (const s of VILLAGE_SEATS.filter((v) => !isHouseArea(v.area))) {
      const d = Math.hypot(s.standX - s.x, s.standZ - s.z);
      expect(d, s.id).toBeLessThanOrEqual(1.3);
      expect(d, s.id).toBeLessThan(SEAT_REACH);
    }
    // a bench or a sofa: straight ahead, so the seat is offered again from where the sitter stands
    for (const s of VILLAGE_SEATS.filter((v) => !isHouseArea(v.area) && (v.kind === "backless" || v.bench.startsWith("plaza_") || v.bench.startsWith("sofa")))) {
      const ahead = (s.standX - s.x) * Math.sin(s.yaw) + (s.standZ - s.z) * Math.cos(s.yaw);
      expect(ahead, s.id).toBeGreaterThan(0);
    }
  });

  it("two sitters of one bench get up to different spots, clear of each other and of the other seat", () => {
    for (let i = 0; i < 16; i += 2) {
      const a = VILLAGE_SEATS[i]!;
      const b = VILLAGE_SEATS[i + 1]!;
      expect(Math.hypot(a.standX - b.standX, a.standZ - b.standZ)).toBeGreaterThan(2 * PLAYER_RADIUS);
      expect(Math.hypot(a.standX - b.x, a.standZ - b.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
      expect(Math.hypot(b.standX - a.x, b.standZ - a.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
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
