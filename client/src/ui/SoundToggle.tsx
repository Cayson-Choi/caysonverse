import { useSoundStore } from "../stores/soundStore";
import { HudButton } from "./HudButton";

/**
 * TTS mute toggle (design 23) — third of the top-right group, every device. `pressed` is
 * "reading aloud is ON"; the store persists the choice to localStorage (default ON). The
 * muted state is a dimmed chip (`is-muted`) with the 🔇 glyph.
 */
export function SoundToggle() {
  const muted = useSoundStore((s) => s.muted);
  const toggleMuted = useSoundStore((s) => s.toggleMuted);
  return (
    <HudButton
      label="음성 낭독 켜기/끄기"
      pressed={!muted}
      highlight={false}
      className={muted ? "is-muted" : undefined}
      onClick={toggleMuted}
    >
      {muted ? "🔇" : "🔊"}
    </HudButton>
  );
}
