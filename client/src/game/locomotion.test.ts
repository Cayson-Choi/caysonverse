import { describe, it, expect } from "vitest";
import { nextWalking } from "./locomotion";
import { WALK_OFF_SPEED, WALK_ON_SPEED } from "./constants";

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
