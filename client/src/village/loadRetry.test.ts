import { describe, expect, it } from "vitest";
import { LOAD_RETRY_LIMIT, retryDelayMs } from "./loadRetry";

describe("loadRetry — a failed model download is tried again a few times (final review m2)", () => {
  it("waits 4, 8, 16 s and stops after LOAD_RETRY_LIMIT tries", () => {
    expect([0, 1, 2].map(retryDelayMs)).toEqual([4000, 8000, 16000]);
    expect(LOAD_RETRY_LIMIT).toBe(3);
    expect(retryDelayMs(-1)).toBe(4000);
  });
});
