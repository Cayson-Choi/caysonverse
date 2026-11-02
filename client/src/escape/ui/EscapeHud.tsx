import { useEffect, useState } from "react";
import { EscapeMsg } from "@caysonverse/shared/escape/messages";
import { isTouchDevice } from "../../device";
import { acquireUiCapture, releaseUiCapture } from "../../game/uiCapture";
import { sendEscape } from "../../net/connection";
import { useAnnounceStore } from "../../stores/announceStore";
import { useEscapeStore, type EscapeView } from "../../stores/escapeStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { DialogueQueue } from "../dialogue";
import { escapeOverlay, formatTime, isLowTime, timeupText, type Overlay } from "../format";
import { DialogueBox } from "./DialogueBox";
import "../escape.css";

/** The "수업이 끝났어요" card shows this long, then the player is walked back to the hall (the server closes the room at 5 s). */
export const ENDED_AUTO_LEAVE_MS = 3500;
/** The keyboard owner of the paused / time-up / class-ended cover. */
const COVER_CAPTURE_OWNER = "cover";
/** A "다시 도전" that has not turned the phase around after this long may be pressed again (a lost message). */
const RETRY_AGAIN_MS = 2500;

/** The clock and the team's name, top centre. */
function TimerCard({ view }: { view: EscapeView }) {
  const low = isLowTime(view.timeLeftS);
  return (
    <div className={"cv-esc-timer" + (low ? " is-low" : "")} role="timer" aria-label={`남은 시간 ${formatTime(view.timeLeftS)}`}>
      <span className="cv-esc-timer-icon" aria-hidden="true">
        ⏱
      </span>
      <div className="cv-esc-timer-main">
        <div className="cv-esc-timer-row">
          <span className="cv-esc-timer-clock">{formatTime(view.timeLeftS)}</span>
          {view.overtime && <span className="cv-esc-timer-extra">+연장</span>}
        </div>
        {view.teamName !== "" && <div className="cv-esc-timer-team">{view.teamName}</div>}
      </div>
    </div>
  );
}

/** The covers: they hold the classroom still (nothing behind them takes a tap or a key). */
function Cover({ overlay, onLeave }: { overlay: Exclude<Overlay, "intro" | null>; onLeave: () => void }) {
  const [sent, setSent] = useState(false);

  // A "다시 도전" press is one message; the button waits for the phase to turn around, and comes back if it never does.
  useEffect(() => {
    if (!sent) return;
    const id = window.setTimeout(() => setSent(false), RETRY_AGAIN_MS);
    return () => window.clearTimeout(id);
  }, [sent]);

  // The class is over: show the card for a moment, then back to the hall (before the server closes the room).
  useEffect(() => {
    if (overlay !== "ended") return;
    const id = window.setTimeout(onLeave, ENDED_AUTO_LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [overlay, onLeave]);

  if (overlay === "paused") {
    return (
      <div className="cv-esc-cover" role="alertdialog" aria-live="polite" aria-label="선생님이 잠시 멈췄어요">
        <div className="cv-esc-card is-paused">
          <div className="cv-esc-card-icon" aria-hidden="true">
            ⏸
          </div>
          <h2 className="cv-esc-card-title">선생님이 잠시 멈췄어요</h2>
        </div>
      </div>
    );
  }
  if (overlay === "timeup") {
    return (
      <div className="cv-esc-cover" role="alertdialog" aria-live="polite" aria-label="시간이 다 됐어요">
        <div className="cv-esc-card is-timeup">
          <div className="cv-esc-card-icon" aria-hidden="true">
            ⏰
          </div>
          <p className="cv-esc-card-text">{timeupText()}</p>
          <button
            type="button"
            className="cv-esc-btn"
            disabled={sent}
            onClick={() => {
              setSent(true);
              sendEscape(EscapeMsg.Retry, {});
            }}
          >
            다시 도전
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="cv-esc-cover" role="alertdialog" aria-live="polite" aria-label="수업이 끝났어요">
      <div className="cv-esc-card is-ended">
        <div className="cv-esc-card-icon" aria-hidden="true">
          🔔
        </div>
        <h2 className="cv-esc-card-title">수업이 끝났어요</h2>
        <button type="button" className="cv-esc-btn is-quiet" onClick={onLeave}>
          복도로 나가기
        </button>
      </div>
    </div>
  );
}

/**
 * The classroom's own DOM (AI 학교 탈출, Task 17), after the shared HUD: the clock and team name top
 * centre (red at one minute, "+연장" after a retry), the story box, and the covers — paused / time up /
 * class ended (escapeOverlay's priority). While a cover is up it holds the keyboard too (owner
 * "cover"), so a key cannot walk the avatar behind it. The intro cover is only a soft line: the
 * story box plays and the room waits a few seconds.
 *
 * The clock reads the server's whole seconds from the escape store; there is no local countdown to drift.
 */
export function EscapeHud({ queue, onLeave }: { queue: DialogueQueue; onLeave: () => void }) {
  const view = useEscapeStore((s) => s.view);
  // An announcement banner takes the top-centre spot; the stack steps below it.
  const announced = useAnnounceStore((s) => s.text !== "");
  // Left-handed on a phone: the HUD columns swap sides, so does the stack.
  const mirrored = useSettingsStore((s) => s.settings.leftHanded) && isTouchDevice;

  const overlay = view ? escapeOverlay(view) : null;
  const covering = overlay === "paused" || overlay === "timeup" || overlay === "ended";

  // Its own owner ("cover"): the overlay stack (ui/overlayStack.ts) holds "overlay", and a cover coming or going
  // while a close-up is open must not free the other's hold.
  useEffect(() => {
    if (!covering) return;
    acquireUiCapture(COVER_CAPTURE_OWNER);
    // PlayShell lets go of every hold in its own mount effect, which runs after this child's: hold again once it has.
    const id = window.setTimeout(() => acquireUiCapture(COVER_CAPTURE_OWNER), 0);
    return () => {
      window.clearTimeout(id);
      releaseUiCapture(COVER_CAPTURE_OWNER);
    };
  }, [covering]);

  if (!view) return null;
  return (
    <>
      <div className={"cv-escui cv-esc-top" + (announced ? " has-announce" : "") + (mirrored ? " is-mirrored" : "")}>
        <TimerCard view={view} />
        {overlay === "intro" && (
          <div className="cv-esc-intro" role="status">
            곧 시작해요! 이야기를 들어 보세요
          </div>
        )}
        <DialogueBox queue={queue} frozen={covering} />
      </div>
      {covering && (
        <div className="cv-escui">
          <Cover overlay={overlay} onLeave={onLeave} />
        </div>
      )}
    </>
  );
}
