import { useEffect, useRef, useState } from "react";
import { EMOJIS, EMOJI_RATE } from "@caysonverse/shared/constants";
import { getRoom, sendEmoji } from "../net/connection";
import { startEmojiSync } from "../net/emojiSync";
import { onHotkey } from "../game/hotkeys";
import "./emoji.css";

/** How long the click/press pulse feedback lingers (ms). */
const PULSE_MS = 200;

/**
 * Bottom-right emoji reaction palette: 6 buttons (the glyph itself is the
 * label) plus 1-6 keyboard shortcuts. The shortcut keys come from the shared
 * hotkey table (hotkeys.ts), which honours the SAME focus flag the chat input
 * sets (uiCapture.ts) so digits never leak into a reaction while typing a
 * message. Wires the emoji broadcast into the module registry for this
 * component's lifetime (mirrors Chat.tsx's startChatSync wiring). The float-up
 * sprites themselves live in the 3D scene (useEmoji, per avatar), not here.
 */
export function EmojiPalette() {
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return startEmojiSync(room);
  }, []);

  const lastSentAt = useRef(Number.NEGATIVE_INFINITY);
  const [pulseIndex, setPulseIndex] = useState<number | null>(null);

  function fire(index: number) {
    const now = performance.now();
    // Client-side mirror of the server's 500ms rate cap: keeps the button
    // feeling responsive (immediate pulse) without spamming the network — the
    // server remains authoritative and silently drops any excess regardless.
    if (now - lastSentAt.current < EMOJI_RATE.windowMs) return;
    lastSentAt.current = now;
    sendEmoji(index);
    setPulseIndex(index);
    window.setTimeout(() => setPulseIndex((p) => (p === index ? null : p)), PULSE_MS);
  }

  useEffect(() => {
    return onHotkey((action) => {
      if (action.type === "emoji") fire(action.index);
    });
    // fire reads only a ref + a stable state setter — safe to register once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cv-emoji-palette" role="group" aria-label="이모지 리액션">
      {EMOJIS.map((emoji, index) => (
        <button
          key={emoji}
          type="button"
          className={"cv-emoji-btn" + (pulseIndex === index ? " is-pulse" : "")}
          aria-label={`${emoji} 리액션 보내기 (단축키 ${index + 1})`}
          onClick={() => fire(index)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
