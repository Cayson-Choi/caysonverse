/**
 * The AI 조교 1:1 side-chat panel (design 31): a right-side drawer above the
 * canvas, visible only to this player. Message list + input; Esc or ✕ closes
 * (walking away also closes it — NpcPrompt). While the input is focused the
 * shared uiCapture flag freezes movement keys, exactly like the world chat.
 */

import { useEffect, useRef, useState } from "react";
import { NPC_LABEL } from "../game/npc";
import { setUiCaptured, captureReleaseEffect } from "../game/uiCapture";
import { NPC_INPUT_MAX, useNpcStore } from "../stores/npcStore";
import "./npc.css";

const EMPTY: never[] = [];

export function NpcChatPanel() {
  const activeNpc = useNpcStore((s) => s.activeNpc);
  const open = activeNpc !== null;
  const sending = useNpcStore((s) => s.sending);
  const messages = useNpcStore((s) => (s.activeNpc ? (s.histories[s.activeNpc] ?? EMPTY) : EMPTY));
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  // Esc closes while open. If the input had focus, its unmount would swallow
  // the blur — captureReleaseEffect below guarantees the flag is released.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Escape") useNpcStore.getState().closePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Unmount safety: a panel removed while its input is focused fires no blur.
  useEffect(() => (open ? captureReleaseEffect() : undefined), [open]);

  if (!open) return null;

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void useNpcStore.getState().send(text);
  };

  return (
    <div className="cv-npc-panel" role="dialog" aria-label={`${NPC_LABEL} 대화`}>
      <div className="cv-npc-head">
        <span className="cv-npc-title">🤖 {NPC_LABEL}</span>
        <button
          type="button"
          className="cv-npc-close"
          onClick={() => useNpcStore.getState().closePanel()}
          aria-label="닫기"
        >
          ✕
        </button>
      </div>
      <div className="cv-npc-list" ref={listRef}>
        {messages.map((m, i) => (
          <div key={i} className={`cv-npc-msg ${m.role === "user" ? "is-user" : "is-npc"}`}>
            {m.text}
          </div>
        ))}
        {sending && <div className="cv-npc-msg is-npc is-pending">답변을 생각하는 중…</div>}
      </div>
      <form
        className="cv-npc-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="cv-npc-field"
          value={draft}
          maxLength={NPC_INPUT_MAX}
          placeholder="조교에게 물어보세요"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setUiCaptured(true)}
          onBlur={() => setUiCaptured(false)}
        />
        <button type="submit" className="cv-npc-send" disabled={sending || !draft.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
