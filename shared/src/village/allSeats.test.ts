import { describe, it, expect } from "vitest";
import { VILLAGE_SEATS } from "./benchSeats";
import { LAKE_FISHING_SPOTS, lakeSeats } from "./lakeLayout";
import { LAKE_SEAT_BASE, VILLAGE_AND_LAKE_SEATS } from "./allSeats";

describe("the village room's seat list with the fishing lake after it", () => {
  it("keeps every village seat at its index and appends the lake's 56", () => {
    expect(VILLAGE_AND_LAKE_SEATS.length).toBe(VILLAGE_SEATS.length + 56);
    VILLAGE_SEATS.forEach((s, i) => expect(VILLAGE_AND_LAKE_SEATS[i]).toEqual(s));
    expect(LAKE_SEAT_BASE).toBe(VILLAGE_SEATS.length);
  });
  it("the first 30 lake seats are the fishing chairs in spot order (the spot index is the chair's offset)", () => {
    for (let i = 0; i < 30; i++) {
      const s = VILLAGE_AND_LAKE_SEATS[LAKE_SEAT_BASE + i] as unknown as { kind: string; spot: string; area: string };
      expect(s.kind).toBe("fishing_chair");
      expect(s.spot).toBe(LAKE_FISHING_SPOTS[i]!.id);
      expect(s.area).toBe("village");
    }
  });
  it("is frozen like the village's own list and does not alter lakeSeats()", () => {
    expect(Object.isFrozen(VILLAGE_AND_LAKE_SEATS)).toBe(true);
    expect(lakeSeats().length).toBe(56);
  });
});
