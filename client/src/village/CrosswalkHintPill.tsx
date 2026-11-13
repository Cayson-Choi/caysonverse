import { useEffect, useState } from "react";
import type { Pose } from "../game/types";
import { crosswalkHintAt, type CrosswalkHint as Hint } from "./crosswalkHint";
import { useTransitState } from "../net/transitSync";
import { villageClock } from "./villageClock";
import "./crosswalkHint.css";

/**
 * A small pill at the top of the screen near a crosswalk: what the walking signal says in words and the seconds left
 * (crosswalkHint.ts), for first-time players and phones, where the signal head is a few pixels. It never blocks a tap
 * (pointer-events: none). PlayShell mutates the live pose in place, so the pose is sampled at 4 Hz and a change is
 * published only when the sentence or the second changes.
 */
export function CrosswalkHintPill({ pose }: { pose: Pose }) {
  const [hint, setHint] = useState<Hint | null>(null);
  const { boarded } = useTransitState(); // a rider is in the bus, not on the road
  useEffect(() => {
    let last = "";
    const id = window.setInterval(() => {
      const h = crosswalkHintAt(pose.x, pose.z, villageClock.nowMs());
      const key = h ? `${h.tone}|${h.text}|${h.seconds}` : "";
      if (key === last) return;
      last = key;
      setHint(h);
    }, 250);
    return () => window.clearInterval(id);
  }, [pose]);
  if (!hint || boarded) return null;
  return (
    <div className={`cv-xwalk-hint is-${hint.tone}`} role="status" aria-live="polite">
      <span className="cv-xwalk-dot" aria-hidden="true" />
      <span className="cv-xwalk-text">{hint.text}</span>
      <span className="cv-xwalk-sec">{hint.seconds}초</span>
    </div>
  );
}
