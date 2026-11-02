import { describe, expect, it } from "vitest";
import { JUMP_DURATION_MS, JUMP_RATE, KICK_CLOSE_CODE } from "./constants";

describe("jump timing (controls-ux Task 11)", () => {
  it("one hop lasts 0.8 s and the server lets exactly one through per hop", () => {
    expect(JUMP_RATE).toEqual({ count: 1, windowMs: 800 });
    expect(JUMP_DURATION_MS).toBe(800);
  });

  it("the animation length equals the rate window, so accepted jumps never overlap", () => {
    expect(JUMP_DURATION_MS).toBe(JUMP_RATE.windowMs);
  });
});

describe("KICK_CLOSE_CODE (ruling E3)", () => {
  // Colyseus' own close codes (@colyseus/shared-types CloseCode): CONSENTED 4000,
  // SERVER_SHUTDOWN 4001, WITH_ERROR 4002, FAILED_TO_RECONNECT 4003, MAY_TRY_RECONNECT 4010.
  // A server restart closes everyone with 4001, so a kick must never share that value.
  it("is an application code outside every Colyseus close code", () => {
    for (const code of [4000, 4001, 4002, 4003, 4010]) expect(KICK_CLOSE_CODE).not.toBe(code);
    expect(KICK_CLOSE_CODE).toBeGreaterThanOrEqual(4000);
    expect(KICK_CLOSE_CODE).toBeLessThanOrEqual(4999);
    expect(KICK_CLOSE_CODE).toBe(4101);
  });
});
