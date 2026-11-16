import { describe, expect, it } from "vitest";
import { SHOP_WAVE_COOLDOWN_MS, emptyShopCue, stepShopCue } from "./shopkeeperCue";

describe("lake shopkeeper's wave cue", () => {
  it("does not wave at the anglers already there when first seen", () => {
    const st = emptyShopCue();
    expect(stepShopCue(st, new Set(["a", "b"]), false, 0)).toBe(false);
  });

  it("waves when someone rents or returns a rod, with a cooldown", () => {
    const st = emptyShopCue();
    stepShopCue(st, new Set(), false, 0);
    expect(stepShopCue(st, new Set(["a"]), false, 100)).toBe(true); // rented
    expect(stepShopCue(st, new Set(["a", "b"]), false, 200)).toBe(false); // too soon
    expect(stepShopCue(st, new Set(["b"]), false, 200 + SHOP_WAVE_COOLDOWN_MS)).toBe(true); // a returned
    expect(stepShopCue(st, new Set(["b"]), false, 300 + 2 * SHOP_WAVE_COOLDOWN_MS)).toBe(false); // nothing changed
  });

  it("waves when I step onto the rental pad", () => {
    const st = emptyShopCue();
    stepShopCue(st, new Set(), false, 0);
    expect(stepShopCue(st, new Set(), true, 10)).toBe(true);
    expect(stepShopCue(st, new Set(), true, 10 + SHOP_WAVE_COOLDOWN_MS)).toBe(false); // still on it
  });
});
