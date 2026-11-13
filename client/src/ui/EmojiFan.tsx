import { useEffect, useState, type CSSProperties } from "react";
import { EMOJIS } from "@caysonverse/shared/constants";
import { useQuiet } from "../game/quiet";
import { useUiStore } from "../stores/uiStore";
import { addChatLayoutTargets } from "./chatLayoutTargets";
import { useEmojiFire } from "./EmojiPalette";
import { HudButton } from "./HudButton";
import { rectStyle, useTouchHudLayout } from "./useTouchHudLayout";
import "./emoji.css";

/** <html> class while the fan is open: the jump, action and 💬 buttons step aside (hud.css). */
const FAN_OPEN_CLASS = "cv-fan-open";

/**
 * Phone emoji reactions: one round button in the bottom-right cluster. Tap it and the six
 * reactions open as an upward half circle (game/hud.ts `fanPositions`, slid inside the
 * screen); tap one to send it, or anywhere else to close. The fan is drawn over the corner
 * the jump, action and 💬 buttons occupy, so they are hidden while it is open — what stays
 * visible is exactly what hud.test.ts keeps 8 px apart (`fanOpenRects`).
 *
 * Every button here is a HudButton (never takes focus from a press), so the chat field's
 * caret and the keyboard are untouched, and the 1–6 keys keep working through
 * `useEmojiFire`. The fan also closes when the menu opens.
 */
export function EmojiFan() {
  const { fire, pulseIndex } = useEmojiFire();
  const layout = useTouchHudLayout();
  const [open, setOpen] = useState(false);
  const menuOpen = useUiStore((s) => s.menuOpen);
  const quiet = useQuiet();

  // Something else took the screen (or the place went quiet): fold up.
  useEffect(() => {
    if (menuOpen || quiet) setOpen(false);
  }, [menuOpen, quiet]);

  // While open, the six buttons are where a chat on a phone gives them back (hidden under cv-chat-focus): a tap that
  // leaves the chat there keeps the chat layout until it is over (ChatInput, chatLayoutTargets.ts).
  useEffect(() => (open ? addChatLayoutTargets(() => layout.fan) : undefined), [open, layout]);

  // While open: hide the corner buttons, and close on any press that is not on the fan.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add(FAN_OPEN_CLASS);
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".cv-emoji-fan")) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      root.classList.remove(FAN_OPEN_CLASS);
    };
  }, [open]);

  if (quiet) return null; // no reactions in the quiet hall (quiet.ts)
  return (
    <div className="cv-emoji-fan" role="group" aria-label="이모지 리액션">
      {open &&
        EMOJIS.map((emoji, index) => (
          <HudButton
            key={emoji}
            label={`${emoji} 리액션 보내기`}
            className={"is-round cv-emoji-fan-btn" + (pulseIndex === index ? " is-pulse" : "")}
            style={{ ...rectStyle(layout.fan[index]), "--cv-fan-i": index } as CSSProperties}
            onClick={() => {
              fire(index);
              setOpen(false);
            }}
          >
            {emoji}
          </HudButton>
        ))}
      <HudButton
        label={open ? "이모지 닫기" : "이모지 열기"}
        pressed={open}
        className="is-round cv-emoji-toggle"
        style={rectStyle(layout.emoji)}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "✕" : "😀"}
      </HudButton>
    </div>
  );
}
