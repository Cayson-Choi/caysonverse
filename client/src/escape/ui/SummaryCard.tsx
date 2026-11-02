import { useEffect, useRef, type CSSProperties } from "react";
import type { EscapedEvent } from "@caysonverse/shared/escape/messages";
import { useEscapeStore } from "../../stores/escapeStore";
import { popOverlay, pushOverlay } from "../../ui/overlayStack";
import { prefersReducedMotion } from "../reducedMotion";
import { useFinaleStore } from "../finaleStore";
import { AriFace } from "./AriFace";
import { circled, elapsedText, firstTryText } from "./finale";
import "../escape.css";
import "../finale.css";

/** The card's id on the overlay stack. It has no way out but its button, so its own Esc does nothing. */
export const SUMMARY_OVERLAY_ID = "summary";
const STARS = 3;
const NOT_CLOSABLE = (): void => {};

/** The confetti, made once: a fixed set of pieces (the same every time, no randomness at render). */
interface Piece {
  left: number;
  delay: number;
  fall: number;
  drift: number;
  spin: number;
  size: number;
  color: string;
}
const CONFETTI_COLORS = ["#8B5CF6", "#4B4FD8", "#FFC857", "#FF8FA9", "#5BBF7A", "#3FA7D6", "#F29E4C"] as const;
const PIECES: readonly Piece[] = (() => {
  const out: Piece[] = [];
  let s = 20261102;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 30; i++) {
    out.push({
      left: Math.round(rnd() * 100),
      delay: Math.round(rnd() * 900) / 1000,
      fall: 2300 + Math.round(rnd() * 1500),
      drift: Math.round((rnd() - 0.5) * 160),
      spin: Math.round(360 + rnd() * 540),
      size: 6 + Math.round(rnd() * 6),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
  }
  return out;
})();

/**
 * The summary card (AI 학교 탈출, Task 20), after the story: stars, the time the team took, what it did on its
 * first try at the principle (when this player watched it), the lines to remember ① ② ③, the question to think
 * about together, where the principles come from, and the one way out — "복도로 나가기". The lines, question and
 * source are the room's own words for the class's reading level; they travel only with the `escaped` event.
 *
 * `replay` is a player who comes in after the escape (a refresh): the card at once, no confetti. Without a
 * `summary` (the escape event never came) it still offers the way out. It holds the keyboard like any overlay.
 */
export function SummaryCard({
  summary,
  replay,
  onLeave,
}: {
  summary: EscapedEvent | null;
  replay: boolean;
  onLeave: () => void;
}) {
  const teamName = useEscapeStore((s) => s.view?.teamName ?? "");
  const roomTitle = useEscapeStore((s) => s.content?.title ?? "");
  const firstTry = useFinaleStore((s) => firstTryText(s.firstTry));
  const leaveRef = useRef<HTMLButtonElement>(null);
  const confetti = !replay && !prefersReducedMotion();

  useEffect(() => {
    pushOverlay(SUMMARY_OVERLAY_ID, NOT_CLOSABLE);
    leaveRef.current?.focus({ preventScroll: true });
    return () => popOverlay(SUMMARY_OVERLAY_ID);
  }, []);

  const stars = summary === null ? 0 : Math.max(0, Math.min(STARS, Math.floor(summary.stars) || 0));
  const lines = summary?.summary.lines ?? [];
  const question = summary?.summary.question ?? "";
  const source = summary?.summary.source ?? "";

  return (
    <div className={"cv-escui cv-sum" + (replay ? " is-replay" : "")} role="dialog" aria-modal="true" aria-labelledby="cv-sum-title">
      <div className="cv-sum-backdrop" />
      {confetti && (
        <div className="cv-sum-confetti" aria-hidden="true">
          {PIECES.map((p, i) => (
            <i
              key={i}
              style={
                {
                  "--l": `${p.left}%`,
                  "--d": `${p.delay}s`,
                  "--f": `${p.fall}ms`,
                  "--x": `${p.drift}px`,
                  "--r": `${p.spin}deg`,
                  "--s": `${p.size}px`,
                  "--c": p.color,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      <div className="cv-sum-card">
        <div className="cv-sum-hero">
          <div className="cv-sum-ari">
            <AriFace expression="smile" size={88} />
          </div>
          <h2 id="cv-sum-title" className="cv-sum-title">
            {summary === null ? "탈출했어요!" : "탈출 성공!"}
          </h2>
          {(teamName !== "" || roomTitle !== "") && (
            <p className="cv-sum-team">{[teamName, roomTitle].filter((t) => t !== "").join(" · ")}</p>
          )}
        </div>

        {summary !== null && (
          <>
            <div className="cv-sum-stats">
              <div className="cv-sum-stars" role="img" aria-label={`별 ${stars}개`}>
                {Array.from({ length: STARS }, (_, i) => (
                  <span key={i} className={"cv-sum-star" + (i < stars ? " is-on" : "")} style={{ "--i": i } as CSSProperties} aria-hidden="true">
                    {i < stars ? "⭐" : "☆"}
                  </span>
                ))}
              </div>
              <div className="cv-sum-time">
                <span className="cv-sum-time-label">걸린 시간</span>
                <b className="cv-sum-time-value">{elapsedText(summary.elapsedS)}</b>
              </div>
            </div>

            {firstTry !== null && <p className="cv-sum-first">{firstTry}</p>}

            {lines.length > 0 && (
              <section className="cv-sum-sec" aria-label="핵심 세 줄">
                <h3 className="cv-sum-h">핵심 세 줄</h3>
                <ol className="cv-sum-lines">
                  {lines.map((line, i) => (
                    <li key={i}>
                      <span className="cv-sum-no" aria-hidden="true">
                        {circled(i + 1)}
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {question !== "" && (
              <section className="cv-sum-sec is-question">
                <h3 className="cv-sum-h">함께 생각해 볼 질문</h3>
                <p className="cv-sum-question">{question}</p>
              </section>
            )}

            {source !== "" && <p className="cv-sum-source">{source}</p>}
          </>
        )}

        <button ref={leaveRef} type="button" className="cv-esc-btn cv-sum-leave" onClick={onLeave}>
          복도로 나가기
        </button>
      </div>
    </div>
  );
}
