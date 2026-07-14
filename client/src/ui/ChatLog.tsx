import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { isTouchDevice } from "../device";

/** Auto-scroll only when the user is already within this many px of the bottom. */
const STICK_THRESHOLD = 24;

/**
 * Right-side collapsible chat log. Rows are `[닉네임] 메시지`, newest at the
 * bottom; system notices (e.g. rate-limit rejections) render dimmed and appear
 * only for the local user. Auto-scrolls to the newest row unless the user has
 * scrolled up to read history.
 */
export function ChatLog() {
  const log = useChatStore((s) => s.log);
  // Touch: start collapsed and open as a bottom sheet on demand (screen space is
  // scarce and the joystick/input own the lower edge). Desktop: expanded as before.
  const [collapsed, setCollapsed] = useState(isTouchDevice);
  const rowsRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  function onScroll() {
    const el = rowsRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  }

  // After new rows render (or on expand), stick to the bottom if we were there.
  useLayoutEffect(() => {
    if (collapsed) return;
    const el = rowsRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [log, collapsed]);

  // Re-anchor to the bottom when the panel is expanded.
  useEffect(() => {
    if (!collapsed) stickToBottom.current = true;
  }, [collapsed]);

  return (
    <div
      className={
        "cv-chat-log" + (collapsed ? " is-collapsed" : "") + (isTouchDevice ? " is-touch" : "")
      }
    >
      <button
        className="cv-chat-toggle"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        채팅 <span aria-hidden="true">{collapsed ? "▲" : "▼"}</span>
      </button>
      {!collapsed && (
        <div className="cv-chat-rows" ref={rowsRef} onScroll={onScroll}>
          {log.map((entry) =>
            entry.kind === "system" ? (
              <div key={entry.id} className="cv-chat-row is-system">
                {entry.text}
              </div>
            ) : (
              <div key={entry.id} className="cv-chat-row">
                <span className="cv-chat-name">[{entry.name}]</span> {entry.text}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
