// The big fish's fight, on screen (owner 2026-11-19): the command in big letters ("당기세요 ⬆" / "놓아주세요 ⬇"), a line-tension meter and
// the distance to the fish, readable on a PC and a phone. The command is the public schedule (fishFightView.ts); the rest comes from the
// server's fight (Player.fishReel). Feedback: the meter's colour, a shake near the snap, a short vibration on a phone at every switch.

import { useEffect, useRef } from "react";
import { fightHint, fightWords, tensionLevel, type FightPrompt } from "./fishFightView";
import { playFightCue } from "./fightSfx";

export function LakeFight({ fight, touch, firstTime }: { fight: FightPrompt; touch: boolean; firstTime: boolean }) {
  const words = fightWords(fight.kind);
  const level = tensionLevel(fight.tension);
  const lastKind = useRef<string | null>(null);
  const lastLevel = useRef<string>("calm");
  // a cue at every switch (sound; a short buzz on a phone), and a warning buzz when the line goes tight
  useEffect(() => {
    if (lastKind.current !== null && lastKind.current !== fight.kind) {
      playFightCue(fight.kind);
      if (touch) navigator.vibrate?.(fight.kind === "run" ? [70, 40, 70] : [35]);
    }
    lastKind.current = fight.kind;
  }, [fight.kind, touch]);
  useEffect(() => {
    if (level === "danger" && lastLevel.current !== "danger") {
      playFightCue("danger");
      if (touch) navigator.vibrate?.([25, 25, 25]);
    }
    lastLevel.current = level;
  }, [level, touch]);
  const pct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
  return (
    <div
      className={`cv-fight is-${fight.kind}${fight.inGrace ? " is-grace" : ""}${level === "danger" ? " is-danger" : ""}`}
      data-fight-cmd={fight.kind}
      data-fight-tension={Math.round(fight.tension * 100)}
      data-fight-progress={Math.round(fight.progress * 100)}
      data-fight-stage={`${fight.index + 1}/${fight.stages}`}
      role="status"
      aria-live="assertive"
    >
      <div className="cv-fight-cmd">
        <span className="cv-fight-text">{words.text}</span>
        <span className="cv-fight-arrow" aria-hidden="true">
          {words.arrow}
        </span>
      </div>
      <div className="cv-fight-hint">{fightHint(fight, touch, firstTime)}</div>
      <div className="cv-fight-meters">
        <div className={`cv-fight-meter tension is-${level}`}>
          <span className="cv-fight-label">줄</span>
          <span className="cv-fight-bar">
            <i style={{ width: pct(fight.tension) }} />
          </span>
        </div>
        <div className="cv-fight-meter distance">
          <span className="cv-fight-label">거리</span>
          <span className="cv-fight-bar">
            <i style={{ width: pct(fight.progress) }} />
          </span>
        </div>
      </div>
    </div>
  );
}
