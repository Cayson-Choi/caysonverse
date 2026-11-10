import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  COACH_CARD_H_GUESS_PX,
  COACH_POLL_MS,
  coachCardWidth,
  coachCopy,
  createCoachPoller,
  placeCoachCard,
  viewYawOf,
  type CoachStep,
} from "../game/coach";
import { viewState } from "../game/viewState";
import { isTouchDevice } from "../device";
import { useAppStore } from "../stores/appStore";
import { useCoachStore } from "../stores/coachStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import type { Orbit, Pose } from "../game/types";
import { addChatLayoutTargets } from "./chatLayoutTargets";
import { useTouchHudLayout, useTouchViewport } from "./useTouchHudLayout";
import "./coach.css";

/**
 * The card for one step, near the control it explains. A phone gets its spot from the
 * touch layout (game/coach.ts `placeCoachCard`: 8 px clear of every HUD button, mirrored
 * with the layout) as inline left / top / width; a PC places it in CSS (coach.css), above
 * the chat bar. It is measured once drawn, so the spot fits its real height.
 *
 * Never in the way: the card ignores the pointer (only 건너뛰기 takes presses), has no tab
 * stop, and 건너뛰기 does not take focus from a press — so a focused chat field keeps its
 * caret and no touch meant for the stick or the look drag stops at the card.
 */
function CoachCard({ step }: { step: Exclude<CoachStep, "done"> }) {
  const report = useCoachStore((s) => s.report);
  const leftHanded = useSettingsStore((s) => s.settings.leftHanded);
  const isAdmin = useAppStore((s) => s.isAdmin);
  const layout = useTouchHudLayout();
  const vp = useTouchViewport();
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(COACH_CARD_H_GUESS_PX);

  // The card's real height (its text wraps differently per step, screen and hand). A hidden
  // card (display: none while the keyboard or the emoji fan is up) measures 0: ignored.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) setHeight((prev) => (prev === h ? prev : h));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, leftHanded]);

  const width = coachCardWidth(vp.w, vp.safe);
  const spot = useMemo(
    () =>
      isTouchDevice
        ? placeCoachCard(step, {
            vw: vp.w,
            vh: vp.h,
            safe: vp.safe,
            leftHanded,
            layout,
            admin: isAdmin,
            w: width,
            h: height,
          })
        : null,
    [step, vp, leftHanded, layout, isAdmin, width, height],
  );
  const style: CSSProperties | undefined = spot
    ? { left: spot.x, top: spot.y, width: spot.w }
    : undefined;
  // Hidden while a phone's chat has the caret (coach.css), back with the HUD: the tap that leaves the chat must not land
  // on its 건너뛰기 (ChatInput holds the chat layout for a tap that went down near the card — chatLayoutTargets.ts).
  useEffect(() => (spot ? addChatLayoutTargets(() => [spot]) : undefined), [spot]);
  const { title, body } = coachCopy(step, isTouchDevice, leftHanded);

  return (
    <div
      ref={ref}
      className={"cv-coach" + (isTouchDevice ? " is-touch" : "")}
      style={style}
      role="status"
      data-step={step}
    >
      <div className="cv-coach-head">
        <span className="cv-coach-title">{title}</span>
        <button
          type="button"
          className="cv-coach-skip"
          tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => report("skip")}
        >
          건너뛰기
        </button>
      </div>
      <p className="cv-coach-body">{body}</p>
    </div>
  );
}

/**
 * The first-visit guide (controls-ux Task 17): ① 움직이기 → ② 둘러보기 → ③ 말하기, one
 * small card at a time near the control it is about, until the player has done all three
 * (or pressed 건너뛰기). It never blocks play — the keys, the stick and the look drag work
 * while a card is up, and it is not a keyboard owner (uiCapture).
 *
 * Moving and looking are measured here, 5 times a second, from the live `pose` and view yaw
 * (the same refs the camera and the avatar use — no per-frame React state): the player has
 * to walk 1.5 m for ① and turn the view 0.6 rad in total for ②. Each step's measuring starts
 * with its first tick (not at mount), so what was done earlier — or a view reset while the
 * world was still settling — never counts. ③ is reported by the chat input
 * when a line is really sent. The step lives in coachStore, which saves `coachDone` when the
 * guide ends so a reload does not show it again; the menu's "조작 안내 다시 보기" restarts it.
 *
 * The card steps aside (renders nothing) while the menu or the roster is open.
 */
export function CoachMarks({ pose, orbit }: { pose: Pose; orbit: Orbit }) {
  const step = useCoachStore((s) => s.step);
  const round = useCoachStore((s) => s.round);
  const report = useCoachStore((s) => s.report);
  const covered = useUiStore((s) => s.menuOpen || s.rosterOpen);

  useEffect(() => {
    if (step !== "move" && step !== "look") return;
    // The baseline is taken on the first tick, not now: see createCoachPoller.
    const poller = createCoachPoller();
    const id = window.setInterval(() => {
      const ev = poller.poll(step, pose.x, pose.z, viewYawOf(viewState, orbit));
      if (ev) report(ev);
    }, COACH_POLL_MS);
    return () => window.clearInterval(id);
  }, [step, round, pose, orbit, report]);

  if (step === "done" || covered) return null;
  return <CoachCard key={step} step={step} />;
}
