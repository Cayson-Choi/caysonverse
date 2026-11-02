import { useCallback, useEffect, useRef, useState } from "react";
import { MessageType } from "@caysonverse/shared/messages";
import type { SitRejectedPayload } from "@caysonverse/shared/messages";
import { getRoom, sendSit, sendStand } from "../net/connection";
import { getRemoteSeatIndices } from "../game/remoteStore";
import { getActiveMap } from "../game/activeMap";
import { onHotkey } from "../game/hotkeys";
import {
  interactInputAt,
  interactNow,
  interactionIcon,
  interactionLabel,
  interactionShortLabel,
  pickInteraction,
  sameInteraction,
  shouldClosePanel,
  type Interaction,
} from "../game/interact";
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
  const refresh = useCallback((): Interaction | null => {
    const npcState = useNpcStore.getState();
    // The conversation ends when you walk away from the assistant you were talking to.
    if (shouldClosePanel(npcState.activeNpc, pose.x, pose.z)) npcState.closePanel();
    // Seats and AI 조교 exist in the legacy world only (ruling E6): elsewhere nothing is offered.
    if (!getActiveMap().seatsAndNpcs) {
      if (current.current !== null) {
        current.current = null;
        setInteraction(null);
      }
      return null;
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
    return next;
  }, [pose, seat]);

  // E / F and a click share this: re-read the world, act on THAT target, re-read.
  const act = useCallback(() => interactNow(refresh, perform), [refresh]);

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
        if (action.type === "interact") act(); // e.g. talk → the panel opens, the button goes
      }),
    [act],
  );

  const label = interaction ? interactionLabel(interaction) : "";
  return (
    <>
      {/* Screen readers: the polite status the old sit / talk hints had. Always mounted, so a
          change of text is announced (a live region added together with its text is often not).
          PC only — on a phone the button itself is the control and is read as it appears. */}
      {!isTouchDevice && (
        <span className="cv-sr-only" role="status" aria-live="polite">
          {interaction ? `E 키: ${label}` : ""}
        </span>
      )}
      {interaction && <ActionButtonView interaction={interaction} layout={layout} onAct={act} />}
    </>
  );
}

/** The visible button. Never takes focus; a click acts on a fresh read, like the E key. */
function ActionButtonView({
  interaction,
  layout,
  onAct,
}: {
  interaction: Interaction;
  layout: ReturnType<typeof useTouchHudLayout>;
  onAct: () => void;
}) {
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
      onClick={onAct}
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
