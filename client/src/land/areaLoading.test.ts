import { describe, expect, it } from "vitest";
import { areaLoadingState, beginAreaLoading, endAreaLoading, loadView, type LoadInputs } from "./areaLoading";

const base: LoadInputs = { target: "park", area: "village", parkReady: false, parkStage: 0, downloaded: 0, villageFrames: 0, vegDressed: false };

describe("areaLoading store", () => {
  it("begins and ends", () => {
    endAreaLoading();
    beginAreaLoading("park");
    expect(areaLoadingState().target).toBe("park");
    endAreaLoading();
    expect(areaLoadingState().target).toBeNull();
  });
});

describe("loadView: park", () => {
  it("climbs the stages and is done only once drawn", () => {
    const door = loadView(base);
    const files = loadView({ ...base, area: "park", downloaded: 0.5 });
    const build = loadView({ ...base, area: "park", parkStage: 1 });
    const almost = loadView({ ...base, area: "park", parkStage: 2 });
    const done = loadView({ ...base, area: "park", parkStage: 2, parkReady: true });
    expect([door, files, build, almost].map((v) => v.done)).toEqual([false, false, false, false]);
    expect(door.progress).toBeLessThan(files.progress);
    expect(files.progress).toBeLessThan(build.progress);
    expect(build.progress).toBeLessThan(almost.progress);
    expect(files.subtitle).toBe("놀이기구를 준비하고 있어요");
    expect(almost.subtitle).toBe("거의 다 됐어요");
    expect(done.done).toBe(true);
    expect(done.progress).toBe(1);
  });
  it("a stale ready flag in the village is not done", () => {
    expect(loadView({ ...base, parkReady: true }).done).toBe(false);
  });
  it("garbage download share is clamped", () => {
    expect(loadView({ ...base, area: "park", downloaded: NaN }).progress).toBeCloseTo(0.1);
    expect(loadView({ ...base, area: "park", downloaded: 9 }).progress).toBeLessThan(0.75);
  });
});

describe("loadView: village", () => {
  it("is done once dressed and drawn", () => {
    const t = { ...base, target: "village" as const };
    expect(loadView({ ...t, area: "park" }).done).toBe(false);
    expect(loadView({ ...t, area: "village", vegDressed: true, villageFrames: 2 }).done).toBe(false);
    expect(loadView({ ...t, area: "village", vegDressed: true, villageFrames: 6 }).done).toBe(true);
    expect(loadView({ ...t, area: "village", vegDressed: false, villageFrames: 60 }).done).toBe(false);
  });
});
