import { describe, it, expect } from "vitest";
import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { CLIP } from "./constants";
import { gaitClip, gaitFor, moveSpeed, remoteGaitProbe } from "./gait";
import type { Gait } from "./gait";

describe("moveSpeed", () => {
  it("walks at MOVE_SPEED and runs at RUN_SPEED (MOVE_SPEED x 1.6)", () => {
    expect(moveSpeed(false)).toBe(MOVE_SPEED);
    expect(moveSpeed(true)).toBeCloseTo(RUN_SPEED, 9);
    expect(moveSpeed(true)).toBeCloseTo(MOVE_SPEED * 1.6, 9);
  });
});

describe("gaitFor", () => {
  it("is idle without movement, walk with movement, run with movement + run", () => {
    expect([gaitFor(false, true), gaitFor(true, false), gaitFor(true, true)]).toEqual([
      "idle",
      "walk",
      "run",
    ]);
  });

  it("holding run while standing still is idle, never a run cycle", () => {
    expect(gaitFor(false, true)).toBe("idle");
    expect(gaitFor(false, false)).toBe("idle");
  });
});

describe("gaitClip", () => {
  it("maps each gait to its KayKit clip", () => {
    expect(gaitClip("run")).toBe("Running_A");
    expect(gaitClip("run")).toBe(CLIP.run);
    expect(gaitClip("walk")).toBe(CLIP.walk);
    expect(gaitClip("idle")).toBe(CLIP.idle);
  });

  it("gives every gait a distinct clip so a crossfade always changes the pose", () => {
    const gaits: Gait[] = ["idle", "walk", "run"];
    expect(new Set(gaits.map(gaitClip)).size).toBe(gaits.length);
  });
});

describe("remoteGaitProbe (DEV-only E2E probe)", () => {
  it("is an empty Map until RemotePlayer records into it", () => {
    expect(remoteGaitProbe).toBeInstanceOf(Map);
    expect(remoteGaitProbe.size).toBe(0);
  });
});
