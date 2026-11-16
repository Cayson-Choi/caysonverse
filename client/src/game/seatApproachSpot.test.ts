import { describe, expect, it } from "vitest";
import { approachesSeat, nearestFreeSeat, seatDistance, SEAT_REACH } from "@caysonverse/shared/worldMap";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { GENERATED_HOUSE_NUMBERS } from "@caysonverse/shared/village/generated/houses";
import { houseFloorArea, houseFloorBounds } from "@caysonverse/shared/village/houseAreas";
import { villageActiveMap } from "./activeMap";
import { furnitureClick, seatApproachSpot } from "./furnitureClick";

/**
 * 집 실내 G round 2: a tap on a house chair walks to a spot the chair is offered from — its own stand spot when that offers it (furnitureClick's
 * `offered`), else an approach spot (a chair whose sitter steps back, exitTurn π).
 */
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
          const standOffers =
            approachesSeat(s, s.standX, s.standZ) && seatDistance(s, s.standX, s.standZ) <= SEAT_REACH && nearestFreeSeat(s.standX, s.standZ, () => false, SEAT_REACH, VILLAGE_SEATS) === i;
          if (standOffers) return;
          const spot = seatApproachSpot(VILLAGE_SEATS, i, from, map.geometry.obstacles, bounds);
          if (!spot) return void bad.push(`${s.id}: no spot`);
          if (!approachesSeat(s, spot.x, spot.z) || nearestFreeSeat(spot.x, spot.z, () => false, SEAT_REACH, VILLAGE_SEATS) !== i) bad.push(`${s.id}: spot does not offer it`);
        });
        expect(bad).toEqual([]);
      });
    }
  }

  it("a click on a dining chair plans a spot that offers it (its approach spot when its stand spot is no approach)", () => {
    const i = VILLAGE_SEATS.findIndex((s) => s.id === "h1_1_4");
    const s = VILLAGE_SEATS[i]!;
    const standIsApproach = approachesSeat(s, s.standX, s.standZ);
    const map = villageActiveMap(s.area as ReturnType<typeof houseFloorArea>);
    const bounds = houseFloorBounds(1, 1);
    // straight down onto its cushion: the seat point is under the table (the hips reach forward), the cushion 0.5 m back from it
    const ray = { o: { x: s.x - Math.sin(s.yaw) * 0.5, y: 2.2, z: s.z - Math.cos(s.yaw) * 0.5 }, d: { x: 0, y: -1, z: 0 } };
    const len = Math.hypot(ray.d.x, ray.d.y, ray.d.z);
    const dir = { x: ray.d.x / len, y: ray.d.y / len, z: ray.d.z / len };
    const t = ((s.seatY ?? 0.45) - ray.o.y) / dir.y;
    const pick = { x: ray.o.x + dir.x * t, y: s.seatY ?? 0.45, z: ray.o.z + dir.z * t, distance: t };
    const withWorld = furnitureClick(pick, { o: ray.o, d: dir }, VILLAGE_SEATS, s.area, () => false, { x: 365.3, z: -4.9 }, 0, true, { obstacles: map.geometry.obstacles, bounds });
    expect(withWorld?.seatIndex).toBe(i);
    expect(approachesSeat(s, withWorld!.surface.x, withWorld!.surface.z)).toBe(true);
    const without = furnitureClick(pick, { o: ray.o, d: dir }, VILLAGE_SEATS, s.area, () => false, { x: 365.3, z: -4.9 }, 0, true);
    // without the world a chair is a candidate only when its own stand spot offers it
    if (standIsApproach) expect(without?.seatIndex).toBe(i);
    else expect(without?.seatIndex ?? null).not.toBe(i);
  });
});
