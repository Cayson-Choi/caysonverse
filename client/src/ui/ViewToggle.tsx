import { useViewStore } from "../stores/viewStore";
import "./view.css";

/**
 * First-person toggle button — EVERY device (design 30 후속 복원, same story
 * as OverviewToggle: PCs that lost the touch misdetection lost this visible
 * control; `V`/wheel still work, the 👁 button is the discoverable path). A
 * single tap/click target (≥44px) parked above the bottom-right emoji palette
 * so the two clusters never overlap. `aria-pressed` + the `is-fp` class
 * reflect the live mode from the zustand button flag; the actual toggle (with
 * its yaw seeding) runs through `onToggle` → toggleViewMode(orbit) in
 * WorldScene.
 */
export function ViewToggle({ onToggle }: { onToggle: () => void }) {
  const isFp = useViewStore((s) => s.isFp);
  return (
    <button
      type="button"
      className={"cv-view-btn" + (isFp ? " is-fp" : "")}
      onClick={onToggle}
      aria-label="1인칭/3인칭 전환"
      aria-pressed={isFp}
    >
      👁
    </button>
  );
}
