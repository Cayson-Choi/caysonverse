import { useSoundStore } from "../stores/soundStore";
import { HudButton } from "./HudButton";

/**
 * Sound on/off toggle — third of the top-right group, every device. `pressed` is "sound is ON";
 * the store persists the choice to localStorage (default ON). The muted state is a dimmed chip
 * (`is-muted`) with the 🔇 glyph. It says nothing about voices: chat is never read aloud any more
 * (owner decision 2026-11-03), and what it still silences is the legacy world's AI 조교.
 */
export function SoundToggle() {
  const muted = useSoundStore((s) => s.muted);
  const toggleMuted = useSoundStore((s) => s.toggleMuted);
  return (
    <HudButton
      label="소리 켜기/끄기"
      pressed={!muted}
      highlight={false}
      className={muted ? "is-muted" : undefined}
      onClick={toggleMuted}
    >
      {muted ? "🔇" : "🔊"}
    </HudButton>
  );
}
