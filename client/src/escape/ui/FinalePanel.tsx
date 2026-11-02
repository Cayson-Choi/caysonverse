import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FINALE_COOLDOWN_MS } from "@caysonverse/shared/escape/constants";
import { EscapeMsg, type RoomContent } from "@caysonverse/shared/escape/messages";
import { isTouchDevice } from "../../device";
import { getEscapeRoom, sendEscape } from "../../net/connection";
import { useEscapeStore } from "../../stores/escapeStore";
import { FOCUSABLE_SELECTOR, tabWrapTarget } from "../../ui/focusTrap";
import { popOverlay, pushOverlay } from "../../ui/overlayStack";
import type { DialogueQueue } from "../dialogue";
import { useFinaleStore } from "../finaleStore";
import { AriFace } from "./AriFace";
import { FINALE_GUIDE, cooldownText, voteChips, voteProgress } from "./finale";
import "../escape.css";
import "../finale.css";

/** The panel's id on the overlay stack (Esc closes the top one). */
export const FINALE_OVERLAY_ID = "finale";
/**
 * The last door's panel waits for the story box to finish ("이제 마지막 문에서 아리를 설득해 봐요"), but never
 * shorter than MIN (the room's story events follow the state patch by a moment) and never longer than MAX.
 */
const OPEN_MIN_WAIT_MS = 700;
const OPEN_MAX_WAIT_MS = 6500;
const OPEN_POLL_MS = 150;
/** The "맞았어요!" note stays this long after a step was got right. */
const RIGHT_NOTE_MS = 2000;
const COOLDOWN_TOTAL_S = FINALE_COOLDOWN_MS / 1000;

const closeFinale = (): void => useFinaleStore.getState().setOpen(false);

const NO_VOTES: Readonly<Record<string, string>> = Object.freeze({});

function firstStepId(content: RoomContent | null): string {
  return content?.finale.steps[0]?.id ?? "";
}

/**
 * Keep the panel's state in step with the room (mounted for the scene's whole life, so no event is missed):
 *  - the room's events go to the finale store (a wrong card, a step got right, the first try),
 *  - the panel opens by itself once the last door is ready — after the story box has finished — for everyone,
 *    and closes when the game leaves the last door (escape, time up).
 * A player who closed the panel stays closed until the next result or until they press the door.
 */
function useFinaleFeed(queue: DialogueQueue): void {
  const phase = useEscapeStore((s) => s.view?.phase ?? null);

  useEffect(() => {
    useFinaleStore.getState().reset();
    return () => useFinaleStore.getState().reset();
  }, []);

  useEffect(() => {
    let seen = useEscapeStore.getState().eventSeq;
    return useEscapeStore.subscribe((s) => {
      if (s.eventSeq === seen) return;
      seen = s.eventSeq;
      if (s.lastEvent !== null) useFinaleStore.getState().onEvent(s.lastEvent, firstStepId(s.content));
    });
  }, []);

  useEffect(() => {
    const finale = useFinaleStore.getState();
    if (phase !== "finale") {
      finale.setOpen(false);
      return;
    }
    if (finale.open) return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const waited = performance.now() - t0;
      if (waited < OPEN_MIN_WAIT_MS) return;
      if (queue.size() === 0 || waited >= OPEN_MAX_WAIT_MS) {
        window.clearInterval(id);
        finale.setOpen(true);
      }
    }, OPEN_POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, queue]);
}

/** My own vote, the votes and who is here, as values that only change when they really do (the store makes new objects every second). */
function useVotes(): { votes: Readonly<Record<string, string>>; members: { sid: string; nickname: string }[] } {
  const votesJson = useEscapeStore((s) => JSON.stringify(s.view?.votes ?? NO_VOTES));
  const membersJson = useEscapeStore((s) => JSON.stringify(s.view?.members ?? []));
  const votes = useMemo(() => JSON.parse(votesJson) as Record<string, string>, [votesJson]);
  const members = useMemo(() => JSON.parse(membersJson) as { sid: string; nickname: string }[], [membersJson]);
  return { votes, members };
}

function FinaleCard() {
  const content = useEscapeStore((s) => s.content);
  const stepIndex = useEscapeStore((s) => s.view?.finaleStep ?? 0);
  const cooldownS = useEscapeStore((s) => s.view?.cooldownS ?? 0);
  const paused = useEscapeStore((s) => s.view?.paused ?? false);
  const { votes, members } = useVotes();
  const wrong = useFinaleStore((s) => s.wrong);
  const rightSeq = useFinaleStore((s) => s.rightSeq);
  const [note, setNote] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const steps = content?.finale.steps ?? [];
  const step = steps[stepIndex] ?? null;
  const me = getEscapeRoom()?.sessionId ?? "";
  const chips = useMemo(() => voteChips(votes, members), [votes, members]);
  const progress = useMemo(() => voteProgress(votes, members), [votes, members]);
  const myVote = Object.prototype.hasOwnProperty.call(votes, me) ? votes[me] : null;
  const locked = cooldownS > 0 || paused;
  // The explanation of the card the team just got wrong stays until somebody chooses again.
  const wrongNow = wrong !== null && step !== null && wrong.stepId === step.id && progress.chosen === 0 ? wrong : null;

  // On the overlay stack for as long as it is open: Esc closes the top one, the keyboard belongs to it.
  useEffect(() => {
    pushOverlay(FINALE_OVERLAY_ID, closeFinale);
    dialogRef.current?.focus({ preventScroll: true });
    return () => popOverlay(FINALE_OVERLAY_ID);
  }, []);

  // A disabled card (the cooldown, a pause, the wrong card after a vote) takes focus with it, and key events
  // then never reach this dialog. Bring focus back to the dialog when it has been lost, so 1-9, the arrows and
  // the Tab trap keep working. A focus that is on a live control inside the dialog is left alone.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement;
    const lost = !active || !dialog.contains(active) || (active as HTMLButtonElement).disabled === true;
    if (lost) dialog.focus({ preventScroll: true });
  }, [locked, wrongNow]);

  // A step got right: say so for a moment (the next question is already up).
  useEffect(() => {
    if (rightSeq === 0) return;
    setNote(true);
    const id = window.setTimeout(() => setNote(false), RIGHT_NOTE_MS);
    return () => window.clearTimeout(id);
  }, [rightSeq]);

  const choose = (optionId: string): void => {
    if (locked || optionId === myVote) return;
    sendEscape(EscapeMsg.Vote, { optionId });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (e.key === "Tab") {
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const target = tabWrapTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (target !== null) {
        e.preventDefault();
        items[target].focus();
      }
      return;
    }
    if (step === null) return;
    // 1, 2, 3 … choose the card with that number.
    if (e.key.length === 1 && e.key >= "1" && e.key <= "9") {
      const option = step.options[Number(e.key) - 1];
      if (option) {
        e.preventDefault();
        // A held key repeats: one press is one vote.
        if (e.repeat) return;
        choose(option.id);
      }
      return;
    }
    // ↑ ↓ walk the cards.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const cards = Array.from(cardsRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
      if (cards.length === 0) return;
      e.preventDefault();
      const at = cards.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? at + 1 : at - 1;
      cards[(next + cards.length) % cards.length].focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      className="cv-escui cv-fin"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cv-fin-claim"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="cv-fin-backdrop" onClick={closeFinale} />
      <div className="cv-fin-panel">
        <div className="cv-fin-head">
          <div className="cv-fin-ari">
            <AriFace expression="think" size={isTouchDevice ? 52 : 76} />
          </div>
          <div className="cv-fin-claim">
            <div className="cv-fin-who">아리의 주장</div>
            <p id="cv-fin-claim" className="cv-fin-claim-text">
              {content?.finale.claim ?? ""}
            </p>
          </div>
          <button type="button" className="cv-fin-close" onClick={closeFinale} aria-label="닫기">
            <span aria-hidden="true">✕</span>
            {!isTouchDevice && <kbd aria-hidden="true">Esc</kbd>}
          </button>
        </div>

        {step !== null && (
          <>
            <div className="cv-fin-step">
              <span className="cv-fin-stepno">
                {stepIndex + 1}/{steps.length}
              </span>
              <h2 className="cv-fin-prompt">{step.prompt}</h2>
            </div>

            {note && (
              <div className="cv-fin-right" role="status" key={rightSeq}>
                <span aria-hidden="true">✔</span> 맞았어요! 다음 질문이에요
              </div>
            )}

            {wrongNow !== null && (
              <p className="cv-fin-explain" role="status">
                <b className="cv-fin-explain-mark" aria-hidden="true">
                  ✕
                </b>{" "}
                {wrongNow.explain !== "" ? wrongNow.explain : "아직 아니에요. 다시 생각해 봐요."}
              </p>
            )}

            {cooldownS > 0 && (
              <div className="cv-fin-cool" role="status">
                <span>{cooldownText(cooldownS)}</span>
                <i style={{ transform: `scaleX(${Math.min(1, cooldownS / COOLDOWN_TOTAL_S)})` }} />
              </div>
            )}

            <div ref={cardsRef} className="cv-fin-cards" role="group" aria-label={step.prompt}>
              {step.options.map((o, i) => {
                const names = chips[o.id] ?? [];
                const mine = myVote === o.id;
                const bad = wrongNow !== null && wrongNow.optionId === o.id;
                return (
                  <div className="cv-fin-slot" key={o.id}>
                    <button
                      type="button"
                      className={"cv-fin-card" + (mine ? " is-mine" : "") + (bad ? " is-wrong" : "") + (names.length > 0 ? " has-votes" : "")}
                      aria-pressed={mine}
                      disabled={locked}
                      onClick={() => choose(o.id)}
                    >
                      <span className="cv-fin-no" aria-hidden="true">
                        {bad ? "✕" : i + 1}
                      </span>
                      <span className="cv-fin-body">
                        <span className="cv-fin-label">{o.label}</span>
                        {o.desc !== undefined && o.desc !== "" && <span className="cv-fin-desc">{o.desc}</span>}
                      </span>
                      <span className="cv-fin-chips">
                        {names.map((n) => (
                          <span className="cv-fin-chip" key={n}>
                            {n}
                          </span>
                        ))}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {cooldownS === 0 && (
              <p className="cv-fin-guide">
                {FINALE_GUIDE}
                {progress.total > 0 && (
                  <span className="cv-fin-count">
                    {" "}
                    · {progress.chosen}/{progress.total}명이 골랐어요
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The last door (AI 학교 탈출, Task 20): Ari's claim, this step's question and the answer cards, each with
 * the nicknames of the teammates who chose it. When everyone has chosen the same card the room judges it:
 * a wrong card shows its explanation and the team waits for the cooldown (cards locked, "n초 뒤에 다시 고를
 * 수 있어요"); a right one moves on to the next question, and after the last one the team escapes.
 *
 * It opens by itself for the whole team when the last door is ready, closes with Esc / ✕ / a tap outside, and
 * opens again from the door's button, on a wrong card and on a step got right. Keys 1–9 choose a card, ↑ ↓
 * walk them. It is on the overlay stack, so the digits and E do not reach the room behind it.
 */
export function FinalePanel({ queue }: { queue: DialogueQueue }) {
  useFinaleFeed(queue);
  const open = useFinaleStore((s) => s.open);
  const inFinale = useEscapeStore((s) => s.view?.phase === "finale");
  if (!open || !inFinale) return null;
  return <FinaleCard />;
}
