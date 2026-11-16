import { describe, expect, it } from "vitest";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { BLINK_MS, lampKey, lampsAt } from "./signalLamps";

describe("crosswalk signal lamps", () => {
  it("shows green cars and a red figure with the red count-down to the walk at the start of a cycle", () => {
    const s = lampsAt(0);
    expect(s.vehicle).toBe("green");
    expect(s.ped).toBe("stop");
    expect(s.stopLit).toBe(true);
    expect(s.walkLit).toBe(false);
    expect(s.countdown).toEqual({ seconds: TRANSIT.pedestrianStartMs / 1000, color: "red" });
  });

  it("lights the walking figure steadily while cars are red, then blinks it, never with a green or amber car", () => {
    const walk = lampsAt(TRANSIT.pedestrianStartMs + 1);
    expect(walk.vehicle).toBe("red");
    expect(walk.ped).toBe("walk");
    expect(walk.walkLit && !walk.stopLit).toBe(true);
    expect(walk.countdown.color).toBe("green");
    expect(walk.countdown.seconds).toBe(14); // 10 s of walking + 4 s of flashing
    const t0 = TRANSIT.pedestrianStartMs + TRANSIT.pedestrianWalkMs;
    const a = lampsAt(t0 + 1);
    const b = lampsAt(t0 + 1 + BLINK_MS);
    expect(a.ped).toBe("flashing");
    expect(a.walkLit).not.toBe(b.walkLit);
    expect(a.countdown.seconds).toBe(4);
    for (let t = 0; t < TRANSIT.signalCycleMs; t += 250) {
      const s = lampsAt(t);
      if (s.walkLit) expect(s.vehicle).toBe("red");
    }
  });

  it("an override forces the lamps (dev screenshots)", () => {
    const s = lampsAt(0, { vehicle: "red", ped: "walk" });
    expect(s.vehicle).toBe("red");
    expect(s.walkLit).toBe(true);
  });

  it("the redraw key changes when a whole second passes", () => {
    expect(lampKey(lampsAt(1_000))).not.toBe(lampKey(lampsAt(2_100)));
    expect(lampKey(lampsAt(1_100))).toBe(lampKey(lampsAt(1_400)));
  });
});
