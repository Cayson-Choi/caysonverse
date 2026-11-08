import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { GUIDE_AI_VOICE_LABEL, guideById } from "@caysonverse/shared/village/guides";
import { useSoundStore } from "../stores/soundStore";
import { popOverlay, pushOverlay } from "../ui/overlayStack";
import { closeGuideDialog, useGuideDialog } from "./guideDialogStore";
import { createBrowserGuideVoice, type GuideVoice, type GuideVoiceState } from "./guideVoice";
import { useLocalArea } from "./villageArea";
import "./guideDialog.css";

declare global {
  interface Window {
    /** Dev only: the guides' voice controller, for the e2e checks. */
    __cvGuideVoice?: GuideVoice;
  }
}

/** The dialog's id on the overlay stack (Esc closes it; WASD and E stay with it while it is open). */
export const GUIDE_OVERLAY_ID = "guide";

const IDLE: GuideVoiceState = { playing: null, asked: null };

/**
 * A guide's questions (케이슨 마을 Task 9A; the store is guideDialogStore.ts, the voice guideVoice.ts). Opened by "문의하기"
 * within 2.2 m of a guide. Choosing a question shows its answer and plays its clip for this player only; pressing
 * the same question again (or 건너뛰기) skips it; another question stops the first. The 🔊 toggle mutes the voice (the
 * text still shows). A small "AI 음성" label says the voice is synthetic. Closes with 닫기, Esc, or leaving the area.
 *
 * The voice controller lives as long as the village scene (this component is in its HUD): created and disposed in
 * one effect, so a StrictMode double mount leaves one element.
 */
export function GuideDialog() {
  const openId = useGuideDialog();
  const area = useLocalArea();
  const muted = useSoundStore((s) => s.muted);
  const [voice, setVoice] = useState<GuideVoice | null>(null);

  useEffect(() => {
    const v = createBrowserGuideVoice(() => useSoundStore.getState().muted);
    setVoice(v);
    if (import.meta.env.DEV) window.__cvGuideVoice = v;
    return () => {
      v.dispose();
      if (window.__cvGuideVoice === v) delete window.__cvGuideVoice;
      setVoice(null);
      closeGuideDialog();
    };
  }, []);

  const subscribe = useCallback((fn: () => void) => voice?.subscribe(fn) ?? (() => {}), [voice]);
  const snapshot = useCallback(() => voice?.state() ?? IDLE, [voice]);
  const state = useSyncExternalStore(subscribe, snapshot, () => IDLE);

  const guide = openId ? guideById(openId) : null;
  const open = guide !== null && guide.area === area;

  // The 🔊 toggle: muting stops the clip.
  useEffect(() => {
    voice?.setMuted(muted);
  }, [voice, muted]);
  // Leaving the guide's area (a door) closes it.
  useEffect(() => {
    if (guide && guide.area !== area) closeGuideDialog();
  }, [guide, area]);
  // Closed: stop the voice and forget the selection.
  useEffect(() => {
    if (!open) voice?.reset();
  }, [open, voice]);
  useEffect(() => {
    if (!open) return;
    pushOverlay(GUIDE_OVERLAY_ID, closeGuideDialog);
    return () => popOverlay(GUIDE_OVERLAY_ID);
  }, [open]);

  if (!open || !guide) return null;
  const asked = guide.qas.find((q) => q.voice === state.asked) ?? null;
  const playing = state.playing !== null;

  return (
    <div className="cv-guide" role="dialog" aria-modal="true" aria-label={guide.name} data-guide={guide.id}>
      <div className="cv-guide-backdrop" onPointerDown={closeGuideDialog} />
      <div className={`cv-guide-panel cv-guide-${guide.id}`}>
        <div className="cv-guide-head">
          <div className="cv-guide-name">{guide.name}</div>
          <span className="cv-guide-ai" title="AI로 만든 목소리예요">
            {GUIDE_AI_VOICE_LABEL}
          </span>
        </div>
        {asked ? (
          <div className="cv-guide-answer" aria-live="polite" data-voice={asked.voice} data-playing={playing ? "1" : "0"}>
            <p>{asked.answer}</p>
            {playing ? (
              <button type="button" className="cv-guide-skip" onClick={() => voice?.skip()}>
                건너뛰기
              </button>
            ) : muted ? (
              <div className="cv-guide-muted">소리가 꺼져 있어요</div>
            ) : null}
          </div>
        ) : (
          <p className="cv-guide-hint">궁금한 것을 골라 주세요.</p>
        )}
        <ul className="cv-guide-questions">
          {guide.qas.map((q) => (
            <li key={q.voice}>
              <button
                type="button"
                className={q.voice === state.asked ? "is-asked" : undefined}
                aria-pressed={q.voice === state.asked}
                data-voice={q.voice}
                onClick={() => voice?.press(q.voice)}
              >
                {q.question}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="cv-guide-close" onClick={closeGuideDialog}>
          닫기
        </button>
      </div>
    </div>
  );
}
