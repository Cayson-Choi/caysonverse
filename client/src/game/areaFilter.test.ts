import { describe, expect, it } from "vitest";
import { normalizeArea, showsInArea } from "./areaFilter";
import { visibilityChange } from "./placeFilter";

describe("areaFilter (케이슨 마을 — who the village shows)", () => {
  it("normalizeArea: hall is the hall, anything else is the village", () => {
    expect(normalizeArea("hall")).toBe("hall");
    expect(normalizeArea("village")).toBe("village");
    expect(normalizeArea("")).toBe("village");
    expect(normalizeArea(undefined)).toBe("village");
    expect(normalizeArea(3)).toBe("village");
  });

  it("showsInArea: a player is shown only to a viewer in the same area", () => {
    expect(showsInArea("village", "village")).toBe(true);
    expect(showsInArea("hall", "hall")).toBe(true);
    expect(showsInArea("hall", "village")).toBe(false);
    expect(showsInArea("village", "hall")).toBe(false);
  });

  it("visibilityChange: add a hidden one that should show, remove a shown one that should not, else nothing", () => {
    expect(visibilityChange(false, true)).toBe("add");
    expect(visibilityChange(true, false)).toBe("remove");
    expect(visibilityChange(true, true)).toBeNull();
    expect(visibilityChange(false, false)).toBeNull();
  });
});
