import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { setUiCaptured, captureReleaseEffect } from "../game/uiCapture";
import { onHotkey } from "../game/hotkeys";
import { createTypingSender } from "../game/typing";
import { sendChat, sendTyping } from "../net/connection";
import { isTouchDevice } from "../device";
import { KBD_INSET_VAR, trackKbdInset } from "./kbdInset";

const PLACEHOLDER = "메시지를 입력하세요 (Enter)";
/** Show the length counter once within this many characters of the limit. */
const COUNTER_LEAD = 20;

/**
 * <html> class while the chat input is focused on a touch device. The other
 * bottom-slot overlays (emoji palette, 👁/🗺 toggles, action and jump buttons) key off it to
 * hide, so the keyboard-lifted input bar can never land on them (design 22).
 */
const FOCUS_CLASS = "cv-chat-focus";

/**
 * Bottom-centre chat input bar.
 *  - Enter or `/` (unfocused) focuses the input; Enter (focused) sends + blurs.
 *  - Escape blurs.
 *  - While focused, `setUiCaptured(true)` tells the movement system to ignore
 *    keys (see uiCapture.ts), so typing never walks the avatar.
 *  - IME-safe: never sends while a composition (e.g. Hangul) is in progress.
 *  - Typing indicator (Task 12): every change tells the typing sender whether the
 *    field has text (ON on the first keystroke + a heartbeat, OFF when cleared);
 *    sending, blur and unmount stop it. The "…" itself is drawn by the name tag.
 */
export function ChatInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  // One sender per mount (it remembers the last ON it sent, for the server's rate
  // window) — useState, not useMemo, so React can never silently rebuild it.
  const [typing] = useState(() => createTypingSender(sendTyping));

  // Soft-keyboard handling (touch only): while focused, mark <html> with
  // FOCUS_CLASS (the palette/toggles/action and jump buttons hide via CSS) and track the
  // keyboard inset from visualViewport. Browser behaviours differ:
  //  - iOS Safari: the keyboard NEVER resizes the layout viewport — a fixed
  //    bottom bar stays anchored where the keyboard now is. The VISUAL viewport
  //    shrinks (vv.height) and can pan (vv.offsetTop), so the inset above
  //    measures exactly the covered strip and chat.css lifts the bar with it.
  //  - Android Chrome 108+ (default interactive-widget=resizes-visual): same
  //    model as iOS — layout viewport unchanged, inset > 0, bar lifted.
  //  - Older Android Chrome / resizes-content: the LAYOUT viewport itself
  //    shrinks, fixed elements rise on their own and the inset computes ~0;
  //    the max() in chat.css then keeps the normal slot (no double lift).
  // Playwright cannot emulate the soft keyboard, so E2E verifies this by
  // mocking visualViewport.height + firing its resize event.
  useEffect(() => {
    if (!focused || !isTouchDevice) return;
    const root = document.documentElement;
    root.classList.add(FOCUS_CLASS);
    const stop = trackKbdInset();
    return () => {
      stop();
      root.classList.remove(FOCUS_CLASS);
      root.style.setProperty(KBD_INSET_VAR, "0px");
    };
  }, [focused]);

  // Enter or `/` (the shared hotkey table's openChat) focuses the input. The table
  // already drops the key while another UI field owns the keyboard — without that,
  // pressing Enter inside another text field (e.g. the admin announce textarea,
  // which sets the same capture flag) would steal focus to the chat bar instead of
  // inserting a newline — and cancels the browser default once for all subscribers,
  // which is also why the `/` that opens chat is never typed into the field.
  useEffect(() => {
    return onHotkey((action) => {
      if (action.type !== "openChat") return;
      const input = inputRef.current;
      if (!input || document.activeElement === input) return;
      input.focus();
    });
  }, []);

  // Release the UI-capture flag if this input unmounts WHILE focused. A reconnect
  // (epoch bump → WorldScene remount) or a kick removes the focused field from
  // the DOM, and browsers fire no blur for a removed element — so onBlur never
  // runs and the flag would otherwise strand `true`, killing WASD/Enter/emoji.
  useEffect(captureReleaseEffect, []);

  // Same for the typing indicator: an input that unmounts while ON (reconnect
  // remount, kick) fires no blur, so tell the others it stopped.
  useEffect(() => () => typing.stop(), [typing]);

  function submit() {
    typing.stop(); // OFF first, so the receivers drop the "…" before the bubble lands
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
        onFocus={() => {
          setUiCaptured(true);
          setFocused(true);
        }}
        onBlur={() => {
          setUiCaptured(false);
          setFocused(false);
          typing.stop();
        }}
        onChange={(e) => {
          const next = e.target.value.slice(0, CHAT_MAX_LENGTH);
          setValue(next);
          typing.onInput(performance.now(), next.trim().length > 0);
        }}
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
