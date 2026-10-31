import { pressJump } from "../game/jump";
import { sendJump } from "../net/connection";
import "./action.css";

/**
 * The touch jump button: a 72 px round thumb target at the bottom-right edge (the
 * action button sits right above it — action.css). Mounted on touch devices only;
 * on a desktop Space jumps (LocalPlayer's hotkey).
 *
 * A press goes through `pressJump` — the SAME gate Space uses: one "jump blocked"
 * flag that LocalPlayer publishes every frame (seated, in the sit / stand-up clip,
 * reconnecting, or no avatar yet) plus the client cooldown. So a tap while blocked
 * is refused outright — it sends nothing and burns no cooldown — and tapping twice
 * quickly sends one jump. Otherwise `localJump` plays our own hop at once (no round
 * trip) and tells the server. The button reads that flag at press time, so it needs
 * no state and never re-renders.
 *
 * It reacts on pointer DOWN (a tap must feel instant) and cancels the default so the
 * button never takes focus or fires a synthetic mouse event / click behind it.
 */
export function JumpButton({ sessionId }: { sessionId: string }) {
  return (
    <button
      type="button"
      className="cv-jump-btn"
      aria-label="점프"
      tabIndex={-1}
      onPointerDown={(e) => {
        e.preventDefault();
        pressJump(sessionId, performance.now(), sendJump);
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
