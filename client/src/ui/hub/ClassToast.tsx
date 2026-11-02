import { useEffect } from "react";
import { useClassStore } from "../../stores/classStore";
import "./hub.css";

/** How long a notice stays up. */
export const TOAST_MS = 5000;

/**
 * The class's personal notice (AI 학교 탈출, Task 16): why a team move or an entry was refused
 * (`ClassMsg.Notice`), a classroom that could not be joined, "교실 연결이 끊겨 복도로 돌아왔어요".
 * They arrive in `classStore.toast` (classSync.ts). It clears itself after TOAST_MS — only the
 * toast it was started for (`clearToast(id)`), so a newer notice is never cut short — and a tap
 * clears it at once.
 */
export function ClassToast() {
  const toast = useClassStore((s) => s.toast);
  const id = toast?.id;

  useEffect(() => {
    if (id === undefined) return;
    const timer = window.setTimeout(() => useClassStore.getState().clearToast(id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  if (!toast) return null;
  return (
    <div
      className="cv-hub-toast"
      role="status"
      aria-live="polite"
      key={toast.id}
      onClick={() => useClassStore.getState().clearToast(toast.id)}
    >
      <span className="cv-hub-toast-icon" aria-hidden="true">
        💬
      </span>
      <span>{toast.text}</span>
    </div>
  );
}
