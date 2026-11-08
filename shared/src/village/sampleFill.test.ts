import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, cubbyAnchors } from "./villageLayout";
import { SAMPLE_FILL, SAMPLE_FILLED_IDS, hashId, sampleFilledIds } from "./sampleFill";

describe("sampleFill — which cubbies hold a sample (shared by the client and the server's candle rule)", () => {
  const anchors = cubbyAnchors(VILLAGE_LAYOUT);
  it("60 % of the hall's cubbies, every id a real cubby, seed-stable", () => {
    expect(SAMPLE_FILLED_IDS.size).toBe(Math.round(anchors.length * SAMPLE_FILL));
    const ids = new Set(anchors.map((a) => a.id));
    for (const id of SAMPLE_FILLED_IDS) expect(ids.has(id)).toBe(true);
    expect([...sampleFilledIds([...anchors].reverse())].sort()).toEqual([...SAMPLE_FILLED_IDS].sort());
  });
  it("hashId is FNV-1a (32-bit)", () => {
    expect(hashId("")).toBe(0x811c9dc5);
    expect(hashId("a")).toBe(0xe40c292c);
  });
});
