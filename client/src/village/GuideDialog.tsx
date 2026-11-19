import { useCallback, useEffect, useRef, useState } from "react";
import { guideById } from "@caysonverse/shared/village/guides";
import { popOverlay, pushOverlay } from "../ui/overlayStack";
import { showOnMap } from "../game/viewState";
import type { Pose, SeatState } from "../game/types";
import { closeGuideDialog, useGuideDialog } from "./guideDialogStore";
import { useLocalArea } from "./villageArea";
import { GUIDE_TOPICS, guideTopic, resolveGuidePlace, type GuideTopic } from "./guideTopics";
import { GuideIcon } from "./GuideIcons";
import { startWalkTo } from "./mapWalk";
import "./guideDialog.css";

/** The dialog's id on the overlay stack (Esc closes it; WASD and E stay with it while it is open). */
export const GUIDE_OVERLAY_ID = "guide";

/**
 * The plaza guide's help (케이슨 마을 Task 9A; redesigned 2026-11-20, owner "이대로 만들어"; the store is guideDialogStore.ts, the
 * words guideTopics.ts). Opened by "문의하기" within reach of the guide, it starts on nine topic cards (an icon and a title each);
 * a card opens its page in the same dialog: the title, a one-line summary, numbered steps with a small icon each, and a short
 * Q&A list (a question opens its answer under it). At the bottom: "지도에서 보기" (the map framed on the topic's place, its card
 * open) and "같이 가요" (the avatar walks there along the paths, mapWalk.ts) where the topic has a place, then "뒤로" (the topic
 * list) and "닫기". A long page scrolls between the fixed head and buttons. Closes with 닫기, Esc, the backdrop, or leaving the
 * area. Nothing in it can be selected (taps and drags on a phone must not paint the text).
 */
export function GuideDialog({ pose, seat }: { pose: Pose; seat: SeatState }) {
  const openId = useGuideDialog();
  const area = useLocalArea();
  const [topicId, setTopicId] = useState<string | null>(null);
  const [askedId, setAskedId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The scene goes away: close the dialog.
  useEffect(() => () => closeGuideDialog(), []);

  const guide = openId ? guideById(openId) : null;
  const open = guide !== null && guide.area === area;

  // Leaving the guide's area (a door) closes it.
  useEffect(() => {
    if (guide && guide.area !== area) closeGuideDialog();
  }, [guide, area]);
  // Closed (or another guide): back to the topic list.
  useEffect(() => {
    setTopicId(null);
    setAskedId(null);
  }, [open, openId]);
  useEffect(() => {
    if (!open) return;
    pushOverlay(GUIDE_OVERLAY_ID, closeGuideDialog);
    return () => popOverlay(GUIDE_OVERLAY_ID);
  }, [open]);
  // A new page starts at its top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [topicId]);

  if (!open || !guide) return null;
  const topic = topicId ? (guideTopic(topicId) ?? null) : null;

  const openTopic = (id: string | null) => {
    setAskedId(null);
    setTopicId(id);
  };
  const showMap = (t: GuideTopic) => {
    if (!t.map) return;
    const place = resolveGuidePlace(t.map, pose.x, pose.z);
    if (!place) return;
    closeGuideDialog();
    showOnMap(place.label.x, place.label.z, t.map.kind === "spot" ? null : place.id);
  };
  const goThere = (t: GuideTopic) => {
    if (!t.go) return;
    const place = resolveGuidePlace(t.go, pose.x, pose.z);
    if (!place) return;
    closeGuideDialog();
    startWalkTo(place, pose, seat);
  };

  return (
    <div className="cv-guide" role="dialog" aria-modal="true" aria-label={guide.name} data-guide={guide.id} data-guide-page={topic?.id ?? "home"}>
      <div className="cv-guide-backdrop" onPointerDown={closeGuideDialog} />
      <div className={`cv-guide-panel cv-guide-${guide.id}`}>
        <div className="cv-guide-head">
          {topic ? (
            <>
              <span className="cv-guide-head-ic" aria-hidden="true">
                <GuideIcon id={topic.icon} size={22} />
              </span>
              <div className="cv-guide-head-text">
                <span className="cv-guide-kicker">{guide.name}</span>
                <h2 className="cv-guide-title">{topic.title}</h2>
              </div>
            </>
          ) : (
            <div className="cv-guide-head-text">
              <h2 className="cv-guide-title">{guide.name}</h2>
              <span className="cv-guide-lead">무엇이 궁금하세요? 하나를 골라 주세요.</span>
            </div>
          )}
        </div>

        <div className="cv-guide-body" ref={bodyRef}>
          {topic ? (
            <TopicPage topic={topic} askedId={askedId} onAsk={(id) => setAskedId((a) => (a === id ? null : id))} speaker={guide.tag} />
          ) : (
            <ul className="cv-guide-cards">
              {GUIDE_TOPICS.map((t) => (
                <li key={t.id}>
                  <button type="button" className="cv-guide-card" data-topic={t.id} onClick={() => openTopic(t.id)}>
                    <span className="cv-guide-card-ic" aria-hidden="true">
                      <GuideIcon id={t.icon} size={26} />
                    </span>
                    <span className="cv-guide-card-title">{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cv-guide-foot">
          {topic && (topic.map || topic.go) && (
            <div className="cv-guide-actions">
              {topic.map && (
                <button type="button" className="cv-guide-btn is-soft" data-guide-act="map" onClick={() => showMap(topic)}>
                  <GuideIcon id="map" size={18} />
                  지도에서 보기
                </button>
              )}
              {topic.go && (
                <button type="button" className="cv-guide-btn is-primary" data-guide-act="go" onClick={() => goThere(topic)}>
                  <GuideIcon id="walk" size={18} />
                  같이 가요
                </button>
              )}
            </div>
          )}
          <div className="cv-guide-nav">
            {topic && (
              <button type="button" className="cv-guide-btn is-plain" data-guide-act="back" onClick={() => openTopic(null)}>
                뒤로
              </button>
            )}
            <button type="button" className="cv-guide-btn is-plain cv-guide-close" data-guide-act="close" onClick={closeGuideDialog}>
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopicPage({ topic, askedId, onAsk, speaker }: { topic: GuideTopic; askedId: string | null; onAsk: (id: string) => void; speaker: string }) {
  // an answer opened near the bottom of the page scrolls into view, once, when it opens (a stable ref: not on every render)
  const reveal = useCallback((el: HTMLDivElement | null) => el?.scrollIntoView({ block: "nearest" }), []);
  return (
    <div className="cv-guide-page">
      <p className="cv-guide-summary">{topic.summary}</p>
      <ol className="cv-guide-steps">
        {topic.steps.map((s, i) => (
          <li key={i} className="cv-guide-step">
            <span className="cv-guide-step-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="cv-guide-step-ic" aria-hidden="true">
              <GuideIcon id={s.icon} size={22} />
            </span>
            <span className="cv-guide-step-text">{s.text}</span>
          </li>
        ))}
      </ol>
      {topic.qas.length > 0 && (
        <>
          <div className="cv-guide-divider" role="separator">
            <span>자주 묻는 질문</span>
          </div>
          <ul className="cv-guide-questions">
            {topic.qas.map((q) => {
              const isOpen = q.id === askedId;
              return (
                <li key={q.id} className={isOpen ? "is-open" : undefined}>
                  <button type="button" className={isOpen ? "is-asked" : undefined} aria-expanded={isOpen} data-qa={q.id} onClick={() => onAsk(q.id)}>
                    <span className="cv-guide-q">{q.question}</span>
                    <span className="cv-guide-chev" aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div className="cv-guide-answer" aria-live="polite" data-qa-answer={q.id} ref={reveal}>
                      <span className="cv-guide-speaker">{speaker}</span>
                      <p>{q.answer}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
