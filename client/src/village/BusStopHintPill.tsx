import { useEffect, useState } from "react";
import type { Pose } from "../game/types";
import { transitNowMs, useTransitState } from "../net/transitSync";
import { busStopHintAt, type BusStopHint } from "./busStopHint";
import "./crosswalkHint.css";

/**
 * A pill at the top of the screen at the bus stop: when the next bus leaves and when it can be boarded (busStopHint.ts),
 * on PC and phone alike. It never blocks a tap (pointer-events: none). The pose is sampled at 4 Hz (PlayShell mutates it
 * in place) and a change is published only when the words change. It sits one row below the crosswalk pill, so both
 * can show at the stop's corner.
 */
export function BusStopHintPill({ pose }: { pose: Pose }) {
  const [hint, setHint] = useState<BusStopHint | null>(null);
  const { boarded } = useTransitState();
  useEffect(() => {
    let last = "";
    const id = window.setInterval(() => {
      const h = busStopHintAt(pose.x, pose.z, transitNowMs(), boarded);
      const key = h ? `${h.tone}|${h.text}` : "";
      if (key === last) return;
      last = key;
      setHint(h);
    }, 250);
    return () => window.clearInterval(id);
  }, [pose, boarded]);
  if (!hint) return null;
  return (
    <div className={`cv-xwalk-hint cv-bus-hint is-${hint.tone === "board" ? "go" : "bus"}`} role="status" aria-live="polite">
      <span className="cv-bus-icon" aria-hidden="true">🚌</span>
      <span className="cv-xwalk-text">{hint.text}</span>
    </div>
  );
}
