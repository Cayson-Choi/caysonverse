import { describe, it, expect } from "vitest";
import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import {
  decideLeave,
  isCapacityError,
  isDeterministicRejection,
  shouldRetryFreshJoin,
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
  it("detects the production client.join full-room error (521 no-rooms-found)", () => {
    // client.join to the full singleton world → matchmaking finds no available
    // (unlocked) room → MATCHMAKE_INVALID_CRITERIA (521). This is the production
    // path (connection.ts / resilience.ts both call client.join).
    expect(
      isCapacityError({ code: 521, message: "no rooms found with provided criteria" }),
    ).toBe(true);
  });

  it("still detects a legacy join-by-id locked/full-room matchmake error (522 locked)", () => {
    expect(isCapacityError({ code: 522, message: 'room "abc" is locked' })).toBe(true);
    expect(isCapacityError(new Error("something else"))).toBe(false);
    expect(isCapacityError({ code: 521 })).toBe(true); // bare code — message not required
    expect(isCapacityError(null)).toBe(false);
  });

  it("maps a capacity error to the exact Korean capacity notice", () => {
    expect(
      joinErrorNotice({ code: 521, message: "no rooms found with provided criteria" }),
    ).toBe(CAPACITY_NOTICE);
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

describe("fresh-join retry policy (D2 — don't hammer deterministic rejections)", () => {
  // A server-authored (Hangul) rejection can NEVER succeed on retry: a denySet
  // kick, a nickname-rule violation, an out-of-range cached identity.
  const KICK_DENY = new Error("입장이 제한되었습니다"); // 입장이 제한되었습니다
  const NICK_RULE = { code: 4002, message: "닉네임은 2~12자여야 합니다" }; // server object shape

  it("flags a server-authored Hangul rejection as deterministic (not retryable)", () => {
    expect(isDeterministicRejection(KICK_DENY)).toBe(true);
    expect(isDeterministicRejection(NICK_RULE)).toBe(true);
    expect(shouldRetryFreshJoin(KICK_DENY)).toBe(false);
    expect(shouldRetryFreshJoin(NICK_RULE)).toBe(false);
  });

  it("keeps capacity/boot-window (521) RETRYABLE — it may clear after the boot window", () => {
    const err521 = { code: 521, message: "no rooms found with provided criteria" };
    expect(isDeterministicRejection(err521)).toBe(false);
    expect(shouldRetryFreshJoin(err521)).toBe(true);
  });

  it("keeps transient network / abnormal-close errors RETRYABLE (no Hangul reason)", () => {
    expect(shouldRetryFreshJoin(new TypeError("fetch failed"))).toBe(true);
    expect(shouldRetryFreshJoin({ code: 1006, message: "abnormal close" })).toBe(true);
    expect(shouldRetryFreshJoin(new Error("cv:closed-during-recovery"))).toBe(true);
    expect(shouldRetryFreshJoin(null)).toBe(true);
  });

  it("surfaces the real Korean reason for a terminal deterministic rejection", () => {
    // The kicked-user-in-lost-4001-race path: show the denySet reason immediately.
    expect(joinErrorNotice(KICK_DENY)).toBe("입장이 제한되었습니다"); // 입장이 제한되었습니다
    expect(joinErrorNotice(NICK_RULE)).toBe("닉네임은 2~12자여야 합니다"); // verbatim
  });
});
