import { describe, expect, it } from "vitest";
import { MAP_CHIP_Z, MAP_PICKED_Z, mapPlaceZRange } from "./mapPlaceStack";

describe("the map's place chips: the picked card is above every other chip (QA 2026-11-20)", () => {
  it("the lowest z-index the picked place can get is above the highest of any other chip", () => {
    expect(Math.min(...MAP_PICKED_Z)).toBeGreaterThan(Math.max(...MAP_CHIP_Z));
  });
  it("and it stays below the HUD (z-index 20 and up: the buttons, the chat, the emoji row)", () => {
    expect(Math.max(...MAP_PICKED_Z)).toBeLessThan(20);
  });
  it("mapPlaceZRange picks the ranges", () => {
    expect(mapPlaceZRange(true)).toEqual([19, 14]);
    expect(mapPlaceZRange(false)).toEqual([13, 0]);
  });
});

describe("the picked place's label is remounted when it is picked (drei writes z-index only when the label moves)", () => {
  it("the key differs between picked and idle, so the z range is recomputed on a still map", async () => {
    const { mapPlaceKey } = await import("./mapPlaceStack");
    expect(mapPlaceKey(true)).not.toBe(mapPlaceKey(false));
  });
});
