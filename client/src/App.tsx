import { useAppStore } from "./stores/appStore";
import { EntryScreen } from "./ui/EntryScreen";
import { WorldScene } from "./game/WorldScene";
import { ReconnectingOverlay } from "./ui/ReconnectingOverlay";

/**
 * Top-level screen router. `screen` and `identity` are UI state (zustand), not
 * per-frame data. Entry -> (join success) -> world; an unexpected room leave is
 * handled by the resilience driver (reconnect behind the overlay, or fall back
 * to entry). The WorldScene is keyed by `connectionEpoch` so a reconnect remounts
 * it against the new room (rebinding every scene-level room subscription); the
 * reconnection overlay lives OUTSIDE that key so it survives the remount.
 */
export default function App() {
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
