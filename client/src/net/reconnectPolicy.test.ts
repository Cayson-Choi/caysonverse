import { describe, it, expect } from "vitest";
import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import { CLASS_CLOSED_CODE } from "@caysonverse/shared/escape/constants";
import {
  decideLeave,
  decideEscapeLeave,
  isCapacityError,
  isDeterministicRejection,
  shouldRetryFreshJoin,
  shouldRetryClassRejoin,
  joinErrorNotice,
  classJoinErrorNotice,
  classRejoinNotice,
  classRejoinPlan,
  serverNoticeOr,
  CAPACITY_NOTICE,
  CLASS_ENDED_NOTICE,
  CLASS_NOT_FOUND_NOTICE,
  FAILED_NOTICE,
  KICKED_NOTICE,
  DISCONNECT_NOTICE,
} from "./reconnectPolicy";

describe("decideLeave (leave-code → action table)", () => {
  it("maps the kick code (4101) to entry + kick notice + no reconnect", () => {
    expect(KICK_CLOSE_CODE).toBe(4101);
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

  it("only the exact kick code (4101) — not its neighbours — is a kick", () => {
    expect(decideLeave(KICK_CLOSE_CODE, false)).toMatchObject({ action: "entry", kick: true });
    expect(decideLeave(KICK_CLOSE_CODE - 1, false).action).toBe("reconnect");
    // 4102 next door is CLASS_CLOSED_CODE (the class ended): the entry screen, but never a kick.
    expect(KICK_CLOSE_CODE + 1).toBe(CLASS_CLOSED_CODE);
    expect(decideLeave(KICK_CLOSE_CODE + 1, false)).not.toHaveProperty("kick");
    expect(decideLeave(KICK_CLOSE_CODE + 2, false).action).toBe("reconnect");
  });

  it("a server shutdown (Colyseus SERVER_SHUTDOWN 4001) reconnects; only 4101 is a kick (ruling E3)", () => {
    // A production restart/deploy closes every client with 4001. That must look like
    // a dropped connection (reconnect → same code back in), never like a kick.
    expect(decideLeave(4001, false)).toEqual({ action: "reconnect" });
    expect(decideLeave(4101, false)).toEqual({
      action: "entry",
      notice: KICKED_NOTICE,
      kick: true,
    });
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
    // The kicked-user-in-lost-kick-close-race path: show the denySet reason immediately.
    expect(joinErrorNotice(KICK_DENY)).toBe("입장이 제한되었습니다"); // 입장이 제한되었습니다
    expect(joinErrorNotice(NICK_RULE)).toBe("닉네임은 2~12자여야 합니다"); // verbatim
  });
});

describe("class (반) leave and join policy (Task 13)", () => {
  it("decideLeave maps CLASS_CLOSED_CODE to the entry screen with CLASS_ENDED_NOTICE (no reconnect)", () => {
    expect(CLASS_CLOSED_CODE).toBe(4102);
    expect(decideLeave(CLASS_CLOSED_CODE, false)).toEqual({ action: "entry", notice: CLASS_ENDED_NOTICE });
    expect(CLASS_ENDED_NOTICE).toBe("수업이 끝났어요. 함께해 줘서 고마워요!");
    // Neighbours stay ordinary drops (reconnect); a kicked session still sees the kick notice.
    expect(decideLeave(CLASS_CLOSED_CODE + 1, false)).toEqual({ action: "reconnect" });
    expect(decideLeave(CLASS_CLOSED_CODE, true)).toEqual({ action: "entry", notice: KICKED_NOTICE, kick: true });
  });

  it("classJoinErrorNotice maps 521 to CLASS_NOT_FOUND_NOTICE and passes server Korean through", () => {
    expect(CLASS_NOT_FOUND_NOTICE).toBe("반 코드를 확인해 주세요. 수업이 끝났거나 반이 가득 찼을 수도 있어요.");
    // No class with that code (or it ended and locked, or it is full): the matchmaker's 521.
    expect(classJoinErrorNotice({ code: 521, message: "no rooms found with provided criteria" })).toBe(
      CLASS_NOT_FOUND_NOTICE,
    );
    expect(classJoinErrorNotice({ code: 522, message: 'room "abc" is locked' })).toBe(CLASS_NOT_FOUND_NOTICE);
    // The room's own Korean refusal (nickname taken, kicked, expired teacher pass) is shown as is.
    const taken = "이 반에 같은 닉네임이 있어요. 다른 닉네임을 써 주세요.";
    expect(classJoinErrorNotice(new Error(taken))).toBe(taken);
    expect(classJoinErrorNotice({ code: 4002, message: "입장이 제한되었습니다" })).toBe("입장이 제한되었습니다");
    // A network failure gets the generic Korean line — never the world's capacity notice.
    const net = classJoinErrorNotice(new TypeError("fetch failed"));
    expect(net).toContain("연결");
    expect(net).not.toBe(CAPACITY_NOTICE);
  });

  it("classRejoinPlan: teacher re-opens with the same code; student rejoins by code; nothing without a code (Review Focus 5)", () => {
    const teacher = { key: "TKEY", classCode: "AB2CDE", textLevel: "hard" as const };
    expect(classRejoinPlan({ classCode: "AB2CDE" }, teacher)).toEqual({
      kind: "teacher",
      key: "TKEY",
      classCode: "AB2CDE",
      textLevel: "hard",
    });
    // The teacher's class wins even when the cache was overwritten by another tab.
    expect(classRejoinPlan({ classCode: "ZZZZZZ" }, teacher)).toMatchObject({ kind: "teacher", classCode: "AB2CDE" });
    expect(classRejoinPlan({}, teacher)).toMatchObject({ kind: "teacher", classCode: "AB2CDE" });
    // A student: the same code, normalised (the server filter is exact).
    expect(classRejoinPlan({ classCode: " ab2cde " }, null)).toEqual({ kind: "student", classCode: "AB2CDE" });
    // No usable code → nothing to rejoin.
    expect(classRejoinPlan({ classCode: "" }, null)).toBeNull();
    expect(classRejoinPlan({}, null)).toBeNull();
    expect(classRejoinPlan({ classCode: "0OIL11" }, null)).toBeNull();
    expect(classRejoinPlan({}, { key: "TKEY", classCode: "", textLevel: "easy" })).toBeNull();
    // A teacher session without a key cannot re-open: it rejoins like a student would.
    expect(classRejoinPlan({ classCode: "AB2CDE" }, { key: "", classCode: "AB2CDE", textLevel: "easy" })).toEqual({
      kind: "student",
      classCode: "AB2CDE",
    });
  });

  it("class rejoin retries a missing class (521) and network/server trouble, never a Korean refusal", () => {
    // Student waiting for the teacher to re-open the class after a restart.
    expect(shouldRetryClassRejoin({ code: 521, message: "no rooms found" })).toBe(true);
    expect(shouldRetryClassRejoin(new TypeError("fetch failed"))).toBe(true);
    expect(shouldRetryClassRejoin(new Error("이 반에 같은 닉네임이 있어요."))).toBe(false);
    // Teacher HTTP failures are classified by status (kept off `code`): 5xx / no answer retry …
    expect(shouldRetryClassRejoin({ status: 503, message: "지금은 반을 더 열 수 없어요." })).toBe(true);
    expect(shouldRetryClassRejoin({ status: 0, message: FAILED_NOTICE })).toBe(true);
    // … a wrong key, another teacher's code, a malformed request or the failure limit do not.
    for (const status of [400, 401, 409, 429]) {
      expect(shouldRetryClassRejoin({ status, message: "선생님 키가 올바르지 않아요" }), String(status)).toBe(false);
    }
  });

  it("classRejoinNotice: a teacher HTTP failure keeps its text; joins map like classJoinErrorNotice", () => {
    expect(classRejoinNotice({ status: 401, message: "선생님 키가 올바르지 않아요" })).toBe("선생님 키가 올바르지 않아요");
    expect(classRejoinNotice({ code: 521, message: "no rooms found" })).toBe(CLASS_NOT_FOUND_NOTICE);
    expect(classRejoinNotice(new Error("입장이 제한되었습니다"))).toBe("입장이 제한되었습니다");
    expect(classRejoinNotice(new TypeError("fetch failed"))).toBe(FAILED_NOTICE);
  });

  it("serverNoticeOr keeps a Korean server message and falls back otherwise", () => {
    expect(serverNoticeOr("반을 열지 못했어요", FAILED_NOTICE)).toBe("반을 열지 못했어요");
    expect(serverNoticeOr("Internal Server Error", FAILED_NOTICE)).toBe(FAILED_NOTICE);
    expect(serverNoticeOr(undefined, FAILED_NOTICE)).toBe(FAILED_NOTICE);
    expect(serverNoticeOr(42, FAILED_NOTICE)).toBe(FAILED_NOTICE);
  });
});

describe("decideEscapeLeave (team classroom connection)", () => {
  it("a kick is a kick, the class end returns to the hall, a server-side clean close returns too", () => {
    expect(decideEscapeLeave(4101, false)).toBe("kicked");
    expect(decideEscapeLeave(1006, true)).toBe("kicked");
    expect(decideEscapeLeave(CLASS_CLOSED_CODE, false)).toBe("ended");
    expect(decideEscapeLeave(4000, false)).toBe("closed");
    expect(decideEscapeLeave(1000, false)).toBe("closed");
  });

  it("every drop, error and server restart (4001) is recovered", () => {
    for (const code of [1001, 1005, 1006, 4001, 4002, 4003, 4010]) {
      expect(decideEscapeLeave(code, false), String(code)).toBe("recover");
    }
  });
});
