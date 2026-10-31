import { useCallback, useEffect, useRef, useState } from "react";
import { MessageType } from "@caysonverse/shared/messages";
import type { SitRejectedPayload } from "@caysonverse/shared/messages";
import { getRoom, sendSit, sendStand } from "../net/connection";
import { getRemoteSeatIndices } from "../game/remoteStore";
import { onHotkey } from "../game/hotkeys";
import {
  interactInputAt,
  interactionIcon,
  interactionLabel,
  interactionShortLabel,
  pickInteraction,
  sameInteraction,
  type Interaction,
} from "../game/interact";
import { NPC_CLOSE_RADIUS, npcDistance } from "../game/npc";
import { useChatStore } from "../stores/chatStore";
import { useNpcStore } from "../stores/npcStore";
import { isTouchDevice } from "../device";
import type { Pose, SeatState } from "../game/types";
import { rectStyle, useTouchHudLayout } from "./useTouchHudLayout";
import "./action.css";

/** How often the proximity check runs (ms). ~5 Hz — off the per-frame path. */
const PROXIMITY_INTERVAL_MS = 200;

/** Do what the button says. The server stays authoritative for sit / stand. */
function perform(it: Interaction): void {
  switch (it.kind) {
    case "sit":
      sendSit(it.seatIndex);
      break;
    case "stand":
      sendStand();
      break;
    case "talk":
      useNpcStore.getState().openPanel(it.npc);
      break;
  }
}

/**
 * The one context button (DOM overlay above the canvas) and the E / F key behind it:
 * sit on a nearby free chair, stand up, or talk to a nearby AI 조교 — whichever is
 * nearest (interact.ts decides). Renders nothing when there is nothing to do.
 *
 *  - Touch: a 60 px round button right above the 72 px JumpButton (icon + short label),
 *    pinned to the rectangle game/hud.ts `touchHudLayout` gives it.
 *  - Desktop: a small pill at the bottom right, above the emoji row, `E 앉기` (clickable too).
 *
 * It also owns what the old SitPrompt / NpcPrompt did off the render path:
 *  - a ~5 Hz proximity check (occupancy comes from every player's schema-synced
 *    `seatIndex` — no extra network),
 *  - closing the 조교 chat panel when you walk past NPC_CLOSE_RADIUS of it, and
 *  - the personal SitRejected notice → a dimmed chat-log system row.
 *
 * Server-authoritative: this only SENDS Sit / Stand (the same path LocalPlayer's
 * seat camera listens to); the seated state itself flips when the schema
 * `seatIndex` syncs. The button never takes keyboard focus (pointerdown is
 * cancelled, no tab stop), so Space / Enter can never re-press it and a focused
 * chat field keeps its caret.
 */
export function ActionButton({ pose, seat }: { pose: Pose; seat: SeatState }) {
  // Discrete UI state (not per-frame), updated at most ~5 Hz and only on change.
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  // Mirrors the state so the key handler never acts on a stale render.
  const current = useRef<Interaction | null>(null);
  // Re-evaluate at once when a chat panel opens or closes (F → button gone).
  const panelOpen = useNpcStore((s) => s.activeNpc !== null);
  const layout = useTouchHudLayout();

  // Personal rejection notice (occupied-seat race) → dimmed system row. Mirrors
  // chatSync's ChatRejected wiring; registered for this component's lifetime.
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return room.onMessage(MessageType.SitRejected, (m: SitRejectedPayload) => {
      useChatStore.getState().pushSystem(m.reason);
    });
  }, []);

  // One proximity pass: auto-close a far chat panel, then pick the interaction.
  // Reads the live pose / seat refs; allocates only at this cadence.
  const refresh = useCallback(() => {
    const npcState = useNpcStore.getState();
    // The conversation ends when you walk away from the assistant you were talking to.
    if (npcState.activeNpc && npcDistance(npcState.activeNpc, pose.x, pose.z) > NPC_CLOSE_RADIUS) {
      npcState.closePanel();
    }
    const occupied = new Set(getRemoteSeatIndices());
    const next = pickInteraction(
      interactInputAt(
        pose.x,
        pose.z,
        seat.index,
        (i) => occupied.has(i),
        useNpcStore.getState().activeNpc !== null,
      ),
    );
    if (!sameInteraction(next, current.current)) {
      current.current = next;
      setInteraction(next);
    }
  }, [pose, seat]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, PROXIMITY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [panelOpen, refresh]);

  // E / F: the shared hotkey table already drops auto-repeat, IME composition and
  // keys typed into a focused field (typing "e" in the chat never sits). Re-read
  // the world first so a key pressed right after walking up sees the current target.
  useEffect(
    () =>
      onHotkey((action) => {
        if (action.type !== "interact") return;
        refresh();
        if (current.current) perform(current.current);
        refresh(); // e.g. talk → the panel is open, the button goes away this frame
      }),
    [refresh],
  );

  if (!interaction) return null;

  const label = interactionLabel(interaction);
  return (
    <button
      type="button"
      className={"cv-action-btn" + (isTouchDevice ? " is-touch" : "")}
      style={isTouchDevice ? rectStyle(layout.action) : undefined}
      // Never take focus: a focused button would be re-pressed by Space / Enter and
      // would steal the caret from the chat field (Review Focus 2).
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        perform(interaction);
        refresh();
      }}
      tabIndex={-1}
      aria-label={label}
    >
      {isTouchDevice ? (
        <>
          <span className="cv-action-icon" aria-hidden="true">
            {interactionIcon(interaction)}
          </span>
          <span className="cv-action-text">{interactionShortLabel(interaction)}</span>
        </>
      ) : (
        <>
          <kbd>E</kbd>
          <span className="cv-action-text">{label}</span>
        </>
      )}
    </button>
  );
}
