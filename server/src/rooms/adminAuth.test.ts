import { describe, it, expect } from "vitest";
import {
  compareAdminCode,
  AdminAttemptLimiter,
  ADMIN_ATTEMPT_LIMIT,
  ADMIN_ATTEMPT_WINDOW_MS,
} from "./adminAuth";

describe("compareAdminCode", () => {
  it("returns true only when the provided code equals the expected code", () => {
    expect(compareAdminCode("s3cret-코드", "s3cret-코드")).toBe(true);
  });

  it("returns false when the codes differ", () => {
    expect(compareAdminCode("wrong", "s3cret")).toBe(false);
    expect(compareAdminCode("s3cret", "s3cretX")).toBe(false); // prefix, differing length
    expect(compareAdminCode("s3cretX", "s3cret")).toBe(false); // longer than expected
  });

  it("returns false when the expected code is unset or empty (admin impossible)", () => {
    expect(compareAdminCode("anything", undefined)).toBe(false);
    expect(compareAdminCode("anything", null)).toBe(false);
    expect(compareAdminCode("anything", "")).toBe(false);
  });

  it("returns false when the provided code is empty", () => {
    expect(compareAdminCode("", "s3cret")).toBe(false);
  });

  it("distinguishes codes that share a prefix but differ in length", () => {
    // A padded compare must still reject a short prefix of the real code.
    expect(compareAdminCode("abc", "abcdef")).toBe(false);
    expect(compareAdminCode("abcdef", "abcdef")).toBe(true);
  });
});

describe("AdminAttemptLimiter (injected clock)", () => {
  it("does not block below the failure limit within the window", () => {
    const limiter = new AdminAttemptLimiter(ADMIN_ATTEMPT_LIMIT, ADMIN_ATTEMPT_WINDOW_MS);
    for (let i = 0; i < ADMIN_ATTEMPT_LIMIT; i++) {
      expect(limiter.isBlocked("1.2.3.4", i)).toBe(false);
      limiter.recordFailure("1.2.3.4", i);
    }
    // The Nth failure has now been recorded → the (N+1)th check is blocked.
    expect(limiter.isBlocked("1.2.3.4", ADMIN_ATTEMPT_LIMIT)).toBe(true);
  });

  it("keys the counter per IP: one IP being blocked never blocks another", () => {
    const limiter = new AdminAttemptLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) limiter.recordFailure("10.0.0.1", i);
    expect(limiter.isBlocked("10.0.0.1", 10)).toBe(true);
    expect(limiter.isBlocked("10.0.0.2", 10)).toBe(false); // independent key
  });

  it("slides: failures older than the window stop counting", () => {
    const limiter = new AdminAttemptLimiter(2, 1000);
    limiter.recordFailure("ip", 0);
    limiter.recordFailure("ip", 500);
    expect(limiter.isBlocked("ip", 900)).toBe(true); // both inside [0,1000]
    // At t=1600 the two hits (0, 500) are >1000ms old → window is empty again.
    expect(limiter.isBlocked("ip", 1600)).toBe(false);
  });

  it("supports a shared global key for the IP-unavailable fallback", () => {
    const limiter = new AdminAttemptLimiter(2, 60_000);
    limiter.recordFailure("__global__", 0);
    limiter.recordFailure("__global__", 1);
    expect(limiter.isBlocked("__global__", 2)).toBe(true);
  });

  it("exposes the design limit as 5 per minute", () => {
    expect(ADMIN_ATTEMPT_LIMIT).toBe(5);
    expect(ADMIN_ATTEMPT_WINDOW_MS).toBe(60_000);
  });
});
