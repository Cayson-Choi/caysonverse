import { describe, it, expect } from "vitest";
import { nextGait, nextWalking } from "./locomotion";
import { RUN_OFF_SPEED, RUN_ON_SPEED, WALK_OFF_SPEED, WALK_ON_SPEED } from "./constants";
import type { Gait } from "./gait";

describe("nextWalking (hysteresis)", () => {
  it("starts walking only above the ON threshold", () => {
    expect(nextWalking(false, WALK_ON_SPEED + 0.05)).toBe(true);
    expect(nextWalking(false, WALK_ON_SPEED)).toBe(false); // strictly above required
    expect(nextWalking(false, 0)).toBe(false);
  });

  it("stops walking only below the OFF threshold", () => {
    expect(nextWalking(true, WALK_OFF_SPEED - 0.05)).toBe(false);
    expect(nextWalking(true, WALK_OFF_SPEED)).toBe(true); // strictly below required
    expect(nextWalking(true, 5)).toBe(true);
  });

  it("holds the current state inside the hysteresis band", () => {
    const mid = (WALK_ON_SPEED + WALK_OFF_SPEED) / 2;
    expect(nextWalking(true, mid)).toBe(true);
    expect(nextWalking(false, mid)).toBe(false);
  });

  it("does not flap when speed jitters around the threshold", () => {
    // Simulate snapshot-boundary jitter oscillating within the band.
    let walking = false;
    const jitter = [0.35, 0.2, 0.25, 0.18, 0.22, 0.16]; // crosses ON once, then wobbles
    const states = jitter.map((v) => (walking = nextWalking(walking, v)));
    // Turned on at 0.35, then STAYS on through the sub-0.3 wobble (never < 0.15).
    expect(states).toEqual([true, true, true, true, true, true]);
  });

  it("turns off once speed clearly drops below OFF", () => {
    let walking = true;
    walking = nextWalking(walking, 0.1);
    expect(walking).toBe(false);
    walking = nextWalking(walking, 0.2); // band -> stays off
    expect(walking).toBe(false);
  });
});

describe("nextGait (idle / walk / run hysteresis)", () => {
  it("nextGait: walk→run above RUN_ON_SPEED, back below RUN_OFF_SPEED, holds in the band", () => {
    expect(nextGait("walk", RUN_ON_SPEED + 0.01)).toBe("run");
    expect(nextGait("run", (RUN_ON_SPEED + RUN_OFF_SPEED) / 2)).toBe("run");
    expect(nextGait("run", RUN_OFF_SPEED - 0.01)).toBe("walk");
    expect(nextGait("run", 0.1)).toBe("idle");
  });

  it("needs a speed STRICTLY above RUN_ON_SPEED to start running, strictly below RUN_OFF_SPEED to stop", () => {
    expect(nextGait("walk", RUN_ON_SPEED)).toBe("walk");
    expect(nextGait("run", RUN_OFF_SPEED)).toBe("run");
  });

  it("holds walk inside the run band (between RUN_OFF and RUN_ON)", () => {
    expect(nextGait("walk", (RUN_ON_SPEED + RUN_OFF_SPEED) / 2)).toBe("walk");
  });

  it("keeps the walk/idle hysteresis exactly as nextWalking defines it", () => {
    const mid = (WALK_ON_SPEED + WALK_OFF_SPEED) / 2;
    expect(nextGait("idle", WALK_ON_SPEED + 0.05)).toBe("walk");
    expect(nextGait("idle", WALK_ON_SPEED)).toBe("idle");
    expect(nextGait("idle", mid)).toBe("idle");
    expect(nextGait("walk", mid)).toBe("walk");
    expect(nextGait("walk", WALK_OFF_SPEED - 0.05)).toBe("idle");
    expect(nextGait("walk", WALK_OFF_SPEED)).toBe("walk");
  });

  it("a runner that starts from standing still goes straight to run", () => {
    expect(nextGait("idle", RUN_ON_SPEED + 0.5)).toBe("run");
  });

  it("a stopping runner drops through walk to idle without ever skipping the walk band", () => {
    let g: Gait = "run";
    g = nextGait(g, 5.0); // still above RUN_OFF → run
    expect(g).toBe("run");
    g = nextGait(g, 4.0); // below RUN_OFF, above WALK_OFF → walk
    expect(g).toBe("walk");
    g = nextGait(g, 0.0); // stopped → idle
    expect(g).toBe("idle");
  });

  it("a remote walking at MOVE_SPEED with ±30% interpolation jitter never shows the run cycle", () => {
    let g: Gait = "walk";
    for (const s of [2.8, 5.2, 3.1, 5.0, 4.4]) {
      g = nextGait(g, s);
      expect(g).not.toBe("run");
    }
    expect(g).toBe("walk");
  });

  it("a remote running at RUN_SPEED (6.4 m/s) keeps the run cycle through jitter dips that stay above RUN_OFF_SPEED", () => {
    let g: Gait = "walk";
    for (const s of [6.4, 5.9, 6.9, 5.5, 6.2, 5.0]) {
      g = nextGait(g, s);
    }
    expect(g).toBe("run");
  });
});
