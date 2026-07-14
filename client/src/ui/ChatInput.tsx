import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { setUiCaptured, isUiCaptured } from "../game/uiCapture";
import { sendChat } from "../net/connection";

const PLACEHOLDER = "메시지를 입력하세요 (Enter)";
/** Show the length counter once within this many characters of the limit. */
const COUNTER_LEAD = 20;

/**
 * Bottom-centre chat input bar.
 *  - Enter (unfocused) focuses the input; Enter (focused) sends + blurs.
 *  - Escape blurs.
 *  - While focused, `setUiCaptured(true)` tells the movement system to ignore
 *    keys (see uiCapture.ts), so typing never walks the avatar.
 *  - IME-safe: never sends while a composition (e.g. Hangul) is in progress.
 */
export function ChatInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  // Global Enter focuses the input — but only when no other UI field owns the
  // keyboard. Without this guard, pressing Enter inside another text field (e.g.
  // the admin announce textarea, which sets the same capture flag) would steal
  // focus to the chat bar instead of inserting a newline.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.isComposing) return;
      if (isUiCaptured()) return; // another field (or chat itself) is focused
      const input = inputRef.current;
      if (!input || document.activeElement === input) return;
      e.preventDefault();
      input.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit() {
    sendChat(value); // trims + drops empty; server is authoritative
    setValue("");
    inputRef.current?.blur();
  }

  return (
    <div className="cv-chat-input">
      <input
        ref={inputRef}
        className="cv-chat-field"
        type="text"
        value={value}
        placeholder={PLACEHOLDER}
        maxLength={CHAT_MAX_LENGTH}
        aria-label="채팅 입력"
        onFocus={() => setUiCaptured(true)}
        onBlur={() => setUiCaptured(false)}
        onChange={(e) => setValue(e.target.value.slice(0, CHAT_MAX_LENGTH))}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return; // let the IME finish first
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            inputRef.current?.blur();
          }
        }}
      />
      {value.length >= CHAT_MAX_LENGTH - COUNTER_LEAD && (
        <span className="cv-chat-counter">
          {value.length}/{CHAT_MAX_LENGTH}
        </span>
      )}
    </div>
  );
}
