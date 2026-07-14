/**
 * Pure mapping from a room LEAVE close code to the client-side UX action. Kept
 * clock-free and side-effect-free so it is exhaustively unit-testable; the
 * connection layer performs the actual side effects (screen change, kick seam).
 *
 * Exactly KICK_CLOSE_CODE (4001) means "kicked by an admin": show the kick
 * notice AND block auto-reconnection. Every other code (normal close, server
 * down, abnormal 1006, …) is an ordinary disconnect that MAY reconnect.
 */

import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";

export interface LeaveAction {
  /** Korean notice to show on the entry screen after leaving. */
  notice: string;
  /**
   * When true the client must NOT auto-reconnect this session (it was kicked).
   * Task 11's reconnection logic reads the persisted seam flag to honor this.
   */
  blockReconnect: boolean;
}

const KICKED_NOTICE = "관리자에 의해 퇴장되었습니다";
const DISCONNECT_NOTICE = "서버와의 연결이 끊어졌습니다. 다시 입장해주세요.";

export function leaveAction(code: number): LeaveAction {
  if (code === KICK_CLOSE_CODE) {
    return { notice: KICKED_NOTICE, blockReconnect: true };
  }
  return { notice: DISCONNECT_NOTICE, blockReconnect: false };
}
