import { useEffect, useRef, useState } from "react";
import { useClassStore } from "../../stores/classStore";
import { OPENED_FLASH_MS, openedNow, phaseBannerText } from "./phaseText";
import "./hub.css";

/**
 * The hall's banner for the class's phase (AI 학교 탈출, Task 16): "팀을 만들고 기다려 주세요…" while
 * the class waits, "선생님이 잠시 멈췄어요" while it is paused, and for 3 seconds after the teacher
 * starts it "복도 문이 열렸어요!". The words are in phaseText.ts. The start flash is for a start
 * this screen SAW (lobby → running): joining a running class, or a resume, shows nothing.
 */
export interface PhaseBannerView {
  text: string;
  tone: "is-open" | "is-paused" | "is-wait";
  icon: string;
}

/** The banner to show now (with the 3-second start flash kept here), or null. */
export function usePhaseBanner(isTeacher: boolean): PhaseBannerView | null {
  const phase = useClassStore((s) => s.phase);
  const previous = useRef(phase);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = phase;
    if (!openedNow(was, phase)) {
      setOpened(false);
      return;
    }
    setOpened(true);
    const id = window.setTimeout(() => setOpened(false), OPENED_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  const text = phaseBannerText({ phase, opened, isTeacher });
  if (text === null) return null;
  return {
    text,
    tone: opened ? "is-open" : phase === "paused" ? "is-paused" : "is-wait",
    icon: opened ? "🚪" : phase === "paused" ? "⏸" : "🕘",
  };
}

export function PhaseBanner({ view }: { view: PhaseBannerView }) {
  return (
    // `key` replays the entrance when the line changes.
    <div className={`cv-hub-phase ${view.tone}`} role="status" aria-live="polite" key={view.text}>
      <span className="cv-hub-phase-icon" aria-hidden="true">
        {view.icon}
      </span>
      <span>{view.text}</span>
    </div>
  );
}
