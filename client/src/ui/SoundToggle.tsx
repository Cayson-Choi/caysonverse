import { useSoundStore } from "../stores/soundStore";
import "./sound.css";

/**
 * TTS mute toggle (design 23): a single 🔊/🔇 tap target (≥44px) rendered on
 * EVERY device — muting is not touch-specific, unlike the 👁/🗺 toggles whose
 * desktop equivalents are keys. On touch it extends the right-middle toggle
 * column one slot ABOVE 🗺 (slot regime, design 22); on desktop it parks above
 * the bottom-right emoji row. Mirrors the ViewToggle pattern: `aria-pressed` +
 * the `is-muted` class reflect the zustand flag; the store persists the choice
 * to localStorage (default ON).
 */
export function SoundToggle() {
  const muted = useSoundStore((s) => s.muted);
  const toggleMuted = useSoundStore((s) => s.toggleMuted);
  return (
    <button
      type="button"
      className={"cv-sound-btn" + (muted ? " is-muted" : "")}
      onClick={toggleMuted}
      aria-label="음성 낭독 켜기/끄기"
      aria-pressed={!muted}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
