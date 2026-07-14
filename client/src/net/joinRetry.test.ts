import { describe, it, expect } from "vitest";
import { retryWhile } from "./joinRetry";
import { isCapacityError, joinErrorNotice, CAPACITY_NOTICE } from "./reconnectPolicy";

// A 521 "no rooms found" — the wire shape of both a genuinely full world AND a
// world that has not been (re)created yet (server boot window). Capacity-shaped.
const ERR_521 = { code: 521, message: "no rooms found with provided criteria" };

/** Fake clock: records requested delays and resolves immediately (no real timer). */
function fakeSleep() {
  const slept: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    slept.push(ms);
  };
  return { slept, sleep };
}

describe("retryWhile (initial-join / fresh-join retry semantics)", () => {
  it("returns the first success without sleeping", async () => {
    const { slept, sleep } = fakeSleep();
    let attempts = 0;
    const room = await retryWhile({
      attempt: async () => {
        attempts++;
        return "ROOM";
      },
      shouldRetry: () => true,
      delaysMs: [1000, 2000],
      sleep,
    });
    expect(room).toBe("ROOM");
    expect(attempts).toBe(1);
    expect(slept).toEqual([]);
  });

  it("retries a 521 N times through the schedule, then surfaces the capacity notice", async () => {
    const { slept, sleep } = fakeSleep();
    let attempts = 0;
    let caught: unknown;
    const delaysMs = [700, 700];
    try {
      await retryWhile({
        attempt: async () => {
          attempts++;
          throw ERR_521;
        },
        shouldRetry: isCapacityError,
        delaysMs,
        sleep,
      });
    } catch (err) {
      caught = err;
    }
    // First attempt + one retry per delay = delaysMs.length + 1.
    expect(attempts).toBe(delaysMs.length + 1);
    expect(slept).toEqual([700, 700]); // slept between each retry, in order
    expect(caught).toBe(ERR_521);
    // The exhausted 521 is capacity-shaped → the entry screen shows the capacity notice.
    expect(joinErrorNotice(caught)).toBe(CAPACITY_NOTICE);
  });

  it("surfaces a non-capacity error immediately — no retry, no sleep", async () => {
    const { slept, sleep } = fakeSleep();
    const rejection = new Error("nickname rejected"); // stands in for a server rule rejection
    let attempts = 0;
    let caught: unknown;
    try {
      await retryWhile({
        attempt: async () => {
          attempts++;
          throw rejection;
        },
        shouldRetry: isCapacityError, // a rule rejection is NOT capacity → not retried
        delaysMs: [700, 700],
        sleep,
      });
    } catch (err) {
      caught = err;
    }
    expect(attempts).toBe(1);
    expect(slept).toEqual([]);
    expect(caught).toBe(rejection);
  });

  it("recovers when a retry succeeds mid-schedule (boot window closes)", async () => {
    const { slept, sleep } = fakeSleep();
    let attempts = 0;
    const room = await retryWhile({
      attempt: async () => {
        attempts++;
        if (attempts === 1) throw ERR_521; // first join lands in the boot window
        return "ROOM"; // the retry finds the freshly (re)created room
      },
      shouldRetry: isCapacityError,
      delaysMs: [700, 700],
      sleep,
    });
    expect(room).toBe("ROOM");
    expect(attempts).toBe(2);
    expect(slept).toEqual([700]); // exactly one delay before the successful retry
  });
});

describe("Phase-2 fresh-join semantics (retry EVERY failure; the last error picks the notice)", () => {
  it("retries even a non-capacity failure and, once the budget is spent, ends on the last error", async () => {
    const { slept, sleep } = fakeSleep();
    const generic = { code: 1006, message: "abnormal close" };
    let attempts = 0;
    let caught: unknown;
    try {
      await retryWhile({
        attempt: async () => {
          attempts++;
          throw generic;
        },
        shouldRetry: () => true, // Phase-2 predicate: retry EVERYTHING
        delaysMs: [1000, 2000],
        sleep,
      });
    } catch (err) {
      caught = err;
    }
    expect(attempts).toBe(3);
    expect(slept).toEqual([1000, 2000]);
    // A non-capacity final error → the generic failure notice branch (not capacity).
    expect(isCapacityError(caught)).toBe(false);
  });

  it("a persistent 521 under the retry-all predicate ends capacity-shaped (world really full)", async () => {
    const { sleep } = fakeSleep();
    let caught: unknown;
    try {
      await retryWhile({
        attempt: async () => {
          throw ERR_521;
        },
        shouldRetry: () => true,
        delaysMs: [1000],
        sleep,
      });
    } catch (err) {
      caught = err;
    }
    // The exhausted 521 → the capacity notice branch.
    expect(isCapacityError(caught)).toBe(true);
  });
});
