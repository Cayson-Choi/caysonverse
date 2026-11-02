import "../escape.css";

/** The line that stays above the chat bar in a classroom (words fixed by the brief). */
export const TEAM_CHAT_NOTICE = "팀 채팅 · 선생님이 볼 수 있어요";

/**
 * Always on, above the chat input: in a classroom the chat is the team's, and the teacher can read it
 * (the server mirrors every line to the teacher, Task 11). The bar itself is the world's chat bar,
 * bound to the classroom by the scene (Chat reads the active room).
 */
export function TeamChatNotice() {
  return (
    <div className="cv-escui cv-esc-chatnote" role="note">
      <span aria-hidden="true">👀</span>
      <span>{TEAM_CHAT_NOTICE}</span>
    </div>
  );
}
