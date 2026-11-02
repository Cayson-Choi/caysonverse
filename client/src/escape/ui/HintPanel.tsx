import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EscapeMsg } from "@caysonverse/shared/escape/messages";
import { isTouchDevice } from "../../device";
import { sendEscape } from "../../net/connection";
import { useEscapeStore } from "../../stores/escapeStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { popOverlay, pushOverlay } from "../../ui/overlayStack";
import { useTouchHudLayout } from "../../ui/useTouchHudLayout";
import { escapeActionsLive } from "../escapeTargets";
import { useFinaleStore } from "../finaleStore";
import { BanditAvatar } from "./DialogueBox";
import { HINT_CONFIRM_TEXT, HINT_START, circled, hintButtonState, hintReducer, hintWaitS, type HintState } from "./finale";
import "../escape.css";
import "../finale.css";

/** The confirm question's id on the overlay stack (Esc answers "아니요"). */
const HINT_OVERLAY_ID = "hint";
/** The server never answers a hint it drops (paused, out of order): the button comes back after this long. */
const REQUEST_WAIT_MS = 3000;
/** The wait counter on the button repaints this often while it counts down. */
const COUNT_TICK_MS = 250;
/** Gap between the top-right button row and the hint button (phone). */
const TOUCH_GAP_PX = 8;

const NO_HINTS: readonly string[] = Object.freeze([]);

/**
 * What the hint button knows: the stage's hint count and wait (from the room's `hint` / `hintWait` / `hintMax`
 * events — finale.ts keeps the rules), a request in flight, and a clock that repaints the wait while it runs.
 * Lives as long as the panel does, so it sees every event; a hint that is still on its way when the team has
 * escaped or the class has ended is ignored.
 */
function useHintState(): { hint: HintState; waitS: number; pending: boolean; begin: () => void } {
  const [hint, setHint] = useState<HintState>(HINT_START);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    let seen = useEscapeStore.getState().eventSeq;
    return useEscapeStore.subscribe((s) => {
      if (s.eventSeq === seen) return;
      seen = s.eventSeq;
      const ev = s.lastEvent;
      if (ev === null) return;
      const phase = s.view?.phase;
      if (phase === "escaped" || phase === "ended") return;
      if (ev.e === "hint" || ev.e === "hintWait" || ev.e === "hintMax") setPending(false);
      const t = performance.now();
      setNow(t);
      setHint((h) => hintReducer(h, ev, t));
    });
  }, []);

  // A request nobody answered: let the button come back.
  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => setPending(false), REQUEST_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [pending]);

  // While a wait runs, repaint it a few times a second (discrete UI work, not per frame).
  const { tier, waitUntil } = hint;
  useEffect(() => {
    if (tier <= 0 || performance.now() >= waitUntil) return;
    const id = window.setInterval(() => {
      const t = performance.now();
      setNow(t);
      if (t >= waitUntil) window.clearInterval(id);
    }, COUNT_TICK_MS);
    return () => window.clearInterval(id);
  }, [tier, waitUntil]);

  const begin = (): void => {
    setPending(true);
    sendEscape(EscapeMsg.HintRequest, {});
  };
  return { hint, waitS: hintWaitS(hint, now), pending, begin };
}

/**
 * Bandit's hint button (AI 학교 탈출, Task 20), top right under the HUD's button row: his portrait, a badge
 * with the hints the team has had, and — on a PC — what the button does now ("힌트 받기", "다음 힌트까지 n초",
 * "힌트를 모두 받았어요"). A phone has the portrait and the wait counter only (the words are in the card).
 *
 * A tap opens Bandit's card: the hints the team has received so far (① ② ③ …, the room's own list, so a
 * teammate who joined late reads them too), how many were used, and the ask button. The ask always goes
 * through the question "힌트를 쓰면 별이 줄 수 있어요. 받을까요?" — a hint can lower the stars. The hint itself
 * comes back as the room's `hint` event: Bandit says it in the story box (dialogueFeed.ts) and it joins the list.
 *
 * It is on screen from the intro to the end of the game (hidden once the team has escaped, and while the time
 * is up). It floats above the last-door panel, so a team that is stuck there can still ask.
 */
export function HintPanel() {
  const phase = useEscapeStore((s) => s.view?.phase ?? null);
  const live = useEscapeStore((s) => s.view !== null && escapeActionsLive(s.view));
  const used = useEscapeStore((s) => s.view?.hintsUsed ?? 0);
  const count = useEscapeStore((s) => s.view?.hints.length ?? 0);
  const hints = useMemo(() => useEscapeStore.getState().view?.hints ?? NO_HINTS, [count]);
  const finaleOpen = useFinaleStore((s) => s.open);
  const { hint, waitS, pending, begin } = useHintState();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const layout = useTouchHudLayout();
  const mirrored = useSettingsStore((s) => s.settings.leftHanded) && isTouchDevice;

  const shown = phase === "intro" || phase === "play" || phase === "finale";
  const state = hintButtonState({ tierInStage: hint.tier, waitS, maxed: hint.maxed });
  const canAsk = state.enabled && live && !pending;

  // Gone from the screen (escaped, time up, class over): close whatever was open.
  useEffect(() => {
    if (shown) return;
    setOpen(false);
    setConfirm(false);
  }, [shown]);

  // The question is an overlay for as long as it is up: Esc answers "아니요", WASD and E stay out of the scene.
  useEffect(() => {
    if (!confirm) return;
    pushOverlay(HINT_OVERLAY_ID, () => setConfirm(false));
    yesRef.current?.focus({ preventScroll: true });
    return () => popOverlay(HINT_OVERLAY_ID);
  }, [confirm]);

  // A tap outside the card closes it (not while the question is up: that one is answered).
  useEffect(() => {
    if (!open || confirm) return;
    const away = (e: PointerEvent): void => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, confirm]);

  // The newest hint is at the bottom of the card: keep it in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count, open]);

  // The hint asked for has come (or been refused): the question is over.
  useEffect(() => {
    if (!canAsk) setConfirm(false);
  }, [canAsk]);

  if (!shown) return null;

  const g = layout.topGroup;
  const size = layout.topPx;
  const style = isTouchDevice
    ? { left: mirrored ? g.x : g.x + g.w - size, top: g.y + g.h + TOUCH_GAP_PX, "--cv-hint-size": `${size}px` }
    : undefined;

  const ask = (): void => {
    setConfirm(false);
    begin();
  };

  return (
    <div
      ref={rootRef}
      className={"cv-escui cv-hint" + (isTouchDevice ? " is-touch" : "") + (mirrored ? " is-mirrored" : "") + (finaleOpen ? " is-over" : "")}
      style={style as CSSProperties | undefined}
    >
      {open && (
        <div className="cv-hint-card" role="dialog" aria-label="반딧의 힌트">
          <div className="cv-hint-card-head">
            <span className="cv-hint-card-face" aria-hidden="true">
              <BanditAvatar />
            </span>
            <strong className="cv-hint-card-title">반딧의 힌트</strong>
            <button type="button" className="cv-hint-x" onClick={() => setOpen(false)} aria-label="닫기">
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          {hints.length === 0 ? (
            <p className="cv-hint-empty">아직 받은 힌트가 없어요. 막히면 반딧에게 물어봐요!</p>
          ) : (
            <ol ref={listRef} className="cv-hint-list">
              {hints.map((h, i) => (
                <li key={i} className="cv-hint-item">
                  <span className="cv-hint-no" aria-hidden="true">
                    {circled(i + 1)}
                  </span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="cv-hint-used">힌트를 {used}번 썼어요</p>

          {confirm ? (
            <div className="cv-hint-confirm" role="alertdialog" aria-label={HINT_CONFIRM_TEXT}>
              <p className="cv-hint-confirm-text">{HINT_CONFIRM_TEXT}</p>
              <div className="cv-hint-confirm-row">
                <button ref={yesRef} type="button" className="cv-hint-btn is-primary" onClick={ask}>
                  받을게요
                </button>
                <button type="button" className="cv-hint-btn" onClick={() => setConfirm(false)}>
                  아니요
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="cv-hint-btn is-primary cv-hint-ask" disabled={!canAsk} onClick={() => setConfirm(true)}>
              {pending ? "반딧이 찾는 중…" : state.label}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className={"cv-hint-fab" + (open ? " is-open" : "") + (canAsk ? " is-ready" : "")}
        aria-expanded={open}
        aria-label={`반딧 힌트, ${state.label}, 받은 힌트 ${count}개`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cv-hint-face">
          <BanditAvatar />
          {count > 0 && (
            <span className="cv-hint-badge" key={count} aria-hidden="true">
              {count}
            </span>
          )}
          {waitS > 0 && !state.enabled && !hint.maxed && (
            <span className="cv-hint-wait" aria-hidden="true">
              {waitS}
            </span>
          )}
        </span>
        <span className="cv-hint-text">
          <span className="cv-hint-name">반딧</span>
          <span className="cv-hint-state">{pending ? "반딧이 찾는 중…" : state.label}</span>
        </span>
      </button>
    </div>
  );
}
