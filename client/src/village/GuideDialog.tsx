import { useEffect, useState } from "react";
import { guideById } from "@caysonverse/shared/village/guides";
import { popOverlay, pushOverlay } from "../ui/overlayStack";
import { closeGuideDialog, useGuideDialog } from "./guideDialogStore";
import { useLocalArea } from "./villageArea";
import "./guideDialog.css";

/** The dialog's id on the overlay stack (Esc closes it; WASD and E stay with it while it is open). */
export const GUIDE_OVERLAY_ID = "guide";

/**
 * A guide's questions (케이슨 마을 Task 9A; the store is guideDialogStore.ts). Opened by "문의하기" within reach of a guide.
 * Choosing a question shows its answer in words only (the voice clips were taken out, owner 2026-11-17). The answer is a
 * speech bubble from the guide's avatar, with the asked question above it as small "나: …" text and a "다른 질문" divider
 * before the question buttons, so it never reads as one more button (owner 2026-11-17: "답변 글이 다른 질문 메뉴와 다른
 * 모습으로"). Closes with 닫기, Esc, the backdrop, or leaving the area.
 */
export function GuideDialog() {
  const openId = useGuideDialog();
  const area = useLocalArea();
  const [askedId, setAskedId] = useState<string | null>(null);

  // The scene goes away: close the dialog.
  useEffect(() => () => closeGuideDialog(), []);

  const guide = openId ? guideById(openId) : null;
  const open = guide !== null && guide.area === area;

  // Leaving the guide's area (a door) closes it.
  useEffect(() => {
    if (guide && guide.area !== area) closeGuideDialog();
  }, [guide, area]);
  // Closed (or another guide): forget the selection.
  useEffect(() => {
    setAskedId(null);
  }, [open, openId]);
  useEffect(() => {
    if (!open) return;
    pushOverlay(GUIDE_OVERLAY_ID, closeGuideDialog);
    return () => popOverlay(GUIDE_OVERLAY_ID);
  }, [open]);

  if (!open || !guide) return null;
  const asked = guide.qas.find((q) => q.id === askedId) ?? null;

  return (
    <div className="cv-guide" role="dialog" aria-modal="true" aria-label={guide.name} data-guide={guide.id}>
      <div className="cv-guide-backdrop" onPointerDown={closeGuideDialog} />
      <div className={`cv-guide-panel cv-guide-${guide.id}`}>
        <div className="cv-guide-head">
          <div className="cv-guide-name">{guide.name}</div>
        </div>
        {asked ? (
          <div className="cv-guide-convo">
            <p className="cv-guide-me">
              <span className="cv-guide-me-who">나</span> {asked.question}
            </p>
            <div className="cv-guide-says">
              <span className="cv-guide-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                  <circle cx="12" cy="8.2" r="4" fill="currentColor" />
                  <path d="M4.5 20.5c.6-4.2 3.6-6.6 7.5-6.6s6.9 2.4 7.5 6.6z" fill="currentColor" />
                </svg>
              </span>
              <div className="cv-guide-answer" aria-live="polite" data-qa={asked.id}>
                <span className="cv-guide-speaker">{guide.tag}</span>
                <p>{asked.answer}</p>
              </div>
            </div>
            <div className="cv-guide-divider" role="separator">
              <span>다른 질문</span>
            </div>
          </div>
        ) : (
          <p className="cv-guide-hint">궁금한 것을 골라 주세요.</p>
        )}
        <ul className="cv-guide-questions">
          {guide.qas.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                className={q.id === askedId ? "is-asked" : undefined}
                aria-pressed={q.id === askedId}
                data-qa={q.id}
                onClick={() => setAskedId(q.id)}
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
