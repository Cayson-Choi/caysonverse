import { useEffect } from "react";
import { useEscapeStore } from "../../stores/escapeStore";
import "../escape.css";

/** How long a classroom toast stays up. */
export const ESCAPE_TOAST_MS = 4500;

/**
 * The classroom's toast (AI 학교 탈출, Task 18): the server's personal notices (`EscapeMsg.Notice`) and the
 * team's bag news ("○○님이 자외선 손전등을 만들었어요", BagPanel) land in `escapeStore.toast`. It clears itself
 * after ESCAPE_TOAST_MS — only the toast it was started for, so a newer one is never cut short. It takes no
 * taps (pointer-events none): over a close-up it would otherwise sit on that card's buttons. Above the story
 * box and the overlays, so a teammate's news is seen over a close-up.
 */
export function EscapeToast() {
  const toast = useEscapeStore((s) => s.toast);
  const id = toast?.id;

  useEffect(() => {
    if (id === undefined) return;
    const timer = window.setTimeout(() => useEscapeStore.getState().clearToast(id), ESCAPE_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  if (!toast) return null;
  return (
    <div className="cv-escui cv-esc-toast" role="status" aria-live="polite" key={toast.id}>
      <span className="cv-esc-toast-icon" aria-hidden="true">
        💬
      </span>
      <span>{toast.text}</span>
    </div>
  );
}
