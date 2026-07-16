import { useViewStore } from "../stores/viewStore";
import { isTouchDevice } from "../device";
import "./view.css";

/**
 * Overview toggle button (touch devices only — desktop uses the `M` key). A
 * single 🗺 tap target (≥44px) parked just above the 👁 first-person button, so
 * the overlay cluster reads top-to-bottom 🗺 / 👁 without overlapping the emoji
 * palette. `aria-pressed` + the `is-ov` class reflect the live mode from the
 * zustand button flag; the actual toggle runs through `onToggle` →
 * toggleOverview() in WorldScene (design 20). Mirrors the ViewToggle pattern.
 */
export function OverviewToggle({ onToggle }: { onToggle: () => void }) {
  const isOv = useViewStore((s) => s.isOv);
  if (!isTouchDevice) return null;
  return (
    <button
      type="button"
      className={"cv-overview-btn" + (isOv ? " is-ov" : "")}
      onClick={onToggle}
      aria-label="맵 전체 보기 (오버뷰)"
      aria-pressed={isOv}
    >
      🗺
    </button>
  );
}
