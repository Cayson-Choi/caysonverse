import { describe, expect, it } from "vitest";
import { JUMP_DURATION_MS, JUMP_RATE } from "./constants";

describe("jump timing (controls-ux Task 11)", () => {
  it("one hop lasts 0.8 s and the server lets exactly one through per hop", () => {
    expect(JUMP_RATE).toEqual({ count: 1, windowMs: 800 });
    expect(JUMP_DURATION_MS).toBe(800);
  });

  it("the animation length equals the rate window, so accepted jumps never overlap", () => {
    expect(JUMP_DURATION_MS).toBe(JUMP_RATE.windowMs);
  });
});
