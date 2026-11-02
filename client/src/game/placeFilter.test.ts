import { describe, expect, it } from "vitest";
import { PLACE_ESCAPE, PLACE_HUB } from "@caysonverse/shared/escape/constants";
import { placeTransition, showsInHub } from "./placeFilter";

describe("placeFilter (Task 15 — who the hall shows)", () => {
  it("showsInHub", () => {
    expect(showsInHub(PLACE_HUB)).toBe(true);
    expect(showsInHub(PLACE_ESCAPE)).toBe(false);
  });

  it("placeTransition: hidden → hub adds, shown → classroom removes, no change otherwise", () => {
    expect(placeTransition(false, PLACE_HUB)).toBe("add"); // back from a classroom
    expect(placeTransition(true, PLACE_ESCAPE)).toBe("remove"); // went into a classroom
    expect(placeTransition(true, PLACE_HUB)).toBeNull(); // still in the hall (the immediate listen)
    expect(placeTransition(false, PLACE_ESCAPE)).toBeNull(); // still inside
  });
});
