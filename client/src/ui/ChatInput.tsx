import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_MAX_LENGTH, CHAT_RATE, CHAT_TOO_FAST } from "@caysonverse/shared/constants";
import { acquireUiCapture, releaseUiCapture, captureReleaseEffect } from "../game/uiCapture";
import { onHotkey } from "../game/hotkeys";
import { isTextEntry, type FocusLike } from "../game/escape";
import { createTypingSender } from "../game/typing";
import { sendChat, sendTyping } from "../net/connection";
import { isTouchDevice } from "../device";
import { useChatStore } from "../stores/chatStore";
import { useCoachStore } from "../stores/coachStore";
import { useNpcStore } from "../stores/npcStore";
import {
  chatKeyAction,
  hasChatText,
  insertPrefix,
  leaveTapStep,
  paceSend,
  pressLeavesChat,
  typeToChatAllowed,
  type LeaveTap,
  type LeaveTapEvent,
} from "./chatBar";
import { HudButton } from "./HudButton";
import { KBD_INSET_VAR, trackKbdInset } from "./kbdInset";
import { rectStyle, useTouchHudLayout } from "./useTouchHudLayout";

const PLACEHOLDER = "메시지를 입력하세요 (Enter)";
/** Show the length counter once within this many characters of the limit. */
const COUNTER_LEAD = 20;

/**
 * <html> class while the chat input is focused on a touch device — and until the tap that took the caret out is over
 * (chatBar.ts leaveTapStep). The other bottom-cluster overlays (the emoji fan, action and jump buttons, the 💬 button)
 * key off it to hide, so the keyboard-lifted input bar can never land on them (design 22).
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
 *    chatBar.ts — never its auto-repeat: a held Enter sends once and stays), Escape, or a press
 *    ANYWHERE outside the bar — the 3D view, a HUD button, a menu (a capture-phase pointerdown
 *    listener, so even HUD buttons that cancel their own press to keep a caret let go of it).
 *    That press otherwise does what it always does (a click-move, a camera drag, the button's
 *    action). WASD / the arrows walk again at once. On a phone the keyboard goes with that press
 *    (the blur) and the bar folds away, but the rest of the HUD keeps its chat layout until the
 *    tap is over — its click, or a moment after the finger lifts (chatBar.ts leaveTapStep): the
 *    browser aims a tap's click when the finger lifts, and it used to land on the 💬 / emoji /
 *    action button that had just come back under the finger (review round 3).
 *  - Enter or `/` (unfocused) focuses the input. So does a key that TYPES something and is no game
 *    key (the hotkey table's typeToChat: H, 7, "." — and in 한글 mode also ㄱ ㅍ ㅡ ㅠ, which would
 *    otherwise be recenter / view / map / bag): the field takes the caret during that keydown and
 *    the browser types the character — or starts the Hangul composition — into it. Not while the
 *    조교 dialogue is open or another field has the caret (chatBar.ts typeToChatAllowed). Chrome on
 *    Windows turns the IME off outside a field, so out there ㅡ arrives as a plain "m": an M / B
 *    right after a consonant key is read as ㅡ / ㅠ of a word (hotkeys.ts followsConsonant), and a
 *    lone M / B waits a moment (hotkeys.ts heldKeyWaitMs) — when the next key goes on typing (ㅡㅡ,
 *    ㅠㅠ, "my") the chat opens with the held letter put in first (the action's `prefix`), otherwise
 *    it is the map / the bag; a slower second key (within the word gap) still takes back the map
 *    that opened meanwhile. The keys pressed before the chat took the caret were game keys, and
 *    those first keys arrive as latin letters ("ㅡㅡ" reads "mm" there), so the first syllable may
 *    need fixing — WASD / Z / C and E / F stay game keys in both modes, so a line that STARTS with
 *    ㅈ ㅁ ㄴ ㅇ ㅋ ㅊ ㄷ ㄹ (ㅋㅋ, ㅇㅇ) walks / turns / interacts on those keys, and ㄱ ㅍ (R V)
 *    recenter / switch the view. Enter (or a click on the bar) first is the sure way in, and once
 *    in, the chat stays open.
 *  - While focused, the "chat" capture tells the movement system and the hotkey table to ignore
 *    keys (see uiCapture.ts), so typing never walks the avatar or fires a hotkey.
 *  - IME-safe: Enter never acts during a composition (e.g. Hangul) — the IME finishes the syllable
 *    first. A send reads the line from the field itself (a syllable still being composed when the
 *    button is pressed is already in it) and clears it, so the last syllable is never dropped and
 *    never sent twice. Safari ends the composition BEFORE the Enter's keydown (keyCode 229,
 *    isComposing false): that Enter sends right after the event, once the syllable is in (one
 *    press, as elsewhere), and a second keydown of the same press does nothing (chatBar.ts).
 *    Safari's Escape that drops a syllable (229) stays the IME's: consumed here, so the window's
 *    hotkey table never takes it for the menu key (which would blur the chat); a second Escape leaves.
 *  - Pacing: the server drops a line over its cap (CHAT_RATE: 3 lines / 5 s) — after the field was
 *    cleared, so the line was lost. Now that the chat stays open that cap is easy to reach, so the
 *    bar holds such a line back itself (chatBar.ts paceSend): it stays in the field, a note right
 *    above the bar says why (the log is folded away on a phone) and the send button dims until the
 *    line may go; the log gets the server's own notice ONCE per hold, however often the player
 *    presses meanwhile.
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
  /** The tap that took the caret out is not over yet (chatBar.ts leaveTapStep): the HUD keeps its chat layout. */
  const [leaving, setLeaving] = useState(false);
  const leaveTap = useRef<LeaveTap | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One sender per mount (it remembers the last ON it sent, for the server's rate
  // window) — useState, not useMemo, so React can never silently rebuild it.
  const [typing] = useState(() => createTypingSender(sendTyping));
  /** When this bar's last lines went out (performance.now()), newest last — for paceSend. */
  const sentAt = useRef<number[]>([]);
  /** A line held back by the pace: until when (ms; null = none), and the timer that ends the hold. */
  const heldUntil = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 0 = nothing held; otherwise the number of refused presses so far (re-keys the note, replaying its nudge). */
  const [held, setHeld] = useState(0);
  /** Safari's IME Enter (chatBar.ts sendAfterIme): a composition is open; a send is queued; the queued send waits for
   *  the composition to end; when the last such send went (performance.now()). */
  const composing = useRef(false);
  const imeQueued = useRef(false);
  const imeAfterEnd = useRef(false);
  const imeSentAt = useRef<number | null>(null);
  /** What the composition that just ended committed (null: none since the last key) — chatBar.ts lastCommit. */
  const lastCommit = useRef<string | null>(null);
  const layout = useTouchHudLayout();

  /** One event around a leave tap: the new tap, its fallback timer, and whether the HUD stays in its chat layout. */
  const leaveEvent = useCallback((ev: LeaveTapEvent) => {
    const step = leaveTapStep(leaveTap.current, ev);
    leaveTap.current = step.tap;
    if (step.timerMs !== undefined) {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      leaveTimer.current = step.timerMs === null ? null : setTimeout(() => leaveEvent({ type: "timeout" }), step.timerMs);
    }
    setLeaving(step.tap !== null);
  }, []);

  /** The HUD's chat layout: while the field has the caret, and until the tap that took it out is over. */
  const chatLayout = focused || leaving;

  // Touch only: while in the chat layout, mark <html> with FOCUS_CLASS (the emoji fan, action and jump buttons hide via
  // CSS; the 💬 button is unmounted below).
  useEffect(() => {
    if (!chatLayout || !isTouchDevice) return;
    const root = document.documentElement;
    root.classList.add(FOCUS_CLASS);
    return () => root.classList.remove(FOCUS_CLASS);
  }, [chatLayout]);

  // Soft-keyboard handling (touch only): while focused, track the
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
    const stop = trackKbdInset();
    return () => {
      stop();
      document.documentElement.style.setProperty(KBD_INSET_VAR, "0px");
    };
  }, [focused]);

  // Enter or `/` (the shared hotkey table's openChat) focuses the input, and so does a typed key
  // (typeToChat). The table already drops the key while another UI field owns the keyboard —
  // without that, pressing Enter inside another text field (e.g. the admin announce textarea,
  // which sets the same capture flag) would steal focus to the chat bar instead of inserting a
  // newline — and cancels the browser default of Enter / `/` once for all subscribers, which is
  // also why the `/` that opens chat is never typed into the field. typeToChat is NOT cancelled:
  // the focus moves during the keydown, so the character the key types lands in the field — after
  // the letter of a held M / B (`prefix`, "ㅡㅡ" / "my"), put in at the caret first.
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
      if (action.type !== "typeToChat" || !action.prefix) return;
      const end = input.value.length;
      const r = insertPrefix(input.value, input.selectionStart ?? end, input.selectionEnd ?? end, action.prefix, CHAT_MAX_LENGTH);
      if (!r) return;
      input.value = r.value;
      input.setSelectionRange(r.caret, r.caret);
      setValue(r.value);
      typing.onInput(performance.now(), hasChatText(r.value));
    });
  }, [typing]);

  // A press anywhere outside the bar takes the caret out of the field. Capture phase on the
  // document, so it runs before (and whatever) the pressed element does: the canvas, a HUD
  // button that cancels its own press to keep a caret, a menu. The press itself goes on as usual.
  // The HUD keeps its chat layout until that press is over (leaveTapStep): its pointerup, its click
  // (capture phase on the window too — whatever the target does with it), a cancel.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      if (!pressLeavesChat(e.target, barRef.current)) return;
      leaveEvent({ type: "press", pointerId: e.pointerId }); // first: the blur's render already keeps the layout
      input.blur();
    };
    const onUp = (e: PointerEvent) => leaveEvent({ type: "pointerup", pointerId: e.pointerId });
    const onCancel = (e: PointerEvent) => leaveEvent({ type: "pointercancel", pointerId: e.pointerId });
    const onClick = () => leaveEvent({ type: "click" });
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("click", onClick, true);
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
      leaveTap.current = null;
    };
  }, [leaveEvent]);

  // Release the UI-capture flag if this input unmounts WHILE focused. A reconnect
  // (epoch bump → WorldScene remount) or a kick removes the focused field from
  // the DOM, and browsers fire no blur for a removed element — so onBlur never
  // runs and the flag would otherwise strand `true`, killing WASD/Enter/emoji.
  useEffect(() => captureReleaseEffect("chat"), []);

  // Same for the typing indicator: an input that unmounts while ON (reconnect
  // remount, kick) fires no blur, so tell the others it stopped.
  useEffect(() => () => typing.stop(), [typing]);

  // A hold that outlives the bar must not set state on an unmounted component.
  useEffect(
    () => () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    },
    [],
  );

  /** The pace lets lines go again: the note goes, the send button lights up (when there is text). */
  function endHold() {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    heldUntil.current = null;
    setHeld(0);
  }

  /**
   * Send the line in the field (if it has any text) and clear it; true when it went. The caret stays where it is.
   * Too fast for the server: the line stays in the field, held until it may go (the note, the dimmed button).
   */
  function send(): boolean {
    const input = inputRef.current;
    // The field itself is the truth: it already holds a syllable an IME is still composing.
    const line = input ? input.value : value;
    if (!hasChatText(line)) return false; // a blank line goes nowhere (the dimmed button)
    const now = performance.now();
    const pace = paceSend(sentAt.current, now, heldUntil.current);
    if (!pace.send) {
      // The server would drop it: keep the line in the field (and the "…" on) and say why — in the log once per hold.
      if (pace.notice) useChatStore.getState().pushSystem(CHAT_TOO_FAST);
      const until = pace.until ?? now;
      heldUntil.current = until;
      setHeld((n) => n + 1);
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(endHold, Math.max(0, until - now));
      return false;
    }
    if (heldUntil.current !== null) endHold();
    sentAt.current = [...sentAt.current, now].slice(-CHAT_RATE.count);
    typing.stop(); // OFF first, so the receivers drop the "…" before the bubble lands
    sendChat(line); // trims; server is authoritative
    useCoachStore.getState().report("talked"); // ③ of the first-visit guide
    if (input) input.value = ""; // at once, even if React's copy of the line lagged behind the field
    setValue("");
    return true;
  }

  /** The queued send of Safari's IME Enter: now, unless a composition is (still) open — then when it ends. */
  function runImeSend() {
    if (composing.current) {
      imeAfterEnd.current = true;
      return;
    }
    imeQueued.current = false;
    if (send()) imeSentAt.current = performance.now();
  }

  const collapsed = isTouchDevice && !focused;
  const ready = hasChatText(value) && held === 0;

  return (
    <>
      {isTouchDevice && !chatLayout && (
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
        // A press on the bar around the field (its padding, the counter, the note, the send button)
        // keeps the caret; a click there puts it in the field (PC: the bar is visible unfocused too).
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
        {held > 0 && (
          // Re-keyed on every refused press, so its nudge replays: the press did something.
          <div key={held} className="cv-chat-note" role="status">
            {CHAT_TOO_FAST}
          </div>
        )}
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
            leaveEvent({ type: "focus" }); // back in the chat: no leave tap pending any more
          }}
          onBlur={() => {
            releaseUiCapture("chat");
            setFocused(false);
            typing.stop();
            // A blur ends any composition; a send still waiting for its end goes now (or not at all, if blank).
            composing.current = false;
            if (imeAfterEnd.current) {
              imeAfterEnd.current = false;
              runImeSend();
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
            lastCommit.current = null;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            lastCommit.current = e.data ?? "";
            if (!imeAfterEnd.current) return;
            imeAfterEnd.current = false;
            setTimeout(runImeSend, 0); // after the input event that brings the committed syllable
          }}
          onChange={(e) => {
            const next = e.target.value.slice(0, CHAT_MAX_LENGTH);
            setValue(next);
            typing.onInput(performance.now(), next.trim().length > 0);
          }}
          onKeyDown={(e) => {
            const act = chatKeyAction(
              // the IME finishes first; a held key acts once; one press never acts twice
              { key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode, repeat: e.repeat },
              e.currentTarget.value,
              {
                imeSendQueued: imeQueued.current,
                sinceImeSend: imeSentAt.current === null ? undefined : performance.now() - imeSentAt.current,
                lastCommit: lastCommit.current ?? undefined,
              },
            );
            lastCommit.current = null; // it speaks for the one key right after the commit only
            if (act === null) return;
            e.preventDefault(); // consumed: the hotkey table must not also open the chat / the menu
            if (act === "consume") {
              e.stopPropagation(); // the IME's own Escape: it never reaches the window (the menu key), the chat stays
              return;
            }
            if (act === "send") send();
            else if (act === "sendAfterIme") {
              // Safari: the syllable was committed before this keydown — send once the IME's input event is in.
              imeQueued.current = true;
              setTimeout(runImeSend, 0);
            } else e.currentTarget.blur();
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
          onClick={() => send()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3.4 20.1 21.2 12.6a.65.65 0 0 0 0-1.2L3.4 3.9a.6.6 0 0 0-.83.7L4.9 11.2l8.1.8-8.1.8-2.33 6.6a.6.6 0 0 0 .83.7Z" />
          </svg>
        </button>
      </div>
    </>
  );
}
