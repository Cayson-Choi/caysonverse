import { useAppStore } from "../stores/appStore";
import "./reconnecting.css";

/**
 * Full-screen dim overlay shown while the resilience driver recovers a dropped
 * connection. The world stays mounted and frozen behind it (input is suspended
 * in the frame loop), so a transient reconnect resumes in place. Rendered at the
 * App level so it survives the WorldScene remount that a reconnect triggers.
 */
export function ReconnectingOverlay() {
  const reconnecting = useAppStore((s) => s.reconnecting);
  if (!reconnecting) return null;

  return (
    <div className="cv-reconnecting" role="status" aria-live="assertive">
      <div className="cv-reconnecting-card">
        <div className="cv-reconnecting-spinner" aria-hidden="true" />
        <span className="cv-reconnecting-text">재연결 중...</span>
      </div>
    </div>
  );
}
