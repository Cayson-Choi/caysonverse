import { describe, it, expect } from "vitest";
import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import {
  decideLeave,
  isCapacityError,
  joinErrorNotice,
  CAPACITY_NOTICE,
  KICKED_NOTICE,
  DISCONNECT_NOTICE,
} from "./reconnectPolicy";

describe("decideLeave (leave-code → action table)", () => {
  it("maps the kick code (4001) to entry + kick notice + no reconnect", () => {
    expect(decideLeave(KICK_CLOSE_CODE, false)).toEqual({
      action: "entry",
      notice: KICKED_NOTICE,
      kick: true,
    });
  });

  it("honors a persisted kicked flag even on a non-kick code (no auto-rejoin)", () => {
    expect(decideLeave(1006, true)).toEqual({
      action: "entry",
      notice: KICKED_NOTICE,
      kick: true,
    });
  });

  it("maps a consented (4000) or normal (1000) close to entry, not reconnect", () => {
    for (const code of [4000, 1000]) {
      // No `kick` key on a plain disconnect → not a kicked session.
      expect(decideLeave(code, false)).toEqual({ action: "entry", notice: DISCONNECT_NOTICE });
    }
  });

  it("maps every abnormal/drop/error code to the reconnect flow", () => {
    for (const code of [1001, 1005, 1006, 4002, 4003, 4010]) {
      expect(decideLeave(code, false)).toEqual({ action: "reconnect" });
    }
  });

  it("only the exact kick code (4001) — not its neighbours — blocks reconnection", () => {
    expect(decideLeave(KICK_CLOSE_CODE, false).action).toBe("entry");
    expect(decideLeave(KICK_CLOSE_CODE + 1, false).action).toBe("reconnect");
    expect(decideLeave(KICK_CLOSE_CODE - 1, false).action).toBe("entry"); // 4000 = consented
  });
});

describe("capacity + join-error mapping", () => {
  it("detects a locked/full-room matchmake error", () => {
    expect(isCapacityError({ code: 522, message: 'room "abc" is locked' })).toBe(true);
    expect(isCapacityError(new Error("something else"))).toBe(false);
    expect(isCapacityError(null)).toBe(false);
  });

  it("maps a capacity error to the exact Korean capacity notice", () => {
    expect(joinErrorNotice({ code: 522, message: 'room "abc" is locked' })).toBe(CAPACITY_NOTICE);
    expect(CAPACITY_NOTICE).toContain("정원이 가득"); // 정원이 가득
    expect(CAPACITY_NOTICE).toContain("110");
  });

  it("passes a Korean server rejection through verbatim", () => {
    const msg = "닉네임은 2~12자여야 합니다"; // 닉네임은 2~12자여야 합니다
    expect(joinErrorNotice(new Error(msg))).toBe(msg);
  });

  it("falls back to a generic Korean connection message for a network error", () => {
    const notice = joinErrorNotice(new TypeError("fetch failed"));
    expect(notice).toContain("연결"); // 연결
  });
});
