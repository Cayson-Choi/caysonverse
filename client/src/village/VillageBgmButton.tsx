import { useEffect, useState } from "react";
import { HudButton } from "../ui/HudButton";
import { createBrowserBgm, type VillageBgm } from "./villageBgm";
import { useLocalArea } from "./villageArea";

declare global {
  interface Window {
    /** Dev only: the village music controller, for the e2e checks. */
    __cvBgm?: VillageBgm;
  }
}

/**
 * The village's music: owns the controller for as long as the village scene is mounted (the effect creates and
 * disposes it, so a StrictMode double mount leaves one element) and draws the ♪ on/off chip in the HUD's left
 * column. The controller starts on the first gesture, goes quiet in the memorial hall (`useLocalArea`) and pauses
 * with the tab.
 */
export function VillageBgmButton() {
  const area = useLocalArea();
  const [bgm, setBgm] = useState<VillageBgm | null>(null);
  const [on, setOn] = useState(true);

  useEffect(() => {
    const c = createBrowserBgm();
    c.arm();
    const sync = () => setOn(c.isEnabled());
    const unsub = c.subscribe(sync);
    const onVisibility = () => c.setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    sync();
    setBgm(c);
    if (import.meta.env.DEV) window.__cvBgm = c;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsub();
      c.dispose();
      if (window.__cvBgm === c) delete window.__cvBgm;
      setBgm(null);
    };
  }, []);

  useEffect(() => {
    bgm?.setHall(area === "hall");
  }, [bgm, area]);

  return (
    <HudButton
      label="배경음악 켜기/끄기"
      pressed={on}
      highlight={false}
      className={on ? undefined : "is-muted"}
      onClick={() => bgm?.toggle()}
    >
      ♪
    </HudButton>
  );
}
