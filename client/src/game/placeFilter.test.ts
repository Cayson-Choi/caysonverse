import { describe, expect, it } from "vitest";
import { visibilityChange } from "./placeFilter";

describe("placeFilter — who the village shows", () => {
  it("visibilityChange: a hidden one that should show adds, a shown one that should not removes, no change otherwise", () => {
    expect(visibilityChange(false, true)).toBe("add");
    expect(visibilityChange(true, false)).toBe("remove");
    expect(visibilityChange(true, true)).toBeNull(); // still shown (the immediate listen)
    expect(visibilityChange(false, false)).toBeNull(); // still hidden
  });
});
