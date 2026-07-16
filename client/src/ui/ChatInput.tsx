import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { setUiCaptured, isUiCaptured, captureReleaseEffect } from "../game/uiCapture";
import { sendChat } from "../net/connection";
import { isTouchDevice } from "../device";

const PLACEHOLDER = "메시지를 입력하세요 (Enter)";
/** Show the length counter once within this many characters of the limit. */
const COUNTER_LEAD = 20;

/**
 * <html> class while the chat input is focused on a touch device. The other
 * bottom-slot overlays (emoji palette, 👁/🗺 toggles, sit button) key off it to
 * hide, so the keyboard-lifted input bar can never land on them (design 22).
 */
const FOCUS_CLASS = "cv-chat-focus";

/** CSS custom property carrying the soft-keyboard inset (px) — read by chat.css. */
const KBD_INSET_VAR = "--cv-kbd-inset";

/**
 * Publish how much of the LAYOUT viewport's bottom the soft keyboard covers.
 * `innerHeight - vv.height - vv.offsetTop` is the strip below the visual
 * viewport: exactly the keyboard overlap when it is up, 0 when it is down.
 */
function updateKbdInset(): void {
  const vv = window.visualViewport;
  const inset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty(KBD_INSET_VAR, `${Math.round(inset)}px`);
}

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
  const [focused, setFocused] = useState(false);

  // Soft-keyboard handling (touch only): while focused, mark <html> with
  // FOCUS_CLASS (the palette/toggles/sit button hide via CSS) and track the
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
    updateKbdInset();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", updateKbdInset);
    vv?.addEventListener("scroll", updateKbdInset);
    return () => {
      vv?.removeEventListener("resize", updateKbdInset);
      vv?.removeEventListener("scroll", updateKbdInset);
      root.classList.remove(FOCUS_CLASS);
      root.style.setProperty(KBD_INSET_VAR, "0px");
    };
  }, [focused]);

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

  // Release the UI-capture flag if this input unmounts WHILE focused. A reconnect
  // (epoch bump → WorldScene remount) or a kick removes the focused field from
  // the DOM, and browsers fire no blur for a removed element — so onBlur never
  // runs and the flag would otherwise strand `true`, killing WASD/Enter/emoji.
  useEffect(captureReleaseEffect, []);

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
        onFocus={() => {
          setUiCaptured(true);
          setFocused(true);
        }}
        onBlur={() => {
          setUiCaptured(false);
          setFocused(false);
        }}
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
