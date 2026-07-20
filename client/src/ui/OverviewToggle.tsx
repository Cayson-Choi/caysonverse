import { useViewStore } from "../stores/viewStore";
import "./view.css";

/**
 * Overview toggle button — EVERY device (design 30 후속 복원: the primary-
 * pointer fix correctly reclassified touch-misdetected PCs as desktop, which
 * silently took this button away from users who navigated by it; the `M` key
 * still works, but the visible 🗺 control is the discoverable path). A single
 * tap/click target (≥44px) parked just above the 👁 first-person button, so
 * the overlay cluster reads top-to-bottom 🗺 / 👁 without overlapping the
 * emoji palette. `aria-pressed` + the `is-ov` class reflect the live mode from
 * the zustand button flag; the actual toggle runs through `onToggle` →
 * toggleOverview() in WorldScene (design 20). Mirrors the ViewToggle pattern.
 */
export function OverviewToggle({ onToggle }: { onToggle: () => void }) {
  const isOv = useViewStore((s) => s.isOv);
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
