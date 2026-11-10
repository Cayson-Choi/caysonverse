import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { acquireUiCapture, releaseUiCapture, captureReleaseEffect } from "../game/uiCapture";
import { noteTypedKey, onHotkey } from "../game/hotkeys";
import { isTextEntry, type FocusLike } from "../game/escape";
import { createTypingSender } from "../game/typing";
import { sendChat, sendTyping } from "../net/connection";
import { isTouchDevice } from "../device";
import { useCoachStore } from "../stores/coachStore";
import { useNpcStore } from "../stores/npcStore";
import { chatKeyAction, hasChatText, pressLeavesChat, typeToChatAllowed } from "./chatBar";
import { HudButton } from "./HudButton";
import { KBD_INSET_VAR, trackKbdInset } from "./kbdInset";
import { rectStyle, useTouchHudLayout } from "./useTouchHudLayout";

const PLACEHOLDER = "메시지를 입력하세요 (Enter)";
/** Show the length counter once within this many characters of the limit. */
const COUNTER_LEAD = 20;

/**
 * <html> class while the chat input is focused on a touch device. The other
 * bottom-cluster overlays (the emoji fan, action and jump buttons, the 💬 button) key off
 * it to hide, so the keyboard-lifted input bar can never land on them (design 22).
 */
const FOCUS_CLASS = "cv-chat-focus";

/** A press that must not take the caret out of the field (the send button, the bar around the field). */
const keepCaret = (e: { preventDefault(): void }) => e.preventDefault();

/**
 * Bottom-centre chat input bar: one rounded bar holding the field and, at its end, the send
 * button (보내기).
 *  - PC: always visible. Phone: the bar is always MOUNTED but folded away (`is-collapsed`:
 *    opacity 0, no pointer events) until the 💬 button — or a hardware Enter / `/` — focuses
 *    it; blur folds it again. The 💬 button calls `input.focus()` straight from its click
 *    handler: iOS raises the keyboard only for a focus() inside a user gesture, so nothing
 *    may be deferred to an effect or a timer. The bar then rides on the keyboard
 *    (`--cv-kbd-inset`, chat.css).
 *  - Once chatting you STAY chatting (owner's ask, 2026-11-10): Enter sends the line and the
 *    caret stays in the field for the next one (on a phone the keyboard stays up); the send
 *    button does exactly the same. Its press never takes the focus (pointerdown / mousedown
 *    cancelled), so a phone keyboard never drops. Dimmed — and a no-op — while the field is blank.
 *  - Leaving: Enter on an empty / blank field (the keyboard's way back to walking, decided in
 *    chatBar.ts), Escape, or a press ANYWHERE outside the bar — the 3D view, a HUD button, a menu
 *    (a capture-phase pointerdown listener, so even HUD buttons that cancel their own press to keep
 *    a caret let go of it). That press otherwise does what it always does (a click-move, a camera
 *    drag, the button's action). WASD / the arrows walk again at once.
 *  - Enter or `/` (unfocused) focuses the input. So does a key that TYPES something and is no game
 *    key (the hotkey table's typeToChat: H, 7, "." — and in 한글 mode also ㄱ ㅍ ㅡ ㅠ, which would
 *    otherwise be recenter / view / map / bag): the field takes the caret during that keydown and
 *    the browser types the character — or starts the Hangul composition — into it. Not while the
 *    조교 dialogue is open or another field has the caret (chatBar.ts typeToChatAllowed). Every key
 *    typed here tells the hotkey table which mode (한글 / English) the keyboard is in (noteTypedKey):
 *    Chrome on Windows turns the IME off outside a field, so out there ㅡ arrives as a plain "m".
 *    WASD / Z / C and E / F stay game keys in both modes, so a line that STARTS with ㅈ ㅁ ㄴ ㅇ ㅋ ㅊ
 *    ㄷ ㄹ walks / turns / interacts on that first key — Enter (or a click on the bar) first is the
 *    sure way in, and once in, the chat stays open.
 *  - While focused, the "chat" capture tells the movement system and the hotkey table to ignore
 *    keys (see uiCapture.ts), so typing never walks the avatar or fires a hotkey.
 *  - IME-safe: Enter never acts during a composition (e.g. Hangul) — the IME finishes the syllable
 *    first. A send reads the line from the field itself (a syllable still being composed when the
 *    button is pressed is already in it) and clears it, so the last syllable is never dropped and
 *    never sent twice.
 *  - A sent line is the guide's ③ "말하기": a send reports `talked` (coachStore) — only for a
 *    line that really goes out, never an empty or blank one.
 *  - Typing indicator (Task 12): every change tells the typing sender whether the
 *    field has text (ON on the first keystroke + a heartbeat, OFF when cleared);
 *    sending, blur and unmount stop it. The "…" itself is drawn by the name tag.
 */
export function ChatInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  // One sender per mount (it remembers the last ON it sent, for the server's rate
  // window) — useState, not useMemo, so React can never silently rebuild it.
  const [typing] = useState(() => createTypingSender(sendTyping));
  const layout = useTouchHudLayout();

  // Soft-keyboard handling (touch only): while focused, mark <html> with
  // FOCUS_CLASS (the emoji fan, 💬, action and jump buttons hide via CSS) and track the
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

  // Enter or `/` (the shared hotkey table's openChat) focuses the input, and so does a typed key
  // (typeToChat). The table already drops the key while another UI field owns the keyboard —
  // without that, pressing Enter inside another text field (e.g. the admin announce textarea,
  // which sets the same capture flag) would steal focus to the chat bar instead of inserting a
  // newline — and cancels the browser default of Enter / `/` once for all subscribers, which is
  // also why the `/` that opens chat is never typed into the field. typeToChat is NOT cancelled:
  // the focus moves during the keydown, so the character the key types lands in the field.
  useEffect(() => {
    return onHotkey((action) => {
      if (action.type !== "openChat" && action.type !== "typeToChat") return;
      const input = inputRef.current;
      if (!input || document.activeElement === input) return;
      if (
        action.type === "typeToChat" &&
        !typeToChatAllowed({
          npcOpen: useNpcStore.getState().activeNpc !== null,
          otherFieldFocused: isTextEntry(document.activeElement as FocusLike | null),
        })
      )
        return;
      input.focus();
    });
  }, []);

  // A press anywhere outside the bar takes the caret out of the field. Capture phase on the
  // document, so it runs before (and whatever) the pressed element does: the canvas, a HUD
  // button that cancels its own press to keep a caret, a menu. The press itself goes on as usual.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      if (pressLeavesChat(e.target, barRef.current)) input.blur();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Release the UI-capture flag if this input unmounts WHILE focused. A reconnect
  // (epoch bump → WorldScene remount) or a kick removes the focused field from
  // the DOM, and browsers fire no blur for a removed element — so onBlur never
  // runs and the flag would otherwise strand `true`, killing WASD/Enter/emoji.
  useEffect(() => captureReleaseEffect("chat"), []);

  // Same for the typing indicator: an input that unmounts while ON (reconnect
  // remount, kick) fires no blur, so tell the others it stopped.
  useEffect(() => () => typing.stop(), [typing]);

  /** Send the line in the field (if it has any text) and clear it. The caret stays where it is. */
  function send() {
    const input = inputRef.current;
    // The field itself is the truth: it already holds a syllable an IME is still composing.
    const line = input ? input.value : value;
    if (!hasChatText(line)) return; // a blank line goes nowhere (the dimmed button)
    typing.stop(); // OFF first, so the receivers drop the "…" before the bubble lands
    sendChat(line); // trims; server is authoritative
    useCoachStore.getState().report("talked"); // ③ of the first-visit guide
    if (input) input.value = ""; // at once, even if React's copy of the line lagged behind the field
    setValue("");
  }

  const collapsed = isTouchDevice && !focused;
  const ready = hasChatText(value);

  return (
    <>
      {isTouchDevice && !focused && (
        <HudButton
          label="채팅 입력"
          className="is-round cv-chat-btn"
          style={rectStyle(layout.chat)}
          // Synchronous, inside the click: the one place iOS lets focus() bring up the keyboard.
          onClick={() => inputRef.current?.focus()}
        >
          💬
        </HudButton>
      )}
      <div
        ref={barRef}
        className={"cv-chat-input" + (collapsed ? " is-collapsed" : "")}
        // A press on the bar around the field (its padding, the counter, the send button) keeps
        // the caret; a click there puts it in the field (PC: the bar is visible unfocused too).
        onPointerDown={(e) => {
          if (e.target !== inputRef.current) keepCaret(e);
        }}
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) keepCaret(e);
        }}
        onClick={(e) => {
          if (e.target !== inputRef.current) inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          className="cv-chat-field"
          type="text"
          value={value}
          placeholder={PLACEHOLDER}
          maxLength={CHAT_MAX_LENGTH}
          aria-label="채팅 입력"
          enterKeyHint="send"
          onFocus={() => {
            acquireUiCapture("chat");
            setFocused(true);
          }}
          onBlur={() => {
            releaseUiCapture("chat");
            setFocused(false);
            typing.stop();
          }}
          onChange={(e) => {
            const next = e.target.value.slice(0, CHAT_MAX_LENGTH);
            setValue(next);
            typing.onInput(performance.now(), next.trim().length > 0);
          }}
          onKeyDown={(e) => {
            noteTypedKey(e.nativeEvent); // 한글 or English: what a key typed out in the world will mean (hotkeys.ts)
            const act = chatKeyAction(
              { key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, // the IME finishes first
              e.currentTarget.value,
            );
            if (act === null) return;
            e.preventDefault(); // consumed: the hotkey table must not also open the chat / the menu
            if (act === "send") send();
            else e.currentTarget.blur();
          }}
        />
        {value.length >= CHAT_MAX_LENGTH - COUNTER_LEAD && (
          <span className="cv-chat-counter">
            {value.length}/{CHAT_MAX_LENGTH}
          </span>
        )}
        <button
          type="button"
          className="cv-chat-send"
          aria-label="보내기"
          title={isTouchDevice ? undefined : "보내기 (Enter)"}
          aria-disabled={!ready}
          // Never a Tab stop and never takes the focus: the caret (and a phone's keyboard) stays in the field.
          tabIndex={-1}
          onPointerDown={keepCaret}
          onMouseDown={keepCaret}
          onClick={send}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3.4 20.1 21.2 12.6a.65.65 0 0 0 0-1.2L3.4 3.9a.6.6 0 0 0-.83.7L4.9 11.2l8.1.8-8.1.8-2.33 6.6a.6.6 0 0 0 .83.7Z" />
          </svg>
        </button>
      </div>
    </>
  );
}
