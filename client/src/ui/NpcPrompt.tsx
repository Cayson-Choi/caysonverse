/**
 * Talk-to-NPC interaction layer (design 31 + 후속: three assistants): a
 * throttled (~5 Hz) proximity check against every AI 조교 spot. Near one and
 * panel closed → desktop `T 대화` hint / touch `🤖 대화` button; walking past
 * NPC_CLOSE_RADIUS of the ACTIVE assistant while its panel is open closes it.
 * Mirrors the SitPrompt structure (same 5 Hz off-frame cadence, same uiCapture
 * guard on the hotkey).
 */

import { useEffect, useRef, useState } from "react";
import {
  NPC_CLOSE_RADIUS,
  NPC_LABEL,
  NPC_TALK_RADIUS,
  nearestNpc,
  npcDistance,
  type NpcId,
} from "../game/npc";
import { isUiCaptured } from "../game/uiCapture";
import { useNpcStore } from "../stores/npcStore";
import { isTouchDevice } from "../device";
import type { Pose } from "../game/types";
import "./npc.css";

const PROXIMITY_INTERVAL_MS = 200;
const LABEL_TALK = `${NPC_LABEL}와 대화`;

export function NpcPrompt({ pose }: { pose: Pose }) {
  const open = useNpcStore((s) => s.activeNpc !== null);
  const [nearId, setNearId] = useState<NpcId | null>(null);
  const nearRef = useRef<NpcId | null>(null);

  useEffect(() => {
    const tick = () => {
      const state = useNpcStore.getState();
      const near = nearestNpc(pose.x, pose.z, NPC_TALK_RADIUS);
      const id = near?.id ?? null;
      if (id !== nearRef.current) {
        nearRef.current = id;
        setNearId(id);
      }
      // Auto-close: the conversation ends when you walk away from the
      // assistant you were talking to.
      if (state.activeNpc && npcDistance(state.activeNpc, pose.x, pose.z) > NPC_CLOSE_RADIUS)
        state.closePanel();
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
      if (state.activeNpc === null && nearRef.current) state.openPanel(nearRef.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (open || nearId === null) return null;

  if (isTouchDevice) {
    const target = nearId;
    return (
      <button
        type="button"
        className="cv-npc-btn"
        onClick={() => useNpcStore.getState().openPanel(target)}
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
