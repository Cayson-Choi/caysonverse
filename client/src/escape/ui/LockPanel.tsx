import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { LOCK_SUBMIT_GAP_MS } from "@caysonverse/shared/escape/constants";
import { EscapeMsg, type PublicLock } from "@caysonverse/shared/escape/messages";
import { sendEscape } from "../../net/connection";
import { useEscapeStore } from "../../stores/escapeStore";
import { DigitsLock } from "./DigitsLock";
import { LettersLock } from "./LettersLock";
import { SortBoard } from "./SortBoard";
import { fitValue, wrongText } from "./lockInput";
import { useLockInputSender, useOverrides } from "./useLockState";
import "../escape.css";

const NO_BOARD: Readonly<Record<string, string>> = Object.freeze({});
/** Shown instead of the board while the cards it needs are not in the team bag. */
const NEED_CARDS_TEXT = "캐비닛에서 카드를 먼저 꺼내요";

/**
 * A lock's plate inside the close-up (AI 학교 탈출, Task 19): the lock's words, the kind of lock it is
 * (number wheels, letter wheels or the sorting board) and the "열기" button.
 *
 * Everything on it is the TEAM's shared state: the wheels and the board show what the server holds (a
 * teammate's turn moves them here), and a change the player makes is sent as `LockInput` / `BoardPlace`.
 * "열기" sends the waiting input and then `LockSubmit`; the answer comes back as the room's `wrong` event
 * (the plate shakes and says how it went — the server's count for a sort board, never worked out here) or
 * as the lock opening, which the close-up learns from its own refresh. Nothing here knows an answer.
 *
 * Keyed by lock id by its parent: a second lock on the same object (the sort board's cover, then its
 * cards) is a new plate.
 */
export function LockPanel({ lock }: { lock: PublicLock }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef(0);

  // Primitives / shallow-stable selectors only: the store's view is rebuilt every second (the clock).
  const serverInput = useEscapeStore((s) => s.view?.lockInput[lock.id]);
  const serverBoard = useEscapeStore(useShallow((s) => s.view?.board ?? NO_BOARD));
  const needsItem = lock.kind === "sort" ? lock.needsItem : undefined;
  const haveItem = useEscapeStore((s) => needsItem === undefined || (s.view?.bag.includes(needsItem) ?? false));

  // The wheel locks: the shared input as the server holds it, with the player's own change on top until it echoes.
  const wheelCount = lock.kind === "digits" ? lock.length : lock.kind === "letters" ? lock.wheels.length : 0;
  const fromServer = fitValue(serverInput, wheelCount);
  const serverRecord = useMemo(() => ({ v: fromServer }), [fromServer]);
  const { get, set } = useOverrides(serverRecord);
  const value = get("v", fromServer);
  const { send, flush } = useLockInputSender(lock.id);

  const change = (next: string): void => {
    set("v", next);
    send(next);
    setMessage("");
  };

  // The team's `wrong` event for this lock: shake the plate and say how it went.
  useEffect(() => {
    let seen = useEscapeStore.getState().eventSeq;
    return useEscapeStore.subscribe((s) => {
      if (s.eventSeq === seen) return;
      seen = s.eventSeq;
      const ev = s.lastEvent;
      if (ev === null || ev.e !== "wrong" || ev.lockId !== lock.id) return;
      setMessage(wrongText(ev));
      const el = rootRef.current;
      if (el) {
        el.classList.remove("is-shake");
        void el.offsetWidth; // restart the animation when it was still running
        el.classList.add("is-shake");
      }
    });
  }, [lock.id]);

  useEffect(() => () => window.clearTimeout(coolTimer.current), []);

  const submit = (): void => {
    if (cooling) return;
    flush(); // the server judges the input it holds: send the last turn first
    sendEscape(EscapeMsg.LockSubmit, { lockId: lock.id });
    setMessage("");
    // The server counts presses within LOCK_SUBMIT_GAP_MS as one: the button rests that long.
    setCooling(true);
    coolTimer.current = window.setTimeout(() => setCooling(false), LOCK_SUBMIT_GAP_MS);
    // Keep the keyboard on the lock (the button was just clicked).
    rootRef.current?.querySelector<HTMLElement>("[data-lock-focus]")?.focus({ preventScroll: true });
  };

  const needCards = lock.kind === "sort" && !haveItem;
  let body: ReactElement;
  switch (lock.kind) {
    case "digits":
      body = <DigitsLock value={value} onChange={change} onSubmit={submit} />;
      break;
    case "letters":
      body = <LettersLock wheels={lock.wheels} value={value} onChange={change} onSubmit={submit} />;
      break;
    case "sort":
      body = needCards ? (
        <p className="cv-lock-need" role="status">
          {NEED_CARDS_TEXT}
        </p>
      ) : (
        <SortBoard lockId={lock.id} bins={lock.bins} cards={lock.cards} server={serverBoard} />
      );
      break;
  }

  return (
    <div
      ref={rootRef}
      className={"cv-lock is-" + lock.kind}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove("is-shake");
      }}
    >
      <p className="cv-lock-plate">{lock.plate}</p>
      {body}
      <p className={"cv-lock-msg" + (message !== "" ? " is-on" : "")} role="status" aria-live="polite">
        {message}
      </p>
      {!needCards && (
        <button
          type="button"
          className="cv-insp-btn is-primary cv-lock-open"
          disabled={cooling}
          // Like the other buttons of the close-up: a click must not take the keyboard off the wheels.
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
        >
          열기
        </button>
      )}
    </div>
  );
}
