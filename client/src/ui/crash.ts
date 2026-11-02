// 앱 전체 오류 화면(AppErrorBoundary)의 문구와 방 나가기. React·DOM 없이 테스트할 수 있게 따로 둔다.

/** 오류 화면 문구. */
export const CRASH_COPY = {
  message: "문제가 생겼어요. 새로고침(F5)하면 다시 들어갈 수 있어요",
  reload: "새로고침",
} as const;

/** leave만 쓰는 방(@colyseus/sdk Room). */
export interface LeavableRoom {
  leave(consented?: boolean): unknown;
}

/**
 * 화면이 무너졌을 때 열린 방이 있으면 나간다: 그대로 두면 다른 사람에게 이 사람의 아바타가 멈춘 채 남는다.
 * 동의한 나가기(consented)라 서버가 재접속 창 없이 바로 지운다. 어떤 경우에도 던지지 않는다(오류 화면은 꼭 떠야 한다).
 * 방이 있었으면 true.
 *
 * 반(AI 학교 탈출, `classMode`)에서는 나가지 않는다: 동의한 나가기는 그 자리에서 팀을 잃게 한다. 새로고침이 연결을
 * 끊으면 서버가 유령으로 두고(재접속 창, 반은 180초), 같은 닉네임으로 다시 들어오면 그 유령을 이어받아 팀과 교실이
 * 그대로다 — 새로고침·탭 닫기 때와 같은 규칙(connection.ts handlePageHide). 이때는 false.
 */
export function leaveAfterCrash(room: LeavableRoom | null, classMode = false): boolean {
  if (!room || classMode) return false;
  try {
    const left = room.leave(true);
    if (left && typeof (left as Promise<unknown>).catch === "function") (left as Promise<unknown>).catch(() => undefined);
  } catch {
    /* 이미 닫힌 연결 등: 서버가 끊김으로 처리한다 */
  }
  return true;
}
