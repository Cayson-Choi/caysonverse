import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, cubbyAnchors } from "./villageLayout";
import { SAMPLE_CUBBY_IDS, SAMPLE_FILLED_IDS, hashId, sampleFilledIds } from "./sampleFill";

describe("sampleFill — which cubbies hold the sample (shared by the client and the server's candle rule)", () => {
  const anchors = cubbyAnchors(VILLAGE_LAYOUT);
  it("exactly ONE of the 416 cubbies holds the example, a real cubby at eye height in bank A", () => {
    expect(anchors).toHaveLength(416);
    expect(SAMPLE_FILLED_IDS.size).toBe(1);
    const ids = new Set(anchors.map((a) => a.id));
    for (const id of SAMPLE_FILLED_IDS) expect(ids.has(id)).toBe(true);
    const a = anchors.find((x) => x.id === SAMPLE_CUBBY_IDS[0])!;
    expect(a).toMatchObject({ bank: "A", row: 3, col: 11 });
    expect(a.y).toBeGreaterThan(1.4);
    expect(a.y).toBeLessThan(1.8);
  });
  it("is stable whatever order the anchors come in, and an id that is not a cubby fills nothing", () => {
    expect([...sampleFilledIds([...anchors].reverse())]).toEqual([...SAMPLE_FILLED_IDS]);
    expect(sampleFilledIds(anchors, ["M1-Z-r0-c00"]).size).toBe(0);
  });
  it("hashId is FNV-1a (32-bit)", () => {
    expect(hashId("")).toBe(0x811c9dc5);
    expect(hashId("a")).toBe(0xe40c292c);
  });
});
