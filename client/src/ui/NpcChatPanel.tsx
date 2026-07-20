/**
 * The AI 조교 1:1 dialogue panel (design 31). Desktop: a right-side drawer.
 * Mobile (design 34 후속 — 발주자: NPC가 보이도록): a bottom SHEET filling the
 * lower ~44vh, so the 3D NPC stays visible in the top half; while it is open a
 * `cv-npc-open` root class hides the world chat bar, emoji palette, movement
 * zone and toggles (npc.css) so only the NPC and the sheet remain. Visible only
 * to this player. Esc or ✕ closes (walking away also closes it — NpcPrompt).
 * While the input is focused the shared uiCapture flag freezes movement keys.
 */

import { useEffect, useRef, useState } from "react";
import { NPC_LABEL } from "../game/npc";
import { sendPortalReturn } from "../net/connection";
import { setUiCaptured, captureReleaseEffect } from "../game/uiCapture";
import { isTouchDevice } from "../device";
import { trackKbdInset } from "./kbdInset";
import { NPC_INPUT_MAX, useNpcStore } from "../stores/npcStore";
import "./npc.css";

const EMPTY: never[] = [];
/** <html> class while an NPC dialogue is open — mobile hides other overlays. */
const NPC_OPEN_CLASS = "cv-npc-open";

export function NpcChatPanel() {
  const activeNpc = useNpcStore((s) => s.activeNpc);
  const open = activeNpc !== null;
  const sending = useNpcStore((s) => s.sending);
  const messages = useNpcStore((s) => (s.activeNpc ? (s.histories[s.activeNpc] ?? EMPTY) : EMPTY));
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Flag the root while open so the mobile sheet can hide the other overlays.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add(NPC_OPEN_CLASS);
    return () => root.classList.remove(NPC_OPEN_CLASS);
  }, [open]);

  // Lift the bottom sheet above the soft keyboard while the field is focused
  // (touch) — same --cv-kbd-inset the world chat bar uses.
  useEffect(() => {
    if (!typing || !isTouchDevice) return;
    return trackKbdInset();
  }, [typing]);

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
      {/* 미로 골 챔버 전용 (design 34 후속): 밟기 자동 포탈은 제거됨 — 큐리와
          대화한 뒤 이 버튼으로만 귀환(서버가 챔버 안 여부를 검증·텔레포트). */}
      {activeNpc === "maze" && (
        <button
          type="button"
          className="cv-npc-portal"
          onClick={() => {
            sendPortalReturn();
            useNpcStore.getState().closePanel();
          }}
        >
          🌀 로비로 돌아가기
        </button>
      )}
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
          onFocus={() => {
            setUiCaptured(true);
            setTyping(true);
          }}
          onBlur={() => {
            setUiCaptured(false);
            setTyping(false);
          }}
        />
        <button type="submit" className="cv-npc-send" disabled={sending || !draft.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
