import { useEffect } from "react";
import { useAppStore } from "./stores/appStore";
import { EntryScreen } from "./ui/EntryScreen";
import { VillageScene } from "./village/VillageScene";
import { ReconnectingOverlay } from "./ui/ReconnectingOverlay";
import { AppErrorBoundary } from "./ui/AppErrorBoundary";
import { VillageLoader } from "./ui/VillageLoader";

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
 * per-frame data. Entry -> (join success) -> village (케이슨 마을); an unexpected
 * room leave is handled by the resilience driver (reconnect behind the overlay, or
 * fall back to entry). The VillageScene is keyed by `connectionEpoch` so a reconnect
 * remounts it against the new room (rebinding every scene-level room subscription);
 * the reconnection overlay lives OUTSIDE that key so it survives the remount, and stays (over a picture of the village taken
 * before the drop) until the new scene is in view (appStore.resuming), so the player never sees it black.
 * AppErrorBoundary wraps both screens: an uncaught render error (e.g. inside the
 * 3D scene) shows a refresh prompt instead of React unmounting the root to a blank
 * page, and leaves any open room.
 */
export default function App() {
  useCanvasContextMenuSuppression();
  const screen = useAppStore((s) => s.screen);
  const identity = useAppStore((s) => s.identity);
  const connectionEpoch = useAppStore((s) => s.connectionEpoch);

  return (
    <>
      <AppErrorBoundary>
        {screen === "village" && identity ? (
          <VillageScene key={connectionEpoch} identity={identity} />
        ) : (
          <EntryScreen />
        )}
      </AppErrorBoundary>
      {/* the entry's loading screen: from the 입장하기 press until the village is first seen (outside the scene's key) */}
      <VillageLoader />
      <ReconnectingOverlay />
    </>
  );
}
