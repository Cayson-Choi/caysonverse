import { pressJump } from "../game/jump";
import { useQuiet } from "../game/quiet";
import { sendJump } from "../net/connection";
import { rectStyle, useTouchHudLayout } from "./useTouchHudLayout";
import "./action.css";

/**
 * The touch jump button: a 72 px round thumb target at the bottom-right edge (the
 * action button sits right above it). Mounted on touch devices only; on a desktop Space
 * jumps (LocalPlayer's hotkey). Its rectangle comes from game/hud.ts `touchHudLayout`
 * (the same numbers hud.test.ts keeps 8 px from every other button; mirrored when
 * left-handed), so it is pinned by inline style, not CSS.
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
  const layout = useTouchHudLayout();
  const quiet = useQuiet();
  if (quiet) return null; // no jumping in the quiet hall (quiet.ts): the server drops it
  return (
    <button
      type="button"
      className="cv-jump-btn"
      style={rectStyle(layout.jump)}
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
