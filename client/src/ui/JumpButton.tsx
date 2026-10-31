import { localJump } from "../game/jump";
import type { SeatState } from "../game/types";
import { sendJump } from "../net/connection";
import { isInputSuspended } from "../net/resilience";
import "./action.css";

/**
 * The touch jump button: a 72 px round thumb target at the bottom-right edge (the
 * action button sits right above it — action.css). Mounted on touch devices only;
 * on a desktop Space jumps (LocalPlayer's hotkey).
 *
 * A press hops at once: `localJump` plays our own jump locally (no round trip) and
 * tells the server, and refuses while seated or inside the client cooldown — the
 * same gate Space goes through, so tapping it twice quickly sends one jump. It reads
 * the live `seat` ref at press time, so the button needs no state and never re-renders.
 *
 * It reacts on pointer DOWN (a tap must feel instant) and cancels the default so the
 * button never takes focus or fires a synthetic mouse event / click behind it.
 */
export function JumpButton({ sessionId, seat }: { sessionId: string; seat: SeatState }) {
  return (
    <button
      type="button"
      className="cv-jump-btn"
      aria-label="점프"
      tabIndex={-1}
      onPointerDown={(e) => {
        e.preventDefault();
        if (isInputSuspended()) return;
        localJump(sessionId, seat.index >= 0, performance.now(), sendJump);
      }}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="cv-jump-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 11l6-6 6 6M6 19l6-6 6 6" />
      </svg>
      <span className="cv-jump-text">점프</span>
    </button>
  );
}
