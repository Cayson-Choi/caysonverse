import { describe, expect, it } from "vitest";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { crosswalkHintAt } from "./crosswalkHint";

describe("crosswalk hint", () => {
  it("shows nothing away from the crossings", () => {
    expect(crosswalkHintAt(0, 0, 0)).toBeNull();
    expect(crosswalkHintAt(-40, 20, 5_000)).toBeNull();
  });

  it("says wait while the figure is red (with the cars passing during their green), go while walking, hurry while flashing", () => {
    const atBus = [33.9, 1] as const;
    expect(crosswalkHintAt(...atBus, 1_000)).toMatchObject({ tone: "wait", seconds: 23 });
    expect(crosswalkHintAt(...atBus, 1_000)!.text).toContain("차가 지나가요");
    expect(crosswalkHintAt(...atBus, TRANSIT.pedestrianStartMs - 500)!.text).not.toContain("차가 지나가요"); // cars are red already
    const walk = crosswalkHintAt(...atBus, TRANSIT.pedestrianStartMs + 100)!;
    expect(walk.tone).toBe("go");
    expect(walk.seconds).toBe(14);
    const flash = crosswalkHintAt(...atBus, TRANSIT.pedestrianStartMs + TRANSIT.pedestrianWalkMs + 100)!;
    expect(flash.tone).toBe("hurry");
    expect(flash.seconds).toBe(4);
  });

  it("also shows at the north crossing", () => {
    expect(crosswalkHintAt(0, -33, 0)).not.toBeNull();
    expect(crosswalkHintAt(0, -43.5, 0)).toBeNull();
  });
});
