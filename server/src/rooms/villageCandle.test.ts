import { describe, expect, it } from "vitest";
import { CANDLE_REACH_M } from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import { candleCubby } from "./villageCandle";

const anchors = cubbyAnchors(VILLAGE_LAYOUT);
const n = anchors.find((a) => a.id === "n_3_10")!;
const e = anchors.find((a) => a.id === "e_0_5")!;

describe("candleCubby — who may light a candle in the memorial hall (Task 9)", () => {
  it("in the hall, in front of the cubby: its anchor", () => {
    expect(candleCubby("hall", n.x, n.z + 0.6, "n_3_10")).toEqual(n);
    expect(candleCubby("hall", e.x - 1, e.z, "e_0_5")).toEqual(e);
  });

  it("the reach is 1.5 m on the ground plane (every row of a column shares it)", () => {
    expect(candleCubby("hall", n.x, n.z + CANDLE_REACH_M - 0.001, "n_6_10")).not.toBeNull();
    expect(candleCubby("hall", n.x, n.z + CANDLE_REACH_M + 0.001, "n_3_10")).toBeNull();
  });

  it("far from the cubby, in the village, an unknown cubby, a non-string or a broken position: refused", () => {
    expect(candleCubby("hall", 300, 3.6, "n_3_10")).toBeNull(); // the spawn, 9 m away
    expect(candleCubby("village", n.x, n.z + 0.5, "n_3_10")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, "n_9_10")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, "")).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, 42)).toBeNull();
    expect(candleCubby("hall", n.x, n.z + 0.5, { id: "n_3_10" })).toBeNull();
    expect(candleCubby("hall", Number.NaN, n.z, "n_3_10")).toBeNull();
  });
});
