import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useAppStore } from "../stores/appStore";
import { vegDressing } from "../village/vegDressing";
import { localArea } from "../village/villageArea";
import { reconnectFrame } from "./reconnectFrame";
import "./reconnecting.css";

/** The new scene shows at least this long (ms) before the overlay may lift (its loaders start a moment after the mount). */
const RESUME_MIN_MS = 1500;
/**
 * The village's model has been in the scene for this many rendered FRAMES: its first frames (shader compile, texture upload) have
 * been drawn. Frames, not time: the main thread is busy for seconds with that work and the canvas stays black meanwhile.
 */
const VILLAGE_DRAW_FRAMES = 40;
/** However the new scene fares, the overlay lifts after this long (ms): a stuck load never traps the player behind it. */
const RESUME_MAX_MS = 30000;
/** The overlay's fade-out (ms). */
const LEAVE_MS = 400;

/**
 * "다시 연결하는 중…" over the village while the resilience driver recovers a dropped connection, and on until the village is
 * back in view (QA 2026-11-20: the scene used to unmount to a black screen with only "불러오는 중…" for 5–25 s).
 *
 *  - Reconnecting: the live village stays mounted and frozen behind the dim (input is suspended in the frame loop). FrameGrab keeps
 *    a picture of it.
 *  - Resuming (`appStore.resuming`, from `reconnected()` on): the scene remounts against the new room (a fresh remote store: no
 *    avatar twice, the own pose, seats, rides, the bus and the fishing all re-read from the room's state). Its canvas is black until
 *    it has loaded again, so the picture taken above is shown here instead, and the overlay lifts (with a fade) once the village
 *    is dressed and nothing is loading.
 *
 * Rendered at the App level so it survives the remount.
 */
export function ReconnectingOverlay() {
  const reconnecting = useAppStore((s) => s.reconnecting);
  const resuming = useAppStore((s) => s.resuming);
  const loading = useProgress((s) => s.active);
  const active = reconnecting || resuming;
  const [leaving, setLeaving] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);
  const wasActive = useRef(false);
  const resumeAt = useRef(0);

  // the picture is read as the resume starts (the reconnect has had its frames by then)
  useEffect(() => {
    if (active) setPicture(reconnectFrame.get());
  }, [active, resuming]);

  // lift once the new scene is in: dressed (or indoors, where the village is not shown), nothing loading, a minimum time shown
  useEffect(() => {
    if (!resuming) return;
    if (resumeAt.current === 0) resumeAt.current = performance.now();
    const check = () => {
      const age = performance.now() - resumeAt.current;
      // in the village: its model is in the scene (and has had a moment to draw) and dressed; indoors the village is not shown,
      // so there nothing but the loaders and a little extra time is asked
      const outside = localArea() === "village";
      const inView = outside ? reconnectFrame.villageFrames() > VILLAGE_DRAW_FRAMES && vegDressing.dressed() : age > RESUME_MIN_MS + 1500;
      const ready = age > RESUME_MIN_MS && !loading && inView;
      if (ready || age > RESUME_MAX_MS) useAppStore.getState().finishResume();
    };
    check();
    const id = window.setInterval(check, 200);
    return () => window.clearInterval(id);
  }, [resuming, loading]);

  useEffect(() => {
    if (!resuming) resumeAt.current = 0;
  }, [resuming]);

  // fade out, then go
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      setLeaving(false);
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    setLeaving(true);
    const id = window.setTimeout(() => {
      setLeaving(false);
      setPicture(null);
      reconnectFrame.clear();
    }, LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  if (!active && !leaving) return null;
  return (
    <div
      className={"cv-reconnecting" + (resuming ? " is-resuming" : "") + (!active ? " is-leaving" : "")}
      style={resuming && picture ? { backgroundImage: `url(${picture})` } : undefined}
      role="status"
      aria-live="assertive"
      data-testid="reconnecting-overlay"
    >
      <div className="cv-reconnecting-dim" aria-hidden="true" />
      <div className="cv-reconnecting-card">
        <div className="cv-reconnecting-spinner" aria-hidden="true" />
        <span className="cv-reconnecting-text">다시 연결하는 중…</span>
      </div>
    </div>
  );
}
