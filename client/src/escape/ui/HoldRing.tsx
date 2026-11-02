import { useEffect, useRef, useSyncExternalStore } from "react";
import { SOLO_HOLD_MS } from "@caysonverse/shared/escape/constants";
import { getHoldRing, subscribeHold, type HoldRing as HoldRingState } from "../holdSession";
import { holdProgress } from "./lockInput";
import "../escape.css";

/** The ring is drawn on a 100-unit circle of radius 44. */
const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The arc moves in this many steps over the hold (a repaint only when it moves a step, not every frame). */
const STEPS = 120;

/** The filling ring itself. Mounted when the server confirms the hold, gone when it stops. */
function Ring({ ring }: { ring: HoldRingState }) {
  const arc = useRef<SVGCircleElement>(null);

  // Frame data never goes through React state: one requestAnimationFrame loop writes the arc straight to the DOM,
  // and only when it has moved a step. It stops at full (the server's `coopDone` takes the ring away).
  useEffect(() => {
    let frame = 0;
    let lastStep = -1;
    const tick = (): void => {
      const p = holdProgress(ring.since, performance.now(), SOLO_HOLD_MS);
      const step = Math.round(p * STEPS);
      if (step !== lastStep) {
        lastStep = step;
        arc.current?.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE * (1 - step / STEPS)));
      }
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ring]);

  return (
    <div className="cv-escui cv-hold" role="status">
      <svg className="cv-hold-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="cv-hold-track" cx="50" cy="50" r={RADIUS} />
        <circle
          ref={arc}
          className="cv-hold-arc"
          cx="50"
          cy="50"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="cv-hold-icon" aria-hidden="true">
        🔑
      </span>
      <span className="cv-hold-text">{`${SOLO_HOLD_MS / 1000}초 동안 계속 눌러요`}</span>
    </div>
  );
}

/**
 * The progress ring of a lone member's long press (AI 학교 탈출, Task 19): it fills over SOLO_HOLD_MS while the
 * key / finger stays down, drawn from the moment the server says the hold began (holdSession.ts). Letting go,
 * the server cancelling it (a teammate arrived, a pause) or the switch turning (`coopDone`) takes it away.
 * It takes no taps. Mounted in the classroom's HUD for the scene's whole life; it draws nothing between holds.
 */
export function HoldRing() {
  const ring = useSyncExternalStore(subscribeHold, getHoldRing, getHoldRing);
  if (ring === null) return null;
  return <Ring key={ring.since} ring={ring} />;
}
