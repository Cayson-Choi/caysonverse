import { useEffect, useSyncExternalStore } from "react";
import { vegDressing } from "./vegDressing";

const dressed = () => vegDressing.dressed();

/** How long (ms) the veil takes to lift once the village is dressed. */
export const VEIL_OPEN_MS = 450;

/**
 * The cover over the village while its vegetation grows (vegDressing.ts): the same dark as the door's curtain
 * (DoorFade), shut at once and lifted gently once every tree has its crown, so the village is never seen with bare
 * trees. Only outside (`active`: the open village); it never takes a press (the chat and the buttons stay usable).
 */
export function VegVeil({ active }: { active: boolean }) {
  const ready = useSyncExternalStore(vegDressing.subscribe, dressed, dressed);
  useEffect(() => () => vegDressing.reset(), []);
  const on = active && !ready;
  useEffect(() => {
    if (on) vegDressing.expect();
  }, [on]);
  // inside (the hall, a house) the village's vegetation is kept (vegPark.ts): coming back out it is dressed at once,
  // no cover (a new build, e.g. after the first one was cut short by going in, covers again: vegDressing.begin)
  return (
    <div
      className="cv-veg-veil"
      aria-hidden="true"
      data-covered={on ? "1" : "0"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 44, // over the HUD (up to 40), under the door's curtain (45), the dialogs and the reconnect overlay
        display: "grid",
        placeItems: "center",
        color: "#cfc9f5",
        fontFamily: "system-ui, sans-serif",
        fontSize: 15,
        letterSpacing: "0.04em",
        background: "#0b0b14",
        pointerEvents: "none",
        opacity: on ? 1 : 0,
        transition: on ? "none" : `opacity ${VEIL_OPEN_MS}ms ease-out`,
      }}
    >
      {on ? "불러오는 중…" : null}
    </div>
  );
}
