import { useEffect, useRef, useState } from "react";
import { EMOJIS, EMOJI_RATE } from "@caysonverse/shared/constants";
import { getActiveRoom, sendEmoji } from "../net/connection";
import { startEmojiSync } from "../net/emojiSync";
import { onHotkey } from "../game/hotkeys";
import "./emoji.css";

/** How long the click/press pulse feedback lingers (ms). */
const PULSE_MS = 200;

/**
 * Everything an emoji control needs, shared by the PC palette and the touch fan (mount
 * ONE of them — this registers the room's emoji broadcast and the 1–6 keys):
 *  - wires the ACTIVE room's emoji broadcast (the classroom while inside one, where sendEmoji
 *    goes too) into the module registry for the caller's lifetime (mirrors
 *    Chat.tsx's startChatSync wiring); the float-up sprites live in the 3D scene (useEmoji),
 *  - the 1–6 shortcut from the shared hotkey table (hotkeys.ts), which honours the SAME
 *    capture rule the chat input sets (uiCapture.ts) so digits never leak into a reaction
 *    while typing a message,
 *  - `fire(index)`: a client-side mirror of the server's 500 ms rate cap (the button feels
 *    immediate without spamming the network — the server stays authoritative),
 *  - `pulseIndex`: which button to flash for PULSE_MS after a send.
 */
export function useEmojiFire(): { fire: (index: number) => void; pulseIndex: number | null } {
  useEffect(() => {
    const room = getActiveRoom();
    if (!room) return;
    return startEmojiSync(room);
  }, []);

  const lastSentAt = useRef(Number.NEGATIVE_INFINITY);
  const [pulseIndex, setPulseIndex] = useState<number | null>(null);

  function fire(index: number) {
    const now = performance.now();
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

  return { fire, pulseIndex };
}

/**
 * PC emoji reactions: one row of six buttons at the bottom right (the glyph itself is the
 * label) next to the 1–6 keys. Phones get the EmojiFan instead (one button that opens a
 * half circle); WorldScene mounts exactly one of the two.
 */
export function EmojiPalette() {
  const { fire, pulseIndex } = useEmojiFire();
  return (
    <div className="cv-emoji-palette" role="group" aria-label="이모지 리액션">
      {EMOJIS.map((emoji, index) => (
        <button
          key={emoji}
          type="button"
          className={"cv-emoji-btn" + (pulseIndex === index ? " is-pulse" : "")}
          aria-label={`${emoji} 리액션 보내기 (단축키 ${index + 1})`}
          tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => fire(index)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
