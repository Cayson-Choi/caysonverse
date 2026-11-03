import type { CSSProperties, ReactNode } from "react";
import "./hud.css";

interface HudButtonProps {
  /** The accessible name (Korean). The glyph inside is decoration. */
  label: string;
  onClick: () => void;
  /** Toggle state (🗺 map, 🔊 sound, 👁 first person...) for assistive tech. Omit for a plain button. */
  pressed?: boolean;
  /** Draw the chip highlighted (`is-on`). Defaults to `pressed`; 🔊 is "pressed" by default but not highlighted. */
  highlight?: boolean;
  /** The button does nothing here and is drawn dimmed (the 🗺 map inside a building). Its place in the row stays. */
  disabled?: boolean;
  /** Extra classes after `cv-hud-btn` (position / shape variants). */
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * The one HUD button: a square chip (or a circle with `is-round`) that never takes
 * keyboard focus from a press. `pointerdown` is cancelled, so a focused chat field keeps
 * its caret and the soft keyboard stays up, Space / Enter can never "re-press" it, and a
 * tap on a phone does not leave a focus ring behind (Review Focus 2). The click still
 * fires — the pointer path is the only way to reach it (`tabIndex -1`), as with the
 * jump and action buttons.
 *
 * Size is `--cv-hud-btn` (hud.css: 48 px on a PC, the 버튼 크기 setting on a phone); a
 * caller that pins an exact rectangle (the touch layout) passes it in `style`.
 */
export function HudButton({
  label,
  onClick,
  pressed,
  highlight = pressed,
  disabled,
  className,
  style,
  children,
}: HudButtonProps) {
  return (
    <button
      type="button"
      className={"cv-hud-btn" + (highlight ? " is-on" : "") + (className ? " " + className : "")}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      tabIndex={-1}
      style={style}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <span className="cv-hud-glyph" aria-hidden="true">
        {children}
      </span>
    </button>
  );
}
