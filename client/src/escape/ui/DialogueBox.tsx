import { useEffect, useState } from "react";
import type { DialogueLine, DialogueQueue } from "../dialogue";
import { AriFace } from "./AriFace";
import "../escape.css";

/** Bandit's portrait (Task 24 puts the art there). Until the file exists the 🔦 circle stands in. */
export const BANDIT_PORTRAIT = "/models/school/portraits/bandit.webp";

/** How often the box ticks its queue and looks for a new line (ms) — discrete UI work, not per frame. */
const TICK_MS = 150;

/** Once the portrait failed to load it is not asked for again this session (one miss, not one per line). */
let banditPortraitMissing = false;

/** Bandit's face: the portrait, or the 🔦 circle once the file has failed to load (the hint button wears it too). */
export function BanditAvatar() {
  const [missing, setMissing] = useState(banditPortraitMissing);
  if (missing) {
    return (
      <span className="cv-esc-bandit-fallback" aria-label="반딧" role="img">
        🔦
      </span>
    );
  }
  return (
    <img
      className="cv-esc-bandit-img"
      src={BANDIT_PORTRAIT}
      alt="반딧"
      width={64}
      height={64}
      decoding="async"
      draggable={false}
      onError={() => {
        banditPortraitMissing = true;
        setMissing(true);
      }}
    />
  );
}

function Face({ line }: { line: DialogueLine }) {
  if (line.speaker === "ari") return <AriFace expression={line.mood ?? "smile"} size={64} />;
  if (line.speaker === "bandit") return <BanditAvatar />;
  return (
    <span className="cv-esc-narrator-icon" aria-hidden="true">
      📖
    </span>
  );
}

let nextLineKey = 1;
const lineKeys = new WeakMap<DialogueLine, number>();
/** A key that stays with one line object (a waiting line being added must not replay the showing line's entrance). */
function lineKey(line: DialogueLine): number {
  let k = lineKeys.get(line);
  if (k === undefined) {
    k = nextLineKey++;
    lineKeys.set(line, k);
  }
  return k;
}

const SPEAKER_NAMES: Record<DialogueLine["speaker"], string> = { ari: "아리", bandit: "반딧", narrator: "" };

/**
 * The story box (AI 학교 탈출, Task 17): one line at a time from the scene's `DialogueQueue` — Ari with
 * her face, Bandit with his portrait, the narrator with a book. A tap on the box goes to the next
 * line; otherwise the queue moves on by itself after max(2500, characters × 90) ms. It never takes
 * the keyboard or blocks the room: only the box itself catches a tap.
 *
 * The queue is plain mutable data; this component ticks it at ~7 Hz and re-renders only when its
 * version changed. While `frozen` (a cover — paused, time up, class ended — holds the room) it does not
 * tick, so a line is not spent unseen behind the card; the showing line gets its full time again when
 * the cover goes.
 */
export function DialogueBox({ queue, frozen = false }: { queue: DialogueQueue; frozen?: boolean }) {
  // The queue is not React state: its version is, so a change re-renders and the render reads the queue.
  const [, setVersion] = useState(() => queue.version());

  useEffect(() => {
    if (frozen) return;
    // Back from a frozen stretch (or the first run): the showing line's clock starts over.
    queue.restartClock();
    const id = window.setInterval(() => {
      queue.tick(performance.now());
      setVersion(queue.version()); // the same number again re-renders nothing
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [queue, frozen]);

  const line = queue.current();
  if (!line) return null;
  const waiting = queue.size() - 1;
  const name = SPEAKER_NAMES[line.speaker];
  return (
    <div
      className={`cv-escui cv-esc-dialogue is-${line.speaker}`}
      // A new line replays the entrance (a key per line object, so two equal texts in a row are two lines).
      key={lineKey(line)}
      role="status"
      aria-live="polite"
      onClick={() => {
        queue.advance();
        setVersion(queue.version());
      }}
    >
      <div className="cv-esc-dialogue-face">
        <Face line={line} />
      </div>
      <div className="cv-esc-dialogue-body">
        {name !== "" && <div className="cv-esc-dialogue-who">{name}</div>}
        <div className="cv-esc-dialogue-text">{line.text}</div>
      </div>
      <div className="cv-esc-dialogue-next" aria-hidden="true">
        {waiting > 0 ? `다음 ▶ +${waiting}` : "▶"}
      </div>
    </div>
  );
}
