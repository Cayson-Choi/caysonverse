import { useEffect, useSyncExternalStore } from "react";
import { doorFade, FADE_IN_MS, FADE_OUT_MS } from "./doorFadeModel";
import { subscribeLocalArea } from "./villageArea";

const covered = () => doorFade.covered();

/**
 * The curtain of the village's door (doorFade.ts): a black layer over the whole screen that closes quickly when
 * the door is pressed and opens once we are on the other side (the local player's area changed). It never takes
 * a press (pointer-events none), so the chat and the buttons under it stay usable, and it is gone from the
 * accessibility tree. The scene's own `useEffect` hands it the area changes.
 */
export function DoorFade() {
  const on = useSyncExternalStore(doorFade.subscribe, covered, covered);

  // We were moved through the door: the curtain may open.
  useEffect(() => {
    const off = subscribeLocalArea(() => doorFade.arrived());
    return () => {
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
