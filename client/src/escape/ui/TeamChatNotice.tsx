import { useEffect } from "react";
import "../escape.css";

/** The line that stays above the chat bar in a classroom (words fixed by the brief). */
export const TEAM_CHAT_NOTICE = "팀 채팅 · 선생님이 볼 수 있어요";

/** chat.css: how far the chat bar's "too fast" note rises while this line sits right above the bar. */
export const NOTE_LIFT_VAR = "--cv-chat-note-lift";

/**
 * The line is 27.5 px tall (12.5 px × 1.4 + 2 × 4 px padding + 2 × 1 px border, escape.css) and sits 4 px (phone) to
 * 8 px (PC) above the bar, where the note starts (8 px): lifted by this much the note clears it with 6–10 px to spare.
 * Review round 4: without it the line, drawn after the note, covered most of it — a player whose 4th quick line stayed in
 * the field could not read why.
 */
export const NOTE_LIFT_PX = 34;

/**
 * Always on, above the chat input: in a classroom the chat is the team's, and the teacher can read it
 * (the server mirrors every line to the teacher, Task 11). The bar itself is the world's chat bar,
 * bound to the classroom by the scene (Chat reads the active room).
 */
export function TeamChatNotice() {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(NOTE_LIFT_VAR, `${NOTE_LIFT_PX}px`);
    return () => {
      root.style.removeProperty(NOTE_LIFT_VAR);
    };
  }, []);
  return (
    <div className="cv-escui cv-esc-chatnote" role="note">
      <span aria-hidden="true">👀</span>
      <span>{TEAM_CHAT_NOTICE}</span>
    </div>
  );
}
