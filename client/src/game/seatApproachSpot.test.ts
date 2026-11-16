import { describe, expect, it } from "vitest";
import { approachesSeat, nearestFreeSeat, SEAT_REACH } from "@caysonverse/shared/worldMap";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { GENERATED_HOUSE_NUMBERS } from "@caysonverse/shared/village/generated/houses";
import { houseFloorArea, houseFloorBounds } from "@caysonverse/shared/village/houseAreas";
import { villageActiveMap } from "./activeMap";
import { furnitureClick, seatApproachSpot } from "./furnitureClick";

/** 집 실내 G round 2: a tap on a house chair walks to a spot the chair is offered from (its stand spot is behind it: exitTurn π). */
describe("seatApproachSpot", () => {
  for (const n of GENERATED_HOUSE_NUMBERS) {
    for (const floor of [1, 2] as const) {
      it(`house ${n} floor ${floor}: every seat has an approach spot that offers exactly it, in the open`, () => {
        const area = houseFloorArea(n, floor);
        const map = villageActiveMap(area);
        const bounds = houseFloorBounds(n, floor);
        const from = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
        const bad: string[] = [];
        VILLAGE_SEATS.forEach((s, i) => {
          if (s.area !== area) return;
          const spot = seatApproachSpot(VILLAGE_SEATS, i, from, map.geometry.obstacles, bounds);
          if (!spot) return void bad.push(`${s.id}: no spot`);
          if (!approachesSeat(s, spot.x, spot.z) || nearestFreeSeat(spot.x, spot.z, () => false, SEAT_REACH, VILLAGE_SEATS) !== i) bad.push(`${s.id}: spot does not offer it`);
        });
        expect(bad).toEqual([]);
      });
    }
  }

  it("a click on a dining chair (stand spot behind it) plans the approach spot; without the world it keeps the old goal", () => {
    const i = VILLAGE_SEATS.findIndex((s) => s.id === "h1_1_4");
    const s = VILLAGE_SEATS[i]!;
    expect(approachesSeat(s, s.standX, s.standZ)).toBe(false); // the premise: the stand spot is no approach
    const map = villageActiveMap(s.area as ReturnType<typeof houseFloorArea>);
    const bounds = houseFloorBounds(1, 1);
    const ray = { o: { x: s.x - 0.8, y: 1.6, z: s.z - 1.4 }, d: { x: 0.5, y: -0.8, z: 0.6 } };
    const len = Math.hypot(ray.d.x, ray.d.y, ray.d.z);
    const dir = { x: ray.d.x / len, y: ray.d.y / len, z: ray.d.z / len };
    const t = (0.5 - ray.o.y) / dir.y;
    const pick = { x: ray.o.x + dir.x * t, y: 0.5, z: ray.o.z + dir.z * t, distance: t };
    const withWorld = furnitureClick(pick, { o: ray.o, d: dir }, VILLAGE_SEATS, s.area, () => false, { x: 365.3, z: -4.9 }, 0, true, { obstacles: map.geometry.obstacles, bounds });
    if (withWorld && withWorld.seatIndex === i) {
      expect(approachesSeat(s, withWorld.surface.x, withWorld.surface.z)).toBe(true);
    }
    const without = furnitureClick(pick, { o: ray.o, d: dir }, VILLAGE_SEATS, s.area, () => false, { x: 365.3, z: -4.9 }, 0, true);
    expect(without?.seatIndex ?? null).not.toBe(i); // before: the chair was not even a candidate
  });
});
