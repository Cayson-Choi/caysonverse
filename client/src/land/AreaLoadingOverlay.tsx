import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useProgress } from "@react-three/drei";
import { localArea, useLocalArea } from "../village/villageArea";
import { vegDressing } from "../village/vegDressing";
import { useParkReady, useParkStage } from "./parkReady";
import { MIN_SHOWN_MS, NO_MOVE_MS, VILLAGE_READY_FRAMES, areaLoadingState, endAreaLoading, loadView, useAreaLoading, type LoadTarget } from "./areaLoading";
import "./areaLoading.css";

const FADE_MS = 450;

/**
 * The full-screen "케이슨랜드로 가는 중…" screen (areaLoading.ts): up from the press of 케이슨랜드 들어가기 (or from arriving in the park without
 * a press: a reconnect) until the park has been drawn, and the same the other way round ("마을로 돌아가는 중…"). A ring of orbiting dots, the
 * title, a stage line that follows the real stages, and a bar. The spinner and the bar's slide are CSS animations on transform / opacity only
 * (areaLoading.css), so the compositor keeps them turning while the main thread is busy compiling shaders and uploading textures.
 * It takes no press (pointer-events none), like the door's curtain.
 */
export function AreaLoadingOverlay() {
  const store = useAreaLoading();
  const area = useLocalArea();
  const parkReady = useParkReady();
  const parkStage = useParkStage();
  const vegDressed = useSyncExternalStore(vegDressing.subscribe, vegDressing.dressed, vegDressing.dressed);
  const { progress: dlPct } = useProgress();
  // a park that is up without a press (a reconnect into it): the same screen until it is drawn
  const target: LoadTarget | null = store.target ?? (area === "park" && !parkReady ? "park" : null);

  // the last target stays drawn while the screen fades out
  const [shown, setShown] = useState<LoadTarget | null>(null);
  const [closing, setClosing] = useState(false);
  const bornAt = useRef(0);
  // fades out, then drops the screen; a timer of its own (the effects that start it lose their trigger when the store clears)
  const hideTimer = useRef(0);
  const fadeAway = () => {
    setClosing(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShown(null), FADE_MS + 50);
  };
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (!target) return;
    if (shown !== target) {
      bornAt.current = performance.now();
      setShown(target);
    }
    setClosing(false);
  }, [target, shown]);

  // village: frames drawn since the way back
  const [frames, setFrames] = useState(0);
  const countFrames = target === "village" && area === "village";
  useEffect(() => {
    if (!countFrames) {
      setFrames(0);
      return;
    }
    let n = 0;
    let raf = 0;
    const step = () => {
      n++;
      setFrames(n);
      if (n < VILLAGE_READY_FRAMES + 2) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [countFrames]);

  const view = shown ? loadView({ target: shown, area, parkReady, parkStage, downloaded: dlPct / 100, villageFrames: frames, vegDressed }) : null;
  const done = !!view?.done && target !== null;

  // ready: wait out the minimum, fade, then drop it
  useEffect(() => {
    if (!done) return;
    const wait = Math.max(0, MIN_SHOWN_MS - (performance.now() - bornAt.current));
    const t1 = window.setTimeout(() => {
      endAreaLoading();
      fadeAway();
    }, wait);
    return () => window.clearTimeout(t1);
  }, [done]);

  // a press the server never answered: nothing moved, nothing is coming
  useEffect(() => {
    if (!store.target) return;
    const t = window.setTimeout(() => {
      const want = areaLoadingState().target;
      if (!want) return;
      if (localArea() !== want) {
        endAreaLoading();
        fadeAway();
      }
    }, NO_MOVE_MS);
    return () => window.clearTimeout(t);
  }, [store.target, store.since]);

  if (!shown || !view) return null;
  return (
    <div
      className={"cv-aload" + (closing ? " is-closing" : "")}
      data-testid={shown === "park" ? "park-loading" : "village-return-loading"}
      data-stage={view.stage}
      data-closing={closing ? "1" : "0"}
      role="status"
      aria-live="polite"
      aria-label={view.title}
    >
      <div className="cv-aload-card">
        <div className="cv-aload-spinner" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="cv-aload-orbit" style={{ animationDelay: `${i * 0.16}s` }}>
              <i />
            </span>
          ))}
        </div>
        <p className="cv-aload-title">{view.title}</p>
        <p className="cv-aload-sub" key={view.subtitle}>
          {view.subtitle}
        </p>
        <div className="cv-aload-bar" aria-hidden="true">
          <div className="cv-aload-fill" style={{ transform: `scaleX(${Math.max(0.04, view.progress)})` }}>
            <span className="cv-aload-shine" />
          </div>
        </div>
      </div>
    </div>
  );
}
