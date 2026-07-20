/**
 * Talk-to-NPC interaction layer (design 31): a throttled (~5 Hz) proximity
 * check against the AI 조교's spot. In range and panel closed → desktop
 * `T 대화` hint / touch `🤖 대화` button; walking past NPC_CLOSE_RADIUS while
 * the panel is open closes it. Mirrors the SitPrompt structure (same 5 Hz
 * off-frame cadence, same uiCapture guard on the hotkey).
 */

import { useEffect, useRef, useState } from "react";
import { NPC_CLOSE_RADIUS, NPC_NAME, NPC_TALK_RADIUS, isNearNpc } from "../game/npc";
import { isUiCaptured } from "../game/uiCapture";
import { useNpcStore } from "../stores/npcStore";
import { isTouchDevice } from "../device";
import type { Pose } from "../game/types";
import "./npc.css";

const PROXIMITY_INTERVAL_MS = 200;
const LABEL_TALK = `${NPC_NAME}와 대화`;

export function NpcPrompt({ pose }: { pose: Pose }) {
  const open = useNpcStore((s) => s.open);
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const state = useNpcStore.getState();
      const isNear = isNearNpc(pose.x, pose.z, NPC_TALK_RADIUS);
      if (isNear !== nearRef.current) {
        nearRef.current = isNear;
        setNear(isNear);
      }
      // Auto-close: the conversation ends when you walk away from the NPC.
      if (state.open && !isNearNpc(pose.x, pose.z, NPC_CLOSE_RADIUS)) state.closePanel();
    };
    tick();
    const id = window.setInterval(tick, PROXIMITY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [pose]);

  // T key opens the panel (desktop). uiCapture guard: typing 't' in the chat
  // input (or the NPC panel itself) never re-triggers.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "KeyT" || e.repeat) return;
      if (isUiCaptured()) return;
      const state = useNpcStore.getState();
      if (!state.open && nearRef.current) state.openPanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (open || !near) return null;

  if (isTouchDevice) {
    return (
      <button
        type="button"
        className="cv-npc-btn"
        onClick={() => useNpcStore.getState().openPanel()}
        aria-label={LABEL_TALK}
      >
        🤖 대화
      </button>
    );
  }
  return (
    <div className="cv-npc-hint" role="status">
      <kbd>T</kbd> {LABEL_TALK}
    </div>
  );
}
