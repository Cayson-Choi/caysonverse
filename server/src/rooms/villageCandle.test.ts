import { describe, expect, it } from "vitest";
import { CANDLE_REACH_M } from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import { SAMPLE_FILLED_IDS } from "@caysonverse/shared/village/sampleFill";
import { candleCubby } from "./villageCandle";

const anchors = cubbyAnchors(VILLAGE_LAYOUT);
// A north-wall column with a filled cubby and an empty one (the rows of a column share their spot on the floor).
const col = anchors.filter((a) => a.id.startsWith("n_")).map((a) => a.id.split("_")[2]!).find((c) => {
  const rows = anchors.filter((a) => a.id.startsWith("n_") && a.id.endsWith(`_${c}`));
  return rows.filter((a) => SAMPLE_FILLED_IDS.has(a.id)).length >= 2 && rows.some((a) => !SAMPLE_FILLED_IDS.has(a.id));
})!;
const colRows = anchors.filter((a) => a.id.startsWith("n_") && a.id.endsWith(`_${col}`));
const [n, n2] = colRows.filter((a) => SAMPLE_FILLED_IDS.has(a.id)) as [typeof anchors[number], typeof anchors[number]];
const empty = colRows.find((a) => !SAMPLE_FILLED_IDS.has(a.id))!;
const e = anchors.find((a) => a.id.startsWith("e_") && SAMPLE_FILLED_IDS.has(a.id))!;

describe("candleCubby — who may light a candle in the memorial hall (Task 9)", () => {
  it("in the hall, in front of the cubby: its anchor", () => {
    expect(candleCubby("hall", n.x, n.z + 0.6, n.id)).toEqual(n);
    expect(candleCubby("hall", e.x - 1, e.z, e.id)).toEqual(e);
  });

  it("an empty cubby (no sample memorial) takes no candle, even right in front of it (final fix)", () => {
    expect(candleCubby("hall", empty.x, empty.z + 0.6, empty.id)).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.6, n.id)).not.toBeNull(); // the same spot, a filled row of the column
  });

  it("the reach is 1.5 m on the ground plane (every row of a column shares it)", () => {
    expect(candleCubby("hall", n.x, n.z + CANDLE_REACH_M - 0.001, n2.id)).not.toBeNull();
    expect(candleCubby("hall", n.x, n.z + CANDLE_REACH_M + 0.001, n.id)).toBeNull();
  });

  it("far from the cubby, in the village, an unknown cubby, a non-string or a broken position: refused", () => {
    expect(candleCubby("hall", 300, 3.6, n.id)).toBeNull(); // the spawn, 9 m away
    expect(candleCubby("village", n.x, n.z + 0.5, n.id)).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, "n_9_10")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, "")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, 42)).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, { id: n.id })).toBeNull();
    expect(candleCubby("hall", Number.NaN, n.z, n.id)).toBeNull();
  });
});
