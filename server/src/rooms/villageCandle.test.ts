import { describe, expect, it } from "vitest";
import { CANDLE_REACH_M } from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import { SAMPLE_FILLED_IDS } from "@caysonverse/shared/village/sampleFill";
import { candleCubby } from "./villageCandle";

const anchors = cubbyAnchors(VILLAGE_LAYOUT);
// Exactly one cubby of the 368 is filled (the 견본): bank A, row 3, column 11.
const n = anchors.find((a) => SAMPLE_FILLED_IDS.has(a.id))!;
// An empty cubby in the same column (the rows of a column share their spot on the floor) and one on the east bank.
const empty = anchors.find((a) => a.bank === n.bank && a.col === n.col && !SAMPLE_FILLED_IDS.has(a.id))!;
const e = anchors.find((a) => a.bank === "E" && a.row === 3 && a.col === 5)!;

describe("candleCubby — who may light a candle in the memorial hall (Task 9, one example cubby since 2026-11-13)", () => {
  it("there is exactly one filled cubby", () => {
    expect(SAMPLE_FILLED_IDS.size).toBe(1);
    expect(n.id).toBe("M1-A-r3-c11");
  });

  it("in the hall, in front of the filled cubby: its anchor", () => {
    expect(candleCubby("hall", n.x, n.z + 0.6, n.id)).toEqual(n);
  });

  it("an empty cubby (no memorial) takes no candle, even right in front of it (final fix)", () => {
    expect(candleCubby("hall", empty.x, empty.z + 0.6, empty.id)).toBeNull();
    expect(candleCubby("hall", e.x - 1, e.z, e.id)).toBeNull(); // the east bank holds none either
    expect(candleCubby("hall", n.x, n.z + 0.6, n.id)).not.toBeNull(); // the same spot, the filled row of the column
  });

  it("the reach covers the whole hall (the close-up opens on any cubby from anywhere in it)", () => {
    expect(candleCubby("hall", n.x, n.z + CANDLE_REACH_M - 0.001, n.id)).not.toBeNull();
    expect(candleCubby("hall", n.x, n.z + CANDLE_REACH_M + 0.001, n.id)).toBeNull();
  });

  it("in the village, an unknown cubby, a non-string or a broken position: refused", () => {
    expect(candleCubby("hall", 300, 3.6, n.id)).not.toBeNull(); // the spawn, 9 m away: still in the hall
    expect(candleCubby("village", n.x, n.z + 0.5, n.id)).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, "n_9_10")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, "M1-A-r9-c99")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, "")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, 42)).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, { id: n.id })).toBeNull();
    expect(candleCubby("hall", Number.NaN, n.z + 0.5, n.id)).toBeNull();
    expect(candleCubby("hall", n.x, Number.POSITIVE_INFINITY, n.id)).toBeNull();
  });
});
