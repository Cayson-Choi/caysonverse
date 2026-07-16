import { useViewStore } from "../stores/viewStore";
import { isTouchDevice } from "../device";
import "./view.css";

/**
 * First-person toggle button (touch devices only — desktop uses the `V` key and
 * the wheel). A single 👁 tap target (≥44px) parked above the bottom-right emoji
 * palette so the two clusters never overlap. `aria-pressed` + the `is-fp` class
 * reflect the live mode from the zustand button flag; the actual toggle (with its
 * yaw seeding) runs through `onToggle` → toggleViewMode(orbit) in WorldScene.
 */
export function ViewToggle({ onToggle }: { onToggle: () => void }) {
  const isFp = useViewStore((s) => s.isFp);
  if (!isTouchDevice) return null;
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
