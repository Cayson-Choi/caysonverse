import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { HOUSE_HEARTHS, hearthFlames, houseEmberY, houseHearthMax, houseHearthMin, setHouseHearth } from "./houseFire";
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
  it("roots each three-dimensional fire on the grate inside its fireplace", () => {
    for (const n of [1, 2, 7, 10]) {
      const fire = hearthFlames(n)!;
      setHouseHearth(n);
      const bounds = new Box3().setFromObject(fire);
      const size = bounds.getSize(new Vector3());
      expect(bounds.min.y).toBeCloseTo(houseEmberY.value);
      expect(new Box3(houseHearthMin.value, houseHearthMax.value).containsBox(bounds)).toBe(true);
      expect(Math.min(size.x, size.z)).toBeGreaterThan(0.08);
      fire.geometry.dispose();
      fire.material.dispose();
    }
    expect(hearthFlames(3)).toBeNull();
  });
});
