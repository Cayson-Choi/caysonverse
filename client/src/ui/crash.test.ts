import { describe, expect, it, vi } from "vitest";
import { CRASH_COPY, leaveAfterCrash } from "./crash";

describe("CRASH_COPY", () => {
  it("tells the user to refresh, with a 새로고침 button", () => {
    expect(CRASH_COPY.message).toBe("문제가 생겼어요. 새로고침(F5)하면 다시 들어갈 수 있어요");
    expect(CRASH_COPY.reload).toBe("새로고침");
  });
});

describe("leaveAfterCrash", () => {
  it("leaves an open room with a consented leave (the server removes the avatar at once)", () => {
    const leave = vi.fn(() => Promise.resolve(1000));
    expect(leaveAfterCrash({ leave })).toBe(true);
    expect(leave).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("does nothing without a room (crash on the entry screen)", () => {
    expect(leaveAfterCrash(null)).toBe(false);
  });

  it("in a class it does NOT leave: a consented leave would lose the team; the reconnection window keeps it (final review I3)", () => {
    const leave = vi.fn(() => Promise.resolve(1000));
    expect(leaveAfterCrash({ leave }, true)).toBe(false);
    expect(leave).not.toHaveBeenCalled();
    // The world is unchanged: still a consented leave.
    expect(leaveAfterCrash({ leave }, false)).toBe(true);
    expect(leave).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("never throws, even when leaving fails or rejects (the crash screen must still render)", async () => {
    expect(
      leaveAfterCrash({
        leave: () => {
          throw new Error("socket already closed");
        },
      }),
    ).toBe(true);
    const rejected = Promise.reject(new Error("closed"));
    expect(leaveAfterCrash({ leave: () => rejected })).toBe(true);
    // The rejection is handled (no unhandled-rejection noise).
    await new Promise((r) => setTimeout(r, 0));
  });
});
