import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { ENTER_GIVE_UP_MS, holdRemainingMs, useEnterTransition } from "../enterTransition";
import "../escape.css";

/** The fade-out after the minimum time (ms) — matches the CSS transition. */
const FADE_MS = 260;

/**
 * "상담실로 들어가는 중…" (AI 학교 탈출, Task 17): the card that covers the hall while the team's
 * ticket is turned into a classroom connection. It rises when the ticket arrives (classSync
 * `begin`), stays at least ENTER_MIN_MS (600 ms) so it never flashes, and — once the classroom
 * scene has been asked for (`ready`) — fades out to show the classroom that has been mounting
 * underneath. A failed join drops it at once (`end`); so does leaving the class and a join that
 * takes far too long.
 *
 * Mounted once, in App, outside the scenes: the hall scene goes down and the classroom scene comes
 * up while this stays put.
 */
export function LoadingTransition() {
  const phase = useEnterTransition((s) => s.phase);
  const label = useEnterTransition((s) => s.label);
  const startedAt = useEnterTransition((s) => s.startedAt);
  const screen = useAppStore((s) => s.screen);
  const [leaving, setLeaving] = useState(false);

  // Ready: hold until the minimum time is over, fade, then drop the card.
  useEffect(() => {
    setLeaving(false);
    if (phase !== "ready") return;
    const hold = holdRemainingMs(startedAt, performance.now());
    const fade = window.setTimeout(() => setLeaving(true), hold);
    const done = window.setTimeout(() => useEnterTransition.getState().end(), hold + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [phase, startedAt]);

  // A join that never finishes must not keep the screen covered.
  useEffect(() => {
    if (phase !== "joining") return;
    const id = window.setTimeout(() => useEnterTransition.getState().end(), ENTER_GIVE_UP_MS);
    return () => window.clearTimeout(id);
  }, [phase, startedAt]);

  // Back at the entry screen (the class ended or we were kicked): nothing to walk into.
  useEffect(() => {
    if (screen === "entry") useEnterTransition.getState().end();
  }, [screen]);

  if (phase === "idle") return null;
  return (
    <div className={"cv-escui cv-esc-loading" + (leaving ? " is-leaving" : "")} role="status" aria-live="polite">
      <div className="cv-esc-loading-title">AI 학교 탈출</div>
      <div className="cv-esc-loading-text">{label}</div>
      <div className="cv-esc-loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
