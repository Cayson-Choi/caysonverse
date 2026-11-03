import { useViewStore } from "../stores/viewStore";
import { HudButton } from "./HudButton";

/**
 * The 🗺 map button — second of the top-right group, every device (the `M` key still works;
 * this is the discoverable path). `pressed` reflects the live overview mode from the zustand
 * flag; the camera work lives in CameraRig, the toggle runs through `onToggle` →
 * toggleOverview() in WorldScene (design 20). `disabled`: no overview where the map is (inside a building,
 * game/indoorCamera.ts) — the chip stays in the row, dimmed.
 */
export function OverviewToggle({ onToggle, disabled }: { onToggle: () => void; disabled?: boolean }) {
  const isOv = useViewStore((s) => s.isOv);
  return (
    <HudButton label="지도 보기" pressed={isOv} disabled={disabled} onClick={onToggle}>
      🗺
    </HudButton>
  );
}
