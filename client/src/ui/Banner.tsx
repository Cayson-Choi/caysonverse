import { useEffect } from "react";
import { getRoom } from "../net/connection";
import { startAnnounceSync } from "../net/announceSync";
import { useAnnounceStore } from "../stores/announceStore";
import "./banner.css";

/**
 * Top-center announcement banner. Wires the room's announcement SCHEMA STATE
 * into the announce store for this component's lifetime (mirrors Chat.tsx's
 * startChatSync), then renders whenever the text is non-empty. The banner is
 * state-driven — late joiners see the current announcement automatically — and
 * has no local dismiss (only the admin clears it). 📢 prefix + entrance slide.
 */
export function Banner() {
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return startAnnounceSync(room);
  }, []);

  const text = useAnnounceStore((s) => s.text);
  if (!text) return null;

  return (
    // `key` restarts the entrance animation whenever the text changes.
    <div className="cv-banner" role="status" aria-live="polite" key={text}>
      <span className="cv-banner-icon" aria-hidden="true">
        📢
      </span>
      <span className="cv-banner-text">{text}</span>
    </div>
  );
}
