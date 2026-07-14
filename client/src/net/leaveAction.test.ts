import { describe, it, expect } from "vitest";
import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import { leaveAction } from "./leaveAction";

describe("leaveAction", () => {
  it("maps the kick close code to the kicked UX with a no-reconnect flag", () => {
    const action = leaveAction(KICK_CLOSE_CODE);
    expect(action.blockReconnect).toBe(true);
    expect(action.notice).toBe("관리자에 의해 퇴장되었습니다");
  });

  it("maps a normal/abnormal close to a generic disconnect notice, reconnect allowed", () => {
    for (const code of [1000, 1001, 1006, 4000, 4002]) {
      const action = leaveAction(code);
      expect(action.blockReconnect).toBe(false);
      expect(action.notice).toContain("연결이 끊어졌습니다");
    }
  });

  it("only the exact kick code (4001) blocks reconnection", () => {
    expect(leaveAction(KICK_CLOSE_CODE).blockReconnect).toBe(true);
    expect(leaveAction(KICK_CLOSE_CODE + 1).blockReconnect).toBe(false);
    expect(leaveAction(KICK_CLOSE_CODE - 1).blockReconnect).toBe(false);
  });
});
