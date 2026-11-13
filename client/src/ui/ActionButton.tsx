import { useCallback, useEffect, useRef, useState } from "react";
import { MessageType } from "@caysonverse/shared/messages";
import type { SitRejectedPayload } from "@caysonverse/shared/messages";
import { getRoom, sendSit, sendStand } from "../net/connection";
import { getRemoteSeatIndices } from "../game/remoteStore";
import { getActiveMap } from "../game/activeMap";
import { onHotkey } from "../game/hotkeys";
import { fireTarget, getTargets } from "../game/interactTargets";
import {
  holdEnded,
  interactInputAt,
  interactNow,
  interactionIcon,
  interactionLabel,
  interactionShortLabel,
  pickInteraction,
  sameInteraction,
  type InteractTarget,
  type Interaction,
} from "../game/interact";
import { useChatStore } from "../stores/chatStore";
import { isTouchDevice } from "../device";
import type { Pose, SeatState } from "../game/types";
import { rectStyle, useTouchHudLayout } from "./useTouchHudLayout";
import "./action.css";

/** How often the proximity check runs (ms). ~5 Hz — off the per-frame path. */
const PROXIMITY_INTERVAL_MS = 200;

/**
 * What holds a hold target down: the E / F key, a finger or mouse on the button, or a plain click (a tap that
 * landed on a button drawn before the target turned into a hold — it is let go of at once). Each way of
 * letting go ends only its own hold.
 */
type HoldBy = "key" | "pointer" | "click";

/** The hold target being held right now, and what holds it. */
interface Held {
  target: InteractTarget;
  by: HoldBy;
}

/** Do what the button says. The server stays authoritative for sit / stand. */
function perform(it: Interaction, startHold: (target: InteractTarget) => void): void {
  switch (it.kind) {
    case "sit":
      sendSit(it.seatIndex);
      break;
    case "stand":
      sendStand();
      break;
    case "target":
      // The scene decides what its target does (the hall: the team panel, "enter"). A tap is a press;
      // a hold target (a lone member's coop switch) is pressed now and released when the finger / key lets go.
      fireTarget(it.target, "press");
      if (it.target.hold) startHold(it.target);
      break;
  }
}

/**
 * The one context button (DOM overlay above the canvas) and the E / F key behind it:
 * sit on a nearby free bench, stand up, or use what the active scene offers (the memorial hall's door, a keypad,
 * a guide, the fishing kiosk - interactTargets.ts) - whichever is nearest (interact.ts decides). Renders nothing
 * when there is nothing to do.
 *
 *  - Touch: a 60 px round button right above the 72 px JumpButton (icon + short label),
 *    pinned to the rectangle game/hud.ts `touchHudLayout` gives it.
 *  - Desktop: a small pill at the bottom right, above the emoji row, `E 앉기` (clickable too).
 *
 * It also owns, off the render path:
 *  - a ~5 Hz proximity check (occupancy comes from every player's schema-synced
 *    `seatIndex` - no extra network), and
 *  - the personal SitRejected notice -> a dimmed chat-log system row.
 *
 * A HOLD target (pressed and held) is pressed when the finger / mouse
 * goes down on the button or E / F goes down, and RELEASED when it comes up - and on every other way out:
 * the pointer being cancelled, the window losing focus or going to the background, the page being hidden,
 * the target no longer being the pick (walked out of reach, an overlay opened, paused) and this button
 * unmounting. The server finishes a hold by itself after the full time, so a release that never gets
 * sent would let a tap count as a full hold.
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
  // The hold target being held (not state: nothing is drawn from it; the ring is the scene's).
  const held = useRef<Held | null>(null);
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

  /** Let go of the hold (only the one `by` started, when given): tell the scene. */
  const releaseHold = useCallback((by?: HoldBy): void => {
    const h = held.current;
    if (h === null || (by !== undefined && h.by !== by)) return;
    held.current = null;
    fireTarget(h.target, "release");
  }, []);

  // One proximity pass: pick the interaction. Reads the live pose / seat refs; allocates only at this cadence.
  const refresh = useCallback((): Interaction | null => {
    // What the active scene offers (the memorial hall's door, keypads, guides, the fishing kiosk).
    const targets = getTargets(pose);
    const map = getActiveMap();
    let next: Interaction | null;
    if (map.seats && map.seats.length > 0) {
      // Its benches (from the front) and the scene's targets.
      const occupied = new Set(getRemoteSeatIndices());
      next = pickInteraction(interactInputAt(pose.x, pose.z, seat.index, (i) => occupied.has(i), targets, { seats: map.seats }));
    } else {
      next = pickInteraction({ seated: false, seat: null, targets });
    }
    if (!sameInteraction(next, current.current)) {
      current.current = next;
      setInteraction(next);
    }
    // A held target that is no longer the pick (out of reach, an overlay, a pause) is let go of.
    if (held.current !== null && holdEnded(held.current.target, next)) releaseHold();
    return next;
  }, [pose, seat, releaseHold]);

  // E / F and a press or click share this: re-read the world, act on THAT target, re-read.
  // A hold that is already going is not started a second time (the other way of pressing waits its turn).
  const act = useCallback(
    (by: HoldBy) => {
      if (held.current !== null) return;
      interactNow(refresh, (it) => perform(it, (target) => void (held.current = { target, by })));
    },
    [refresh],
  );
  // A tap on a button drawn before its target became a hold: the finger is already up, so it is a press and a release.
  const actClick = useCallback(() => {
    act("click");
    releaseHold("click");
  }, [act, releaseHold]);
  const holdDown = useCallback(() => act("pointer"), [act]);
  const holdUp = useCallback(() => releaseHold("pointer"), [releaseHold]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, PROXIMITY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // E / F: the shared hotkey table already drops auto-repeat, IME composition and
  // keys typed into a focused field (typing "e" in the chat never sits). Re-read
  // the world first so a key pressed right after walking up sees the current target.
  // E / F going up ends the hold the key started (the keyup passes even while an overlay holds the keyboard).
  useEffect(
    () =>
      onHotkey((action) => {
        if (action.type === "interact") act("key"); 
        else if (action.type === "interactUp") releaseHold("key");
      }),
    [act, releaseHold],
  );

  // Every other way out of a hold: the window loses focus, goes to the background or the page is hidden (a
  // finger lifted somewhere we never hear of), and this button going away.
  useEffect(() => {
    const letGo = (): void => releaseHold();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") releaseHold();
    };
    window.addEventListener("blur", letGo);
    window.addEventListener("pagehide", letGo);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", letGo);
      window.removeEventListener("pagehide", letGo);
      document.removeEventListener("visibilitychange", onVisibility);
      releaseHold();
    };
  }, [releaseHold]);

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
      {interaction && (
        <ActionButtonView
          interaction={interaction}
          layout={layout}
          onClick={actClick}
          onHoldDown={holdDown}
          onHoldUp={holdUp}
        />
      )}
    </>
  );
}

/**
 * The visible button. Never takes focus; a click acts on a fresh read, like the E key. A hold target acts
 * when the pointer goes DOWN and is let go of when it comes up or is cancelled (the pointer is captured, so
 * it can come up anywhere), and the click that follows is ignored.
 */
function ActionButtonView({
  interaction,
  layout,
  onClick,
  onHoldDown,
  onHoldUp,
}: {
  interaction: Interaction;
  layout: ReturnType<typeof useTouchHudLayout>;
  onClick: () => void;
  onHoldDown: () => void;
  onHoldUp: () => void;
}) {
  const label = interactionLabel(interaction);
  const isHold = interaction.kind === "target" && interaction.target.hold === true;
  return (
    <button
      type="button"
      className={"cv-action-btn" + (isTouchDevice ? " is-touch" : "") + (isHold ? " is-hold" : "")}
      style={isTouchDevice ? rectStyle(layout.action) : undefined}
      // Never take focus: a focused button would be re-pressed by Space / Enter and
      // would steal the caret from the chat field (Review Focus 2).
      onPointerDown={(e) => {
        e.preventDefault();
        if (!isHold || (e.pointerType === "mouse" && e.button !== 0)) return;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // a pointer that is already gone: the up / cancel below still ends the hold
        }
        onHoldDown();
      }}
      onPointerUp={isHold ? onHoldUp : undefined}
      onPointerCancel={isHold ? onHoldUp : undefined}
      onLostPointerCapture={isHold ? onHoldUp : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={isHold ? (e) => e.preventDefault() : undefined}
      onClick={isHold ? undefined : onClick}
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
