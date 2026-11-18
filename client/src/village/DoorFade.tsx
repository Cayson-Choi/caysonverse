import { useEffect, useSyncExternalStore } from "react";
import { doorFade, FADE_IN_MS, FADE_OUT_MS } from "./doorFadeModel";
import { subscribeLocalArea } from "./villageArea";

const covered = () => doorFade.covered();
/** Frames drawn in the new place before the curtain opens (the mount, its first heavy frame, one clean one). */
export const ARRIVE_FRAMES = 3;

/**
 * The curtain of the village's door (doorFade.ts): a black layer over the whole screen that closes quickly when
 * the door is pressed and opens once we are on the other side (the local player's area changed). It never takes
 * a press (pointer-events none), so the chat and the buttons under it stay usable, and it is gone from the
 * accessibility tree. The scene's own `useEffect` hands it the area changes.
 */
export function DoorFade() {
  const on = useSyncExternalStore(doorFade.subscribe, covered, covered);

  // We were moved through the door: the curtain may open, once the other side has drawn. The place we arrive in
  // mounts on the area change (the village's whole tree on the way out of a room: its first frame there took
  // 1.3–1.6 s on a PC, L5v2 release-4 run), so the curtain waits out ARRIVE_FRAMES frames: that long frame is
  // spent behind the black, not on a half-open view that stops dead.
  useEffect(() => {
    let raf = 0;
    const off = subscribeLocalArea(() => {
      cancelAnimationFrame(raf);
      let left = ARRIVE_FRAMES;
      const step = () => {
        if (--left <= 0) doorFade.arrived();
        else raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
      doorFade.reset();
    };
  }, []);

  return (
    <div
      className="cv-door-fade"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 45, // over the HUD (up to 40), under the dialogs and the reconnect overlay (60 and up)
        background: "#0b0b14",
        pointerEvents: "none",
        opacity: on ? 1 : 0,
        // Closing is quick, opening a touch gentler: 0.2 s + 0.2 s when the server answers at once.
        transition: `opacity ${on ? FADE_IN_MS : FADE_OUT_MS}ms ease-${on ? "in" : "out"}`,
      }}
      // The curtain is shut: the door may be used now, so the other side first shows on a black screen.
      onTransitionEnd={(e) => {
        if (on && e.propertyName === "opacity") doorFade.closed();
      }}
    />
  );
}
