import { useAppStore } from "./stores/appStore";
import { EntryScreen } from "./ui/EntryScreen";
import { WorldScene } from "./game/WorldScene";

/**
 * Top-level screen router. `screen` and `identity` are UI state (zustand), not
 * per-frame data. Entry -> (join success) -> world; an unexpected room leave
 * flips back to entry (handled in the connection layer).
 */
export default function App() {
  const screen = useAppStore((s) => s.screen);
  const identity = useAppStore((s) => s.identity);

  if (screen === "world" && identity) {
    return <WorldScene identity={identity} />;
  }
  return <EntryScreen />;
}
