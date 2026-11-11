import { useEffect, useState } from "react";
import { useSoundStore } from "../stores/soundStore";
import { HudButton } from "../ui/HudButton";
import { createBrowserBgm, mountVillageBgm, type VillageBgm } from "./villageBgm";
import { useLocalArea } from "./villageArea";
import { isHouseArea } from "@caysonverse/shared/village/villageLayout";

/**
 * The village's music: owns the controller for as long as the village scene is mounted (the effect creates and
 * disposes it, so a StrictMode double mount leaves one element) and draws the ♪ on/off chip in the HUD's left
 * column. The controller starts on the first gesture, goes quiet in the memorial hall (`useLocalArea`) and pauses
 * with the tab. The game's 🔊 toggle ("소리 켜기/끄기") silences it as well (final review m4); ♪ is the music's own choice.
 */
export function VillageBgmButton() {
  const area = useLocalArea();
  const [bgm, setBgm] = useState<VillageBgm | null>(null);
  const [on, setOn] = useState(true);
  const muted = useSoundStore((s) => s.muted);

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
    bgm?.setHall(area === "hall" || isHouseArea(area));
  }, [bgm, area]);

  useEffect(() => {
    bgm?.setMuted(muted);
  }, [bgm, muted]);

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
