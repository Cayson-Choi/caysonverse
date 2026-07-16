import { useEffect } from "react";
import { useAppStore } from "./stores/appStore";
import { EntryScreen } from "./ui/EntryScreen";
import { WorldScene } from "./game/WorldScene";
import { ReconnectingOverlay } from "./ui/ReconnectingOverlay";

/**
 * Suppress the browser context menu on the 3D canvas only (right-drag rotates the
 * camera, so the "save image / copy image" menu keeps popping up mid-play).
 * Scoped to <canvas> so text inputs keep their native right-click (paste etc.).
 * Document-level + capture so it survives WorldScene remounts on reconnect.
 */
function useCanvasContextMenuSuppression() {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.target instanceof HTMLCanvasElement) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu, { capture: true });
    return () => document.removeEventListener("contextmenu", onContextMenu, { capture: true });
  }, []);
}

/**
 * Top-level screen router. `screen` and `identity` are UI state (zustand), not
 * per-frame data. Entry -> (join success) -> world; an unexpected room leave is
 * handled by the resilience driver (reconnect behind the overlay, or fall back
 * to entry). The WorldScene is keyed by `connectionEpoch` so a reconnect remounts
 * it against the new room (rebinding every scene-level room subscription); the
 * reconnection overlay lives OUTSIDE that key so it survives the remount.
 */
export default function App() {
  useCanvasContextMenuSuppression();
  const screen = useAppStore((s) => s.screen);
  const identity = useAppStore((s) => s.identity);
  const connectionEpoch = useAppStore((s) => s.connectionEpoch);

  return (
    <>
      {screen === "world" && identity ? (
        <WorldScene key={connectionEpoch} identity={identity} />
      ) : (
        <EntryScreen />
      )}
      <ReconnectingOverlay />
    </>
  );
}
