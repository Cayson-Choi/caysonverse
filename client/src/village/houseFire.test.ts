import { describe, expect, it } from "vitest";
import { HOUSE_HEARTHS, houseHearthMax, houseHearthMin, setHouseHearth } from "./houseFire";
import { HOUSE_1_COLLIDERS } from "@caysonverse/shared/village/generated/houses/house_1_colliders";
import { HOUSE_7_COLLIDERS } from "@caysonverse/shared/village/generated/houses/house_7_colliders";

describe("house fireplaces", () => {
  it("covers exactly the houses whose model has a fireplace (1, 2, 7, 10)", () => {
    expect(Object.keys(HOUSE_HEARTHS).map(Number)).toEqual([1, 2, 7, 10]);
  });
  it("each hearth box holds its fireplace collider's footprint", () => {
    const f1 = HOUSE_1_COLLIDERS.find((b) => b.minX === 361.52)!;
    expect(HOUSE_HEARTHS[1]!.min[0]).toBeLessThanOrEqual(f1.minX);
    expect(HOUSE_HEARTHS[1]!.max[0]).toBeGreaterThanOrEqual(f1.maxX);
    const f7 = HOUSE_7_COLLIDERS.find((b) => b.minX === 504.04)!;
    expect(HOUSE_HEARTHS[7]!.min[2]).toBeLessThanOrEqual(f7.minZ);
    expect(HOUSE_HEARTHS[7]!.max[2]).toBeGreaterThanOrEqual(f7.maxZ);
  });
  it("sets the shared box for a house with a fireplace and empties it for one without", () => {
    setHouseHearth(7);
    expect(houseHearthMin.value.x).toBe(504.04);
    setHouseHearth(3);
    expect(houseHearthMin.value.x).toBeGreaterThan(houseHearthMax.value.x);
  });
});
