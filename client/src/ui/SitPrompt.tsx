import { useEffect, useRef, useState } from "react";
import { nearestFreeSeat } from "@caysonverse/shared/worldMap";
import { MessageType } from "@caysonverse/shared/messages";
import type { SitRejectedPayload } from "@caysonverse/shared/messages";
import { getRoom, sendSit, sendStand } from "../net/connection";
import { getRemoteSeatIndices } from "../game/remoteStore";
import { isUiCaptured } from "../game/uiCapture";
import { useChatStore } from "../stores/chatStore";
import { isTouchDevice } from "../device";
import type { Pose, SeatState } from "../game/types";
import "./sit.css";

/** How often the proximity check runs (ms). ~5 Hz — off the per-frame path. */
const PROXIMITY_INTERVAL_MS = 200;

// User-facing Korean strings (identifiers stay English). The desktop hint renders
// the E key as a <kbd> chip followed by the label (visually "E 앉기").
const LABEL_SIT = "앉기";
const LABEL_STAND = "일어서기";

/**
 * The sit/stand interaction layer (DOM overlay above the canvas):
 *  - a throttled (~5 Hz) proximity check for the nearest FREE seat within
 *    SEAT_REACH of the local player (occupancy derived from every player's
 *    schema-synced `seatIndex` — no extra network),
 *  - desktop HUD hints (`E 앉기` / `E 일어서기`), the E key routed through the
 *    same uiCapture focus guard (typing in chat never sits),
 *  - touch `[앉기]` / `[일어서기]` buttons (≥44px) beside the joystick, and
 *  - the personal SitRejected notice → a dimmed chat-log system row.
 *
 * Server-authoritative: this only SENDS Sit/Stand; the seated state itself flips
 * when the schema `seatIndex` syncs (LocalPlayer confirms it).
 */
export function SitPrompt({ pose, seat }: { pose: Pose; seat: SeatState }) {
  // Discrete UI state (not per-frame): the seat we could sit on, and whether we
  // are seated. Updated at most ~5 Hz and only when the derived value changes.
  const [promptSeat, setPromptSeat] = useState<number | null>(null);
  const [seated, setSeated] = useState(false);
  // Refs mirror the state so the (once-registered) E-key handler reads fresh
  // values without re-subscribing every tick.
  const promptSeatRef = useRef<number | null>(null);
  const seatedRef = useRef(false);

  // Personal rejection notice (occupied-seat race) → dimmed system row. Mirrors
  // chatSync's ChatRejected wiring; registered for this component's lifetime.
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return room.onMessage(MessageType.SitRejected, (m: SitRejectedPayload) => {
      useChatStore.getState().pushSystem(m.reason);
    });
  }, []);

  // Throttled proximity + seated derivation. Reads the live pose/seat refs.
  useEffect(() => {
    const tick = () => {
      const isSeated = seat.index >= 0;
      if (isSeated !== seatedRef.current) {
        seatedRef.current = isSeated;
        setSeated(isSeated);
      }
      // Occupancy: remotes' seats + our own. Small allocations at 5 Hz only.
      const occupied = new Set(getRemoteSeatIndices());
      if (seat.index >= 0) occupied.add(seat.index);
      const next = isSeated
        ? null
        : nearestFreeSeat(pose.x, pose.z, (i) => occupied.has(i));
      if (next !== promptSeatRef.current) {
        promptSeatRef.current = next;
        setPromptSeat(next);
      }
    };
    tick();
    const id = window.setInterval(tick, PROXIMITY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [pose, seat]);

  // E key: sit (in range) or stand (seated). Honors the chat focus guard so
  // typing 'e' never triggers it. Registered once — reads live refs.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "KeyE") return;
      if (isUiCaptured()) return; // chat input owns the keyboard
      if (e.repeat) return; // one action per physical press (no auto-repeat spam)
      if (seatedRef.current) {
        sendStand();
      } else if (promptSeatRef.current !== null) {
        sendSit(promptSeatRef.current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Touch buttons: a big tap target beside the joystick.
  if (isTouchDevice) {
    if (seated) {
      return (
        <button
          type="button"
          className="cv-sit-btn"
          onClick={() => sendStand()}
          aria-label={LABEL_STAND}
        >
          {LABEL_STAND}
        </button>
      );
    }
    if (promptSeat !== null) {
      const target = promptSeat;
      return (
        <button
          type="button"
          className="cv-sit-btn"
          onClick={() => sendSit(target)}
          aria-label={LABEL_SIT}
        >
          {LABEL_SIT}
        </button>
      );
    }
    return null;
  }

  // Desktop HUD hint (bottom-centre). Shown seated (stand) or when in range (sit).
  if (seated) {
    return (
      <div className="cv-sit-hint" role="status">
        <kbd>E</kbd> {LABEL_STAND}
      </div>
    );
  }
  if (promptSeat !== null) {
    return (
      <div className="cv-sit-hint" role="status">
        <kbd>E</kbd> {LABEL_SIT}
      </div>
    );
  }
  return null;
}
