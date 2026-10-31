import { useViewStore } from "../stores/viewStore";
import { HudButton } from "./HudButton";

/**
 * The 👁 first-person / third-person button — first of the top-right group, every device
 * (owner's call, Task 16: V, the zoom-through and the menu switch still toggle too, this is
 * the visible one). `pressed` is the live mode from the zustand flag; the toggle itself
 * (with its yaw seeding, and ignoring the overview map) runs through `onToggle` in WorldScene.
 */
export function ViewToggle({ onToggle }: { onToggle: () => void }) {
  const isFp = useViewStore((s) => s.isFp);
  return (
    <HudButton label="1인칭/3인칭 전환" pressed={isFp} onClick={onToggle}>
      👁
    </HudButton>
  );
}
