import { useEffect } from "react";
import { useAppStore } from "./stores/appStore";
import { EntryScreen } from "./ui/EntryScreen";
import { WorldScene } from "./game/WorldScene";
import { ReconnectingOverlay } from "./ui/ReconnectingOverlay";
import { AppErrorBoundary } from "./ui/AppErrorBoundary";

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

/** The temporary hub / classroom panel (Tasks 15 and 17 replace it with the scenes). */
const PENDING_STYLE = { display: "grid", placeItems: "center", minHeight: "100vh", fontSize: "1.5rem" } as const;

/**
 * Top-level screen router. `screen` and `identity` are UI state (zustand), not
 * per-frame data. Entry -> (join success) -> world; an unexpected room leave is
 * handled by the resilience driver (reconnect behind the overlay, or fall back
 * to entry). The WorldScene is keyed by `connectionEpoch` so a reconnect remounts
 * it against the new room (rebinding every scene-level room subscription); the
 * reconnection overlay lives OUTSIDE that key so it survives the remount.
 * AppErrorBoundary wraps both screens: an uncaught render error (e.g. inside the
 * 3D scene) shows a refresh prompt instead of React unmounting the root to a blank
 * page, and leaves any open room.
 *
 * AI 학교 탈출 (Task 13): `hub` (a class's hall) and `escape` (a team classroom) are
 * screens of the state machine already; their scenes come in Tasks 15 and 17. Until
 * then they show a plain "준비 중" panel.
 */
export default function App() {
  useCanvasContextMenuSuppression();
  const screen = useAppStore((s) => s.screen);
  const identity = useAppStore((s) => s.identity);
  const connectionEpoch = useAppStore((s) => s.connectionEpoch);

  return (
    <>
      <AppErrorBoundary>
        {screen === "world" && identity ? (
          <WorldScene key={connectionEpoch} identity={identity} />
        ) : (screen === "hub" || screen === "escape") && identity ? (
          <div className="cv-pending" role="status" style={PENDING_STYLE}>
            준비 중
          </div>
        ) : (
          <EntryScreen />
        )}
      </AppErrorBoundary>
      <ReconnectingOverlay />
    </>
  );
}
