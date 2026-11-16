import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS, SEAT_REACH, approachesSeat, nearestFreeSeat } from "../worldMap";
import { HOUSE_NUMBERS, HOUSE_SEAT_PLAN, houseFloorBounds, seatCount, type HouseFloor, type HouseNumber } from "./houseAreas";
import { GENERATED_HOUSES, GENERATED_HOUSE_NUMBERS } from "./generated/houses";
import { VILLAGE_SEATS } from "./benchSeats";
import { houseArea, isHouseArea, villageGeometry } from "./villageLayout";
import { inside } from "../school/reachTestUtil";
import { HOUSE_EXIT_TARGET_ID, HOUSE_STAIR_DOWN_TARGET_ID, HOUSE_STAIR_UP_TARGET_ID, houseOffers, padOfferedFrom } from "./houseTargets";
import { EXIT_PAD, HOUSE_PAD_HALF_WIDTH, HOUSE_PAD_REACH, HOUSE_PLACES, HOUSE_STAIR_TYPE, STAIR_PLANS, localToWorld, padUsableFrom, worldToLocal } from "./houseAreas";

/**
 * 집 실내 G: the design's chapter 8.3 on the seat list — for every seat of every finished house, approached from 8 directions at 0.6 and
 * 1.0 m (the sitter's seat point is where it is; the approach points are round it), the prompt (`nearestFreeSeat`, the client's rule) follows the
 * rules: a backed seat only from its front (a chair at a table also from its sides), a backless one from either side, a cushion from any side,
 * and nothing is offered through furniture or a wall.
 */
const seats = VILLAGE_SEATS.map((s, index) => ({ s, index })).filter(({ s }) => isHouseArea(s.area));
const free = () => false;

describe("house seat counts follow the plan", () => {
  it("each finished house has the markers its plan says, floor by floor (houses 2–10 are checked here when they land)", () => {
    for (const n of GENERATED_HOUSE_NUMBERS) {
      for (const f of [1, 2] as const) {
        const got = GENERATED_HOUSES[n]!.seats.filter((m) => m.floor === f);
        expect(got.length, `house ${n} floor ${f}`).toBe(seatCount(n, f));
      }
    }
    expect(HOUSE_NUMBERS.length).toBe(10);
    expect(Object.keys(HOUSE_SEAT_PLAN)).toHaveLength(10);
  });
});

describe("approaching every house seat (8 directions x 0.6 / 1.0 m)", () => {
  it("is offered the seat's own kind of approach, never through a collider and never from behind a backrest", () => {
    const problems: string[] = [];
    let probes = 0;
    for (const { s, index } of seats) {
      const hit = /^house:house_(\d+):([12])$/.exec(s.area)!;
      const room = houseFloorBounds(Number(hit[1]) as HouseNumber, Number(hit[2]) as HouseFloor);
      const marker = GENERATED_HOUSES[Number(hit[1]) as HouseNumber]!.seats.find((m) => s.bench === m.id)!;
      let offeredSomewhere = false;
      for (const d of [0.6, 1.0]) {
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const x = s.x + Math.cos(a) * d;
          const z = s.z + Math.sin(a) * d;
          if (!inside(room, { x, z }) || isBlocked(x, z, PLAYER_RADIUS, villageGeometry.obstacles, 0)) continue; // furniture / a wall: no body there
          probes++;
          const asked = nearestFreeSeat(x, z, free, SEAT_REACH, VILLAGE_SEATS);
          const rule = approachesSeat(s, x, z);
          if (asked === index) {
            offeredSomewhere = true;
            if (!rule) problems.push(`${s.id}: offered from (${x.toFixed(2)}, ${z.toFixed(2)}) against its own approach rule`);
          }
          // behind a backrest: a backed seat that is no chair at a table (a sofa, an armchair, a beanbag) is not offered 0.6+ m behind it
          if (marker.kind === "backed" && marker.furn !== "chair") {
            const ahead = (x - s.x) * Math.sin(s.yaw) + (z - s.z) * Math.cos(s.yaw);
            if (ahead < -(s.frontEdge ?? 0) - 0.05 && asked === index) problems.push(`${s.id}: offered from behind (${ahead.toFixed(2)})`);
          }
        }
      }
      // every seat can be approached from somewhere free (else nobody could sit on it)
      const stand = nearestFreeSeat(s.standX, s.standZ, free, SEAT_REACH, VILLAGE_SEATS);
      if (!offeredSomewhere && stand === null) problems.push(`${s.id}: never offered from any free probe`);
    }
    expect(probes).toBeGreaterThan(30);
    expect(problems, problems.slice(0, 20).join("\n")).toEqual([]);
  });

  it("two facings of one backless place exclude each other (one group)", () => {
    const byBench = new Map<string, number[]>();
    seats.forEach(({ s, index }) => byBench.set(s.bench, [...(byBench.get(s.bench) ?? []), index]));
    for (const [bench, idx] of byBench) {
      if (idx.length < 2) continue;
      const groups = new Set(idx.map((i) => VILLAGE_SEATS[i]!.group));
      expect(groups.size, bench).toBe(1);
    }
  });
});

describe("the house pads' buttons (houseTargets.ts)", () => {
  it("the button is offered strictly inside what the server accepts (padUsableFrom), on every floor of every house", () => {
    const bad: string[] = [];
    for (const n of HOUSE_NUMBERS) {
      const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
      for (const [pad, label] of [[EXIT_PAD, "exit"], [plan.upPad, "up"], [plan.downPad, "down"]] as const) {
        for (let lx = pad.x - 3; lx <= pad.x + 3; lx += 0.05) {
          for (let lz = pad.z - 3; lz <= pad.z + 3; lz += 0.05) {
            if (padOfferedFrom(pad, lx, lz) && !padUsableFrom(pad, lx, lz)) bad.push(`${n} ${label} (${lx.toFixed(2)}, ${lz.toFixed(2)})`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    // and the margin is real: a point 1.78 m in front is usable (radius 0.5 + 1.3 = 1.8) but not offered; 1.6 m is both
    const up = STAIR_PLANS.A.upPad;
    const at = (d: number) => ({ x: up.x - Math.sin(up.facing) * d, z: up.z - Math.cos(up.facing) * d });
    expect(padUsableFrom(up, at(1.78).x, at(1.78).z)).toBe(true);
    expect(padOfferedFrom(up, at(1.78).x, at(1.78).z)).toBe(false);
    expect(padOfferedFrom(up, at(1.6).x, at(1.6).z)).toBe(true);
    expect(HOUSE_PAD_REACH).toBe(1.3);
    expect(HOUSE_PAD_HALF_WIDTH).toBe(0.8);
  });

  it("floor 1 offers the way out at the exit pad and the stair at the foot pad; floor 2 offers the way down at the landing; nothing else anywhere", () => {
    for (const n of HOUSE_NUMBERS) {
      const p = HOUSE_PLACES[n];
      expect(houseOffers(houseArea(`house_${n}`, 1), p.exitPad.x, p.exitPad.z).map((o) => o.id)).toEqual([HOUSE_EXIT_TARGET_ID]);
      expect(houseOffers(houseArea(`house_${n}`, 1), p.upPad.x, p.upPad.z).map((o) => o.id)).toEqual([HOUSE_STAIR_UP_TARGET_ID]);
      expect(houseOffers(houseArea(`house_${n}`, 2), p.downPad.x, p.downPad.z).map((o) => o.id)).toEqual([HOUSE_STAIR_DOWN_TARGET_ID]);
      // the arrival spots offer their stair straight back (they are 0.35 m from the pad), the way in (spawn__in) offers nothing
      expect(houseOffers(houseArea(`house_${n}`, 2), p.spawnUp.x, p.spawnUp.z).map((o) => o.id)).toEqual([HOUSE_STAIR_DOWN_TARGET_ID]);
      expect(houseOffers(houseArea(`house_${n}`, 1), p.spawnDown.x, p.spawnDown.z).map((o) => o.id)).toEqual([HOUSE_STAIR_UP_TARGET_ID]);
      expect(houseOffers(houseArea(`house_${n}`, 1), p.spawnIn.x, p.spawnIn.z)).toEqual([]);
      const c = localToWorld(n, 1, 5.3, 3.9); // the room's centre
      expect(houseOffers(houseArea(`house_${n}`, 1), c.x, c.z)).toEqual([]);
      expect(houseOffers("village", p.exitPad.x, p.exitPad.z)).toEqual([]);
      expect(worldToLocal(n, 1, p.exitPad.x, p.exitPad.z)).toMatchObject({ x: 5.3, z: 0.9 });
    }
  });
});
