import { useEffect, useState } from "react";
import { HudButton } from "../ui/HudButton";
import { createBrowserBgm, mountVillageBgm, type VillageBgm } from "./villageBgm";
import { useLocalArea } from "./villageArea";

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

  useEffect(
    () =>
      mountVillageBgm({
        create: createBrowserBgm,
        doc: document,
        setBgm,
        setOn,
        probe: import.meta.env.DEV ? window : null,
      }),
    [],
  );

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
